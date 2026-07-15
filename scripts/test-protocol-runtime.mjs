import assert from 'node:assert/strict';

await import('../browser-extension/protocol-runtime.js');
const runtime = globalThis.OwenProtocolRuntime;
assert.equal(runtime.protocolVersion, '3.0');
assert.equal(runtime.retryDelay(1, 0), 500);
assert.equal(runtime.retryDelay(2, 1), 1200);
assert.equal(runtime.retryDelay(99, 0), 30000);
assert.equal(runtime.retryDelay(0, -1), 500);
assert.equal(runtime.staleBatchReason(undefined, undefined, 'navigate'), 'action navigate invalidates the current page state');
assert.equal(runtime.staleBatchReason(
  { tabId: 1, url: 'https://example.com', domHash: 'before', activeElement: '' },
  { tabId: 1, url: 'https://example.com', domHash: 'after', activeElement: '' },
  'click'
), 'DOM changed after a state-changing action');
assert.equal(runtime.staleBatchReason(
  { tabId: 1, url: 'https://example.com', domHash: 'same', activeElement: '' },
  { tabId: 1, url: 'https://example.com', domHash: 'same', activeElement: '' },
  'readPage'
), undefined);
assert.equal(runtime.navigationReadinessKind('https://example.com/a', { status: 'complete' }, { url: 'https://example.com/b', status: 'complete' }), 'document');
assert.equal(runtime.navigationReadinessKind('https://example.com/a', { url: 'https://example.com/a#details' }, { url: 'https://example.com/a#details', status: 'complete' }), 'same-document');
assert.equal(runtime.navigationReadinessKind('https://example.com/a', { status: 'loading', url: 'https://example.com/b' }, { status: 'loading' }), undefined);

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

console.log('Verified browser protocol runtime backoff, timeout, stale-batch, and navigation readiness behavior.');
