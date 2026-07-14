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

  globalThis.OwenProtocolRuntime = Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    retryDelay,
    fetchWithTimeout
  });
})();
