importScripts('protocol-runtime.js');

const DEFAULT_OPTIONS = {
  port: 17321,
  token: '',
  commandPolling: true,
  includeHtml: false,
  includeScreenshot: true,
  screenshotRedaction: 'standard'
};

let pollInProgress = false;
let pollLoopTimer;
let pollFailureCount = 0;
let lastReplayScript;
const stateCheckpoints = new Map();
const executionRunHistory = new Map();
const recentCommandFailures = new Map();
const BROWSER_SESSION_STORAGE_KEY = 'owenBrowserSessionId';
const LATEST_BROWSER_STATE_STORAGE_KEY = 'owenLatestBrowserState';
const WORKFLOW_MACROS_STORAGE_KEY = 'owenWorkflowMacros';
const SELECTOR_MEMORY_STORAGE_KEY = 'owenSelectorMemory';
const VISUAL_ASSERT_STORAGE_KEY = 'owenVisualAssertBaseline';
const BROWSER_JOBS_STORAGE_KEY = 'owenBrowserJobs';
const SCENARIO_TEMPLATES_STORAGE_KEY = 'owenScenarioTemplates';
const AGENT_ID_STORAGE_KEY = 'owenBrowserAgentId';
const RESULT_OUTBOX_STORAGE_KEY = 'owenCommandResultOutbox';
const CONNECTION_STATUS_STORAGE_KEY = 'owenBridgeConnectionStatus';
const RUNTIME_STATE_STORAGE_KEY = 'owenBrowserRuntimeState';
const BRIDGE_PROTOCOL_VERSION = globalThis.OwenProtocolRuntime.protocolVersion;
let runtimeStateLoaded = false;

chrome.runtime.onInstalled.addListener(() => {
  ensureCommandPolling();
});

chrome.runtime.onStartup.addListener(() => {
  ensureCommandPolling();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'owen-command-poll') {
    pollForCommand().catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'wake-command-polling') {
    scheduleCommandPoll(0);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== 'capture-current-tab') {
    return false;
  }

  captureCurrentTab()
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message ?? error) }));

  return true;
});

ensureCommandPolling();

function ensureCommandPolling() {
  chrome.alarms.create('owen-command-poll', { periodInMinutes: 0.5 });
  scheduleCommandPoll(0);
}

function scheduleCommandPoll(delayMs = 250) {
  if (pollLoopTimer) {
    clearTimeout(pollLoopTimer);
  }
  pollLoopTimer = setTimeout(() => {
    pollLoopTimer = undefined;
    pollForCommand().catch(() => undefined);
  }, delayMs);
}

async function pollForCommand() {
  if (pollInProgress) {
    return;
  }

  const options = await getOptions();
  if (!options.commandPolling || !options.token) {
    return;
  }

  pollInProgress = true;
  let nextPollDelay = 250;
  try {
    const agentId = await getBrowserAgentId();
    await flushCommandResultOutbox(options);
    const hasRunnableJob = await hasRunnableBrowserJob();
    const browserVersion = encodeURIComponent(chrome.runtime.getManifest().version);
    const browserName = encodeURIComponent(getBrowserName());
    const response = await globalThis.OwenProtocolRuntime.fetchWithTimeout(`http://127.0.0.1:${options.port}/commands/next?waitMs=${hasRunnableJob ? 0 : 20000}&protocolVersion=${encodeURIComponent(BRIDGE_PROTOCOL_VERSION)}&browserVersion=${browserVersion}&browserName=${browserName}&agentId=${encodeURIComponent(agentId)}`, {
      method: 'GET',
      headers: { 'X-Owen-Bridge-Token': options.token }
    }, hasRunnableJob ? 10000 : 26000);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.message || detail.error || `Bridge poll failed with HTTP ${response.status}`);
    }

    const body = await response.json().catch(() => ({}));
    if (body.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new Error(`Bridge protocol mismatch. Browser=${BRIDGE_PROTOCOL_VERSION}, VS Code=${body.protocolVersion || 'missing'}.`);
    }
    pollFailureCount = 0;
    await rememberConnectionStatus({ ok: true, agentId, protocolVersion: BRIDGE_PROTOCOL_VERSION, extensionVersion: body.extensionVersion, updatedAt: new Date().toISOString() });
    if (body.command) {
      await acknowledgeBrowserCommand(options, body.command, agentId);
      const result = await executeBrowserCommand(body.command, options);
      result.agentId = agentId;
      await enqueueCommandResult(result);
      await flushCommandResultOutbox(options);
    } else if (hasRunnableJob) {
      await processNextBrowserJobStep();
    }
  } catch (error) {
    pollFailureCount += 1;
    nextPollDelay = globalThis.OwenProtocolRuntime.retryDelay(pollFailureCount);
    await rememberConnectionStatus({ ok: false, error: String(error?.message ?? error), retryInMs: nextPollDelay, updatedAt: new Date().toISOString() });
  } finally {
    pollInProgress = false;
    scheduleCommandPoll(nextPollDelay);
  }
}

async function getBrowserAgentId() {
  const stored = await chrome.storage.local.get(AGENT_ID_STORAGE_KEY);
  if (stored[AGENT_ID_STORAGE_KEY]) {
    return stored[AGENT_ID_STORAGE_KEY];
  }
  const id = `agent-${crypto.randomUUID()}`;
  await chrome.storage.local.set({ [AGENT_ID_STORAGE_KEY]: id });
  return id;
}

function getBrowserName() {
  const userAgent = navigator.userAgent || '';
  if (/Edg\//.test(userAgent)) {
    return 'Edge';
  }
  if (/Chrome\//.test(userAgent)) {
    return 'Chrome';
  }
  return 'Chromium';
}

async function rememberConnectionStatus(status) {
  await chrome.storage.local.set({ [CONNECTION_STATUS_STORAGE_KEY]: status });
}

async function ensureRuntimeStateLoaded() {
  if (runtimeStateLoaded) {
    return;
  }
  const stored = await chrome.storage.local.get(RUNTIME_STATE_STORAGE_KEY);
  const state = stored[RUNTIME_STATE_STORAGE_KEY] || {};
  restoreMap(stateCheckpoints, state.checkpoints, 100);
  restoreMap(executionRunHistory, state.runs, 100);
  restoreMap(recentCommandFailures, state.failures, 50);
  runtimeStateLoaded = true;
}

function restoreMap(target, entries, limit) {
  target.clear();
  if (!Array.isArray(entries)) {
    return;
  }
  for (const entry of entries.slice(-limit)) {
    if (Array.isArray(entry) && entry.length === 2 && entry[0]) {
      target.set(entry[0], entry[1]);
    }
  }
}

async function persistRuntimeState() {
  await chrome.storage.local.set({
    [RUNTIME_STATE_STORAGE_KEY]: {
      checkpoints: [...stateCheckpoints.entries()].slice(-100),
      runs: [...executionRunHistory.entries()].slice(-100),
      failures: [...recentCommandFailures.entries()].slice(-50),
      updatedAt: new Date().toISOString()
    }
  });
}

