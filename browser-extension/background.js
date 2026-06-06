const DEFAULT_OPTIONS = {
  port: 17321,
  token: '',
  investigationName: '',
  commandPolling: true,
  includeHtml: false,
  includeScreenshot: true
};

let pollInProgress = false;
let lastReplayScript;
const stateCheckpoints = new Map();
const executionRunHistory = new Map();
const BROWSER_SESSION_STORAGE_KEY = 'owenBrowserSessionId';
const LATEST_BROWSER_STATE_STORAGE_KEY = 'owenLatestBrowserState';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('owen-command-poll', { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('owen-command-poll', { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'owen-command-poll') {
    pollForCommand().catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'capture-current-tab') {
    return false;
  }

  captureCurrentTab()
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message ?? error) }));

  return true;
});

pollForCommand().catch(() => undefined);

async function pollForCommand() {
  if (pollInProgress) {
    return;
  }

  const options = await getOptions();
  if (!options.commandPolling || !options.token) {
    return;
  }

  pollInProgress = true;
  try {
    const response = await fetch(`http://127.0.0.1:${options.port}/commands/next`, {
      method: 'GET',
      headers: { 'X-Owen-Bridge-Token': options.token }
    });
    if (!response.ok) {
      return;
    }

    const body = await response.json().catch(() => ({}));
    if (body.command) {
      const result = await executeBrowserCommand(body.command, options);
      await postCommandResult(options, result);
    }
  } finally {
    pollInProgress = false;
  }
}

async function executeBrowserCommand(command, options) {
  try {
    const workflow = command.action === 'runWorkflow' ? normalizeWorkflowSteps(command.steps) : [command];
    const executionTrail = [];

    for (const step of workflow) {
      const result = await executeSingleAction(step, command.allowedHosts);
      executionTrail.push({ action: step.action, result });
    }

    const currentTab = await getActiveTab();
    const capture = command.captureAfter || command.action === 'capture'
      ? await createCapturePayload(currentTab, command, options)
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

    lastReplayScript = {
      exportedAt: new Date().toISOString(),
      action: command.action,
      command: { ...command, allowedHosts: undefined },
      steps: executionTrail
    };

    return response;
  } catch (error) {
    const message = String(error?.message ?? error);
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

async function executeSingleAction(command, allowedHosts) {
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

  if (action === 'navigate') {
    assertAllowedUrl(command.url, allowedHosts);
    const tab = await getActiveTab();
    await chrome.tabs.update(tab.id, { url: command.url });
    await waitForTabComplete(tab.id, command.timeoutMs);
    const updated = await chrome.tabs.get(tab.id);
    return { ok: true, url: updated.url, title: updated.title };
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
    await chrome.tabs.goBack(tab.id).catch(() => undefined);
    await waitForTabComplete(tab.id, command.timeoutMs).catch(() => undefined);
    return { ok: true };
  }

  if (action === 'forward') {
    await chrome.tabs.goForward(tab.id).catch(() => undefined);
    await waitForTabComplete(tab.id, command.timeoutMs).catch(() => undefined);
    return { ok: true };
  }

  if (action === 'reload') {
    await chrome.tabs.reload(tab.id);
    await waitForTabComplete(tab.id, command.timeoutMs);
    return { ok: true };
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

  const targets = buildTargetCandidates(command);
  const maxRetries = Number.isInteger(command.retries) ? command.retries : 0;
  let lastError = 'Action failed.';

  for (let retry = 0; retry <= maxRetries; retry += 1) {
    for (const candidate of targets) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: runDomCommand,
        args: [{ ...command, ...candidate }]
      });
      if (!result?.error) {
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
        return { ...(result ?? { ok: true }), autoHealed: true, target: candidate, inspection };
      }

      lastError = result.error;
    }
  }

  throw new Error(lastError);
}

