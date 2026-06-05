const DEFAULT_OPTIONS = {
  port: 17321,
  token: '',
  investigationName: '',
  commandPolling: true,
  includeHtml: false,
  includeScreenshot: true
};

let pollInProgress = false;

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
    return {
      id: command.id,
      ok: true,
      result: {
        action: command.action,
        steps: executionTrail,
        url: currentTab.url,
        title: currentTab.title,
        tabIndex: currentTab.index
      },
      capture
    };
  } catch (error) {
    return { id: command.id, ok: false, error: String(error?.message ?? error) };
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
    if (!created?.id) {
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

  throw new Error(lastError);
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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active browser tab is available.');
  }

  return tab;
}

async function getTabByIndex(targetTabIndex) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const target = tabs.find(tab => tab.index === targetTabIndex);
  if (!target?.id) {
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

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
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

  return {
    source: 'owen-browser-capture',
    version: chrome.runtime.getManifest().version,
    collectedAt: new Date().toISOString(),
    investigation: command.investigationName ? { name: command.investigationName } : options.investigationName ? { name: options.investigationName } : undefined,
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

  return {
    url: location.href,
    title: document.title,
    visibleText: normalize(document.body?.innerText ?? '').slice(0, 200000),
    selection: normalize(String(window.getSelection?.() ?? '')),
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
      meta: metadata
    }
  };
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}