async function acknowledgeBrowserCommand(options, command, agentId) {
  const response = await globalThis.OwenProtocolRuntime.fetchWithTimeout(`http://127.0.0.1:${options.port}/commands/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Owen-Bridge-Token': options.token
    },
    body: JSON.stringify({ id: command.id, agentId, leaseMs: Math.min(Math.max(Number(command.timeoutMs) + 45000, 60000), 600000) })
  }, 10000);
  if (!response.ok) {
    throw new Error(`Failed to acknowledge browser command ${command.id}: HTTP ${response.status}`);
  }
}

async function executeBrowserCommand(command, options) {
  try {
    await ensureRuntimeStateLoaded();
    const workflow = command.action === 'runWorkflow' ? normalizeWorkflowSteps(command.steps) : [command];
    const executionTrail = [];
    let beforeAfterDiff;
    let staleBatchGuard;

    if (command.captureBeforeAfter) {
      const activeTab = await getActiveTab();
      const before = await collectDomFingerprint(activeTab.id);
      const beforeUrl = activeTab.url;
      const execution = await executeWorkflowSteps(workflow, command.allowedHosts);
      executionTrail.push(...execution.steps);
      staleBatchGuard = execution.staleBatchGuard;
      const afterTab = await getActiveTab();
      const after = await collectDomFingerprint(afterTab.id);
      beforeAfterDiff = {
        beforeHash: before.hash,
        afterHash: after.hash,
        changed: before.hash !== after.hash || beforeUrl !== afterTab.url,
        urlChanged: beforeUrl !== afterTab.url,
        textDelta: after.textLength - before.textLength,
        headingDelta: after.headings - before.headings
      };
    } else {
      const execution = await executeWorkflowSteps(workflow, command.allowedHosts);
      executionTrail.push(...execution.steps);
      staleBatchGuard = execution.staleBatchGuard;
    }

    const currentTab = await getActiveTab();
    const screenshotOverride = extractScreenshotOverride(executionTrail);
    const capture = command.captureAfter || command.action === 'capture'
      ? await createCapturePayload(currentTab, command, options, screenshotOverride)
      : undefined;
    const browserSession = capture?.browserSession ?? await buildBrowserSessionState(currentTab, command, undefined, false);
    await rememberBrowserState(browserSession);
    const response = {
      id: command.id,
      ok: true,
      result: {
        runId: command.id,
        action: command.action,
        steps: executionTrail,
        beforeAfterDiff,
        staleBatchGuard,
        url: currentTab.url,
        title: currentTab.title,
        tabIndex: currentTab.index,
        browserSession
      },
      capture
    };

    executionRunHistory.set(command.id, {
      runId: command.id,
      createdAt: new Date().toISOString(),
      action: command.action,
      url: currentTab.url,
      title: currentTab.title,
      steps: executionTrail
    });
    if (executionRunHistory.size > 100) {
      const oldest = executionRunHistory.keys().next().value;
      if (oldest) {
        executionRunHistory.delete(oldest);
      }
    }
    await persistRuntimeState();

    lastReplayScript = {
      exportedAt: new Date().toISOString(),
      action: command.action,
      command: { ...command, allowedHosts: undefined },
      steps: executionTrail
    };

    return response;
  } catch (error) {
    const message = String(error?.message ?? error);
    await rememberCommandFailure(command, message);
    const authPrefix = 'AUTH_REQUIRED::';
    if (message.startsWith(authPrefix)) {
      const payloadText = message.slice(authPrefix.length);
      const payload = JSON.parse(payloadText);
      return { id: command.id, ok: false, error: 'AUTH_REQUIRED', result: payload };
    }

    const reviewPrefix = 'REVIEW_REQUIRED::';
    if (message.startsWith(reviewPrefix)) {
      const payloadText = message.slice(reviewPrefix.length);
      const payload = JSON.parse(payloadText);
      return { id: command.id, ok: false, error: 'REVIEW_REQUIRED', result: payload };
    }

    return { id: command.id, ok: false, error: message };
  }
}

function normalizeWorkflowSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Workflow has no steps.');
  }

  return steps.map(step => ({ ...step, action: step.action ?? 'readPage' }));
}

async function executeWorkflowSteps(workflow, allowedHosts) {
  const steps = [];
  for (let index = 0; index < workflow.length; index += 1) {
    const step = workflow[index];
    const before = workflow.length > 1 ? await collectActionEffectState(step).catch(() => undefined) : undefined;
    const result = await executeSingleAction(step, allowedHosts);
    steps.push({ action: step.action, result });
    if (index >= workflow.length - 1) {
      continue;
    }
    const after = await collectActionEffectState(step).catch(() => undefined);
    const reason = globalThis.OwenProtocolRuntime.staleBatchReason(before, after, step.action);
    if (reason) {
      return {
        steps,
        staleBatchGuard: {
          stopped: true,
          reason,
          stoppedAfterIndex: index,
          skippedActions: workflow.slice(index + 1).map(item => item.action)
        }
      };
    }
  }
  return { steps, staleBatchGuard: { stopped: false } };
}

async function executeSingleAction(command, allowedHosts) {
  const action = command.action ?? 'readPage';
  const effectActions = new Set(['click', 'type', 'scroll', 'keyPress', 'selectOption', 'clearInput']);
  const effectPolicy = effectActions.has(action) ? String(command.effectPolicy || 'observe') : 'none';
  const before = effectPolicy === 'none' ? undefined : await collectActionEffectState(command).catch(() => undefined);
  const result = await executeSingleActionCore(command, allowedHosts);
  if (!before) {
    return result;
  }

  await sleep(action === 'scroll' ? 350 : 150);
  const after = await collectActionEffectState(command).catch(() => undefined);
  if (!after) {
    return result;
  }

  const changes = [];
  if (before.tabId !== after.tabId) { changes.push('tab'); }
  if (before.url !== after.url) { changes.push('url'); }
  if (before.domHash !== after.domHash) { changes.push('dom'); }
  if (before.scrollX !== after.scrollX || before.scrollY !== after.scrollY) { changes.push('scroll'); }
  if (before.activeElement !== after.activeElement) { changes.push('focus'); }
  if (before.targetState !== after.targetState) { changes.push('target'); }
  const effect = { policy: effectPolicy, observed: changes.length > 0, changes, before, after };
  if (effectPolicy === 'require' && !effect.observed) {
    throw new Error(`Browser action produced no observable effect: ${action}`);
  }

  return result && typeof result === 'object' ? { ...result, effect } : { ok: true, result, effect };
}

async function executeSingleActionCore(command, allowedHosts) {
  const action = command.action ?? 'readPage';

  ensureOperatorConfirmed(command, action);

  if (action === 'journeyCapture') {
    return runJourneyCapture(command, allowedHosts);
  }

  if (action === 'paginateCapture') {
    return runPaginateCapture(command, allowedHosts);
  }

  if (action === 'smartFormFill') {
    return runSmartFormFill(command, allowedHosts);
  }

  if (action === 'conditionalWorkflow') {
    return runConditionalWorkflow(command, allowedHosts);
  }

  if (action === 'multiTabCrawl') {
    return runMultiTabCrawl(command, allowedHosts);
  }

  if (action === 'runtimeSnapshot') {
    return runRuntimeSnapshot(command, allowedHosts);
  }

  if (action === 'domDiffTimeline') {
    return runDomDiffTimeline(command, allowedHosts);
  }

  if (action === 'ocrSnapshot') {
    return runOcrSnapshot(command, allowedHosts);
  }

  if (action === 'dataGapGuard') {
    return runDataGapGuard(command, allowedHosts);
  }

  if (action === 'exportReplay') {
    return runExportReplay();
  }

  if (action === 'networkTraceCapture') {
    return runNetworkTraceCapture(command, allowedHosts);
  }

  if (action === 'safeDownloadAndHash') {
    return runSafeDownloadAndHash(command, allowedHosts);
  }

  if (action === 'tableExtract') {
    return runTableExtract(command, allowedHosts);
  }

  if (action === 'stateCheckpoint') {
    return runStateCheckpoint(command, allowedHosts);
  }

  if (action === 'rollbackToCheckpoint') {
    return runRollbackToCheckpoint(command, allowedHosts);
  }

  if (action === 'humanReviewGate') {
    return runHumanReviewGate(command, allowedHosts);
  }

  if (action === 'bulkActionFromList') {
    return runBulkActionFromList(command, allowedHosts);
  }

  if (action === 'semanticWait') {
    return runSemanticWait(command, allowedHosts);
  }

  if (action === 'compareCaptureRuns') {
    return runCompareCaptureRuns(command);
  }

  if (action === 'policyGuard') {
    return runPolicyGuard(command, allowedHosts);
  }

  if (action === 'visualAssert') {
    return runVisualAssert(command, allowedHosts);
  }

  if (action === 'accessibilitySnapshot') {
    return runAccessibilitySnapshot(command, allowedHosts);
  }

  if (action === 'mapForm') {
    return runMapForm(command, allowedHosts);
  }

  if (action === 'watchPageChanges') {
    return runWatchPageChanges(command, allowedHosts);
  }

  if (action === 'highlightEvidence') {
    return runHighlightEvidence(command, allowedHosts);
  }

  if (action === 'planAndRun') {
    return runPlanAndRun(command, allowedHosts);
  }

  if (action === 'evidenceClaimCheck') {
    return runEvidenceClaimCheck(command, allowedHosts);
  }

  if (action === 'tableWatchAndDiff') {
    return runTableWatchAndDiff(command, allowedHosts);
  }

  if (action === 'browserRunBundle') {
    return runBrowserRunBundle(command, allowedHosts);
  }

  if (action === 'safeActionPreview') {
    return runSafeActionPreview(command, allowedHosts);
  }

  if (action === 'stableTargetProfile') {
    return runStableTargetProfile(command, allowedHosts);
  }

  if (action === 'guidedDrilldown') {
    return runGuidedDrilldown(command, allowedHosts);
  }

  if (action === 'evidenceCompletenessCheck') {
    return runEvidenceCompletenessCheck(command, allowedHosts);
  }

  if (action === 'failureExplainer') {
    return runFailureExplainer(command, allowedHosts);
  }

  if (action === 'waitProfiler') {
    return runWaitProfiler(command, allowedHosts);
  }

  if (action === 'automationHealthScore') {
    return runAutomationHealthScore(command, allowedHosts);
  }

  if (action === 'sensitiveActionGuard') {
    return runSensitiveActionGuard(command, allowedHosts);
  }

  if (action === 'tabOrchestrator') {
    return runTabOrchestrator(command, allowedHosts);
  }

  if (action === 'popupGuard') {
    return runPopupGuard(command, allowedHosts);
  }

  if (action === 'returnToTab') {
    return runReturnToTab(command, allowedHosts);
  }

  if (action === 'tabRunSummary') {
    return runTabRunSummary(command, allowedHosts);
  }

  if (action === 'buildEvidencePack') {
    return runBuildEvidencePack(command, allowedHosts);
  }

  if (action === 'buildNavigationGraph') {
    return runBuildNavigationGraph(command);
  }

  if (action === 'assertPageContract') {
    return runAssertPageContract(command, allowedHosts);
  }

  if (action === 'createHandoff') {
    return runCreateHandoff(command, allowedHosts);
  }

  if (action === 'selectorHealthReport') {
    return runSelectorHealthReport();
  }

  if (action === 'captureReviewQueue') {
    return runCaptureReviewQueue(command);
  }

  if (action === 'startBrowserJob') {
    return runStartBrowserJob(command, allowedHosts);
  }

  if (action === 'getBrowserJob') {
    return runGetBrowserJob(command);
  }

  if (action === 'cancelBrowserJob') {
    return runCancelBrowserJob(command);
  }

  if (action === 'waitPreset') {
    return runWaitPreset(command, allowedHosts);
  }

  if (action === 'recordWorkflow') {
    return runRecordWorkflow(command);
  }

  if (action === 'replayWorkflow') {
    return runReplayWorkflow(command, allowedHosts);
  }

  if (action === 'listScenarioTemplates') {
    return runListScenarioTemplates();
  }

  if (action === 'saveScenarioTemplate') {
    return runSaveScenarioTemplate(command);
  }

  if (action === 'deleteScenarioTemplate') {
    return runDeleteScenarioTemplate(command);
  }

  if (action === 'exportScenarioTemplates') {
    return runExportScenarioTemplates();
  }

  if (action === 'runScenarioTemplate') {
    return runScenarioTemplate(command, allowedHosts);
  }

  if (action === 'navigate') {
    assertAllowedUrl(command.url, allowedHosts);
    const tab = await getActiveTab();
    const navigationKind = await waitForNavigationReady(tab.id, command.timeoutMs, tab.url, () => chrome.tabs.update(tab.id, { url: command.url }));
    const updated = await chrome.tabs.get(tab.id);
    return { ok: true, url: updated.url, title: updated.title, navigationKind };
  }

  if (action === 'openInNewTab') {
    assertAllowedUrl(command.url, allowedHosts);
    const created = await chrome.tabs.create({ url: command.url, active: true });
    if (!hasTabId(created)) {
      throw new Error('Failed to create a new tab.');
    }

    await waitForTabComplete(created.id, command.timeoutMs);
    return { ok: true, tabIndex: created.index, url: created.url, title: created.title };
  }

  if (action === 'switchTab') {
    if (!Number.isInteger(command.targetTabIndex)) {
      throw new Error('switchTab requires targetTabIndex.');
    }

    const target = await getTabByIndex(command.targetTabIndex);
    await chrome.tabs.update(target.id, { active: true });
    return { ok: true, tabIndex: target.index, url: target.url, title: target.title };
  }

  if (action === 'closeTab') {
    if (!command.confirmDangerous) {
      throw new Error('closeTab requires confirmDangerous=true.');
    }

    const tab = Number.isInteger(command.targetTabIndex)
      ? await getTabByIndex(command.targetTabIndex)
      : await getActiveTab();
    await chrome.tabs.remove(tab.id);
    return { ok: true, closedTabIndex: tab.index };
  }

  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  if (action === 'back') {
    const navigationKind = await waitForNavigationReady(tab.id, command.timeoutMs, tab.url, () => chrome.tabs.goBack(tab.id)).catch(() => undefined);
    return { ok: true, navigationKind };
  }

  if (action === 'forward') {
    const navigationKind = await waitForNavigationReady(tab.id, command.timeoutMs, tab.url, () => chrome.tabs.goForward(tab.id)).catch(() => undefined);
    return { ok: true, navigationKind };
  }

  if (action === 'reload') {
    const navigationKind = await waitForNavigationReady(tab.id, command.timeoutMs, tab.url, () => chrome.tabs.reload(tab.id));
    return { ok: true, navigationKind };
  }

  if (action === 'capture') {
    return { ok: true };
  }

  if (action === 'readPage') {
    const [{ result: pageSnapshot }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageSnapshot,
      args: [command.includeHtml]
    });
    const browserSession = await buildBrowserSessionState(tab, command, pageSnapshot?.screenSummary, false);
    await rememberBrowserState(browserSession);
    return { ok: true, page: pageSnapshot, browserSession };
  }

  if (action === 'inspectTargets') {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectTargetsOnPage,
      args: [buildTargetIntent(command)]
    });
    return result ?? { ok: true, rankedTargets: [] };
  }

  if (action === 'captureElement') {
    return runCaptureElement(command, allowedHosts);
  }

  if (action === 'captureRegion') {
    return runCaptureRegion(command, allowedHosts);
  }

  const targets = await buildTargetCandidatesWithMemory(command, tab);
  const retryProfile = String(command.retryProfile || 'standard');
  const profileRetries = retryProfile === 'conservative' ? 0 : retryProfile === 'aggressive' ? 3 : 1;
  const maxRetries = Number.isInteger(command.retries) ? command.retries : profileRetries;
  let lastError = 'Action failed.';

  for (let retry = 0; retry <= maxRetries; retry += 1) {
    if (retry > 0) {
      const backoffMs = retryProfile === 'aggressive' ? retry * 300 : retryProfile === 'conservative' ? retry * 900 : retry * 600;
      await sleep(backoffMs);
    }
    for (const candidate of targets) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: runDomCommand,
        args: [{ ...command, ...candidate }]
      });
      if (!result?.error) {
        await rememberSelectorSuccess(command, tab, candidate, false).catch(() => undefined);
        return result ?? { ok: true };
      }

      lastError = result.error;
    }
  }

  if (command.autoHeal) {
    const [{ result: inspection }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectTargetsOnPage,
      args: [buildTargetIntent(command)]
    });
    const healedTargets = Array.isArray(inspection?.rankedTargets)
      ? inspection.rankedTargets
        .filter(target => target.selectorHint || target.text || target.accessibleName)
        .slice(0, 5)
        .map(target => ({
          selector: target.selectorHint,
          text: target.selectorHint ? undefined : (target.text || target.accessibleName),
          label: target.accessibleName,
          role: target.role,
          index: 0
        }))
      : [];

    for (const candidate of healedTargets) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: runDomCommand,
        args: [{ ...command, ...candidate }]
      });
      if (!result?.error) {
        await rememberSelectorSuccess(command, tab, candidate, true).catch(() => undefined);
        return { ...(result ?? { ok: true }), autoHealed: true, target: candidate, inspection };
      }

      lastError = result.error;
    }
  }

  throw new Error(lastError);
}

function ensureOperatorConfirmed(command, action) {
  const highRisk = new Set(['navigate', 'openInNewTab', 'closeTab', 'journeyCapture', 'paginateCapture', 'multiTabCrawl', 'bulkActionFromList', 'safeDownloadAndHash', 'replayWorkflow']);
  if (!highRisk.has(action)) {
    return;
  }

  if (!command.acknowledgement || command.acknowledgement === 'CONFIRM_BROWSER_ACTION') {
    return;
  }

  throw new Error('High-risk action requires acknowledgement=CONFIRM_BROWSER_ACTION.');
}

async function runSmartFormFill(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: runDomCommand,
    args: [{ action: 'smartFormFill', formFields: command.formFields, submitSelector: command.submitSelector, submitText: command.submitText }]
  });
  if (result?.error) {
    throw new Error(result.error);
  }

  return result ?? { ok: true };
}

async function runConditionalWorkflow(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  const outputs = [];
  const conditions = Array.isArray(command.conditions) ? command.conditions : [];
  for (const entry of conditions) {
    const matched = await evaluateConditionOnTab(tab.id, entry?.if);
    const selectedSteps = matched ? (Array.isArray(entry?.then) ? entry.then : []) : (Array.isArray(entry?.else) ? entry.else : []);
    const results = [];
    for (const step of selectedSteps.slice(0, 20)) {
      const stepResult = await executeSingleAction({ ...command, ...step, action: step.action ?? 'readPage' }, allowedHosts);
      results.push(stepResult);
    }
    outputs.push({ matched, stepsExecuted: selectedSteps.length, results });
  }

  return { ok: true, branches: outputs };
}

async function runMultiTabCrawl(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const maxTabs = Math.min(Math.max(Number(command.maxTabs) || 5, 1), 30);

  const [{ result: links }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (linkSelector, linkText, max) => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      const nodes = linkSelector
        ? Array.from(document.querySelectorAll(linkSelector))
        : Array.from(document.querySelectorAll('a[href]'));
      const filterText = normalize(linkText);
      return nodes
        .map(node => ({ href: node.href, text: normalize(node.innerText || node.getAttribute('aria-label') || '') }))
        .filter(item => item.href && (!filterText || item.text.includes(filterText)))
        .slice(0, max)
        .map(item => item.href);
    },
    args: [command.linkSelector, command.linkText, maxTabs]
  });

  const targets = Array.isArray(links) ? links : [];
  const pages = [];
  for (const href of targets) {
    assertAllowedUrl(href, allowedHosts);
    const created = await chrome.tabs.create({ url: href, active: false });
    if (!hasTabId(created)) {
      continue;
    }
    await waitForTabComplete(created.id, command.timeoutMs).catch(() => undefined);
    const summary = await collectTabSummary(created.id, command.extractSelectors);
    pages.push(summary);
    await chrome.tabs.remove(created.id).catch(() => undefined);
  }

  return { ok: true, crawled: pages.length, pages };
}

async function runRuntimeSnapshot(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const resources = performance.getEntriesByType('resource').slice(-30).map(entry => ({
        name: entry.name,
        type: entry.initiatorType,
        duration: Math.round(entry.duration)
      }));
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = performance.getEntriesByType('paint').map(entry => ({ name: entry.name, startTime: Math.round(entry.startTime) }));
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      const lcp = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : undefined;
      const layoutShifts = performance.getEntriesByType('layout-shift').filter(entry => !entry.hadRecentInput);
      const cls = layoutShifts.reduce((total, entry) => total + Number(entry.value || 0), 0);
      const longTasks = performance.getEntriesByType('longtask');
      return {
        ok: true,
        url: location.href,
        title: document.title,
        navigation: nav ? {
          timeToFirstByte: Math.round(nav.responseStart),
          dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
          connection: Math.round(nav.connectEnd - nav.connectStart),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          loadEventEnd: Math.round(nav.loadEventEnd)
        } : undefined,
        webVitals: {
          firstContentfulPaint: paints.find(entry => entry.name === 'first-contentful-paint')?.startTime,
          largestContentfulPaint: lcp ? Math.round(lcp.startTime) : undefined,
          cumulativeLayoutShift: Number(cls.toFixed(4)),
          longTaskCount: longTasks.length,
          longTaskTotalDuration: Math.round(longTasks.reduce((total, entry) => total + entry.duration, 0)),
          longestTaskDuration: Math.round(Math.max(0, ...longTasks.map(entry => entry.duration)))
        },
        paints,
        resources,
        consoleSupport: 'Console log history is not persisted in MV3 runtime by default.'
      };
    }
  });
  return result ?? { ok: true };
}

async function runDomDiffTimeline(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const timeline = [];
  let before = await collectDomFingerprint(tab.id);

  const steps = Array.isArray(command.steps) ? command.steps.slice(0, 20) : [];
  for (const step of steps) {
    const result = await executeSingleAction({ ...command, ...step, action: step.action ?? 'readPage' }, allowedHosts);
    const after = await collectDomFingerprint(tab.id);
    timeline.push({
      action: step.action ?? 'readPage',
      result,
      beforeHash: before.hash,
      afterHash: after.hash,
      textDelta: after.textLength - before.textLength,
      headingDelta: after.headings - before.headings
    });
    before = after;
  }

  return { ok: true, timeline };
}

async function runOcrSnapshot(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const captured = await captureVisibleTabWithRedaction(tab);
  const [{ result: hint }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const altTexts = Array.from(document.querySelectorAll('img[alt]')).slice(0, 50).map(node => normalize(node.getAttribute('alt'))).filter(Boolean);
      const visibleText = normalize(document.body?.innerText ?? '').slice(0, 2000);
      return { altTexts, visibleText };
    }
  });

  return {
    ok: true,
    ocrSupported: false,
    message: 'True OCR is not embedded in this runtime. Returned screenshot and DOM-based text hints instead.',
    screenshotDataUrl: captured.dataUrl,
    screenshotRedaction: captured.redaction,
    hint
  };
}

async function runDataGapGuard(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const summary = await collectTabSummary(tab.id, command.extractSelectors);
  const requiredFields = Array.isArray(command.requiredFields) ? command.requiredFields : [];
  const requiredTexts = Array.isArray(command.requiredTexts) ? command.requiredTexts : [];

  const missingFields = requiredFields.filter(field => !summary.extracted || !String(summary.extracted[field] ?? '').trim());
  const visibleLower = String(summary.visibleTextSample ?? '').toLowerCase();
  const missingTexts = requiredTexts.filter(text => !visibleLower.includes(String(text).toLowerCase()));

  return {
    ok: true,
    summary,
    missingFields,
    missingTexts,
    gapDetected: missingFields.length > 0 || missingTexts.length > 0
  };
}

function runExportReplay() {
  return {
    ok: true,
    replay: lastReplayScript ?? null,
    message: lastReplayScript ? 'Replay script exported from latest browser action.' : 'No replay script is available yet.'
  };
}

async function runNetworkTraceCapture(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (urlIncludes, maxEntries) => {
      const filters = Array.isArray(urlIncludes) ? urlIncludes.map(value => String(value).toLowerCase()).filter(Boolean) : [];
      const rows = performance.getEntriesByType('resource')
        .map(entry => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          durationMs: Math.round(entry.duration),
          transferSize: Number(entry.transferSize || 0)
        }))
        .filter(item => filters.length === 0 || filters.some(filter => item.name.toLowerCase().includes(filter)))
        .slice(-Math.min(Math.max(Number(maxEntries) || 30, 1), 200));
      return { ok: true, capturedAt: new Date().toISOString(), trace: rows };
    },
    args: [command.urlIncludes, command.maxEntries]
  });
  return result ?? { ok: true, trace: [] };
}

async function runSafeDownloadAndHash(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (selector, text, explicitUrl) => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      const byText = normalize(text);
      let targetUrl = explicitUrl;
      if (!targetUrl) {
        const node = selector
          ? document.querySelector(selector)
          : Array.from(document.querySelectorAll('a[href],button,[role="button"]')).find(element => {
            const label = normalize(element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '');
            return byText && label.includes(byText);
          });
        targetUrl = node?.href || node?.getAttribute?.('data-href') || '';
      }

      if (!targetUrl) {
        return { error: 'Download URL could not be resolved.' };
      }

      const response = await fetch(targetUrl, { credentials: 'include' });
      if (!response.ok) {
        return { error: `Download request failed: HTTP ${response.status}` };
      }

      const buffer = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hashHex = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
      return {
        ok: true,
        url: targetUrl,
        sizeBytes: buffer.byteLength,
        sha256: hashHex,
        contentType: response.headers.get('content-type') || undefined
      };
    },
    args: [command.selector, command.text, command.url]
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  return result ?? { ok: true };
}

async function runCaptureElement(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  const [{ result: targetResult }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: resolveCaptureElementRegion,
    args: [{
      selector: command.selector,
      text: command.text,
      label: command.label,
      role: command.role,
      index: command.index,
      targetHint: command.targetHint,
      regionPadding: command.regionPadding,
      targetScope: command.targetScope,
      frameDepth: command.frameDepth
    }]
  });

  if (targetResult?.error) {
    throw new Error(targetResult.error);
  }

  const clipped = await captureRegionImage(tab, targetResult.region);
  return {
    ok: true,
    screenshotDataUrl: clipped.dataUrl,
    screenshotMimeType: 'image/png',
    screenshotRedaction: clipped.redaction,
    captureRegion: targetResult.region,
    captureTarget: targetResult.target
  };
}

async function runCaptureRegion(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  const [{ result: metrics }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    })
  });

  const region = normalizeCaptureRegion({
    x: command.regionX,
    y: command.regionY,
    width: command.regionWidth,
    height: command.regionHeight,
    padding: command.regionPadding,
    viewportWidth: metrics?.viewportWidth,
    viewportHeight: metrics?.viewportHeight,
    devicePixelRatio: metrics?.devicePixelRatio
  });

  const clipped = await captureRegionImage(tab, region);
  return {
    ok: true,
    screenshotDataUrl: clipped.dataUrl,
    screenshotMimeType: 'image/png',
    screenshotRedaction: clipped.redaction,
    captureRegion: region
  };
}

async function runTableExtract(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (tableSelector, headerMode, outputFormat) => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const table = tableSelector ? document.querySelector(tableSelector) : document.querySelector('table');
      if (!table) {
        return { error: 'Table not found.' };
      }

      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length === 0) {
        return { ok: true, rows: [], csv: '' };
      }

      const hasThead = table.querySelectorAll('thead th').length > 0;
      const mode = headerMode || 'auto';
      const headerCells = mode === 'thead' || (mode === 'auto' && hasThead)
        ? Array.from(table.querySelectorAll('thead th'))
        : Array.from(rows[0].querySelectorAll('th,td'));
      const headers = headerCells.map(cell => normalize(cell.textContent || '')).map((value, index) => value || `col_${index + 1}`);

      const bodyRows = mode === 'firstRow' || (!hasThead && mode === 'auto') ? rows.slice(1) : rows;
      const data = bodyRows
        .map(row => Array.from(row.querySelectorAll('td,th')).map(cell => normalize(cell.textContent || '')))
        .filter(cells => cells.length > 0)
        .map(cells => {
          const record = {};
          headers.forEach((header, index) => {
            record[header] = cells[index] ?? '';
          });
          return record;
        });

      const csvLines = [headers, ...data.map(record => headers.map(header => String(record[header] ?? '').replace(/"/g, '""')))]
        .map(line => line.map(cell => `"${cell}"`).join(','));
      return {
        ok: true,
        headers,
        rowCount: data.length,
        rows: outputFormat === 'csv' ? undefined : data,
        csv: csvLines.join('\n')
      };
    },
    args: [command.tableSelector, command.headerMode, command.outputFormat]
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  return result ?? { ok: true, rows: [] };
}

async function runStateCheckpoint(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const checkpointName = String(command.checkpointName || '').trim();

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: includeFormState => {
      const formState = [];
      if (includeFormState) {
        const controls = Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 300);
        for (const element of controls) {
          const key = element.id || element.name || element.getAttribute('aria-label') || '';
          if (!key) {
            continue;
          }
          formState.push({
            key,
            value: element.type === 'checkbox' || element.type === 'radio' ? String(Boolean(element.checked)) : String(element.value ?? ''),
            type: element.type || element.tagName.toLowerCase()
          });
        }
      }

      return {
        ok: true,
        url: location.href,
        title: document.title,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        formState
      };
    },
    args: [Boolean(command.includeFormState)]
  });

  if (!checkpointName) {
    throw new Error('stateCheckpoint requires checkpointName.');
  }

  stateCheckpoints.set(checkpointName, {
    checkpointName,
    createdAt: new Date().toISOString(),
    tabIndex: tab.index,
    ...result
  });
  await persistRuntimeState();

  return { ok: true, checkpointName, saved: stateCheckpoints.get(checkpointName) };
}

async function runRollbackToCheckpoint(command, allowedHosts) {
  const checkpointName = String(command.checkpointName || '').trim();
  const checkpoint = stateCheckpoints.get(checkpointName);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${checkpointName}`);
  }

  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  if (command.strictUrlMatch && checkpoint.url !== tab.url) {
    throw new Error('strictUrlMatch=true and current URL differs from checkpoint URL.');
  }

  if (checkpoint.url && checkpoint.url !== tab.url) {
    await chrome.tabs.update(tab.id, { url: checkpoint.url });
    await waitForTabComplete(tab.id, command.timeoutMs).catch(() => undefined);
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: saved => {
      const entries = Array.isArray(saved?.formState) ? saved.formState : [];
      for (const entry of entries) {
        const selector = `#${CSS.escape(entry.key)}`;
        const byId = document.querySelector(selector);
        const byName = document.querySelector(`[name="${CSS.escape(entry.key)}"]`);
        const target = byId || byName;
        if (!target) {
          continue;
        }

        if (target.type === 'checkbox' || target.type === 'radio') {
          target.checked = entry.value === 'true';
        } else {
          target.value = entry.value;
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }

      window.scrollTo({ left: Number(saved?.scrollX) || 0, top: Number(saved?.scrollY) || 0, behavior: 'auto' });
      return { ok: true, restoredCount: entries.length, url: location.href };
    },
    args: [checkpoint]
  });

  return result ?? { ok: true, checkpointName };
}

async function runHumanReviewGate(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  const expected = String(command.approvalKeyword || '').trim();
  const provided = String(command.value || '').trim();
  if (expected && provided && expected === provided) {
    return { ok: true, approved: true, message: 'Manual review approved.' };
  }

  throw new Error(`REVIEW_REQUIRED::${JSON.stringify({
    reviewRequired: true,
    message: command.reviewPrompt || '위험 단계 전 수동 검토가 필요합니다. approvalKeyword 값을 확인해 다시 실행하세요.',
    approvalKeyword: expected || undefined
  })}`);
}

async function runBulkActionFromList(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (itemSelector, matchText, matchMode, actionTemplate, maxItems) => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      const nodes = Array.from(document.querySelectorAll(itemSelector));
      const mode = matchMode || 'includes';
      const needle = normalize(matchText || '');
      const limit = Math.min(Math.max(Number(maxItems) || 20, 1), 200);

      const matched = nodes.filter(node => {
        if (!needle) {
          return true;
        }
        const hay = normalize(node.innerText || node.textContent || '');
        if (mode === 'equals') {
          return hay === needle;
        }
        if (mode === 'regex') {
          try {
            return new RegExp(matchText, 'i').test(hay);
          } catch {
            return false;
          }
        }
        return hay.includes(needle);
      }).slice(0, limit);

      const action = String(actionTemplate?.action || 'click');
      const details = [];
      for (const node of matched) {
        if (action === 'click') {
          node.click();
        } else if (action === 'hover') {
          node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }
        details.push({ action, text: normalize(node.innerText || node.textContent || '').slice(0, 200) });
      }

      return { ok: true, processed: details.length, details };
    },
    args: [command.itemSelector, command.matchText, command.matchMode, command.actionTemplate, command.maxItems]
  });

  return result ?? { ok: true, processed: 0, details: [] };
}

async function runSemanticWait(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: runDomCommand,
    args: [{ action: 'wait', wait: { kind: 'semantic', semanticConditions: command.semanticConditions }, timeoutMs: command.timeoutMs }]
  });

  if (result?.error) {
    throw new Error(result.error);
  }
  return result ?? { ok: true };
}

function runCompareCaptureRuns(command) {
  const runIds = Array.from(executionRunHistory.keys());
  const latestRunId = command.newRunId || runIds[runIds.length - 1];
  const baseRunId = command.baseRunId || runIds[runIds.length - 2];
  if (!latestRunId || !baseRunId) {
    throw new Error('compareCaptureRuns requires at least two run histories.');
  }

  const base = executionRunHistory.get(baseRunId);
  const latest = executionRunHistory.get(latestRunId);
  if (!base || !latest) {
    throw new Error('compareCaptureRuns run id not found in current session history.');
  }

  const baseStepCount = Array.isArray(base.steps) ? base.steps.length : 0;
  const latestStepCount = Array.isArray(latest.steps) ? latest.steps.length : 0;
  return {
    ok: true,
    baseRunId,
    newRunId: latestRunId,
    changed: {
      urlChanged: base.url !== latest.url,
      titleChanged: base.title !== latest.title,
      stepDelta: latestStepCount - baseStepCount
    },
    base,
    latest,
    ignoredSelectors: Array.isArray(command.ignoreSelectors) ? command.ignoreSelectors : []
  };
}

async function runPolicyGuard(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const host = new URL(tab.url).hostname.toLowerCase();

  const profiles = {
    strict: {
      allowedSuffixes: ['microsoft.com', 'microsoft365.com'],
      blockedActions: ['closeTab']
    },
    standard: {
      allowedSuffixes: [],
      blockedActions: []
    },
    investigation: {
      allowedSuffixes: ['microsoft.com', 'microsoft365.com', 'azure.com'],
      blockedActions: []
    }
  };

  const profile = profiles[String(command.policyProfile || 'standard')] || profiles.standard;
  const hostAllowed = profile.allowedSuffixes.length === 0 || profile.allowedSuffixes.some(suffix => host.endsWith(suffix));
  const actionBlocked = profile.blockedActions.includes(String(command.actionTemplate?.action || ''));
  const violations = [];
  if (!hostAllowed) {
    violations.push(`Host not allowed by policy profile: ${host}`);
  }
  if (actionBlocked) {
    violations.push(`Action blocked by policy profile: ${command.actionTemplate?.action}`);
  }

  if (violations.length > 0 && command.onViolation !== 'warn') {
    throw new Error(`Policy violation: ${violations.join('; ')}`);
  }

  return {
    ok: true,
    profile: command.policyProfile,
    host,
    violations,
    passed: violations.length === 0
  };
}

async function runVisualAssert(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: input => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const visibleText = normalize(document.body?.innerText ?? '');
      const isVisible = element => {
        if (!element) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const assertions = [];
      const add = (name, passed, detail) => assertions.push({ name, passed, detail });
      if (input.assertText) {
        add('assertText', visibleText.includes(String(input.assertText)), input.assertText);
      }
      if (input.assertNoText) {
        add('assertNoText', !visibleText.includes(String(input.assertNoText)), input.assertNoText);
      }
      if (input.assertSelector) {
        add('assertSelector', isVisible(document.querySelector(String(input.assertSelector))), input.assertSelector);
      }
      if (input.assertNotSelector) {
        add('assertNotSelector', !isVisible(document.querySelector(String(input.assertNotSelector))), input.assertNotSelector);
      }
      let hash = 2166136261;
      for (let i = 0; i < visibleText.length; i += 1) {
        hash ^= visibleText.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return {
        assertions,
        fingerprint: {
          hash: `h${(hash >>> 0).toString(16)}`,
          textLength: visibleText.length,
          title: document.title,
          url: location.href
        }
      };
    },
    args: [command]
  });

  const stored = await chrome.storage.local.get(VISUAL_ASSERT_STORAGE_KEY);
  const previous = stored[VISUAL_ASSERT_STORAGE_KEY];
  const assertions = Array.isArray(result?.assertions) ? result.assertions : [];
  if (command.assertScreenshotChanged) {
    assertions.push({
      name: 'assertScreenshotChanged',
      passed: Boolean(previous?.hash && result?.fingerprint?.hash && previous.hash !== result.fingerprint.hash),
      detail: previous?.hash ? `${previous.hash} -> ${result?.fingerprint?.hash}` : 'no previous visual baseline'
    });
  }
  await chrome.storage.local.set({ [VISUAL_ASSERT_STORAGE_KEY]: result?.fingerprint });
  const failed = assertions.filter(item => !item.passed);
  return {
    ok: failed.length === 0,
    passed: failed.length === 0,
    assertions,
    failed,
    fingerprint: result?.fingerprint,
    previousFingerprint: previous
  };
}

