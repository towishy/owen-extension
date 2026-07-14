const DEFAULT_OPTIONS = {
  port: 17321,
  token: '',
  investigationName: '',
  commandPolling: true,
  includeHtml: false,
  includeScreenshot: true
};

const elements = {
  port: document.getElementById('port'),
  token: document.getElementById('token'),
  investigationName: document.getElementById('investigationName'),
  commandPolling: document.getElementById('commandPolling'),
  includeHtml: document.getElementById('includeHtml'),
  includeScreenshot: document.getElementById('includeScreenshot'),
  save: document.getElementById('save'),
  status: document.getElementById('status')
};

loadOptions();

elements.save.addEventListener('click', async () => {
  await saveOptions();
  setStatus('Passive');
});

async function loadOptions() {
  const options = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  elements.port.value = String(options.port);
  elements.token.value = options.token;
  elements.investigationName.value = options.investigationName;
  elements.commandPolling.checked = options.commandPolling;
  elements.includeHtml.checked = options.includeHtml;
  elements.includeScreenshot.checked = options.includeScreenshot;
}

async function saveOptions() {
  await chrome.storage.sync.set({
    port: Number(elements.port.value || DEFAULT_OPTIONS.port),
    token: elements.token.value.trim(),
    investigationName: elements.investigationName.value.trim(),
    commandPolling: elements.commandPolling.checked,
    includeHtml: elements.includeHtml.checked,
    includeScreenshot: elements.includeScreenshot.checked
  });
  await chrome.runtime.sendMessage({ type: 'wake-command-polling' });
}

function setStatus(value) {
  elements.status.textContent = value;
}