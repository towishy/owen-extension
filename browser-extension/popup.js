const DEFAULT_OPTIONS = {
  port: 17321,
  token: '',
  investigationName: '',
  commandPolling: true,
  includeHtml: false,
  includeScreenshot: true,
  screenshotRedaction: 'standard'
};

const elements = {
  port: document.getElementById('port'),
  token: document.getElementById('token'),
  investigationName: document.getElementById('investigationName'),
  commandPolling: document.getElementById('commandPolling'),
  includeHtml: document.getElementById('includeHtml'),
  includeScreenshot: document.getElementById('includeScreenshot'),
  screenshotRedaction: document.getElementById('screenshotRedaction'),
  agentId: document.getElementById('agentId'),
  connectionStatus: document.getElementById('connectionStatus'),
  grantSite: document.getElementById('grantSite'),
  save: document.getElementById('save'),
  status: document.getElementById('status')
};

loadOptions();

elements.save.addEventListener('click', async () => {
  await saveOptions();
  setStatus('Passive');
});

elements.grantSite.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    setStatus('Open an HTTP(S) page first');
    return;
  }
  const origin = `${new URL(tab.url).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  setStatus(granted ? 'Site access granted' : 'Site access denied');
});

async function loadOptions() {
  const [syncedOptions, localSecrets] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_OPTIONS),
    chrome.storage.local.get(['token', 'owenBrowserAgentId', 'owenBridgeConnectionStatus'])
  ]);
  const token = localSecrets.token || syncedOptions.token || '';
  if (!localSecrets.token && syncedOptions.token) {
    await chrome.storage.local.set({ token: syncedOptions.token });
    await chrome.storage.sync.remove('token');
  }
  const options = { ...syncedOptions, token };
  elements.port.value = String(options.port);
  elements.token.value = options.token;
  elements.investigationName.value = options.investigationName;
  elements.commandPolling.checked = options.commandPolling;
  elements.includeHtml.checked = options.includeHtml;
  elements.includeScreenshot.checked = options.includeScreenshot;
  elements.screenshotRedaction.value = options.screenshotRedaction;
  elements.agentId.textContent = localSecrets.owenBrowserAgentId || 'Created after polling starts';
  const connection = localSecrets.owenBridgeConnectionStatus;
  elements.connectionStatus.textContent = connection?.ok
    ? `Connected · protocol ${connection.protocolVersion}`
    : connection?.error || 'Waiting for VS Code';
}

async function saveOptions() {
  const token = elements.token.value.trim();
  await Promise.all([
    chrome.storage.local.set({ token }),
    chrome.storage.sync.set({
    port: Number(elements.port.value || DEFAULT_OPTIONS.port),
    investigationName: elements.investigationName.value.trim(),
    commandPolling: elements.commandPolling.checked,
    includeHtml: elements.includeHtml.checked,
    includeScreenshot: elements.includeScreenshot.checked,
    screenshotRedaction: elements.screenshotRedaction.value
    }),
    chrome.storage.sync.remove('token')
  ]);
  await chrome.runtime.sendMessage({ type: 'wake-command-polling' });
}

function setStatus(value) {
  elements.status.textContent = value;
}