async function runAccessibilitySnapshot(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: input => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const isVisible = element => {
        if (!element) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const selectorHint = element => {
        if (element.id) {
          return `#${CSS.escape(element.id)}`;
        }
        const name = element.getAttribute('name');
        if (name) {
          return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        }
        const label = element.getAttribute('aria-label') || element.getAttribute('title');
        if (label) {
          return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]`;
        }
        return undefined;
      };
      const roleFor = element => element.getAttribute('role') || ({
        A: 'link',
        BUTTON: 'button',
        INPUT: element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : 'textbox',
        TEXTAREA: 'textbox',
        SELECT: 'combobox',
        TABLE: 'table',
        NAV: 'navigation',
        MAIN: 'main',
        HEADER: 'banner',
        FOOTER: 'contentinfo',
        H1: 'heading',
        H2: 'heading',
        H3: 'heading'
      })[element.tagName] || undefined;
      const nameFor = element => normalize(
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.labels?.[0]?.innerText ||
        element.innerText ||
        element.value ||
        ''
      ).slice(0, 180);
      const nodes = Array.from(document.querySelectorAll('main,nav,header,footer,[role],h1,h2,h3,button,a[href],input,textarea,select,[tabindex]'))
        .filter(isVisible)
        .slice(0, Math.min(Math.max(Number(input.maxEntries) || 120, 1), 300))
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          return {
            index,
            role: roleFor(element),
            name: nameFor(element),
            tag: element.tagName.toLowerCase(),
            level: /^H[1-6]$/.test(element.tagName) ? Number(element.tagName.slice(1)) : undefined,
            selectorHint: selectorHint(element),
            disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          };
        });
      return { ok: true, url: location.href, title: document.title, nodes };
    },
    args: [command]
  });
  return result ?? { ok: true, nodes: [] };
}

async function runMapForm(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: input => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const selectorHint = element => {
        if (element.id) {
          return `#${CSS.escape(element.id)}`;
        }
        if (element.name) {
          return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
        }
        return undefined;
      };
      const labelFor = element => {
        if (element.labels?.[0]) {
          return normalize(element.labels[0].innerText);
        }
        const aria = element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('title');
        if (aria) {
          return normalize(aria);
        }
        const id = element.id;
        if (id) {
          const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (explicit) {
            return normalize(explicit.innerText);
          }
        }
        return '';
      };
      const controls = Array.from(document.querySelectorAll(input.selector || 'input,textarea,select,[contenteditable="true"],[role="textbox"]'))
        .slice(0, Math.min(Math.max(Number(input.maxEntries) || 120, 1), 300))
        .map((element, index) => {
          const tag = element.tagName.toLowerCase();
          const type = element.getAttribute('type') || (element.isContentEditable ? 'contenteditable' : tag);
          const options = tag === 'select'
            ? Array.from(element.options).map(option => ({ value: option.value, text: normalize(option.textContent || '') })).slice(0, 50)
            : undefined;
          return {
            index,
            tag,
            type,
            name: element.getAttribute('name') || undefined,
            id: element.id || undefined,
            label: labelFor(element),
            placeholder: element.getAttribute('placeholder') || undefined,
            required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
            disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
            readOnly: Boolean(element.readOnly),
            autocomplete: element.getAttribute('autocomplete') || undefined,
            selectorHint: selectorHint(element),
            options
          };
        });
      return { ok: true, url: location.href, title: document.title, fields: controls, fieldCount: controls.length };
    },
    args: [command]
  });
  return result ?? { ok: true, fields: [] };
}

async function runWatchPageChanges(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const durationMs = Math.min(Math.max(Number(command.watchDurationMs) || Number(command.durationMs) || 3000, 500), 30000);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: watchMs => new Promise(resolve => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const startedAt = new Date().toISOString();
      const startUrl = location.href;
      const startTitle = document.title;
      const startText = normalize(document.body?.innerText ?? '');
      const startResourceCount = performance.getEntriesByType('resource').length;
      let mutationCount = 0;
      let lastMutationAt;
      const observer = new MutationObserver(mutations => {
        mutationCount += mutations.length;
        lastMutationAt = new Date().toISOString();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      setTimeout(() => {
        observer.disconnect();
        const endText = normalize(document.body?.innerText ?? '');
        const resources = performance.getEntriesByType('resource').slice(startResourceCount).map(entry => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          durationMs: Math.round(entry.duration),
          transferSize: Number(entry.transferSize || 0)
        })).slice(-50);
        resolve({
          ok: true,
          startedAt,
          endedAt: new Date().toISOString(),
          durationMs: watchMs,
          startUrl,
          endUrl: location.href,
          urlChanged: startUrl !== location.href,
          titleChanged: startTitle !== document.title,
          textDelta: endText.length - startText.length,
          mutationCount,
          lastMutationAt,
          newResourceCount: resources.length,
          resources
        });
      }, watchMs);
    }),
    args: [durationMs]
  });
  return result ?? { ok: true, durationMs };
}

async function runHighlightEvidence(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result: highlight }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: input => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const isVisible = element => {
        if (!element) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const selectors = Array.isArray(input.highlightSelectors) ? input.highlightSelectors.filter(Boolean) : [];
      if (input.selector) {
        selectors.unshift(input.selector);
      }
      const seen = new Set();
      const targets = [];
      for (const selector of selectors) {
        try {
          for (const element of Array.from(document.querySelectorAll(String(selector)))) {
            if (!isVisible(element) || seen.has(element)) {
              continue;
            }
            seen.add(element);
            targets.push({ element, reason: selector });
          }
        } catch {
          // Ignore invalid selectors.
        }
      }
      const textNeedle = normalize(input.highlightText || input.targetHint || input.text).toLowerCase();
      if (textNeedle) {
        const candidates = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role],h1,h2,h3,p,td,th,span,div'));
        for (const element of candidates) {
          if (!isVisible(element) || seen.has(element)) {
            continue;
          }
          const label = normalize(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '').toLowerCase();
          if (label.includes(textNeedle)) {
            seen.add(element);
            targets.push({ element, reason: textNeedle });
          }
          if (targets.length >= 20) {
            break;
          }
        }
      }
      const items = targets.slice(0, 20).map((item, index) => {
        const rect = item.element.getBoundingClientRect();
        return {
          index: index + 1,
          label: normalize(item.element.innerText || item.element.value || item.element.getAttribute('aria-label') || item.element.getAttribute('title') || item.reason).slice(0, 80),
          tag: item.element.tagName.toLowerCase(),
          reason: item.reason,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      });
      return {
        ok: true,
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
        highlights: items
      };
    },
    args: [command]
  });

  if (!highlight?.highlights || highlight.highlights.length === 0) {
    throw new Error('highlightEvidence found no visible targets.');
  }

  const captured = await captureVisibleTabWithRedaction(tab);
  const fullDataUrl = captured.dataUrl;
  const blob = await fetch(fullDataUrl).then(response => response.blob());
  const bitmap = await createImageBitmap(blob);
  const dpr = Number(highlight.viewport?.devicePixelRatio) || 1;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create highlight canvas context.');
  }
  context.drawImage(bitmap, 0, 0);
  context.lineWidth = Math.max(3, Math.round(3 * dpr));
  context.font = `${Math.max(14, Math.round(14 * dpr))}px sans-serif`;
  for (const item of highlight.highlights) {
    const x = Math.round(item.bounds.x * dpr);
    const y = Math.round(item.bounds.y * dpr);
    const width = Math.round(item.bounds.width * dpr);
    const height = Math.round(item.bounds.height * dpr);
    context.strokeStyle = '#f59e0b';
    context.fillStyle = 'rgba(245, 158, 11, 0.16)';
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
    const label = `${item.index}. ${item.label || item.tag}`;
    const metrics = context.measureText(label);
    const labelY = Math.max(0, y - Math.round(22 * dpr));
    context.fillStyle = '#111827';
    context.fillRect(x, labelY, Math.ceil(metrics.width + 12 * dpr), Math.round(22 * dpr));
    context.fillStyle = '#fef3c7';
    context.fillText(label, x + Math.round(6 * dpr), labelY + Math.round(16 * dpr));
  }
  const highlightedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await highlightedBlob.arrayBuffer();
  return {
    ok: true,
    highlightedCount: highlight.highlights.length,
    highlights: highlight.highlights,
    screenshotDataUrl: `data:image/png;base64,${arrayBufferToBase64(buffer)}`,
    screenshotMimeType: 'image/png',
    screenshotRedaction: captured.redaction
  };
}

async function runBuildEvidencePack(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const captureGroup = String(command.captureGroup || command.investigationName || '').trim();
  return {
    ok: true,
    captureGroup,
    requestedAt: new Date().toISOString(),
    url: tab.url,
    title: tab.title,
    historyRunCount: executionRunHistory.size,
    message: 'Evidence pack file assembly is completed by the VS Code extension after this command result is logged.'
  };
}

async function runPlanAndRun(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const goal = String(command.goal || command.text || '').trim();
  const generatedPlan = [{ action: 'waitPreset', waitPreset: command.waitPreset || 'genericPortalReady' }];

  if (command.contractName || command.contractSelectors?.length || command.contractTexts?.length) {
    generatedPlan.push({
      action: 'assertPageContract',
      contractName: command.contractName,
      contractSelectors: command.contractSelectors,
      contractTexts: command.contractTexts
    });
  }

  if (command.tableSelector || /table|row|grid|표|테이블/i.test(goal)) {
    generatedPlan.push({
      action: 'tableExtract',
      tableSelector: command.tableSelector,
      headerMode: command.headerMode || 'auto',
      outputFormat: 'json'
    });
  }

  if (command.highlightSelectors?.length || command.highlightText || command.selector || command.targetHint) {
    generatedPlan.push({
      action: 'highlightEvidence',
      selector: command.selector,
      targetHint: command.targetHint,
      highlightSelectors: command.highlightSelectors,
      highlightText: command.highlightText
    });
  }

  const explicitSteps = Array.isArray(command.steps) ? command.steps.slice(0, 20) : [];
  const steps = [...generatedPlan, ...explicitSteps];
  const results = [];
  for (const step of steps) {
    const result = await executeSingleAction({ ...command, ...step, action: step.action || 'readPage' }, allowedHosts);
    results.push({ action: step.action || 'readPage', result });
    if (result?.ok === false || result?.error) {
      break;
    }
  }

  return {
    ok: results.every(item => item.result?.ok !== false && !item.result?.error),
    goal,
    generatedPlan,
    explicitStepCount: explicitSteps.length,
    steps: results
  };
}

async function runEvidenceClaimCheck(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const claim = String(command.claim || '').trim();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (claimInput, tableSelector) => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const bodyText = normalize(document.body?.innerText || '');
      const lowerText = bodyText.toLowerCase();
      const terms = Array.from(new Set(normalize(claimInput).toLowerCase().split(/[^a-z0-9가-힣_.-]+/).filter(term => term.length >= 3))).slice(0, 40);
      const matchedTerms = terms.filter(term => lowerText.includes(term));
      const missingTerms = terms.filter(term => !lowerText.includes(term));
      const tables = Array.from(tableSelector ? document.querySelectorAll(tableSelector) : document.querySelectorAll('table,[role="table"],[role="grid"]')).slice(0, 5);
      const tableMatches = tables.map((table, tableIndex) => {
        const rows = Array.from(table.querySelectorAll('tr,[role="row"]')).slice(0, 50).map((row, rowIndex) => ({
          rowIndex,
          text: normalize(row.textContent || '')
        }));
        const matches = rows.filter(row => matchedTerms.some(term => row.text.toLowerCase().includes(term))).slice(0, 10);
        return { tableIndex, rowCount: rows.length, matches };
      });
      const evidenceSnippets = matchedTerms.slice(0, 10).map(term => {
        const index = lowerText.indexOf(term);
        return { term, snippet: index >= 0 ? bodyText.slice(Math.max(0, index - 80), Math.min(bodyText.length, index + 120)) : '' };
      });
      const supportRatio = terms.length ? matchedTerms.length / terms.length : 0;
      const verdict = supportRatio >= 0.65 ? 'supported' : 'notEnoughEvidence';
      return { ok: true, claim: claimInput, verdict, supportRatio, matchedTerms, missingTerms, evidenceSnippets, tableMatches };
    },
    args: [claim, command.tableSelector]
  });
  return result || { ok: false, claim, verdict: 'notEnoughEvidence' };
}

async function runTableWatchAndDiff(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const durationMs = Math.min(Math.max(Number(command.watchDurationMs || command.durationMs) || 2000, 500), 30000);
  const before = await snapshotTable(tab.id, command);
  await new Promise(resolve => setTimeout(resolve, durationMs));
  const after = await snapshotTable(tab.id, command);
  const diff = diffTableSnapshots(before, after, Array.isArray(command.keyColumns) ? command.keyColumns : []);
  return { ok: true, generatedAt: new Date().toISOString(), durationMs, before, after, diff };
}

async function snapshotTable(tabId, command) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (tableSelector, headerMode) => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const table = tableSelector ? document.querySelector(tableSelector) : document.querySelector('table,[role="table"],[role="grid"]');
      if (!table) {
        return { ok: false, error: 'Table not found.', headers: [], rows: [] };
      }

      const rowElements = Array.from(table.querySelectorAll('tr,[role="row"]'));
      const hasThead = table.querySelectorAll('thead th').length > 0;
      const mode = headerMode || 'auto';
      const headerCells = mode === 'thead' || (mode === 'auto' && hasThead)
        ? Array.from(table.querySelectorAll('thead th'))
        : Array.from(rowElements[0]?.querySelectorAll('th,td,[role="columnheader"],[role="cell"]') || []);
      const headers = headerCells.map((cell, index) => normalize(cell.textContent || '') || `col_${index + 1}`);
      const dataRows = mode === 'firstRow' || (!hasThead && mode === 'auto') ? rowElements.slice(1) : rowElements;
      const rows = dataRows.map((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('td,th,[role="cell"],[role="gridcell"]')).map(cell => normalize(cell.textContent || ''));
        const record = {};
        headers.forEach((header, index) => { record[header] = cells[index] || ''; });
        return { rowIndex, key: cells.join('|'), cells, record };
      }).filter(row => row.cells.length > 0);
      return { ok: true, capturedAt: new Date().toISOString(), headers, rowCount: rows.length, rows };
    },
    args: [command.tableSelector, command.headerMode]
  });
  if (result?.error) {
    throw new Error(result.error);
  }
  return result || { ok: true, headers: [], rows: [] };
}

function diffTableSnapshots(before, after, keyColumns) {
  const keyFor = row => {
    const record = row.record || {};
    const configured = keyColumns.map(column => String(record[column] || '')).filter(Boolean);
    return configured.length > 0 ? configured.join('|') : row.key || String(row.rowIndex);
  };
  const beforeMap = new Map((before.rows || []).map(row => [keyFor(row), row]));
  const afterMap = new Map((after.rows || []).map(row => [keyFor(row), row]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, row] of afterMap) {
    if (!beforeMap.has(key)) {
      added.push(row);
      continue;
    }
    const previous = beforeMap.get(key);
    if (JSON.stringify(previous?.record || previous?.cells) !== JSON.stringify(row.record || row.cells)) {
      changed.push({ key, before: previous, after: row });
    }
  }
  for (const [key, row] of beforeMap) {
    if (!afterMap.has(key)) {
      removed.push(row);
    }
  }
  return { stable: added.length === 0 && removed.length === 0 && changed.length === 0, added, removed, changed };
}

async function runBrowserRunBundle(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const captureGroup = String(command.captureGroup || command.investigationName || '').trim();
  return {
    ok: true,
    captureGroup,
    generatedAt: new Date().toISOString(),
    url: tab.url,
    title: tab.title,
    historyRunCount: executionRunHistory.size,
    message: 'Browser run bundle folder is assembled by the VS Code extension after this command result is logged.'
  };
}

async function runSafeActionPreview(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const actionTemplate = command.actionTemplate && typeof command.actionTemplate === 'object' ? command.actionTemplate : {};
  const previewCommand = { ...command, ...actionTemplate, action: actionTemplate.action || command.action };
  const [{ result: inspection }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: inspectTargetsOnPage,
    args: [buildTargetIntent(previewCommand)]
  });
  const targetAction = previewCommand.action || 'click';
  const destructiveActions = new Set(['closeTab', 'safeDownloadAndHash', 'bulkActionFromList', 'rollbackToCheckpoint']);
  const destructiveText = /delete|remove|disable|reset|revoke|block|quarantine|삭제|제거|차단|초기화/i.test(String(previewCommand.text || previewCommand.targetHint || previewCommand.label || ''));
  const topTargets = Array.isArray(inspection?.rankedTargets) ? inspection.rankedTargets.slice(0, 5) : [];
  return {
    ok: true,
    action: targetAction,
    url: tab.url,
    title: tab.title,
    targetCount: topTargets.length,
    recommendedTarget: topTargets[0],
    candidates: topTargets,
    requiresConfirmation: destructiveActions.has(targetAction) || destructiveText,
    reasons: [destructiveActions.has(targetAction) ? 'destructive-action' : undefined, destructiveText ? 'destructive-target-text' : undefined].filter(Boolean)
  };
}

async function runStableTargetProfile(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result: inspection }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: inspectTargetsOnPage,
    args: [buildTargetIntent(command)]
  });
  const profiles = (Array.isArray(inspection?.rankedTargets) ? inspection.rankedTargets : []).slice(0, 10).map(target => {
    const selector = String(target.selectorHint || '');
    let stabilityScore = Number(target.score || 0);
    const reasons = Array.isArray(target.reasons) ? [...target.reasons] : [];
    if (selector.startsWith('#') || selector.includes('data-testid')) {
      stabilityScore += 20;
      reasons.push('strong-selector');
    }
    if (target.accessibleName) {
      stabilityScore += 8;
      reasons.push('accessible-name');
    }
    if (target.interactableScore?.enabled && target.interactableScore?.notOverlapped && target.interactableScore?.inViewport) {
      stabilityScore += 10;
      reasons.push('ready-to-act');
    }
    return {
      ...target,
      stabilityScore: Math.max(0, Math.min(100, stabilityScore)),
      recommendedLocator: selector || target.accessibleName || target.text,
      fallbackTexts: [target.accessibleName, target.text].filter(Boolean).slice(0, 3),
      reasons
    };
  }).sort((a, b) => b.stabilityScore - a.stabilityScore);
  return { ok: true, url: tab.url, title: tab.title, intent: inspection?.intent, recommendedTarget: profiles[0], profiles };
}

async function runGuidedDrilldown(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const maxItems = Math.min(Math.max(Number(command.maxItems) || 3, 1), 10);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (tableSelector, itemSelector, matchText, detailSelector, max) => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const matchesNeedle = value => !matchText || normalize(value).toLowerCase().includes(String(matchText).toLowerCase());
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const roots = itemSelector
        ? Array.from(document.querySelectorAll(itemSelector))
        : Array.from((tableSelector ? document.querySelector(tableSelector) : document.querySelector('table,[role="table"],[role="grid"]'))?.querySelectorAll('tr,[role="row"]') || []);
      const rows = roots.filter(row => matchesNeedle(row.textContent || '')).slice(0, max);
      const items = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const rowText = normalize(row.textContent || '');
        row.scrollIntoView({ block: 'center', inline: 'nearest' });
        const clickTarget = row.querySelector('button,a,[role="button"],[tabindex]') || row;
        clickTarget.click();
        await wait(500);
        const detail = detailSelector ? document.querySelector(detailSelector) : undefined;
        const detailText = detail ? normalize(detail.textContent || '') : '';
        const rect = row.getBoundingClientRect();
        items.push({
          index,
          rowText,
          clicked: true,
          detailFound: Boolean(detail),
          detailText: detailText.slice(0, 4000),
          bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        });
      }
      return { ok: true, matchText, matchedCount: rows.length, items };
    },
    args: [command.tableSelector, command.itemSelector, command.matchText, command.detailSelector, maxItems]
  });
  return result || { ok: true, matchedCount: 0, items: [] };
}

async function runEvidenceCompletenessCheck(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const requiredClaims = Array.isArray(command.requiredClaims) ? command.requiredClaims.filter(Boolean).slice(0, 20) : [];
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: claims => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const text = normalize(document.body?.innerText || '');
      const lowerText = text.toLowerCase();
      const checks = claims.map(claim => {
        const terms = normalize(claim).toLowerCase().split(/[^a-z0-9가-힣_.-]+/).filter(term => term.length >= 3).slice(0, 20);
        const matchedTerms = terms.filter(term => lowerText.includes(term));
        const supportRatio = terms.length ? matchedTerms.length / terms.length : 0;
        return { claim, status: supportRatio >= 0.65 ? 'visible' : supportRatio >= 0.35 ? 'partial' : 'missing', supportRatio, matchedTerms };
      });
      return { visibleTextLength: text.length, checks };
    },
    args: [requiredClaims]
  });
  return {
    ok: true,
    captureGroup: String(command.captureGroup || command.investigationName || '').trim(),
    requiredClaims,
    currentPage: result,
    url: tab.url,
    title: tab.title,
    message: 'Capture-group completeness files are assembled by the VS Code extension when a capture group is available.'
  };
}

async function rememberCommandFailure(command, message) {
  if (!command?.id) {
    return;
  }
  recentCommandFailures.set(command.id, {
    runId: command.id,
    action: command.action,
    createdAt: new Date().toISOString(),
    error: message,
    selector: command.selector,
    text: command.text,
    label: command.label,
    targetHint: command.targetHint,
    url: command.url
  });
  if (recentCommandFailures.size > 50) {
    const oldest = recentCommandFailures.keys().next().value;
    if (oldest) {
      recentCommandFailures.delete(oldest);
    }
  }
  await persistRuntimeState();
}