function ensureOperatorConfirmed(command, action) {
  const highRisk = new Set(['navigate', 'openInNewTab', 'closeTab', 'journeyCapture', 'paginateCapture', 'multiTabCrawl']);
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
      return {
        ok: true,
        url: location.href,
        title: document.title,
        navigation: nav ? {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          loadEventEnd: Math.round(nav.loadEventEnd)
        } : undefined,
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
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
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
    screenshotDataUrl: dataUrl,
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
  const candidates = [{ selector: command.selector, text: command.text, label: command.label, role: command.role, index: command.index }];
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
    action: command.action
  };
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

async function postCommandResult(options, result) {
  await fetch(`http://127.0.0.1:${options.port}/commands/result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Owen-Bridge-Token': options.token
    },
    body: JSON.stringify(result)
  });
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
  if (options.includeScreenshot) {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    screenshot = { dataUrl, mimeType: 'image/png' };
  }

  const payload = {
    source: 'owen-browser-capture',
    version: chrome.runtime.getManifest().version,
    collectedAt: new Date().toISOString(),
    investigation: options.investigationName ? { name: options.investigationName } : undefined,
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

async function createCapturePayload(tab, command, options) {
  const includeHtml = command.includeHtml ?? options.includeHtml;
  const includeScreenshot = command.includeScreenshot ?? options.includeScreenshot;
  const [{ result: pageSnapshot }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPageSnapshot,
    args: [includeHtml]
  });

  let screenshot;
  if (includeScreenshot) {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    screenshot = { dataUrl, mimeType: 'image/png' };
  }

  const browserSession = await buildBrowserSessionState(tab, command, pageSnapshot.screenSummary, Boolean(screenshot));
  await rememberBrowserState(browserSession);

  return {
    source: 'owen-browser-capture',
    version: chrome.runtime.getManifest().version,
    collectedAt: new Date().toISOString(),
    investigation: command.investigationName ? { name: command.investigationName } : options.investigationName ? { name: options.investigationName } : undefined,
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

    const findByIntent = () => {
      if (command.selector) {
        return document.querySelector(command.selector);
      }

      const query = command.role
        ? `[role="${command.role}"]`
        : 'button,[role="button"],[role="tab"],a,input,textarea,select,[tabindex]';
      const elements = Array.from(document.querySelectorAll(query));
      const byLabel = normalize(command.label).toLowerCase();
      if (byLabel) {
        const matched = elements.filter(element => normalize(element.getAttribute('aria-label') || element.getAttribute('title') || '').toLowerCase().includes(byLabel));
        if (matched.length > 0) {
          return matched[Math.max(0, Math.min(command.index ?? 0, matched.length - 1))];
        }
      }

      const byText = normalize(command.text).toLowerCase();
      if (!byText) {
        return undefined;
      }

      const matched = elements.filter(element => normalize(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '').toLowerCase().includes(byText));
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
          const element = document.querySelector(condition?.selector ?? command.selector ?? '');
          if (isVisible(element)) {
            resolve({ ok: true });
            return;
          }
        } else if (kind === 'elementGone') {
          const element = document.querySelector(condition?.selector ?? command.selector ?? '');
          if (!isVisible(element)) {
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
          const element = selector ? document.querySelector(selector) : undefined;
          const text = normalize(element?.innerText || element?.textContent || '');
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
          const element = selector ? document.querySelector(selector) : undefined;
          if (!spinner && (!selector || isVisible(element))) {
            resolve({ ok: true });
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
              return selector ? isVisible(document.querySelector(selector)) : false;
            }
            if (value.startsWith('selectorGone:')) {
              const selector = value.slice(13).trim();
              return selector ? !isVisible(document.querySelector(selector)) : false;
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
      const elements = Array.from(document.querySelectorAll('button,[role="button"],[role="tab"],a,input,textarea,select,[tabindex]'))
        .filter(isVisible)
        .slice(0, 300)
        .map((element, index) => ({
          index,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || undefined,
          id: element.id || undefined,
          classes: element.className || undefined,
          text: normalize(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || ''),
          selectorHint: element.id ? `#${element.id}` : undefined
        }));
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
        const candidates = Array.from(document.querySelectorAll('input,textarea,select'));
        const target = candidates.find(element => {
          const label = normalize(element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || '').toLowerCase();
          return Boolean(label) && label.includes(key);
        });
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
        } else {
          target.value = String(fieldValue);
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        updates.push({ field: fieldName, updated: true });
      }

      if (command.submitSelector || command.submitText) {
        const submit = command.submitSelector
          ? document.querySelector(command.submitSelector)
          : Array.from(document.querySelectorAll('button,input[type="submit"],a,[role="button"]')).find(node => normalize(node.innerText || node.value || node.getAttribute('aria-label') || '').toLowerCase().includes(normalize(command.submitText).toLowerCase()));
        if (submit) {
          submit.click();
        }
      }

      return { ok: true, updates };
    }

    const element = findByIntent();
    if (!element) {
      return { error: command.selector ? `Element not found: ${command.selector}` : `Element text not found: ${command.text}` };
    }

    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (command.action === 'click') {
      element.click();
      return { ok: true };
    }

    if (command.action === 'hover') {
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return { ok: true };
    }

    if (command.action === 'clearInput') {
      const input = element;
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
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
      return { ok: true, value: option.value };
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
      return { ok: true };
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
  const stored = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  return { ...DEFAULT_OPTIONS, ...stored };
}

function collectPageSnapshot(includeHtml) {
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
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
  const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="tab"],a[href],input,textarea,select,[tabindex]')).filter(isVisible);
  const rankedTargets = nodes.map((element, index) => {
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
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
      score -= 40;
      reasons.push('disabled');
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
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
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

function scoreCaptureQuality(input) {
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
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}
