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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active browser tab is available.');
    }

    if (command.action === 'navigate') {
      assertAllowedUrl(command.url, command.allowedHosts);
      await chrome.tabs.update(tab.id, { url: command.url });
      await waitForTabComplete(tab.id, command.timeoutMs);
    } else {
      assertAllowedUrl(tab.url, command.allowedHosts);
      if (command.action === 'click' || command.action === 'type' || command.action === 'waitForText' || command.action === 'readPage') {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: runDomCommand,
          args: [command]
        });
        if (result?.error) {
          throw new Error(result.error);
        }
      }
    }

    const currentTab = await chrome.tabs.get(tab.id);
    const capture = command.captureAfter || command.action === 'capture'
      ? await createCapturePayload(currentTab, command, options)
      : undefined;
    return { id: command.id, ok: true, result: { action: command.action, url: currentTab.url, title: currentTab.title }, capture };
  } catch (error) {
    return { id: command.id, ok: false, error: String(error?.message ?? error) };
  }
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
    if (command.action === 'readPage') {
      return { ok: true };
    }

    if (command.action === 'waitForText') {
      return waitForText(command.text, command.timeoutMs);
    }

    const element = command.selector ? document.querySelector(command.selector) : findElementByText(command.text);
    if (!element) {
      return { error: command.selector ? `Element not found: ${command.selector}` : `Element text not found: ${command.text}` };
    }

    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (command.action === 'click') {
      element.click();
      return { ok: true };
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

function findElementByText(text) {
  const needle = normalizeText(text ?? '').toLowerCase();
  if (!needle) {
    return undefined;
  }

  return Array.from(document.querySelectorAll('button,[role="button"],[role="tab"],a,input,textarea,select'))
    .find(element => normalizeText(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '').toLowerCase().includes(needle));
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
    .map(element => ({ level: element.tagName.toLowerCase(), text: normalizeText(element.innerText) }))
    .filter(item => item.text);

  const buttons = Array.from(document.querySelectorAll('button,[role="button"],a'))
    .slice(0, 120)
    .map(element => normalizeText(element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || ''))
    .filter(Boolean);

  return {
    url: location.href,
    title: document.title,
    visibleText: normalizeText(document.body?.innerText ?? '').slice(0, 200000),
    selection: normalizeText(String(window.getSelection?.() ?? '')),
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

function waitForText(text, timeoutMs) {
  const needle = normalizeText(text ?? '');
  return new Promise(resolve => {
    const deadline = Date.now() + (timeoutMs ?? 60000);
    const check = () => {
      const pageText = normalizeText(document.body?.innerText ?? '');
      if (pageText.includes(needle)) {
        resolve({ ok: true });
        return;
      }

      if (Date.now() >= deadline) {
        resolve({ error: `Text not found: ${text}` });
        return;
      }

      setTimeout(check, 500);
    };
    check();
  });
}