async function runFailureExplainer(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const requestedRunId = command.baseRunId || command.newRunId || command.value;
  const failedRun = requestedRunId
    ? recentCommandFailures.get(requestedRunId)
    : Array.from(recentCommandFailures.values()).slice(-1)[0];
  const historicalRun = requestedRunId ? executionRunHistory.get(requestedRunId) : Array.from(executionRunHistory.values()).reverse().find(run => Array.isArray(run.steps) && run.steps.some(step => step?.result?.ok === false || step?.result?.error));
  const source = failedRun || historicalRun;
  const errorText = String(failedRun?.error || historicalRun?.steps?.find(step => step?.result?.ok === false || step?.result?.error)?.result?.error || 'No recent failed browser command was found.');
  const lowered = errorText.toLowerCase();
  const findings = [];
  if (/selector|not found|no element|invalid selector/.test(lowered)) {
    findings.push({ kind: 'target-not-found', detail: 'The requested selector or target did not resolve to a usable element.' });
  }
  if (/hidden|visible|visibility|display|disabled|overlap/.test(lowered)) {
    findings.push({ kind: 'target-not-actionable', detail: 'The target may be hidden, disabled, outside the viewport, or overlapped.' });
  }
  if (/timeout|timed out/.test(lowered)) {
    findings.push({ kind: 'timeout', detail: 'The page did not reach the expected state before the timeout.' });
  }
  if (/auth_required|sign in|signin|login|unauthorized/.test(lowered)) {
    findings.push({ kind: 'auth-or-authorization', detail: 'The browser may need sign-in or pairing/host authorization.' });
  }
  if (/iframe|frame|shadow/.test(lowered)) {
    findings.push({ kind: 'deep-targeting', detail: 'The target may be inside an iframe or shadow root.' });
  }
  if (findings.length === 0) {
    findings.push({ kind: 'unknown', detail: 'No known failure pattern matched. Inspect current targets before retrying.' });
  }

  let targetInspection;
  if (source?.selector || source?.text || source?.label || source?.targetHint || command.selector || command.text || command.label || command.targetHint) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectTargetsOnPage,
      args: [buildTargetIntent({ ...command, ...source })]
    });
    targetInspection = result;
  }

  const recommendations = [];
  if (findings.some(item => item.kind === 'target-not-found' || item.kind === 'deep-targeting')) {
    recommendations.push('Run inspectTargets or stableTargetProfile with targetScope=allFrames and a targetHint.');
  }
  if (findings.some(item => item.kind === 'timeout')) {
    recommendations.push('Run waitProfiler, then retry with the recommended wait kind or waitPreset.');
  }
  if (findings.some(item => item.kind === 'target-not-actionable')) {
    recommendations.push('Use safeActionPreview before retrying, then scroll or wait for the target to become actionable.');
  }
  return { ok: true, generatedAt: new Date().toISOString(), runId: source?.runId, action: source?.action, error: errorText, findings, recommendations, targetInspection };
}

async function runWaitProfiler(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const candidates = Array.isArray(command.waitCandidates) && command.waitCandidates.length > 0
    ? command.waitCandidates.slice(0, 8)
    : ['spinnerGone', 'elementStable', 'urlSettled', 'networkIdle'];
  const profiles = [];
  for (const candidate of candidates) {
    const wait = waitConditionFromCandidate(candidate, command);
    const started = Date.now();
    let result;
    try {
      const [{ result: waitResult }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: runDomCommand,
        args: [{ ...command, action: 'wait', wait, timeoutMs: Math.min(Number(command.timeoutMs) || 5000, 10000) }]
      });
      result = waitResult;
    } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    const elapsedMs = Date.now() - started;
    profiles.push({ candidate, wait, ok: result?.ok !== false && !result?.error, elapsedMs, result });
  }
  const successful = profiles.filter(profile => profile.ok).sort((a, b) => a.elapsedMs - b.elapsedMs);
  const recommended = successful.find(profile => profile.elapsedMs >= 150) || successful[0] || profiles[0];
  return { ok: true, generatedAt: new Date().toISOString(), url: tab.url, title: tab.title, recommended, profiles };
}

function waitConditionFromCandidate(candidate, command) {
  const key = String(candidate || '').trim();
  if (key === 'semantic') {
    return { kind: 'semantic', semanticConditions: command.semanticConditions || [] };
  }
  if (key === 'networkIdle') {
    return { kind: 'networkIdle', idleMs: 800, maxInflight: 0 };
  }
  if (key === 'elementStable') {
    return { kind: 'elementStable', selector: command.selector || command.assertSelector || 'body' };
  }
  if (key === 'urlSettled') {
    return { kind: 'urlSettled' };
  }
  if (key === 'text') {
    return { kind: 'text', text: command.text || command.assertText || '' };
  }
  if (key === 'element') {
    return { kind: 'element', selector: command.selector || command.assertSelector || 'body' };
  }
  return { kind: key || 'spinnerGone', selector: command.selector || command.assertSelector };
}

async function runAutomationHealthScore(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const [{ result: page }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const text = normalize(document.body?.innerText || '');
      const busyCount = document.querySelectorAll('[aria-busy="true"],[role="progressbar"],.spinner,.loading').length;
      const interactableCount = document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="tab"],[tabindex]').length;
      const tableCount = document.querySelectorAll('table,[role="table"],[role="grid"]').length;
      const formFieldCount = document.querySelectorAll('input,textarea,select').length;
      return {
        textLength: text.length,
        authLikely: Boolean(document.querySelector('input[type="password"]')) || /sign in|signin|login|로그인|인증/i.test(text.slice(0, 3000)),
        busyCount,
        interactableCount,
        tableCount,
        formFieldCount,
        headings: document.querySelectorAll('h1,h2,h3').length,
        url: location.href,
        title: document.title
      };
    }
  });
  const fingerprintA = await collectDomFingerprint(tab.id);
  await new Promise(resolve => setTimeout(resolve, 500));
  const fingerprintB = await collectDomFingerprint(tab.id);
  const stored = await chrome.storage.local.get(SELECTOR_MEMORY_STORAGE_KEY);
  const memory = stored[SELECTOR_MEMORY_STORAGE_KEY] && typeof stored[SELECTOR_MEMORY_STORAGE_KEY] === 'object' ? stored[SELECTOR_MEMORY_STORAGE_KEY] : {};
  const selectorMemoryEntries = Object.values(memory).reduce((count, value) => count + (Array.isArray(value) ? value.length : 0), 0);
  const risks = [];
  let score = 100;
  if (page?.authLikely) { score -= 30; risks.push('auth-likely'); }
  if ((page?.busyCount || 0) > 0) { score -= 15; risks.push('busy-indicators-visible'); }
  if (fingerprintA.hash !== fingerprintB.hash) { score -= 15; risks.push('dom-still-changing'); }
  if ((page?.interactableCount || 0) === 0) { score -= 20; risks.push('no-interactables-detected'); }
  if ((page?.textLength || 0) < 100) { score -= 10; risks.push('low-visible-text'); }
  if (selectorMemoryEntries === 0) { score -= 5; risks.push('no-selector-memory'); }
  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? 'good' : score >= 55 ? 'fair' : 'poor';
  const recommendedNextAction = risks.includes('dom-still-changing') || risks.includes('busy-indicators-visible') ? 'waitProfiler' : risks.includes('no-selector-memory') ? 'stableTargetProfile' : 'safeActionPreview';
  return { ok: true, generatedAt: new Date().toISOString(), score, level, risks, recommendedNextAction, page, domStability: { before: fingerprintA, after: fingerprintB, stable: fingerprintA.hash === fingerprintB.hash }, selectorMemoryEntries };
}

async function runSensitiveActionGuard(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const actionTemplate = command.actionTemplate && typeof command.actionTemplate === 'object' ? command.actionTemplate : {};
  const guardedCommand = { ...command, ...actionTemplate, action: actionTemplate.action || command.action };
  const [{ result: inspection }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: inspectTargetsOnPage,
    args: [buildTargetIntent(guardedCommand)]
  });
  const target = Array.isArray(inspection?.rankedTargets) ? inspection.rankedTargets[0] : undefined;
  const text = [guardedCommand.action, guardedCommand.text, guardedCommand.label, guardedCommand.targetHint, target?.text, target?.accessibleName].filter(Boolean).join(' ');
  const sensitivePattern = /delete|remove|disable|block|revoke|reset|submit|approve|confirm|quarantine|isolate|삭제|제거|차단|초기화|승인|격리|제출/i;
  const sensitive = sensitivePattern.test(text);
  const destructiveActions = new Set(['closeTab', 'safeDownloadAndHash', 'bulkActionFromList', 'rollbackToCheckpoint']);
  const reasons = [sensitive ? 'sensitive-target-text' : undefined, destructiveActions.has(guardedCommand.action) ? 'destructive-action' : undefined].filter(Boolean);
  const decision = reasons.length === 0 ? 'pass' : command.onViolation === 'warn' ? 'warn' : 'block';
  return {
    ok: true,
    decision,
    requiresConfirmation: decision !== 'pass',
    confirmationKeyword: decision !== 'pass' ? 'CONFIRM_BROWSER_ACTION' : undefined,
    action: guardedCommand.action,
    reasons,
    target,
    candidates: Array.isArray(inspection?.rankedTargets) ? inspection.rankedTargets.slice(0, 5) : [],
    saferAlternative: decision !== 'pass' ? { action: 'readPage', captureAfter: false } : undefined
  };
}

async function runTabOrchestrator(command, allowedHosts) {
  const { tabs, summaries } = await collectWindowTabSummaries(command, allowedHosts);
  const unexpectedTabs = findUnexpectedTabs(summaries, command);
  const missingRoles = findMissingTabRoles(summaries, command);
  const actions = [];

  if (unexpectedTabs.length > 0 && command.onUnexpectedTab === 'block') {
    throw new Error(`Unexpected tabs detected: ${unexpectedTabs.map(tab => `${tab.index}:${tab.title || tab.url}`).join(', ')}`);
  }

  if (command.closeExtraTabs) {
    if (!command.confirmDangerous) {
      throw new Error('tabOrchestrator closeExtraTabs requires confirmDangerous=true.');
    }

    for (const summary of unexpectedTabs.filter(tab => !tab.active)) {
      const target = tabs.find(tab => tab.id === summary.tabId);
      if (hasTabId(target)) {
        await chrome.tabs.remove(target.id);
        actions.push({ action: 'closedExtraTab', tabIndex: summary.index, role: summary.role, url: summary.url });
      }
    }
  }

  let returnedTo;
  if (command.returnToRole) {
    returnedTo = await activateTabRole(command.returnToRole, command, allowedHosts);
    actions.push({ action: 'activatedRole', role: command.returnToRole, tabIndex: returnedTo.index, url: returnedTo.url });
  }

  return {
    ok: true,
    action: 'tabOrchestrator',
    expectedTabs: command.expectedTabs,
    tabCount: summaries.length,
    unexpectedCount: unexpectedTabs.length,
    missingRoles,
    returnedTo: returnedTo ? summarizeBrowserTab(returnedTo, classifyTabRole(returnedTo, command), command) : undefined,
    actions,
    onUnexpectedTab: command.onUnexpectedTab,
    tabs: summaries
  };
}

async function runPopupGuard(command, allowedHosts) {
  const { summaries } = await collectWindowTabSummaries(command, allowedHosts);
  const unexpectedTabs = findUnexpectedTabs(summaries, command);
  const suspiciousTabs = summaries.filter(tab => tab.signals.some(signal => ['auth-popup', 'security-warning', 'permission-page', 'unknown-popup'].includes(signal)));
  const findings = [...unexpectedTabs, ...suspiciousTabs.filter(tab => !unexpectedTabs.some(unexpected => unexpected.tabId === tab.tabId))];

  if (findings.length > 0 && command.onUnexpectedTab === 'block') {
    throw new Error(`Popup guard blocked ${findings.length} unexpected or sensitive tab(s).`);
  }

  return {
    ok: true,
    action: 'popupGuard',
    mode: command.onUnexpectedTab,
    blocked: false,
    findingCount: findings.length,
    findings,
    tabs: summaries
  };
}

async function runReturnToTab(command, allowedHosts) {
  let target;
  if (Number.isInteger(command.targetTabIndex)) {
    target = await getTabByIndex(command.targetTabIndex);
  } else if (command.returnToRole) {
    target = await activateTabRole(command.returnToRole, command, allowedHosts);
  } else {
    throw new Error('returnToTab requires returnToRole or targetTabIndex.');
  }

  assertAllowedUrl(target.url, allowedHosts);
  await chrome.tabs.update(target.id, { active: true });
  return {
    ok: true,
    action: 'returnToTab',
    tab: summarizeBrowserTab(target, classifyTabRole(target, command), command)
  };
}

async function runTabRunSummary(command, allowedHosts) {
  const { summaries } = await collectWindowTabSummaries(command, allowedHosts);
  const roleCounts = summaries.reduce((counts, tab) => {
    counts[tab.role] = (counts[tab.role] || 0) + 1;
    return counts;
  }, {});
  const unexpectedTabs = findUnexpectedTabs(summaries, command);

  return {
    ok: true,
    action: 'tabRunSummary',
    tabCount: summaries.length,
    activeTab: summaries.find(tab => tab.active),
    roleCounts,
    unexpectedTabs,
    recommendedNextAction: unexpectedTabs.length > 0 ? 'popupGuard' : command.returnToRole ? 'returnToTab' : 'continue',
    tabs: summaries
  };
}

async function collectWindowTabSummaries(command, allowedHosts) {
  const activeTab = await getActiveTab();
  const tabs = await chrome.tabs.query({ windowId: activeTab.windowId });
  const summaries = tabs
    .filter(tab => hasTabId(tab))
    .map(tab => summarizeBrowserTab(tab, classifyTabRole(tab, command), command));

  for (const summary of summaries) {
    if (summary.url && !summary.url.startsWith('chrome://') && !summary.url.startsWith('edge://')) {
      assertAllowedUrl(summary.url, allowedHosts);
    }
  }

  return { tabs, summaries };
}

function summarizeBrowserTab(tab, role, command) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    status: tab.status,
    role,
    title: tab.title || '',
    url: tab.url || '',
    signals: inferTabSignals(tab, role, command)
  };
}

function classifyTabRole(tab, command) {
  const url = String(tab.url || '').toLowerCase();
  const title = String(tab.title || '').toLowerCase();
  const haystack = `${url} ${title}`;
  const tabRoles = command.tabRoles && typeof command.tabRoles === 'object' ? command.tabRoles : {};

  for (const [role, patterns] of Object.entries(tabRoles)) {
    if (Array.isArray(patterns) && patterns.some(pattern => pattern && haystack.includes(String(pattern).toLowerCase()))) {
      return role;
    }
  }

  if (/login|signin|oauth|saml|authorize|microsoftonline|auth/.test(haystack)) {
    return 'auth';
  }

  if (/callback|redirect|consent/.test(haystack)) {
    return 'callback';
  }

  if (/download|blob:|data:/.test(haystack)) {
    return 'download';
  }

  if (/detail|details|blade|panel|item|record/.test(haystack)) {
    return 'detail';
  }

  if (tab.active) {
    return 'main';
  }

  return 'unknown';
}

function inferTabSignals(tab, role, command) {
  const url = String(tab.url || '').toLowerCase();
  const title = String(tab.title || '').toLowerCase();
  const signals = [];

  if (role === 'auth') {
    signals.push('auth-popup');
  }
  if (/privacy|certificate|not secure|security|blocked|warning|deceptive/.test(`${url} ${title}`)) {
    signals.push('security-warning');
  }
  if (/permissions|extension|chrome:\/\/|edge:\/\//.test(`${url} ${title}`)) {
    signals.push('permission-page');
  }
  if (role === 'unknown' && Number.isInteger(command.expectedTabs)) {
    signals.push('unknown-popup');
  }
  if (tab.status && tab.status !== 'complete') {
    signals.push('loading');
  }

  return signals;
}

function findUnexpectedTabs(summaries, command) {
  const expectedTabs = Number.isInteger(command.expectedTabs) ? command.expectedTabs : undefined;
  const tabRoles = command.tabRoles && typeof command.tabRoles === 'object' ? command.tabRoles : {};
  const knownRoles = new Set(['main', 'auth', 'callback', 'download', 'detail', ...Object.keys(tabRoles)]);

  return summaries.filter(tab => {
    if (expectedTabs && summaries.length > expectedTabs && tab.role === 'unknown') {
      return true;
    }
    if (!knownRoles.has(tab.role)) {
      return true;
    }
    return tab.signals.includes('security-warning') || tab.signals.includes('permission-page');
  });
}

function findMissingTabRoles(summaries, command) {
  const tabRoles = command.tabRoles && typeof command.tabRoles === 'object' ? command.tabRoles : {};
  return Object.keys(tabRoles).filter(role => !summaries.some(tab => tab.role === role));
}

async function activateTabRole(role, command, allowedHosts) {
  const activeTab = await getActiveTab();
  const tabs = await chrome.tabs.query({ windowId: activeTab.windowId });
  const target = tabs.find(tab => hasTabId(tab) && classifyTabRole(tab, command) === role);
  if (!hasTabId(target)) {
    throw new Error(`No tab found for role: ${role}`);
  }

  assertAllowedUrl(target.url, allowedHosts);
  await chrome.tabs.update(target.id, { active: true });
  return target;
}

function runBuildNavigationGraph(command) {
  const runs = Array.from(executionRunHistory.values()).slice(-Math.min(Math.max(Number(command.maxEntries) || 50, 1), 200));
  const nodes = [];
  const edges = [];
  let previousNodeId;
  for (const run of runs) {
    const nodeId = run.runId;
    nodes.push({
      id: nodeId,
      action: run.action,
      title: run.title,
      url: run.url,
      createdAt: run.createdAt,
      stepCount: Array.isArray(run.steps) ? run.steps.length : 0
    });
    if (previousNodeId) {
      edges.push({ from: previousNodeId, to: nodeId });
    }
    previousNodeId = nodeId;
  }
  return { ok: true, generatedAt: new Date().toISOString(), nodeCount: nodes.length, edgeCount: edges.length, nodes, edges };
}

async function runAssertPageContract(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const preset = pageContractPreset(command.contractName);
  const selectors = [...(preset.selectors || []), ...(Array.isArray(command.contractSelectors) ? command.contractSelectors : [])].filter(Boolean);
  const texts = [...(preset.texts || []), ...(Array.isArray(command.contractTexts) ? command.contractTexts : [])].filter(Boolean);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (selectorsInput, textsInput, contractName) => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const visibleText = normalize(document.body?.innerText ?? '');
      const isVisible = element => {
        if (!element) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const selectorResults = selectorsInput.map(selector => ({ selector, passed: isVisible(document.querySelector(selector)) }));
      const textResults = textsInput.map(text => ({ text, passed: visibleText.toLowerCase().includes(String(text).toLowerCase()) }));
      const failed = [...selectorResults, ...textResults].filter(item => !item.passed);
      return {
        ok: failed.length === 0,
        contractName: contractName || 'custom',
        url: location.href,
        title: document.title,
        selectorResults,
        textResults,
        failed
      };
    },
    args: [selectors, texts, command.contractName]
  });
  return result ?? { ok: false, failed: [{ reason: 'no result' }] };
}

function pageContractPreset(name) {
  const key = String(name || '').trim();
  const presets = {
    genericPortalReady: { selectors: ['body'], texts: [] },
    defenderIncidentReady: { selectors: ['[role="tab"],button,a'], texts: ['Overview'] },
    azureBladeReady: { selectors: ['main,[role="main"],body'], texts: [] },
    entraTableReady: { selectors: ['table,[role="grid"],[role="table"]'], texts: [] }
  };
  return presets[key] || { selectors: [], texts: [] };
}

async function runCreateHandoff(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const latestRun = Array.from(executionRunHistory.values()).slice(-1)[0];
  const [{ result: targets }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: inspectTargetsOnPage,
    args: [buildTargetIntent(command)]
  });
  return {
    ok: true,
    createdAt: new Date().toISOString(),
    url: tab.url,
    title: tab.title,
    reason: command.reviewPrompt || command.text || 'Manual handoff requested.',
    latestRun,
    candidateTargets: Array.isArray(targets?.rankedTargets) ? targets.rankedTargets.slice(0, 8) : []
  };
}

async function runSelectorHealthReport() {
  const stored = await chrome.storage.local.get(SELECTOR_MEMORY_STORAGE_KEY);
  const memory = stored[SELECTOR_MEMORY_STORAGE_KEY] && typeof stored[SELECTOR_MEMORY_STORAGE_KEY] === 'object'
    ? stored[SELECTOR_MEMORY_STORAGE_KEY]
    : {};
  const entries = Object.entries(memory).map(([key, values]) => {
    const items = Array.isArray(values) ? values : [];
    return {
      key,
      rememberedCount: items.length,
      autoHealedCount: items.filter(item => item?.autoHealed).length,
      latestUpdatedAt: items[0]?.updatedAt,
      latestSelector: items[0]?.selector,
      latestText: items[0]?.text
    };
  }).sort((a, b) => String(b.latestUpdatedAt || '').localeCompare(String(a.latestUpdatedAt || '')));
  return { ok: true, generatedAt: new Date().toISOString(), entryCount: entries.length, entries: entries.slice(0, 100) };
}

function runCaptureReviewQueue(command) {
  const limit = Math.min(Math.max(Number(command.maxEntries) || 30, 1), 100);
  const runs = Array.from(executionRunHistory.values()).slice(-limit);
  const items = [];
  for (const run of runs) {
    const steps = Array.isArray(run.steps) ? run.steps : [];
    const failedSteps = steps.filter(step => step?.result?.ok === false || step?.result?.passed === false || step?.result?.error);
    const qualityFindings = steps.flatMap(step => step?.result?.page?.screenSummary?.captureQuality?.findings || []);
    if (failedSteps.length > 0 || qualityFindings.length > 0) {
      items.push({
        runId: run.runId,
        action: run.action,
        url: run.url,
        title: run.title,
        createdAt: run.createdAt,
        failedStepCount: failedSteps.length,
        qualityFindings
      });
    }
  }
  return { ok: true, generatedAt: new Date().toISOString(), itemCount: items.length, items };
}

async function runStartBrowserJob(command, allowedHosts) {
  const jobName = String(command.jobName || '').trim();
  const stored = await chrome.storage.local.get(BROWSER_JOBS_STORAGE_KEY);
  const jobs = stored[BROWSER_JOBS_STORAGE_KEY] && typeof stored[BROWSER_JOBS_STORAGE_KEY] === 'object' ? stored[BROWSER_JOBS_STORAGE_KEY] : {};
  const steps = Array.isArray(command.steps) ? command.steps.slice(0, 30) : [];
  if (steps.length === 0) {
    throw new Error('startBrowserJob requires at least one step.');
  }
  const job = {
    jobName,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stepCount: steps.length,
    nextStepIndex: 0,
    steps,
    allowedHosts,
    commandDefaults: {
      timeoutMs: command.timeoutMs,
      retries: command.retries,
      retryProfile: command.retryProfile,
      autoHeal: command.autoHeal,
      selectorMemory: command.selectorMemory,
      effectPolicy: command.effectPolicy
    },
    results: []
  };
  jobs[jobName] = job;
  const jobNames = Object.keys(jobs);
  for (const staleName of jobNames.slice(0, Math.max(0, jobNames.length - 50))) {
    if (!['queued', 'running'].includes(jobs[staleName]?.status)) {
      delete jobs[staleName];
    }
  }
  await chrome.storage.local.set({ [BROWSER_JOBS_STORAGE_KEY]: jobs });
  scheduleCommandPoll(0);
  return { ok: true, job: publicBrowserJob(job) };
}

