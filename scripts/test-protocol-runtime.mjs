import assert from 'node:assert/strict';

await import('../browser-extension/protocol-runtime.js');
const runtime = globalThis.OwenProtocolRuntime;
assert.equal(runtime.protocolVersion, '3.0');
assert.equal(runtime.retryDelay(1, 0), 500);
assert.equal(runtime.retryDelay(2, 1), 1200);
assert.equal(runtime.retryDelay(99, 0), 30000);
assert.equal(runtime.retryDelay(0, -1), 500);

const originalFetch = globalThis.fetch;
let aborted = false;
globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => {
    aborted = true;
    reject(init.signal.reason ?? new Error('aborted'));
  }, { once: true });
});
try {
  await assert.rejects(runtime.fetchWithTimeout('https://example.invalid', {}, 1), error => error?.name === 'AbortError');
  assert.equal(aborted, true);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Verified browser protocol runtime backoff and timeout behavior.');
