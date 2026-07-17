const DEFAULT_OPTIONS = {
  port: 17321,
  token: '',
  commandPolling: true,
  includeHtml: false,
  includeScreenshot: true,
  screenshotRedaction: 'standard'
};

const elements = {
  port: document.getElementById('port'),
  token: document.getElementById('token'),
  commandPolling: document.getElementById('commandPolling'),
  includeHtml: document.getElementById('includeHtml'),
  includeScreenshot: document.getElementById('includeScreenshot'),
  screenshotRedaction: document.getElementById('screenshotRedaction'),
  agentId: document.getElementById('agentId'),
  connectionStatus: document.getElementById('connectionStatus'),
  save: document.getElementById('save'),
  status: document.getElementById('status'),
  statusLabel: document.getElementById('statusLabel'),
  connectionHelp: document.getElementById('connectionHelp'),
  feedback: document.getElementById('feedback'),
  redactionRow: document.getElementById('redactionRow'),
  toggleToken: document.getElementById('toggleToken')
};

loadOptions();

elements.save.addEventListener('click', async () => {
  elements.save.disabled = true;
  await saveOptions();
  setFeedback('Settings saved. The browser agent is reconnecting.');
  elements.save.textContent = 'Saved';
  setTimeout(() => {
    elements.save.disabled = false;
    elements.save.textContent = 'Save changes';
  }, 900);
});

elements.includeScreenshot.addEventListener('change', updateScreenshotControls);

elements.toggleToken.addEventListener('click', () => {
  const isHidden = elements.token.type === 'password';
  elements.token.type = isHidden ? 'text' : 'password';
  elements.toggleToken.textContent = isHidden ? 'Hide' : 'Show';
  elements.toggleToken.setAttribute('aria-label', `${isHidden ? 'Hide' : 'Show'} pairing token`);
  elements.toggleToken.title = `${isHidden ? 'Hide' : 'Show'} pairing token`;
});

document.querySelectorAll('input, select').forEach(element => {
  element.addEventListener('change', () => setFeedback('Unsaved changes.'));
  element.addEventListener('input', () => setFeedback('Unsaved changes.'));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.owenBridgeConnectionStatus) {
    updateConnectionStatus(changes.owenBridgeConnectionStatus.newValue);
  }
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
  elements.commandPolling.checked = options.commandPolling;
  elements.includeHtml.checked = options.includeHtml;
  elements.includeScreenshot.checked = options.includeScreenshot;
  elements.screenshotRedaction.value = options.screenshotRedaction;
  elements.agentId.textContent = localSecrets.owenBrowserAgentId || 'Created after polling starts';
  const connection = localSecrets.owenBridgeConnectionStatus;
  updateConnectionStatus(connection);
  updateScreenshotControls();
}

async function saveOptions() {
  const token = elements.token.value.trim();
  await Promise.all([
    chrome.storage.local.set({ token }),
    chrome.storage.sync.set({
    port: Number(elements.port.value || DEFAULT_OPTIONS.port),
    commandPolling: elements.commandPolling.checked,
    includeHtml: elements.includeHtml.checked,
    includeScreenshot: elements.includeScreenshot.checked,
    screenshotRedaction: elements.screenshotRedaction.value
    }),
    chrome.storage.sync.remove('token')
  ]);
  await chrome.runtime.sendMessage({ type: 'wake-command-polling' });
}

function updateConnectionStatus(connection) {
  if (connection?.ok) {
    elements.connectionStatus.textContent = `Connected to VS Code on port ${elements.port.value}`;
    elements.connectionHelp.textContent = `Bridge protocol ${connection.protocolVersion} is ready for browser actions.`;
    setStatus('Connected', 'success');
    return;
  }

  const error = connection?.error || '';
  elements.connectionStatus.textContent = error || 'Waiting for VS Code';
  if (/protocol mismatch/i.test(error)) {
    elements.connectionHelp.textContent = 'Reload VS Code and update both extensions to the same version.';
    setStatus('Action needed', 'danger');
  } else if (error) {
    elements.connectionHelp.textContent = 'Check the port and pairing token, then save again.';
    setStatus('Offline', 'warning');
  } else {
    elements.connectionHelp.textContent = 'Open VS Code with Owen Browser Bridge enabled.';
    setStatus('Waiting', 'waiting');
  }
}

function updateScreenshotControls() {
  const enabled = elements.includeScreenshot.checked;
  elements.screenshotRedaction.disabled = !enabled;
  elements.redactionRow.classList.toggle('is-disabled', !enabled);
}

function setStatus(value, tone) {
  elements.statusLabel.textContent = value;
  elements.status.dataset.tone = tone;
}

function setFeedback(value) {
  elements.feedback.textContent = value;
}