async function runGetBrowserJob(command) {
  const stored = await chrome.storage.local.get(BROWSER_JOBS_STORAGE_KEY);
  const jobs = stored[BROWSER_JOBS_STORAGE_KEY] && typeof stored[BROWSER_JOBS_STORAGE_KEY] === 'object' ? stored[BROWSER_JOBS_STORAGE_KEY] : {};
  const job = jobs[String(command.jobName || '').trim()];
  if (!job) {
    throw new Error(`Browser job not found: ${command.jobName}`);
  }
  return { ok: true, job: publicBrowserJob(job) };
}

async function runCancelBrowserJob(command) {
  const stored = await chrome.storage.local.get(BROWSER_JOBS_STORAGE_KEY);
  const jobs = stored[BROWSER_JOBS_STORAGE_KEY] && typeof stored[BROWSER_JOBS_STORAGE_KEY] === 'object' ? stored[BROWSER_JOBS_STORAGE_KEY] : {};
  const jobName = String(command.jobName || '').trim();
  const job = jobs[jobName];
  if (!job) {
    throw new Error(`Browser job not found: ${jobName}`);
  }
  job.status = 'cancelled';
  job.updatedAt = new Date().toISOString();
  jobs[jobName] = job;
  await chrome.storage.local.set({ [BROWSER_JOBS_STORAGE_KEY]: jobs });
  return { ok: true, job: publicBrowserJob(job) };
}

async function hasRunnableBrowserJob() {
  const stored = await chrome.storage.local.get(BROWSER_JOBS_STORAGE_KEY);
  const jobs = stored[BROWSER_JOBS_STORAGE_KEY] && typeof stored[BROWSER_JOBS_STORAGE_KEY] === 'object' ? stored[BROWSER_JOBS_STORAGE_KEY] : {};
  return Object.values(jobs).some(job => job && ['queued', 'running'].includes(job.status));
}

async function processNextBrowserJobStep() {
  const stored = await chrome.storage.local.get(BROWSER_JOBS_STORAGE_KEY);
  const jobs = stored[BROWSER_JOBS_STORAGE_KEY] && typeof stored[BROWSER_JOBS_STORAGE_KEY] === 'object' ? stored[BROWSER_JOBS_STORAGE_KEY] : {};
  const job = Object.values(jobs).find(candidate => candidate && ['queued', 'running'].includes(candidate.status));
  if (!job) {
    return false;
  }

  const current = jobs[job.jobName];
  const step = current.steps?.[current.nextStepIndex];
  if (!step) {
    current.status = 'completed';
    current.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [BROWSER_JOBS_STORAGE_KEY]: jobs });
    return true;
  }

  current.status = 'running';
  current.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [BROWSER_JOBS_STORAGE_KEY]: jobs });
  try {
    const result = await executeSingleAction({ ...current.commandDefaults, ...step, action: step.action ?? 'readPage' }, current.allowedHosts || []);
    const refreshed = await chrome.storage.local.get(BROWSER_JOBS_STORAGE_KEY);
    const latestJobs = refreshed[BROWSER_JOBS_STORAGE_KEY] && typeof refreshed[BROWSER_JOBS_STORAGE_KEY] === 'object' ? refreshed[BROWSER_JOBS_STORAGE_KEY] : jobs;
    const latest = latestJobs[current.jobName] || current;
    if (latest.status === 'cancelled') {
      return true;
    }
    latest.results = Array.isArray(latest.results) ? latest.results : [];
    latest.results.push({ action: step.action ?? 'readPage', result });
    latest.nextStepIndex += 1;
    latest.status = latest.nextStepIndex >= latest.stepCount ? 'completed' : 'queued';
    latest.updatedAt = new Date().toISOString();
    latestJobs[current.jobName] = latest;
    await chrome.storage.local.set({ [BROWSER_JOBS_STORAGE_KEY]: latestJobs });
  } catch (error) {
    current.status = 'failed';
    current.error = String(error?.message ?? error);
    current.updatedAt = new Date().toISOString();
    jobs[current.jobName] = current;
    await chrome.storage.local.set({ [BROWSER_JOBS_STORAGE_KEY]: jobs });
  }
  return true;
}

function publicBrowserJob(job) {
  const { steps, allowedHosts, commandDefaults, ...summary } = job;
  return summary;
}

async function runWaitPreset(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);
  const preset = waitPresetConfig(command.waitPreset);
  const checks = [];
  if (preset.wait) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runDomCommand,
      args: [{ action: 'wait', wait: preset.wait, timeoutMs: command.timeoutMs }]
    });
    checks.push({ kind: preset.wait.kind, result });
    if (result?.error) {
      throw new Error(result.error);
    }
  }
  if (preset.contract) {
    const contractResult = await runAssertPageContract({ ...command, ...preset.contract }, allowedHosts);
    checks.push({ kind: 'contract', result: contractResult });
    if (!contractResult.ok) {
      throw new Error(`waitPreset contract failed: ${command.waitPreset}`);
    }
  }
  return { ok: true, waitPreset: command.waitPreset, checks };
}

function waitPresetConfig(name) {
  const presets = {
    genericPortalReady: { wait: { kind: 'spinnerGone', pollIntervalMs: 400 }, contract: { contractSelectors: ['body'] } },
    defenderIncidentReady: { wait: { kind: 'composite', selector: '[role="tab"]', pollIntervalMs: 500 }, contract: { contractName: 'defenderIncidentReady' } },
    azureBladeReady: { wait: { kind: 'spinnerGone', pollIntervalMs: 500 }, contract: { contractName: 'azureBladeReady' } },
    entraTableReady: { wait: { kind: 'spinnerGone', pollIntervalMs: 500 }, contract: { contractName: 'entraTableReady' } }
  };
  return presets[String(name || 'genericPortalReady')] || presets.genericPortalReady;
}

async function buildTargetCandidatesWithMemory(command, tab) {
  const candidates = buildTargetCandidates(command);
  if (command.selectorMemory === false) {
    return candidates;
  }

  const memoryKey = selectorMemoryKey(command, tab?.url);
  if (!memoryKey) {
    return candidates;
  }

  const stored = await chrome.storage.local.get(SELECTOR_MEMORY_STORAGE_KEY);
  const memory = stored[SELECTOR_MEMORY_STORAGE_KEY] && typeof stored[SELECTOR_MEMORY_STORAGE_KEY] === 'object'
    ? stored[SELECTOR_MEMORY_STORAGE_KEY]
    : {};
  const entries = Array.isArray(memory[memoryKey]) ? memory[memoryKey].slice(0, 5) : [];
  const remembered = entries
    .filter(entry => entry?.selector || entry?.text || entry?.label)
    .map(entry => ({
      ...candidates[0],
      selector: entry.selector,
      text: entry.selector ? undefined : entry.text,
      label: entry.label,
      role: entry.role,
      selectorMemoryHit: true
    }));
  return [...remembered, ...candidates];
}

async function rememberSelectorSuccess(command, tab, candidate, autoHealed) {
  if (command.selectorMemory === false || !candidate || (!candidate.selector && !candidate.text && !candidate.label)) {
    return;
  }

  const memoryKey = selectorMemoryKey(command, tab?.url);
  if (!memoryKey) {
    return;
  }

  const stored = await chrome.storage.local.get(SELECTOR_MEMORY_STORAGE_KEY);
  const memory = stored[SELECTOR_MEMORY_STORAGE_KEY] && typeof stored[SELECTOR_MEMORY_STORAGE_KEY] === 'object'
    ? stored[SELECTOR_MEMORY_STORAGE_KEY]
    : {};
  const current = Array.isArray(memory[memoryKey]) ? memory[memoryKey] : [];
  const entry = {
    selector: candidate.selector,
    text: candidate.text,
    label: candidate.label,
    role: candidate.role,
    action: command.action,
    autoHealed: Boolean(autoHealed),
    updatedAt: new Date().toISOString()
  };
  memory[memoryKey] = [entry, ...current.filter(item => item?.selector !== entry.selector || item?.text !== entry.text).slice(0, 9)];
  await chrome.storage.local.set({ [SELECTOR_MEMORY_STORAGE_KEY]: memory });
}

function selectorMemoryKey(command, url) {
  const identity = String(command.targetHint || command.label || command.text || command.selector || '').trim().toLowerCase();
  if (!identity) {
    return undefined;
  }

  let host = 'unknown-host';
  try {
    host = new URL(url || location.href).hostname.toLowerCase();
  } catch {
    host = 'unknown-host';
  }
  return `${host}|${command.action || 'action'}|${identity}`;
}

async function runRecordWorkflow(command) {
  const macroName = String(command.macroName || '').trim();
  if (!macroName) {
    throw new Error('recordWorkflow requires macroName.');
  }

  const steps = Array.isArray(command.steps) ? command.steps.slice(0, 50) : [];
  if (steps.length === 0) {
    throw new Error('recordWorkflow requires at least one step.');
  }

  const stored = await chrome.storage.local.get(WORKFLOW_MACROS_STORAGE_KEY);
  const macros = stored[WORKFLOW_MACROS_STORAGE_KEY] && typeof stored[WORKFLOW_MACROS_STORAGE_KEY] === 'object'
    ? stored[WORKFLOW_MACROS_STORAGE_KEY]
    : {};

  macros[macroName] = {
    macroName,
    updatedAt: new Date().toISOString(),
    steps
  };

  await chrome.storage.local.set({ [WORKFLOW_MACROS_STORAGE_KEY]: macros });
  return { ok: true, macroName, stepCount: steps.length };
}

async function runReplayWorkflow(command, allowedHosts) {
  const macroName = String(command.macroName || '').trim();
  if (!macroName) {
    throw new Error('replayWorkflow requires macroName.');
  }

  const stored = await chrome.storage.local.get(WORKFLOW_MACROS_STORAGE_KEY);
  const macros = stored[WORKFLOW_MACROS_STORAGE_KEY] && typeof stored[WORKFLOW_MACROS_STORAGE_KEY] === 'object'
    ? stored[WORKFLOW_MACROS_STORAGE_KEY]
    : {};
  const macro = macros[macroName];
  if (!macro || !Array.isArray(macro.steps) || macro.steps.length === 0) {
    throw new Error(`Workflow macro not found: ${macroName}`);
  }

  const params = command.params && typeof command.params === 'object' ? command.params : {};
  const renderedSteps = macro.steps.map(step => renderTemplateObject(step, params));
  const results = [];
  for (const step of renderedSteps) {
    const result = await executeSingleAction({ ...command, ...step, action: step.action ?? 'readPage' }, allowedHosts);
    results.push({ action: step.action ?? 'readPage', result });
  }

  return { ok: true, macroName, executed: results.length, steps: results };
}

const SCENARIO_TEMPLATE_REGISTRY = {
  portalReadinessCheck: {
    category: 'generic',
    description: 'Check whether a portal page is ready for browser automation.',
    defaults: {
      waitPreset: 'genericPortalReady',
      contractName: 'genericPortalReady',
      contractSelectors: ['main'],
      contractTexts: []
    },
    steps: [
      { action: 'automationHealthScore', captureAfter: false },
      { action: 'waitPreset', waitPreset: '{{waitPreset}}', captureAfter: false },
      { action: 'assertPageContract', contractName: '{{contractName}}', contractSelectors: '{{contractSelectors}}', contractTexts: '{{contractTexts}}' },
      { action: 'accessibilitySnapshot', maxEntries: 80, captureAfter: false }
    ]
  },
  evidenceTableReview: {
    category: 'generic',
    description: 'Collect and verify table-based evidence.',
    defaults: {
      tableSelector: 'table',
      claim: 'visible table evidence is present',
      captureGroup: 'evidence-table-review',
      highlightSelectors: ['table']
    },
    steps: [
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', headerMode: 'auto', outputFormat: 'json' },
      { action: 'highlightEvidence', highlightSelectors: '{{highlightSelectors}}', includeScreenshot: true },
      { action: 'evidenceClaimCheck', claim: '{{claim}}', tableSelector: '{{tableSelector}}' },
      { action: 'buildEvidencePack', captureGroup: '{{captureGroup}}', captureAfter: false }
    ]
  },
  safeDestructiveAction: {
    category: 'generic',
    description: 'Preview and gate a potentially destructive action without executing it.',
    defaults: {
      actionTemplate: { action: 'click', targetHint: 'Delete, disable, approve, or remove action' },
      targetHint: 'sensitive action',
      reviewPrompt: 'Review the sensitive browser action before any execution.',
      approvalKeyword: 'APPROVE_SCENARIO'
    },
    steps: [
      { action: 'policyGuard', policyProfile: 'standard', onViolation: 'block', actionTemplate: '{{actionTemplate}}' },
      { action: 'sensitiveActionGuard', onViolation: 'block', actionTemplate: '{{actionTemplate}}', targetHint: '{{targetHint}}' },
      { action: 'safeActionPreview', actionTemplate: '{{actionTemplate}}', targetHint: '{{targetHint}}' },
      { action: 'humanReviewGate', reviewPrompt: '{{reviewPrompt}}', approvalKeyword: '{{approvalKeyword}}', value: '{{approvalKeyword}}' }
    ]
  },
  multiTabAuthFlow: {
    category: 'generic',
    description: 'Classify tabs, detect popups, and return to the main tab.',
    defaults: {
      tabRoles: { main: [''], auth: ['login', 'oauth', 'signin'], callback: ['redirect', 'callback'] },
      expectedTabs: 1,
      returnToRole: 'main'
    },
    steps: [
      { action: 'tabRunSummary', tabRoles: '{{tabRoles}}', expectedTabs: '{{expectedTabs}}', captureAfter: false },
      { action: 'popupGuard', tabRoles: '{{tabRoles}}', expectedTabs: '{{expectedTabs}}', onUnexpectedTab: 'warn', captureAfter: false },
      { action: 'tabOrchestrator', tabRoles: '{{tabRoles}}', expectedTabs: '{{expectedTabs}}', returnToRole: '{{returnToRole}}', onUnexpectedTab: 'capture' },
      { action: 'returnToTab', returnToRole: '{{returnToRole}}', tabRoles: '{{tabRoles}}', captureAfter: false }
    ]
  },
  formFillAndVerify: {
    category: 'generic',
    description: 'Map a form, fill provided non-secret fields, and verify the resulting state.',
    defaults: {
      formFields: {},
      submitSelector: '',
      submitText: '',
      assertText: '',
      assertSelector: 'form'
    },
    steps: [
      { action: 'mapForm', captureAfter: false },
      { action: 'smartFormFill', formFields: '{{formFields}}', submitSelector: '{{submitSelector}}', submitText: '{{submitText}}' },
      { action: 'watchPageChanges', watchDurationMs: 2500, captureAfter: false },
      { action: 'visualAssert', assertText: '{{assertText}}', assertSelector: '{{assertSelector}}', captureAfter: false }
    ]
  },
  downloadEvidenceCapture: {
    category: 'generic',
    description: 'Capture evidence around a download link and hash the downloaded target.',
    defaults: {
      selector: 'a',
      text: '',
      url: '',
      captureGroup: 'download-evidence',
      highlightSelectors: ['a']
    },
    steps: [
      { action: 'highlightEvidence', selector: '{{selector}}', highlightSelectors: '{{highlightSelectors}}', includeScreenshot: true },
      { action: 'safeDownloadAndHash', selector: '{{selector}}', text: '{{text}}', url: '{{url}}' },
      { action: 'browserRunBundle', captureGroup: '{{captureGroup}}', captureAfter: false }
    ]
  },
  flakyUiRecovery: {
    category: 'generic',
    description: 'Explain a recent failure and profile better waiting/targeting choices.',
    defaults: {
      targetHint: 'the failed target',
      selector: 'main',
      waitCandidates: ['spinnerGone', 'elementStable', 'networkIdle']
    },
    steps: [
      { action: 'failureExplainer', targetHint: '{{targetHint}}', captureAfter: false },
      { action: 'waitProfiler', waitCandidates: '{{waitCandidates}}', selector: '{{selector}}', captureAfter: false },
      { action: 'stableTargetProfile', targetHint: '{{targetHint}}', selector: '{{selector}}', captureAfter: false },
      { action: 'safeActionPreview', targetHint: '{{targetHint}}' }
    ]
  },
  guidedDrilldownEvidence: {
    category: 'generic',
    description: 'Open relevant rows or list items and collect detail evidence.',
    defaults: {
      tableSelector: 'table',
      itemSelector: '',
      matchText: '',
      detailSelector: 'main',
      captureGroup: 'guided-drilldown',
      requiredClaims: ['summary', 'detail evidence']
    },
    steps: [
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'guidedDrilldown', tableSelector: '{{tableSelector}}', itemSelector: '{{itemSelector}}', matchText: '{{matchText}}', detailSelector: '{{detailSelector}}' },
      { action: 'highlightEvidence', highlightSelectors: ['{{detailSelector}}'], includeScreenshot: true },
      { action: 'evidenceCompletenessCheck', captureGroup: '{{captureGroup}}', requiredClaims: '{{requiredClaims}}' }
    ]
  },
  operatorHandoff: {
    category: 'generic',
    description: 'Package current browser state and evidence for a human operator.',
    defaults: {
      captureGroup: 'operator-handoff',
      reviewPrompt: 'Review browser evidence and continue manually if needed.'
    },
    steps: [
      { action: 'createHandoff', reviewPrompt: '{{reviewPrompt}}' },
      { action: 'buildNavigationGraph', maxEntries: 80, captureAfter: false },
      { action: 'browserRunBundle', captureGroup: '{{captureGroup}}', captureAfter: false },
      { action: 'captureReviewQueue', maxEntries: 50, captureAfter: false }
    ]
  },
  backgroundJobWorkflow: {
    category: 'generic',
    description: 'Run a small step bundle as a named browser job and return its status.',
    defaults: {
      jobName: 'scenario-job',
      jobSteps: [{ action: 'readPage' }],
      captureGroup: 'scenario-job'
    },
    steps: [
      { action: 'startBrowserJob', jobName: '{{jobName}}', steps: '{{jobSteps}}', captureAfter: false },
      { action: 'getBrowserJob', jobName: '{{jobName}}', captureAfter: false },
      { action: 'browserRunBundle', captureGroup: '{{captureGroup}}', captureAfter: false }
    ]
  },
  defenderXdrIncidentTriage: {
    category: 'microsoft-security',
    product: 'Microsoft Defender XDR',
    description: 'Collect visible incident summary, alerts, entities, and handoff evidence.',
    defaults: {
      captureGroup: 'defender-xdr-incident',
      summarySelector: 'main',
      alertsTableSelector: 'table',
      alertDetailSelector: 'main',
      requiredClaims: ['incident severity', 'incident status', 'affected entities', 'related alerts', 'timeline evidence']
    },
    steps: [
      { action: 'automationHealthScore', captureAfter: false },
      { action: 'waitPreset', waitPreset: 'defenderIncidentReady', captureAfter: false },
      { action: 'assertPageContract', contractName: 'defenderIncidentReady' },
      { action: 'tabRunSummary', expectedTabs: 1, captureAfter: false },
      { action: 'guidedDrilldown', tableSelector: '{{alertsTableSelector}}', detailSelector: '{{alertDetailSelector}}' },
      { action: 'highlightEvidence', highlightSelectors: ['{{summarySelector}}', '{{alertsTableSelector}}'], includeScreenshot: true },
      { action: 'evidenceCompletenessCheck', captureGroup: '{{captureGroup}}', requiredClaims: '{{requiredClaims}}' },
      { action: 'buildEvidencePack', captureGroup: '{{captureGroup}}', captureAfter: false },
      { action: 'createHandoff', reviewPrompt: 'Review Defender XDR incident evidence before final reporting.' }
    ]
  },
  defenderXdrAlertEvidenceReview: {
    category: 'microsoft-security',
    product: 'Microsoft Defender XDR',
    description: 'Review per-alert evidence and impact scope.',
    defaults: {
      tableSelector: 'table',
      detailSelector: 'main',
      claim: 'alert evidence is visible',
      captureGroup: 'defender-xdr-alerts',
      requiredClaims: ['alert title', 'severity', 'affected entity', 'detection source']
    },
    steps: [
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'guidedDrilldown', tableSelector: '{{tableSelector}}', detailSelector: '{{detailSelector}}' },
      { action: 'evidenceClaimCheck', claim: '{{claim}}', tableSelector: '{{tableSelector}}' },
      { action: 'evidenceCompletenessCheck', captureGroup: '{{captureGroup}}', requiredClaims: '{{requiredClaims}}' }
    ]
  },
  sentinelLogCollection: {
    category: 'microsoft-security',
    product: 'Microsoft Sentinel',
    description: 'Capture Sentinel query context and visible result table evidence.',
    defaults: {
      captureGroup: 'sentinel-log-collection',
      tableSelector: 'table',
      requiredClaims: ['query time range', 'result count', 'key entities', 'notable rows']
    },
    steps: [
      { action: 'automationHealthScore', captureAfter: false },
      { action: 'waitPreset', waitPreset: 'azureBladeReady', captureAfter: false },
      { action: 'assertPageContract', contractName: 'azureBladeReady' },
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', headerMode: 'auto', outputFormat: 'json' },
      { action: 'highlightEvidence', highlightSelectors: ['{{tableSelector}}'], includeScreenshot: true },
      { action: 'evidenceCompletenessCheck', captureGroup: '{{captureGroup}}', requiredClaims: '{{requiredClaims}}' },
      { action: 'browserRunBundle', captureGroup: '{{captureGroup}}', captureAfter: false }
    ]
  },
  sentinelIncidentCorrelation: {
    category: 'microsoft-security',
    product: 'Microsoft Sentinel',
    description: 'Correlate a Sentinel incident page with visible log results.',
    defaults: {
      goal: 'correlate Sentinel incident evidence with visible log results',
      tableSelector: 'table',
      claim: 'Sentinel incident evidence is supported by visible logs'
    },
    steps: [
      { action: 'planAndRun', goal: '{{goal}}', tableSelector: '{{tableSelector}}', captureAfter: false },
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'evidenceClaimCheck', claim: '{{claim}}', tableSelector: '{{tableSelector}}' },
      { action: 'buildNavigationGraph', maxEntries: 80, captureAfter: false }
    ]
  },
  entraRiskySignInReview: {
    category: 'microsoft-security',
    product: 'Microsoft Entra ID',
    description: 'Collect risky sign-in evidence while guarding remediation actions.',
    defaults: {
      tableSelector: 'table',
      detailSelector: 'main',
      userPrincipalName: '',
      captureGroup: 'entra-risky-signin'
    },
    steps: [
      { action: 'waitPreset', waitPreset: 'entraTableReady', captureAfter: false },
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'guidedDrilldown', tableSelector: '{{tableSelector}}', matchText: '{{userPrincipalName}}', detailSelector: '{{detailSelector}}' },
      { action: 'sensitiveActionGuard', onViolation: 'block', actionTemplate: { action: 'click', targetHint: 'Confirm compromised, dismiss risk, or block user' } },
      { action: 'highlightEvidence', highlightSelectors: ['{{detailSelector}}'], includeScreenshot: true },
      { action: 'buildEvidencePack', captureGroup: '{{captureGroup}}', captureAfter: false }
    ]
  },
  entraAuditTrailCapture: {
    category: 'microsoft-security',
    product: 'Microsoft Entra ID',
    description: 'Capture Entra audit or sign-in logs after filters are applied.',
    defaults: {
      formFields: {},
      tableSelector: 'table',
      captureGroup: 'entra-audit-trail'
    },
    steps: [
      { action: 'mapForm', captureAfter: false },
      { action: 'smartFormFill', formFields: '{{formFields}}' },
      { action: 'waitPreset', waitPreset: 'entraTableReady', captureAfter: false },
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'buildEvidencePack', captureGroup: '{{captureGroup}}', captureAfter: false }
    ]
  },
  mdeDeviceTimelineReview: {
    category: 'microsoft-security',
    product: 'Microsoft Defender for Endpoint',
    description: 'Collect device timeline events and detail evidence.',
    defaults: {
      tableSelector: 'table',
      detailSelector: 'main',
      keyColumns: ['Time', 'Event'],
      captureGroup: 'mde-device-timeline'
    },
    steps: [
      { action: 'assertPageContract', contractSelectors: ['{{tableSelector}}'] },
      { action: 'tableWatchAndDiff', tableSelector: '{{tableSelector}}', keyColumns: '{{keyColumns}}', watchDurationMs: 1500 },
      { action: 'guidedDrilldown', tableSelector: '{{tableSelector}}', detailSelector: '{{detailSelector}}' },
      { action: 'highlightEvidence', highlightSelectors: ['{{tableSelector}}', '{{detailSelector}}'], includeScreenshot: true }
    ]
  },
  mdeAdvancedHuntingCollection: {
    category: 'microsoft-security',
    product: 'Microsoft Defender XDR Advanced Hunting',
    description: 'Collect Advanced Hunting result evidence.',
    defaults: {
      tableSelector: 'table',
      claim: 'advanced hunting results are visible',
      captureGroup: 'mde-advanced-hunting',
      waitCandidates: ['spinnerGone', 'elementStable', 'networkIdle']
    },
    steps: [
      { action: 'waitProfiler', waitCandidates: '{{waitCandidates}}', selector: '{{tableSelector}}', captureAfter: false },
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'evidenceClaimCheck', claim: '{{claim}}', tableSelector: '{{tableSelector}}' },
      { action: 'browserRunBundle', captureGroup: '{{captureGroup}}', captureAfter: false }
    ]
  },
  mdoEmailThreatReview: {
    category: 'microsoft-security',
    product: 'Microsoft Defender for Office 365',
    description: 'Review malicious email, URL, attachment, and delivery evidence.',
    defaults: {
      tableSelector: 'table',
      detailSelector: 'main',
      targetHint: 'email threat action',
      captureGroup: 'mdo-email-threat'
    },
    steps: [
      { action: 'guidedDrilldown', tableSelector: '{{tableSelector}}', detailSelector: '{{detailSelector}}' },
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'highlightEvidence', highlightSelectors: ['{{tableSelector}}', '{{detailSelector}}'], includeScreenshot: true },
      { action: 'safeActionPreview', targetHint: '{{targetHint}}' }
    ]
  },
  defenderForIdentityLateralMovementReview: {
    category: 'microsoft-security',
    product: 'Microsoft Defender for Identity',
    description: 'Review account and host evidence for lateral movement alerts.',
    defaults: {
      tableSelector: 'table',
      detailSelector: 'main',
      claim: 'lateral movement evidence is visible',
      captureGroup: 'mdi-lateral-movement'
    },
    steps: [
      { action: 'guidedDrilldown', tableSelector: '{{tableSelector}}', detailSelector: '{{detailSelector}}' },
      { action: 'evidenceClaimCheck', claim: '{{claim}}', tableSelector: '{{tableSelector}}' },
      { action: 'buildEvidencePack', captureGroup: '{{captureGroup}}', captureAfter: false }
    ]
  },
  defenderForCloudPostureReview: {
    category: 'microsoft-security',
    product: 'Microsoft Defender for Cloud',
    description: 'Collect security recommendation, resource, and compliance posture evidence.',
    defaults: {
      tableSelector: 'table',
      captureGroup: 'defender-for-cloud-posture',
      requiredClaims: ['recommendation', 'resource', 'severity', 'compliance state']
    },
    steps: [
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'highlightEvidence', highlightSelectors: ['{{tableSelector}}'], includeScreenshot: true },
      { action: 'evidenceCompletenessCheck', captureGroup: '{{captureGroup}}', requiredClaims: '{{requiredClaims}}' }
    ]
  },
  purviewDlpIncidentReview: {
    category: 'microsoft-security',
    product: 'Microsoft Purview',
    description: 'Capture DLP alert, policy, and sensitive information evidence.',
    defaults: {
      tableSelector: 'table',
      detailSelector: 'main',
      captureGroup: 'purview-dlp-incident'
    },
    steps: [
      { action: 'policyGuard', policyProfile: 'investigation', onViolation: 'warn', actionTemplate: { action: 'readPage' } },
      { action: 'tableExtract', tableSelector: '{{tableSelector}}', outputFormat: 'json' },
      { action: 'guidedDrilldown', tableSelector: '{{tableSelector}}', detailSelector: '{{detailSelector}}' },
      { action: 'createHandoff', reviewPrompt: 'Review Purview DLP evidence before any remediation.' }
    ]
  },
  securityPortalHandoffBundle: {
    category: 'microsoft-security',
    product: 'Microsoft Security portals',
    description: 'Create a cross-product handoff bundle from current security portal evidence.',
    defaults: {
      captureGroup: 'security-portal-handoff',
      reviewPrompt: 'Review security portal evidence and continue manually if needed.'
    },
    steps: [
      { action: 'createHandoff', reviewPrompt: '{{reviewPrompt}}' },
      { action: 'buildEvidencePack', captureGroup: '{{captureGroup}}', captureAfter: false },
      { action: 'buildNavigationGraph', maxEntries: 100, captureAfter: false },
      { action: 'captureReviewQueue', maxEntries: 50, captureAfter: false }
    ]
  }
};

