(() => {
  const PROTOCOL_VERSION = '3.0';

  function retryDelay(failureCount, randomValue = Math.random()) {
    const exponent = Math.min(Math.max(Number(failureCount) || 1, 1) - 1, 6);
    const base = Math.min(500 * (2 ** exponent), 30000);
    const jitter = Math.floor(base * 0.2 * Math.min(Math.max(randomValue, 0), 1));
    return base + jitter;
  }

  async function fetchWithTimeout(url, init = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(Number(timeoutMs) || 30000, 1000));
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  function staleBatchReason(before, after, action) {
    const terminatingActions = new Set(['navigate', 'openInNewTab', 'switchTab', 'back', 'forward', 'reload', 'closeTab']);
    if (terminatingActions.has(String(action || ''))) {
      return `action ${action} invalidates the current page state`;
    }
    if (!before || !after) {
      return undefined;
    }
    if (before.tabId !== after.tabId) {
      return 'active tab changed';
    }
    if (before.url !== after.url) {
      return 'URL changed';
    }
    const mutatingActions = new Set(['click', 'type', 'scroll', 'keyPress', 'selectOption', 'clearInput', 'smartFormFill', 'rollbackToCheckpoint', 'tabOrchestrator', 'returnToTab']);
    if (mutatingActions.has(String(action || '')) && before.domHash !== after.domHash) {
      return 'DOM changed after a state-changing action';
    }
    if (before.activeElement !== after.activeElement && mutatingActions.has(String(action || ''))) {
      return 'focused element changed after a state-changing action';
    }
    return undefined;
  }

  function navigationReadinessKind(previousUrl, changeInfo = {}, tab = {}) {
    if (changeInfo.status === 'complete') {
      return 'document';
    }
    const nextUrl = changeInfo.url || tab.url;
    if (nextUrl && previousUrl && nextUrl !== previousUrl && changeInfo.status !== 'loading' && tab.status === 'complete') {
      return 'same-document';
    }
    return undefined;
  }

  globalThis.OwenProtocolRuntime = Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    retryDelay,
    fetchWithTimeout,
    staleBatchReason,
    navigationReadinessKind
  });
})();