async function runScenarioTemplate(command, allowedHosts) {
  const scenarioName = String(command.scenarioName || '').trim();
  if (!scenarioName) {
    throw new Error('runScenarioTemplate requires scenarioName.');
  }

  const templates = await buildScenarioTemplateRegistry(command.scenarioTemplates);
  const template = templates[scenarioName];
  if (!template || !Array.isArray(template.steps) || template.steps.length === 0) {
    const available = Object.keys(templates).sort().join(', ');
    throw new Error(`Scenario template not found: ${scenarioName}. Available: ${available}`);
  }

  const params = buildScenarioTemplateParams(command, scenarioName, template);
  const renderedSteps = template.steps
    .slice(0, 40)
    .map(step => renderScenarioTemplateObject(step, params))
    .map(step => ({ ...step, action: step.action || 'readPage' }));

  const results = [];
  for (const step of renderedSteps) {
    if (step.action === 'runScenarioTemplate') {
      throw new Error('Scenario templates cannot call runScenarioTemplate recursively.');
    }
    const result = await executeSingleAction({ ...command, ...step }, allowedHosts);
    results.push({ action: step.action, result });
  }

  return {
    ok: true,
    action: 'runScenarioTemplate',
    scenarioName,
    category: template.category || 'custom',
    product: template.product,
    description: template.description,
    stepCount: renderedSteps.length,
    executed: results.length,
    steps: results,
    availableTemplates: Object.keys(templates).sort(),
    recommendedNextAction: template.recommendedNextAction || 'reviewScenarioResults'
  };
}

async function buildScenarioTemplateRegistry(customTemplates) {
  const registry = { ...SCENARIO_TEMPLATE_REGISTRY };
  const stored = await chrome.storage.local.get(SCENARIO_TEMPLATES_STORAGE_KEY);
  mergeScenarioTemplateRegistry(registry, stored[SCENARIO_TEMPLATES_STORAGE_KEY], 'stored');
  mergeScenarioTemplateRegistry(registry, customTemplates, 'request');
  return registry;
}

function mergeScenarioTemplateRegistry(registry, templates, source) {
  if (!templates || typeof templates !== 'object' || Array.isArray(templates)) {
    return;
  }
  for (const [name, template] of Object.entries(templates)) {
    if (!name || !template || typeof template !== 'object' || Array.isArray(template)) {
      continue;
    }
    if (Array.isArray(template.steps) && template.steps.length > 0) {
      registry[name] = {
        category: String(template.category || 'custom'),
        product: typeof template.product === 'string' ? template.product : undefined,
        description: typeof template.description === 'string' ? template.description : 'Custom scenario template.',
        defaults: template.defaults && typeof template.defaults === 'object' ? template.defaults : {},
        steps: template.steps.slice(0, 40),
        templateVersion: typeof template.templateVersion === 'string' ? template.templateVersion : '1.0.0',
        source
      };
    }
  }
}

async function runListScenarioTemplates() {
  const templates = await buildScenarioTemplateRegistry();
  const items = Object.entries(templates).map(([name, template]) => ({
    name,
    category: template.category || 'custom',
    product: template.product,
    description: template.description,
    templateVersion: template.templateVersion || 'builtin',
    source: template.source || 'builtin',
    stepCount: Array.isArray(template.steps) ? template.steps.length : 0
  }));
  return { ok: true, templateCount: items.length, templates: items.sort((left, right) => left.name.localeCompare(right.name)) };
}

async function runSaveScenarioTemplate(command) {
  const scenarioName = String(command.scenarioName || '').trim();
  const definition = command.scenarioTemplates?.[scenarioName];
  if (!definition || typeof definition !== 'object' || !Array.isArray(definition.steps) || definition.steps.length === 0) {
    throw new Error('saveScenarioTemplate requires scenarioTemplates[scenarioName] with at least one step.');
  }
  const stored = await chrome.storage.local.get(SCENARIO_TEMPLATES_STORAGE_KEY);
  const templates = stored[SCENARIO_TEMPLATES_STORAGE_KEY] && typeof stored[SCENARIO_TEMPLATES_STORAGE_KEY] === 'object'
    ? stored[SCENARIO_TEMPLATES_STORAGE_KEY]
    : {};
  templates[scenarioName] = {
    category: String(definition.category || 'custom'),
    product: typeof definition.product === 'string' ? definition.product : undefined,
    description: typeof definition.description === 'string' ? definition.description : 'Custom scenario template.',
    defaults: definition.defaults && typeof definition.defaults === 'object' ? definition.defaults : {},
    steps: definition.steps.slice(0, 40),
    templateVersion: String(command.templateVersion || definition.templateVersion || '1.0.0').slice(0, 40),
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [SCENARIO_TEMPLATES_STORAGE_KEY]: templates });
  return { ok: true, scenarioName, templateVersion: templates[scenarioName].templateVersion, stepCount: templates[scenarioName].steps.length };
}

async function runDeleteScenarioTemplate(command) {
  const scenarioName = String(command.scenarioName || '').trim();
  const stored = await chrome.storage.local.get(SCENARIO_TEMPLATES_STORAGE_KEY);
  const templates = stored[SCENARIO_TEMPLATES_STORAGE_KEY] && typeof stored[SCENARIO_TEMPLATES_STORAGE_KEY] === 'object'
    ? stored[SCENARIO_TEMPLATES_STORAGE_KEY]
    : {};
  const deleted = Boolean(templates[scenarioName]);
  delete templates[scenarioName];
  await chrome.storage.local.set({ [SCENARIO_TEMPLATES_STORAGE_KEY]: templates });
  return { ok: true, scenarioName, deleted };
}

async function runExportScenarioTemplates() {
  const stored = await chrome.storage.local.get(SCENARIO_TEMPLATES_STORAGE_KEY);
  const templates = stored[SCENARIO_TEMPLATES_STORAGE_KEY] && typeof stored[SCENARIO_TEMPLATES_STORAGE_KEY] === 'object'
    ? stored[SCENARIO_TEMPLATES_STORAGE_KEY]
    : {};
  return { ok: true, exportedAt: new Date().toISOString(), formatVersion: '1.0', templates };
}

function buildScenarioTemplateParams(command, scenarioName, template) {
  const defaults = template.defaults && typeof template.defaults === 'object' ? template.defaults : {};
  const direct = {};
  const keys = [
    'selector', 'text', 'value', 'url', 'urls', 'formFields', 'submitSelector', 'submitText', 'targetHint', 'tableSelector',
    'detailSelector', 'itemSelector', 'matchText', 'claim', 'requiredClaims', 'keyColumns', 'waitCandidates', 'waitPreset',
    'contractName', 'contractSelectors', 'contractTexts', 'captureGroup', 'jobName', 'tabRoles', 'expectedTabs', 'returnToRole',
    'actionTemplate', 'highlightSelectors', 'highlightText', 'reviewPrompt', 'approvalKeyword', 'goal', 'params'
  ];
  for (const key of keys) {
    if (command[key] !== undefined) {
      direct[key] = command[key];
    }
  }

  return {
    ...defaults,
    scenarioName,
    captureGroup: command.captureGroup || command.investigationName || defaults.captureGroup || scenarioName,
    investigationName: command.investigationName || command.captureGroup || defaults.captureGroup || scenarioName,
    ...direct,
    ...(command.params && typeof command.params === 'object' ? command.params : {})
  };
}

function renderScenarioTemplateObject(input, params) {
  if (typeof input === 'string') {
    const exact = input.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/);
    if (exact) {
      return readScenarioParam(params, exact[1], input);
    }
    return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
      const value = readScenarioParam(params, key, undefined);
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      return match;
    });
  }
  if (Array.isArray(input)) {
    return input.map(item => renderScenarioTemplateObject(item, params));
  }
  if (!input || typeof input !== 'object') {
    return input;
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = renderScenarioTemplateObject(value, params);
  }
  return output;
}

function readScenarioParam(params, key, fallback) {
  if (Object.prototype.hasOwnProperty.call(params, key)) {
    return params[key];
  }

  const parts = key.split('.');
  let current = params;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return fallback;
    }
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

function renderTemplateObject(input, params) {
  if (typeof input === 'string') {
    return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
      const value = params[key];
      return typeof value === 'string' ? value : match;
    });
  }
  if (Array.isArray(input)) {
    return input.map(item => renderTemplateObject(item, params));
  }
  if (!input || typeof input !== 'object') {
    return input;
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = renderTemplateObject(value, params);
  }
  return output;
}

async function evaluateConditionOnTab(tabId, condition) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (input) => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (input?.selector) {
        const target = document.querySelector(input.selector);
        if (target) {
          return true;
        }
      }
      if (input?.text) {
        const pageText = normalize(document.body?.innerText ?? '');
        if (pageText.includes(normalize(input.text))) {
          return true;
        }
      }
      if (input?.urlPattern) {
        return location.href.includes(input.urlPattern);
      }
      return false;
    },
    args: [condition]
  });

  return Boolean(result);
}

async function collectDomFingerprint(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const text = normalize(document.body?.innerText ?? '').slice(0, 40000);
      let hash = 2166136261;
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return {
        hash: `h${(hash >>> 0).toString(16)}`,
        textLength: text.length,
        headings: document.querySelectorAll('h1,h2,h3').length
      };
    }
  });

  return result ?? { hash: 'h0', textLength: 0, headings: 0 };
}

async function collectActionEffectState(command) {
  const tab = await getActiveTab();
  if (!hasTabId(tab)) {
    return undefined;
  }

  const fingerprint = await collectDomFingerprint(tab.id);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: input => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      let target;
      if (input.selector) {
        target = document.querySelector(input.selector);
      } else if (input.text || input.label) {
        const intent = normalize(input.text || input.label).toLowerCase();
        target = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="tab"],[role="menuitem"]'))
          .find(element => normalize(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title')).toLowerCase().includes(intent));
      }

      const active = document.activeElement;
      const activeElement = active ? [active.tagName, active.id, active.getAttribute('name'), active.getAttribute('aria-label')].filter(Boolean).join('|') : '';
      const targetState = target ? JSON.stringify({
        value: 'value' in target ? target.value : undefined,
        checked: 'checked' in target ? target.checked : undefined,
        selectedIndex: 'selectedIndex' in target ? target.selectedIndex : undefined,
        ariaSelected: target.getAttribute('aria-selected'),
        ariaExpanded: target.getAttribute('aria-expanded'),
        text: normalize(target.innerText || target.textContent).slice(0, 500)
      }) : '';
      return {
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        activeElement,
        targetState
      };
    },
    args: [command]
  });

  return {
    tabId: tab.id,
    url: tab.url,
    domHash: fingerprint.hash,
    scrollX: result?.scrollX ?? 0,
    scrollY: result?.scrollY ?? 0,
    activeElement: result?.activeElement ?? '',
    targetState: result?.targetState ?? ''
  };
}

async function runJourneyCapture(command, allowedHosts) {
  const urls = Array.isArray(command.urls) ? command.urls.filter(Boolean).slice(0, Math.max(1, Number(command.maxPages) || 5)) : [];
  if (urls.length === 0) {
    throw new Error('journeyCapture requires urls.');
  }

  const pages = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    assertAllowedUrl(url, allowedHosts);
    const tab = await getActiveTab();
    await chrome.tabs.update(tab.id, { url });
    await waitForTabComplete(tab.id, command.timeoutMs);
    const authState = await detectAuthRequired(tab.id);
    if (authState?.authRequired) {
      throw new Error(`AUTH_REQUIRED::${JSON.stringify({
        authRequired: true,
        authUrl: authState.authUrl,
        message: 'Authentication is required in the browser tab before capture can continue.',
        pages,
        visitedCount: pages.length,
        resumeInput: {
          action: 'journeyCapture',
          urls: urls.slice(i),
          maxPages: Math.max(1, Number(command.maxPages) || 5),
          extractSelectors: command.extractSelectors,
          timeoutMs: command.timeoutMs,
          includeScreenshot: command.includeScreenshot,
          includeHtml: command.includeHtml,
          captureAfter: command.captureAfter,
          investigationName: command.investigationName
        }
      })}`);
    }

    const summary = await collectTabSummary(tab.id, command.extractSelectors);
    pages.push(summary);
  }

  return {
    ok: true,
    pages,
    visitedCount: pages.length
  };
}

async function runPaginateCapture(command, allowedHosts) {
  const tab = await getActiveTab();
  assertAllowedUrl(tab.url, allowedHosts);

  const maxPages = Math.min(Math.max(Number(command.maxPages) || 5, 1), 30);
  const pages = [];
  const seenKeys = new Set();

  for (let i = 0; i < maxPages; i += 1) {
    const authState = await detectAuthRequired(tab.id);
    if (authState?.authRequired) {
      throw new Error(`AUTH_REQUIRED::${JSON.stringify({
        authRequired: true,
        authUrl: authState.authUrl,
        message: 'Authentication is required in the browser tab before pagination capture can continue.',
        pages,
        visitedCount: pages.length,
        resumeInput: {
          action: 'paginateCapture',
          nextSelector: command.nextSelector,
          nextText: command.nextText,
          maxPages: Math.max(1, maxPages - i),
          extractSelectors: command.extractSelectors,
          wait: command.wait,
          waitAfterNavigateMs: command.waitAfterNavigateMs,
          timeoutMs: command.timeoutMs,
          includeScreenshot: command.includeScreenshot,
          includeHtml: command.includeHtml,
          captureAfter: command.captureAfter,
          investigationName: command.investigationName
        }
      })}`);
    }

    const page = await collectTabSummary(tab.id, command.extractSelectors);
    const dedupeKey = `${page.url}|${page.title}|${page.visibleTextLength}`;
    if (seenKeys.has(dedupeKey)) {
      return { ok: true, pages, visitedCount: pages.length, stoppedReason: 'duplicate-page-detected' };
    }

    seenKeys.add(dedupeKey);
    pages.push(page);

    const [{ result: nextResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runDomCommand,
      args: [{ action: 'click', selector: command.nextSelector, text: command.nextText, label: command.nextText, timeoutMs: command.timeoutMs }]
    });
    if (nextResult?.error) {
      return { ok: true, pages, visitedCount: pages.length, stoppedReason: `next-not-found: ${nextResult.error}` };
    }

    await sleep(Number(command.waitAfterNavigateMs) || 1200);
    const [{ result: waitResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runDomCommand,
      args: [{ action: 'wait', wait: command.wait ?? { kind: 'spinnerGone' }, timeoutMs: command.timeoutMs }]
    });
    if (waitResult?.error) {
      return { ok: true, pages, visitedCount: pages.length, stoppedReason: `wait-timeout: ${waitResult.error}` };
    }
  }

  return { ok: true, pages, visitedCount: pages.length, stoppedReason: 'max-pages-reached' };
}

async function collectTabSummary(tabId, extractSelectors) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selectors) => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const visibleText = normalize(document.body?.innerText ?? '');
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 20).map(element => normalize(element.innerText)).filter(Boolean);
      const buttons = Array.from(document.querySelectorAll('button,[role="button"],a')).slice(0, 60).map(element => normalize(element.innerText || element.getAttribute('aria-label') || '')).filter(Boolean);
      const extracted = {};
      if (selectors && typeof selectors === 'object') {
        for (const [field, selector] of Object.entries(selectors)) {
          try {
            const element = document.querySelector(String(selector));
            extracted[field] = normalize(element?.innerText || element?.textContent || element?.value || '');
          } catch {
            extracted[field] = '';
          }
        }
      }

      return {
        collectedAt: new Date().toISOString(),
        url: location.href,
        title: document.title,
        visibleTextLength: visibleText.length,
        visibleTextSample: visibleText.slice(0, 2000),
        headings,
        buttons: buttons.slice(0, 30),
        extracted
      };
    },
    args: [extractSelectors]
  });

  if (!result) {
    throw new Error('Failed to collect tab summary.');
  }

  return result;
}

function sleep(ms) {
  const duration = Math.min(Math.max(Number(ms) || 0, 0), 10000);
  return new Promise(resolve => setTimeout(resolve, duration));
}

async function detectAuthRequired(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const href = location.href;
      const host = location.hostname.toLowerCase();
      const authHost = host.includes('login.microsoftonline.com') || host.includes('signin') || host.includes('auth');
      const hasPasswordField = Boolean(document.querySelector('input[type="password"]'));
      const hasSignInText = /sign in|signin|로그인|인증/i.test((document.body?.innerText || '').slice(0, 3000));
      const authRequired = authHost || hasPasswordField || hasSignInText;
      return { authRequired, authUrl: href };
    }
  });

  return result;
}

function buildTargetCandidates(command) {
  const candidates = [{
    selector: command.selector,
    text: command.text,
    label: command.label,
    role: command.role,
    index: command.index,
    targetScope: command.targetScope,
    frameDepth: command.frameDepth
  }];
  for (const selector of command.fallbackSelectors ?? []) {
    candidates.push({ ...candidates[0], selector });
  }
  for (const text of command.fallbackTexts ?? []) {
    candidates.push({ ...candidates[0], selector: undefined, text });
  }

  return candidates;
}

function buildTargetIntent(command) {
  return {
    selector: command.selector,
    text: command.text,
    label: command.label,
    role: command.role,
    targetHint: command.targetHint,
    targetScope: command.targetScope,
    frameDepth: command.frameDepth,
    action: command.action
  };
}

function extractScreenshotOverride(executionTrail) {
  if (!Array.isArray(executionTrail)) {
    return undefined;
  }

  for (let i = executionTrail.length - 1; i >= 0; i -= 1) {
    const result = executionTrail[i]?.result;
    if (!result || typeof result !== 'object') {
      continue;
    }

    if (typeof result.screenshotDataUrl === 'string' && result.screenshotDataUrl.startsWith('data:image/')) {
      return {
        dataUrl: result.screenshotDataUrl,
        mimeType: result.screenshotMimeType || 'image/png',
        pageMetadata: {
          action: executionTrail[i]?.action,
          captureRegion: result.captureRegion,
          captureTarget: result.captureTarget,
          screenshotRedaction: result.screenshotRedaction
        }
      };
    }
  }

  return undefined;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (hasTabId(tab)) {
    return tab;
  }

  const [lastFocusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (hasTabId(lastFocusedTab)) {
    return lastFocusedTab;
  }

  const activeTabs = await chrome.tabs.query({ active: true });
  const fallbackTab = activeTabs.find(candidate => hasTabId(candidate) && candidate.windowId !== chrome.windows.WINDOW_ID_NONE);
  if (hasTabId(fallbackTab)) {
    return fallbackTab;
  }

  if (!hasTabId(tab)) {
    throw new Error('No active browser tab is available.');
  }

  return tab;
}

function hasTabId(tab) {
  return Number.isInteger(tab?.id);
}

async function getBrowserSessionId() {
  const stored = await chrome.storage.local.get(BROWSER_SESSION_STORAGE_KEY);
  if (stored[BROWSER_SESSION_STORAGE_KEY]) {
    return stored[BROWSER_SESSION_STORAGE_KEY];
  }

  const id = `browser-session-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${crypto.randomUUID().slice(0, 8)}`;
  await chrome.storage.local.set({ [BROWSER_SESSION_STORAGE_KEY]: id });
  return id;
}

async function buildBrowserSessionState(tab, command, screenSummary, screenshotIncluded) {
  return {
    browserSessionId: await getBrowserSessionId(),
    tabId: tab.id,
    windowId: tab.windowId,
    tabIndex: tab.index,
    url: tab.url,
    title: tab.title,
    captureGroup: command.investigationName,
    lastAction: command.action ?? 'readPage',
    lastCommandId: command.id,
    lastScreenshotIncluded: screenshotIncluded,
    updatedAt: new Date().toISOString(),
    screenSummary
  };
}

async function rememberBrowserState(browserSession) {
  await chrome.storage.local.set({ [LATEST_BROWSER_STATE_STORAGE_KEY]: browserSession });
}

async function getTabByIndex(targetTabIndex) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const target = tabs.find(tab => tab.index === targetTabIndex);
  if (!hasTabId(target)) {
    throw new Error(`Tab index not found: ${targetTabIndex}`);
  }

  return target;
}

async function enqueueCommandResult(result) {
  const stored = await chrome.storage.local.get(RESULT_OUTBOX_STORAGE_KEY);
  const outbox = Array.isArray(stored[RESULT_OUTBOX_STORAGE_KEY]) ? stored[RESULT_OUTBOX_STORAGE_KEY] : [];
  const next = [...outbox.filter(item => item?.id !== result.id), result].slice(-100);
  await chrome.storage.local.set({ [RESULT_OUTBOX_STORAGE_KEY]: next });
}

async function flushCommandResultOutbox(options) {
  const stored = await chrome.storage.local.get(RESULT_OUTBOX_STORAGE_KEY);
  const outbox = Array.isArray(stored[RESULT_OUTBOX_STORAGE_KEY]) ? stored[RESULT_OUTBOX_STORAGE_KEY] : [];
  if (outbox.length === 0) {
    return;
  }

  const remaining = [...outbox];
  while (remaining.length > 0) {
    const result = remaining[0];
    const response = await globalThis.OwenProtocolRuntime.fetchWithTimeout(`http://127.0.0.1:${options.port}/commands/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Owen-Bridge-Token': options.token
      },
      body: JSON.stringify(result)
    }, 15000);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      if (detail.discardResult === true) {
        remaining.shift();
        await chrome.storage.local.set({ [RESULT_OUTBOX_STORAGE_KEY]: remaining });
        continue;
      }
      throw new Error(detail.message || `Failed to deliver browser command result ${result?.id || 'unknown'}: HTTP ${response.status}`);
    }
    remaining.shift();
    await chrome.storage.local.set({ [RESULT_OUTBOX_STORAGE_KEY]: remaining });
  }
}

async function captureCurrentTab() {
  const options = await getOptions();
  if (!options.token) {
    throw new Error('Pairing token is missing. Paste the token from VS Code first.');
  }

  const tab = await getActiveTab();
  if (!hasTabId(tab) || !tab.url) {
    throw new Error('No active browser tab is available.');
  }

  const [{ result: pageSnapshot }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPageSnapshot,
    args: [options.includeHtml]
  });

  let screenshot;
  let screenshotRedaction;
  if (options.includeScreenshot) {
    const captured = await captureVisibleTabWithRedaction(tab, options.screenshotRedaction);
    screenshot = { dataUrl: captured.dataUrl, mimeType: 'image/png' };
    screenshotRedaction = captured.redaction;
  }

  pageSnapshot.metadata = { ...pageSnapshot.metadata, screenshotRedaction };

  const payload = {
    source: 'owen-browser-capture',
    version: chrome.runtime.getManifest().version,
    collectedAt: new Date().toISOString(),
    page: {
      url: tab.url,
      title: tab.title ?? pageSnapshot.title,
      ...pageSnapshot
    },
    screenshot
  };

  const response = await fetch(`http://127.0.0.1:${options.port}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Owen-Bridge-Token': options.token
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ? `${body.error}${body.host ? `: ${body.host}` : ''}` : `HTTP ${response.status}`);
  }

  return body;
}

async function createCapturePayload(tab, command, options, screenshotOverride) {
  const includeHtml = command.includeHtml ?? options.includeHtml;
  const includeScreenshot = command.includeScreenshot ?? options.includeScreenshot;
  const [{ result: pageSnapshot }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPageSnapshot,
    args: [includeHtml]
  });

  let screenshot;
  let screenshotRedaction = screenshotOverride?.pageMetadata?.screenshotRedaction;
  if (screenshotOverride?.dataUrl) {
    screenshot = { dataUrl: screenshotOverride.dataUrl, mimeType: screenshotOverride.mimeType || 'image/png' };
  } else if (includeScreenshot) {
    const captured = await captureVisibleTabWithRedaction(tab, options.screenshotRedaction);
    screenshot = { dataUrl: captured.dataUrl, mimeType: 'image/png' };
    screenshotRedaction = captured.redaction;
  }

  pageSnapshot.metadata = { ...pageSnapshot.metadata, screenshotRedaction };

  if (screenshotOverride?.pageMetadata && pageSnapshot?.metadata && typeof pageSnapshot.metadata === 'object') {
    pageSnapshot.metadata = {
      ...pageSnapshot.metadata,
      partialCapture: screenshotOverride.pageMetadata
    };
  }

  const browserSession = await buildBrowserSessionState(tab, command, pageSnapshot.screenSummary, Boolean(screenshot));
  await rememberBrowserState(browserSession);

  return {
    source: 'owen-browser-capture',
    version: chrome.runtime.getManifest().version,
    collectedAt: new Date().toISOString(),
    investigation: command.investigationName ? { name: command.investigationName } : undefined,
    browserSession,
    page: {
      url: tab.url,
      title: tab.title ?? pageSnapshot.title,
      ...pageSnapshot
    },
    screenshot
  };
}

function runDomCommand(command) {
  try {
    const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const scope = String(command.targetScope || 'auto');
    const includeFrames = scope === 'allFrames' || scope === 'auto';
    const includeShadow = scope === 'shadowDeep' || scope === 'auto';
    const maxFrameDepth = Math.min(Math.max(Number(command.frameDepth) || 2, 0), 6);

    const normalizeDateInput = value => {
      const raw = String(value ?? '').trim();
      const matched = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
      if (matched) {
        const year = matched[1];
        const month = matched[2].padStart(2, '0');
        const day = matched[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return raw;
    };

    const normalizePhone = value => String(value ?? '').replace(/[^0-9+]/g, '');

    const toBoolean = value => {
      const lowered = normalize(value).toLowerCase();
      return lowered === 'true' || lowered === 'yes' || lowered === 'on' || lowered === '1' || lowered === 'checked';
    };

    const enumerateRoots = () => {
      const contexts = [{ root: document, framePath: 'main' }];
      const queue = [{ doc: document, framePath: 'main', depth: 0 }];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }

        const elements = Array.from(current.doc.querySelectorAll('*'));
        for (const element of elements) {
          if (includeShadow && element.shadowRoot) {
            contexts.push({ root: element.shadowRoot, framePath: current.framePath });
          }
        }

        if (!includeFrames || current.depth >= maxFrameDepth) {
          continue;
        }

        const frames = Array.from(current.doc.querySelectorAll('iframe'));
        for (let i = 0; i < frames.length; i += 1) {
          const frame = frames[i];
          try {
            const frameDoc = frame.contentDocument;
            if (!frameDoc) {
              continue;
            }
            const framePath = `${current.framePath}>iframe[${i}]`;
            contexts.push({ root: frameDoc, framePath });
            queue.push({ doc: frameDoc, framePath, depth: current.depth + 1 });
          } catch {
            // Ignore cross-origin iframes.
          }
        }
      }

      return contexts;
    };

    const queryAll = selector => {
      if (!selector) {
        return [];
      }
      const roots = enumerateRoots();
      const found = [];
      for (const context of roots) {
        try {
          const nodes = Array.from(context.root.querySelectorAll(selector));
          for (const node of nodes) {
            found.push({ element: node, framePath: context.framePath });
          }
        } catch {
          // Invalid selector for this root.
        }
      }
      return found;
    };

    const queryFirst = selector => {
      const matches = queryAll(selector);
      return matches.length > 0 ? matches[0] : undefined;
    };

    const isVisible = element => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const isInViewport = element => {
      if (!element) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
    };

    const isOverlapped = element => {
      if (!element || !isVisible(element)) {
        return true;
      }
      const rect = element.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      const clampedX = Math.max(0, Math.min(cx, window.innerWidth - 1));
      const clampedY = Math.max(0, Math.min(cy, window.innerHeight - 1));
      const topElement = document.elementFromPoint(clampedX, clampedY);
      if (!topElement) {
        return true;
      }
      return topElement !== element && !element.contains(topElement);
    };

    const isDisabled = element => Boolean(element?.disabled || element?.getAttribute?.('aria-disabled') === 'true');

    const getSearchableElements = query => {
      if (!query) {
        return [];
      }
      return queryAll(query).filter(item => isVisible(item.element));
    };

    const findByIntent = () => {
      if (command.selector) {
        return queryFirst(command.selector);
      }

      const query = command.role
        ? `[role="${command.role}"]`
        : 'button,[role="button"],[role="tab"],a,input,textarea,select,[tabindex]';
      const elements = getSearchableElements(query);
      const byLabel = normalize(command.label).toLowerCase();
      if (byLabel) {
        const matched = elements.filter(item => normalize(item.element.getAttribute('aria-label') || item.element.getAttribute('title') || '').toLowerCase().includes(byLabel));
        if (matched.length > 0) {
          return matched[Math.max(0, Math.min(command.index ?? 0, matched.length - 1))];
        }
      }

      const byText = normalize(command.text).toLowerCase();
      if (!byText) {
        return undefined;
      }

      const matched = elements.filter(item => normalize(item.element.innerText || item.element.value || item.element.getAttribute('aria-label') || item.element.getAttribute('title') || '').toLowerCase().includes(byText));
      if (matched.length === 0) {
        return undefined;
      }

      return matched[Math.max(0, Math.min(command.index ?? 0, matched.length - 1))];
    };

    const waitForCondition = condition => new Promise(resolve => {
      const kind = condition?.kind ?? 'text';
      const interval = Number.isFinite(condition?.pollIntervalMs) ? Math.max(100, Math.min(5000, condition.pollIntervalMs)) : 400;
      const deadline = Date.now() + (command.timeoutMs ?? 60000);
      const spinnerSelector = condition?.selector ?? '[aria-busy="true"], [role="progressbar"], .spinner, .loading';
      let stableCount = 0;
      let lastStableText = '';
      let urlStableCount = 0;
      let lastUrl = location.href;
      let lastResourceCount = -1;
      let idleSince = Date.now();

      const filteredResourceEntries = () => {
        const filters = Array.isArray(condition?.urlIncludes) ? condition.urlIncludes.map(value => String(value).toLowerCase()).filter(Boolean) : [];
        return performance.getEntriesByType('resource')
          .map(entry => ({ name: String(entry.name || '').toLowerCase() }))
          .filter(entry => filters.length === 0 || filters.some(filter => entry.name.includes(filter)));
      };

      const check = () => {
        if (kind === 'urlMatch') {
          const pattern = condition?.urlPattern ?? '';
          if (!pattern) {
            resolve({ error: 'wait urlMatch requires urlPattern.' });
            return;
          }

          const matched = location.href.includes(pattern) || (() => {
            try {
              return new RegExp(pattern).test(location.href);
            } catch {
              return false;
            }
          })();
          if (matched) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'text') {
          const needle = normalize(condition?.text ?? command.text);
          if (needle && normalize(document.body?.innerText ?? '').includes(needle)) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'element') {
          const found = queryFirst(condition?.selector ?? command.selector ?? '');
          if (isVisible(found?.element)) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'elementGone') {
          const found = queryFirst(condition?.selector ?? command.selector ?? '');
          if (!isVisible(found?.element)) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'spinnerGone') {
          const spinner = Array.from(document.querySelectorAll(spinnerSelector)).find(isVisible);
          if (!spinner) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'elementStable') {
          const selector = condition?.selector ?? command.selector ?? '';
          const found = selector ? queryFirst(selector) : undefined;
          const text = normalize(found?.element?.innerText || found?.element?.textContent || '');
          if (text && text === lastStableText) {
            stableCount += 1;
          } else {
            stableCount = 0;
            lastStableText = text;
          }
          if (stableCount >= 2) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'urlSettled') {
          const nowUrl = location.href;
          if (nowUrl === lastUrl) {
            urlStableCount += 1;
          } else {
            urlStableCount = 0;
            lastUrl = nowUrl;
          }
          if (urlStableCount >= 2) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'composite') {
          const spinner = Array.from(document.querySelectorAll(spinnerSelector)).find(isVisible);
          const selector = condition?.selector ?? command.selector ?? '';
          const found = selector ? queryFirst(selector) : undefined;
          if (!spinner && (!selector || isVisible(found?.element))) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'networkIdle') {
          const entries = filteredResourceEntries();
          const currentCount = entries.length;
          if (currentCount !== lastResourceCount) {
            lastResourceCount = currentCount;
            idleSince = Date.now();
          }
          const idleMs = Math.min(Math.max(Number(condition?.idleMs) || 1200, 200), 10000);
          if (Date.now() - idleSince >= idleMs) {
            resolve({ ok: true, observedEntries: currentCount, idleMs });
            return;
          }
        } else if (kind === 'requestDone') {
          const entries = filteredResourceEntries();
          if (entries.length > 0) {
            resolve({
              ok: true,
              observedEntries: entries.length,
              statusFilterApplied: Array.isArray(condition?.statusIn) && condition.statusIn.length > 0 ? false : undefined,
              note: Array.isArray(condition?.statusIn) && condition.statusIn.length > 0
                ? 'statusIn filter is not available from PerformanceResourceTiming and was ignored.'
                : undefined
            });
            return;
          }
        } else if (kind === 'semantic') {
          const conditions = Array.isArray(condition?.semanticConditions) ? condition.semanticConditions : [];
          const pageText = normalize(document.body?.innerText ?? '').toLowerCase();
          const allPassed = conditions.every(item => {
            const value = String(item ?? '').trim();
            if (!value) {
              return true;
            }
            if (value.startsWith('text:')) {
              return pageText.includes(normalize(value.slice(5)).toLowerCase());
            }
            if (value.startsWith('notText:')) {
              return !pageText.includes(normalize(value.slice(8)).toLowerCase());
            }
            if (value.startsWith('selector:')) {
              const selector = value.slice(9).trim();
              const found = selector ? queryFirst(selector) : undefined;
              return selector ? isVisible(found?.element) : false;
            }
            if (value.startsWith('selectorGone:')) {
              const selector = value.slice(13).trim();
              const found = selector ? queryFirst(selector) : undefined;
              return selector ? !isVisible(found?.element) : false;
            }
            return pageText.includes(normalize(value).toLowerCase());
          });

          if (allPassed) {
            resolve({ ok: true, semanticConditions: conditions });
            return;
          }
        }

        if (Date.now() >= deadline) {
          resolve({ error: `Wait condition timed out: ${kind}` });
          return;
        }

        setTimeout(check, interval);
      };

      check();
    });

    const listInteractables = () => {
      const elements = getSearchableElements('button,[role="button"],[role="tab"],a,input,textarea,select,[tabindex]')
        .slice(0, 300)
        .map((item, index) => {
          const element = item.element;
          const overlapped = isOverlapped(element);
          const inViewport = isInViewport(element);
          const enabled = !isDisabled(element);
          const interactableScore = {
            visible: isVisible(element),
            enabled,
            notOverlapped: !overlapped,
            inViewport
          };
          const score = (interactableScore.visible ? 35 : 0)
            + (interactableScore.enabled ? 25 : 0)
            + (interactableScore.notOverlapped ? 25 : 0)
            + (interactableScore.inViewport ? 15 : 0);
          return {
          index,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || undefined,
          id: element.id || undefined,
          classes: element.className || undefined,
          text: normalize(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || ''),
          selectorHint: element.id ? `#${element.id}` : undefined,
          framePath: item.framePath,
          interactableScore,
          score
          };
        })
        .sort((a, b) => b.score - a.score);
      return { ok: true, interactables: elements };
    };

    if (command.action === 'readPage') {
      return { ok: true };
    }

    if (command.action === 'listInteractables') {
      return listInteractables();
    }

    if (command.action === 'wait') {
      return waitForCondition(command.wait);
    }

    if (command.action === 'waitForText') {
      return waitForCondition({ kind: 'text', text: command.text, pollIntervalMs: command.wait?.pollIntervalMs });
    }

    if (command.action === 'scroll') {
      const step = Number.isFinite(command.delta) ? command.delta : 800;
      const deltaY = command.direction === 'up' ? -Math.abs(step) : Math.abs(step);
      window.scrollBy({ top: deltaY, behavior: 'smooth' });
      return { ok: true, deltaY };
    }

    if (command.action === 'keyPress') {
      const key = command.key || command.value;
      if (!key) {
        return { error: 'keyPress requires key.' };
      }

      const target = command.selector ? document.querySelector(command.selector) : document.activeElement || document.body;
      if (!target) {
        return { error: 'No target for keyPress.' };
      }

      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      return { ok: true, key };
    }

    if (command.action === 'smartFormFill') {
      const fields = command.formFields && typeof command.formFields === 'object' ? command.formFields : {};
      const updates = [];
      for (const [fieldName, fieldValue] of Object.entries(fields)) {
        const key = normalize(fieldName).toLowerCase();
        const candidates = getSearchableElements('input,textarea,select,[contenteditable="true"],[role="textbox"]');
        const found = candidates.find(item => {
          const element = item.element;
          const label = normalize(element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || '').toLowerCase();
          return Boolean(label) && label.includes(key);
        });
        const target = found?.element;
        if (!target) {
          updates.push({ field: fieldName, updated: false });
          continue;
        }

        target.focus();
        if (target.tagName?.toLowerCase() === 'select') {
          const select = target;
          const option = Array.from(select.options).find(item => normalize(item.value).toLowerCase() === normalize(fieldValue).toLowerCase() || normalize(item.textContent).toLowerCase().includes(normalize(fieldValue).toLowerCase()));
          if (option) {
            select.value = option.value;
          }
        } else if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
          target.textContent = String(fieldValue);
        } else if (target.type === 'checkbox' || target.type === 'radio') {
          target.checked = toBoolean(fieldValue);
        } else if (target.type === 'date') {
          target.value = normalizeDateInput(fieldValue);
        } else if (target.type === 'tel') {
          target.value = normalizePhone(fieldValue);
        } else {
          target.value = String(fieldValue);
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        updates.push({ field: fieldName, updated: true });
      }

      if (command.submitSelector || command.submitText) {
        const submit = command.submitSelector
          ? queryFirst(command.submitSelector)?.element
          : getSearchableElements('button,input[type="submit"],a,[role="button"]').map(item => item.element).find(node => normalize(node.innerText || node.value || node.getAttribute('aria-label') || '').toLowerCase().includes(normalize(command.submitText).toLowerCase()));
        if (submit) {
          submit.click();
        }
      }

      return { ok: true, updates };
    }

    const resolved = findByIntent();
    const element = resolved?.element;
    if (!resolved || !element) {
      return { error: command.selector ? `Element not found: ${command.selector}` : `Element text not found: ${command.text}` };
    }

    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (command.action === 'click') {
      element.click();
      return { ok: true, framePath: resolved.framePath };
    }

    if (command.action === 'hover') {
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return { ok: true, framePath: resolved.framePath };
    }

    if (command.action === 'clearInput') {
      const input = element;
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, framePath: resolved.framePath };
    }

    if (command.action === 'selectOption') {
      if (element.tagName?.toLowerCase() !== 'select') {
        return { error: 'selectOption requires a <select> target.' };
      }

      const select = element;
      const candidates = [command.value, ...(Array.isArray(command.options) ? command.options : [])].filter(Boolean);
      const option = Array.from(select.options).find(item => candidates.includes(item.value) || candidates.includes(normalize(item.textContent || '')));
      if (!option) {
        return { error: 'No matching select option.' };
      }

      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: option.value, framePath: resolved.framePath };
    }

    if (command.action === 'type') {
      const input = element;
      if (input.type === 'password') {
        return { error: 'Refusing to type into a password field.' };
      }

      input.focus();
      input.value = command.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, framePath: resolved.framePath };
    }

    return { error: `Unsupported DOM action: ${command.action}` };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for navigation.'));
    }, timeoutMs ?? 30000);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function waitForNavigationReady(tabId, timeoutMs, previousUrl, trigger) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for navigation readiness.'));
    }, timeoutMs ?? 30000);
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) {
        return;
      }
      const kind = globalThis.OwenProtocolRuntime.navigationReadinessKind(previousUrl, changeInfo, tab);
      if (kind) {
        cleanup();
        resolve(kind);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    Promise.resolve().then(trigger).catch(error => {
      cleanup();
      reject(error);
    });
  });
}

function assertAllowedUrl(url, allowedHosts) {
  if (!url) {
    throw new Error('Active tab has no URL.');
  }

  const pageUrl = new URL(url);
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    return;
  }

  if (!allowedHosts.some(entry => isAllowedHost(pageUrl.hostname, entry))) {
    throw new Error(`Host is not allowed for browser control: ${pageUrl.hostname}`);
  }
}

function isAllowedHost(hostname, entry) {
  const normalizedHost = hostname.toLowerCase();
  const normalizedEntry = normalizeAllowedHost(entry);
  if (!normalizedEntry) {
    return false;
  }

  if (normalizedEntry.startsWith('*.')) {
    return normalizedHost.endsWith(normalizedEntry.slice(1));
  }

  return normalizedHost === normalizedEntry;
}

function normalizeAllowedHost(entry) {
  const trimmed = String(entry ?? '').trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes('://')) {
    return new URL(trimmed).hostname;
  }

  return trimmed.split('/')[0];
}

async function getOptions() {
  const [syncedOptions, localSecrets] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_OPTIONS),
    chrome.storage.local.get('token')
  ]);
  const token = localSecrets.token || syncedOptions.token || '';
  if (!localSecrets.token && syncedOptions.token) {
    await chrome.storage.local.set({ token: syncedOptions.token });
    await chrome.storage.sync.remove('token');
  }
  return { ...DEFAULT_OPTIONS, ...syncedOptions, token };
}

function collectPageSnapshot(includeHtml) {
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const scoreCaptureQuality = input => {
    const findings = [];
    let score = 100;
    if (input.authLikely) {
      score -= 35;
      findings.push('auth-page-likely');
    }
    if (input.loadingLikely) {
      score -= 25;
      findings.push('loading-indicator-visible');
    }
    if (input.visibleText.length < 120) {
      score -= 20;
      findings.push('low-visible-text');
    }
    if (input.headings.length === 0) {
      score -= 10;
      findings.push('no-headings');
    }
    if (input.interactables.length === 0) {
      score -= 10;
      findings.push('no-interactables');
    }
    if (input.tables.some(table => table.rowCount === 0)) {
      score -= 5;
      findings.push('empty-table-detected');
    }
    if (!input.hasHtml) {
      findings.push('html-snapshot-disabled');
    }

    const normalizedScore = Math.max(0, Math.min(100, score));
    return {
      score: normalizedScore,
      level: normalizedScore >= 80 ? 'good' : normalizedScore >= 55 ? 'partial' : 'poor',
      findings
    };
  };
  const isVisible = element => {
    if (!element) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const selectorHint = element => {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id') || element.getAttribute('data-test');
    if (testId) {
      return `[data-testid="${CSS.escape(testId)}"]`;
    }
    const label = element.getAttribute('aria-label') || element.getAttribute('title');
    if (label) {
      return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]`;
    }
    return undefined;
  };
  const describeElement = (element, index) => {
    const rect = element.getBoundingClientRect();
    return {
      index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || undefined,
      type: element.getAttribute('type') || undefined,
      text: normalize(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '').slice(0, 180),
      selectorHint: selectorHint(element),
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  };
  const metadata = {};
  for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
    const key = meta.getAttribute('name') || meta.getAttribute('property');
    const value = meta.getAttribute('content');
    if (key && value) {
      metadata[key] = value;
    }
  }

  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .slice(0, 50)
    .map(element => ({ level: element.tagName.toLowerCase(), text: normalize(element.innerText) }))
    .filter(item => item.text);

  const buttons = Array.from(document.querySelectorAll('button,[role="button"],a'))
    .slice(0, 120)
    .map(element => normalize(element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || ''))
    .filter(Boolean);

  const interactables = Array.from(document.querySelectorAll('button,[role="button"],[role="tab"],a[href],input,textarea,select,[tabindex]'))
    .filter(isVisible)
    .slice(0, 120)
    .map(describeElement);
  const formFields = Array.from(document.querySelectorAll('input,textarea,select'))
    .filter(isVisible)
    .slice(0, 80)
    .map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type') || undefined,
      name: element.getAttribute('name') || undefined,
      label: normalize(element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.labels?.[0]?.innerText || ''),
      selectorHint: selectorHint(element),
      disabled: Boolean(element.disabled)
    }));
  const tables = Array.from(document.querySelectorAll('table'))
    .filter(isVisible)
    .slice(0, 20)
    .map((table, index) => ({
      index,
      caption: normalize(table.caption?.innerText || ''),
      columns: Array.from(table.querySelectorAll('th')).slice(0, 20).map(cell => normalize(cell.innerText)).filter(Boolean),
      rowCount: table.querySelectorAll('tr').length
    }));
  const landmarks = Array.from(document.querySelectorAll('main,nav,aside,header,footer,[role="main"],[role="navigation"],[role="search"],[role="dialog"]'))
    .filter(isVisible)
    .slice(0, 40)
    .map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || undefined,
      label: normalize(element.getAttribute('aria-label') || element.getAttribute('title') || ''),
      selectorHint: selectorHint(element)
    }));
  const pageText = normalize(document.body?.innerText ?? '');
  const captureQuality = scoreCaptureQuality({
    visibleText: pageText,
    headings,
    interactables,
    formFields,
    tables,
    hasHtml: Boolean(includeHtml),
    authLikely: Boolean(document.querySelector('input[type="password"]')) || /sign in|signin|로그인|인증/i.test(pageText.slice(0, 3000)),
    loadingLikely: Boolean(Array.from(document.querySelectorAll('[aria-busy="true"],[role="progressbar"],.spinner,.loading')).find(isVisible))
  });
  const screenSummary = {
    url: location.href,
    title: document.title,
    textSample: pageText.slice(0, 4000),
    counts: {
      headings: headings.length,
      interactables: interactables.length,
      formFields: formFields.length,
      tables: tables.length,
      landmarks: landmarks.length
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      documentHeight: Math.round(document.documentElement.scrollHeight)
    },
    headings,
    landmarks,
    interactables,
    formFields,
    tables,
    captureQuality
  };

  return {
    url: location.href,
    title: document.title,
    visibleText: normalize(document.body?.innerText ?? '').slice(0, 200000),
    selection: normalize(String(window.getSelection?.() ?? '')),
    screenSummary,
    html: includeHtml ? document.documentElement.outerHTML.slice(0, 250000) : undefined,
    metadata: {
      lang: document.documentElement.lang || undefined,
      referrer: document.referrer || undefined,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      },
      headings,
      buttons,
      captureQuality,
      meta: metadata
    }
  };
}

function inspectTargetsOnPage(intent) {
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalizeLower = value => normalize(value).toLowerCase();
  const scope = String(intent?.targetScope || 'auto');
  const includeFrames = scope === 'allFrames' || scope === 'auto';
  const includeShadow = scope === 'shadowDeep' || scope === 'auto';
  const maxFrameDepth = Math.min(Math.max(Number(intent?.frameDepth) || 2, 0), 6);
  const isVisible = element => {
    if (!element) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const isInViewport = element => {
    const rect = element.getBoundingClientRect();
    return rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
  };
  const isDisabled = element => Boolean(element?.disabled || element?.getAttribute?.('aria-disabled') === 'true');
  const isOverlapped = element => {
    const rect = element.getBoundingClientRect();
    const cx = Math.max(0, Math.min(Math.round(rect.left + rect.width / 2), window.innerWidth - 1));
    const cy = Math.max(0, Math.min(Math.round(rect.top + rect.height / 2), window.innerHeight - 1));
    const topElement = document.elementFromPoint(cx, cy);
    if (!topElement) {
      return true;
    }
    return topElement !== element && !element.contains(topElement);
  };
  const enumerateRoots = () => {
    const contexts = [{ root: document, framePath: 'main' }];
    const queue = [{ doc: document, framePath: 'main', depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const allNodes = Array.from(current.doc.querySelectorAll('*'));
      if (includeShadow) {
        for (const node of allNodes) {
          if (node.shadowRoot) {
            contexts.push({ root: node.shadowRoot, framePath: current.framePath });
          }
        }
      }

      if (!includeFrames || current.depth >= maxFrameDepth) {
        continue;
      }

      const frames = Array.from(current.doc.querySelectorAll('iframe'));
      for (let i = 0; i < frames.length; i += 1) {
        try {
          const frameDoc = frames[i].contentDocument;
          if (!frameDoc) {
            continue;
          }
          const framePath = `${current.framePath}>iframe[${i}]`;
          contexts.push({ root: frameDoc, framePath });
          queue.push({ doc: frameDoc, framePath, depth: current.depth + 1 });
        } catch {
          // Ignore cross-origin frames.
        }
      }
    }
    return contexts;
  };
  const selectorHint = element => {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id') || element.getAttribute('data-test');
    if (testId) {
      return `[data-testid="${CSS.escape(testId)}"]`;
    }
    const name = element.getAttribute('name');
    if (name) {
      return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    }
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
    }
    return undefined;
  };
  const getAccessibleName = element => normalize(
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.labels?.[0]?.innerText ||
    element.innerText ||
    element.value ||
    ''
  );
  const needle = normalizeLower(intent?.targetHint || intent?.label || intent?.text || intent?.selector || '');
  const wantedRole = normalizeLower(intent?.role || '');
  const contexts = enumerateRoots();
  const nodes = [];
  for (const context of contexts) {
    const found = Array.from(context.root.querySelectorAll('button,[role="button"],[role="tab"],a[href],input,textarea,select,[tabindex]'));
    for (const element of found) {
      if (isVisible(element)) {
        nodes.push({ element, framePath: context.framePath });
      }
    }
  }
  const rankedTargets = nodes.map((item, index) => {
    const element = item.element;
    const rect = element.getBoundingClientRect();
    const role = element.getAttribute('role') || (element.tagName.toLowerCase() === 'button' ? 'button' : undefined);
    const text = normalize(element.innerText || element.value || '');
    const accessibleName = getAccessibleName(element);
    const haystack = normalizeLower(`${text} ${accessibleName} ${element.id || ''} ${element.className || ''} ${selectorHint(element) || ''}`);
    let score = 20;
    const reasons = [];
    if (needle && haystack.includes(needle)) {
      score += 45;
      reasons.push('intent-text-match');
    }
    if (wantedRole && normalizeLower(role || '') === wantedRole) {
      score += 20;
      reasons.push('role-match');
    }
    if (selectorHint(element)) {
      score += 10;
      reasons.push('stable-selector-hint');
    }
    if (rect.width >= 16 && rect.height >= 16) {
      score += 8;
      reasons.push('usable-bounds');
    }
    if (isDisabled(element)) {
      score -= 40;
      reasons.push('disabled');
    }
    const overlapped = isOverlapped(element);
    const inViewport = isInViewport(element);
    if (overlapped) {
      score -= 20;
      reasons.push('overlapped');
    }
    if (!inViewport) {
      score -= 8;
      reasons.push('off-viewport');
    }

    return {
      index,
      score: Math.max(0, Math.min(100, score)),
      reasons,
      tag: element.tagName.toLowerCase(),
      role,
      type: element.getAttribute('type') || undefined,
      text: text.slice(0, 180),
      accessibleName: accessibleName.slice(0, 180),
      selectorHint: selectorHint(element),
      disabled: isDisabled(element),
      framePath: item.framePath,
      interactableScore: {
        visible: true,
        enabled: !isDisabled(element),
        notOverlapped: !overlapped,
        inViewport
      },
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  return { ok: true, intent, rankedTargets };
}

function normalizeCaptureRegion(input) {
  const viewportWidth = Math.max(1, Number(input.viewportWidth) || 1);
  const viewportHeight = Math.max(1, Number(input.viewportHeight) || 1);
  const devicePixelRatio = Number(input.devicePixelRatio) || 1;
  const padding = Math.max(0, Number(input.padding) || 0);

  let x = Number(input.x) || 0;
  let y = Number(input.y) || 0;
  let width = Number(input.width) || 1;
  let height = Number(input.height) || 1;

  x -= padding;
  y -= padding;
  width += padding * 2;
  height += padding * 2;

  x = Math.max(0, Math.min(x, viewportWidth - 1));
  y = Math.max(0, Math.min(y, viewportHeight - 1));
  width = Math.max(1, Math.min(width, viewportWidth - x));
  height = Math.max(1, Math.min(height, viewportHeight - y));

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    viewportWidth: Math.round(viewportWidth),
    viewportHeight: Math.round(viewportHeight),
    devicePixelRatio,
    padding
  };
}

async function captureRegionImage(tab, region) {
  const captured = await captureVisibleTabWithRedaction(tab);
  const fullDataUrl = captured.dataUrl;
  const blob = await fetch(fullDataUrl).then(response => response.blob());
  const bitmap = await createImageBitmap(blob);
  const dpr = Number(region?.devicePixelRatio) || 1;
  const sx = Math.max(0, Math.round((Number(region?.x) || 0) * dpr));
  const sy = Math.max(0, Math.round((Number(region?.y) || 0) * dpr));
  const sw = Math.max(1, Math.round((Number(region?.width) || 1) * dpr));
  const sh = Math.max(1, Math.round((Number(region?.height) || 1) * dpr));
  const clippedWidth = Math.min(sw, Math.max(1, bitmap.width - sx));
  const clippedHeight = Math.min(sh, Math.max(1, bitmap.height - sy));

  const canvas = new OffscreenCanvas(clippedWidth, clippedHeight);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create 2D context for region capture.');
  }

  context.drawImage(bitmap, sx, sy, clippedWidth, clippedHeight, 0, 0, clippedWidth, clippedHeight);
  const clippedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await clippedBlob.arrayBuffer();
  return {
    dataUrl: `data:image/png;base64,${arrayBufferToBase64(buffer)}`,
    redaction: captured.redaction
  };
}

async function captureVisibleTabWithRedaction(tab, requestedProfile) {
  const options = requestedProfile ? undefined : await getOptions();
  const configuredProfile = requestedProfile || options?.screenshotRedaction;
  const profile = ['off', 'standard', 'strict'].includes(configuredProfile) ? configuredProfile : 'standard';
  if (profile === 'off' || !hasTabId(tab)) {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { dataUrl, redaction: { profile, applied: false, maskedRegionCount: 0 } };
  }

  const marker = `owen-redact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let maskedRegionCount = 0;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: applyScreenshotRedactionOnPage,
      args: [profile, marker]
    });
    maskedRegionCount = Number(result?.maskedRegionCount) || 0;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { dataUrl, redaction: { profile, applied: maskedRegionCount > 0, maskedRegionCount } };
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: restoreScreenshotRedactionOnPage,
      args: [marker]
    }).catch(() => undefined);
  }
}

function applyScreenshotRedactionOnPage(profile, marker) {
  const selectors = [
    'input[type="password"]',
    'input[type="email"]',
    'input[name*="token" i]',
    'input[name*="secret" i]',
    '[data-sensitive]',
    '[data-redact]'
  ];
  if (profile === 'strict') {
    selectors.push('input', 'textarea', '[contenteditable="true"]');
  }

  const targets = new Set();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      targets.add(element);
    }
  }
  if (profile === 'strict') {
    const sensitiveText = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b)/i;
    for (const element of document.querySelectorAll('body *')) {
      if (element.children.length === 0 && sensitiveText.test(element.textContent || '')) {
        targets.add(element);
      }
    }
  }

  for (const element of targets) {
    element.setAttribute('data-owen-redaction-marker', marker);
    element.setAttribute('data-owen-redaction-filter', element.style.filter || '');
    element.style.filter = 'blur(10px)';
  }
  return { maskedRegionCount: targets.size };
}

function restoreScreenshotRedactionOnPage(marker) {
  const selector = `[data-owen-redaction-marker="${CSS.escape(marker)}"]`;
  for (const element of document.querySelectorAll(selector)) {
    element.style.filter = element.getAttribute('data-owen-redaction-filter') || '';
    element.removeAttribute('data-owen-redaction-filter');
    element.removeAttribute('data-owen-redaction-marker');
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function resolveCaptureElementRegion(input) {
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalizeLower = value => normalize(value).toLowerCase();
  const scope = String(input?.targetScope || 'auto');
  const includeFrames = scope === 'allFrames' || scope === 'auto';
  const includeShadow = scope === 'shadowDeep' || scope === 'auto';
  const maxFrameDepth = Math.min(Math.max(Number(input?.frameDepth) || 2, 0), 6);
  const normalizeRegionLocal = raw => {
    const viewportWidth = Math.max(1, Number(raw.viewportWidth) || 1);
    const viewportHeight = Math.max(1, Number(raw.viewportHeight) || 1);
    const devicePixelRatio = Number(raw.devicePixelRatio) || 1;
    const padding = Math.max(0, Number(raw.padding) || 0);

    let x = Number(raw.x) || 0;
    let y = Number(raw.y) || 0;
    let width = Number(raw.width) || 1;
    let height = Number(raw.height) || 1;

    x -= padding;
    y -= padding;
    width += padding * 2;
    height += padding * 2;

    x = Math.max(0, Math.min(x, viewportWidth - 1));
    y = Math.max(0, Math.min(y, viewportHeight - 1));
    width = Math.max(1, Math.min(width, viewportWidth - x));
    height = Math.max(1, Math.min(height, viewportHeight - y));

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      viewportWidth: Math.round(viewportWidth),
      viewportHeight: Math.round(viewportHeight),
      devicePixelRatio,
      padding
    };
  };
  const isVisible = element => {
    if (!element) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const enumerateRoots = () => {
    const contexts = [{ root: document, framePath: 'main' }];
    const queue = [{ doc: document, framePath: 'main', depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      if (includeShadow) {
        for (const node of Array.from(current.doc.querySelectorAll('*'))) {
          if (node.shadowRoot) {
            contexts.push({ root: node.shadowRoot, framePath: current.framePath });
          }
        }
      }

      if (!includeFrames || current.depth >= maxFrameDepth) {
        continue;
      }

      const frames = Array.from(current.doc.querySelectorAll('iframe'));
      for (let i = 0; i < frames.length; i += 1) {
        try {
          const frameDoc = frames[i].contentDocument;
          if (!frameDoc) {
            continue;
          }
          const framePath = `${current.framePath}>iframe[${i}]`;
          contexts.push({ root: frameDoc, framePath });
          queue.push({ doc: frameDoc, framePath, depth: current.depth + 1 });
        } catch {
          // Ignore cross-origin frames.
        }
      }
    }
    return contexts;
  };

  const queryAll = selector => {
    if (!selector) {
      return [];
    }
    const found = [];
    for (const context of enumerateRoots()) {
      try {
        for (const element of Array.from(context.root.querySelectorAll(selector))) {
          found.push({ element, framePath: context.framePath });
        }
      } catch {
        // Ignore invalid selectors for specific roots.
      }
    }
    return found;
  };

  const findTarget = () => {
    if (input?.selector) {
      const matches = queryAll(input.selector);
      return matches[0];
    }

    const roleQuery = input?.role ? `[role="${input.role}"]` : 'button,[role="button"],[role="tab"],a[href],input,textarea,select,[tabindex]';
    const elements = queryAll(roleQuery).filter(item => isVisible(item.element));
    const labelNeedle = normalizeLower(input?.label);
    if (labelNeedle) {
      const matches = elements.filter(item => normalizeLower(item.element.getAttribute('aria-label') || item.element.getAttribute('title') || '').includes(labelNeedle));
      if (matches.length > 0) {
        return matches[Math.max(0, Math.min(Number(input?.index) || 0, matches.length - 1))];
      }
    }

    const textNeedle = normalizeLower(input?.targetHint || input?.text);
    if (!textNeedle) {
      return undefined;
    }
    const matches = elements.filter(item => normalizeLower(item.element.innerText || item.element.value || item.element.getAttribute('aria-label') || item.element.getAttribute('title') || '').includes(textNeedle));
    if (matches.length === 0) {
      return undefined;
    }
    return matches[Math.max(0, Math.min(Number(input?.index) || 0, matches.length - 1))];
  };

  const resolved = findTarget();
  const target = resolved?.element;
  if (!resolved || !target || !isVisible(target)) {
    return { error: 'captureElement target not found.' };
  }

  target.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = target.getBoundingClientRect();
  const region = normalizeRegionLocal({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    padding: input?.regionPadding,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1
  });

  const selectorHint = target.id ? `#${CSS.escape(target.id)}` : undefined;
  return {
    ok: true,
    region,
    target: {
      tag: target.tagName.toLowerCase(),
      role: target.getAttribute('role') || undefined,
      text: normalize(target.innerText || target.value || target.getAttribute('aria-label') || target.getAttribute('title') || '').slice(0, 180),
      selectorHint,
      framePath: resolved.framePath
    }
  };
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}
