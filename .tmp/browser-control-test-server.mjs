import http from 'node:http';

const port = 18080;

function page(number = 1) {
  const next = number === 1 ? '<button id="next-page" onclick="location.href=\'/page2\'">Next Page</button>' : '<p id="last-page">Last Page</p>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Owen Browser Control Test ${number}</title>
  <style>
    body { font-family: sans-serif; min-height: 1800px; padding: 24px; }
    nav a, button, input, select, textarea { display: block; margin: 8px 0; }
    #hover-target { width: 180px; padding: 12px; background: #eef; }
    .bulk-item { cursor: pointer; padding: 4px; }
  </style>
</head>
<body>
  <header><h1>Owen Browser Control Test Page ${number}</h1></header>
  <main id="main">
    <p id="ready-text">READY_MARKER control page ${number}</p>
    <button id="click-target" onclick="document.querySelector('#click-result').textContent='clicked'">Click Target</button>
    <p id="click-result">not clicked</p>
    <label>Name <input id="name-input" name="name" placeholder="Name field"></label>
    <textarea id="notes" name="notes" aria-label="Notes"></textarea>
    <select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
    <button id="submit-form" onclick="document.querySelector('#form-result').textContent=document.querySelector('#name-input').value + ':' + document.querySelector('#choice').value">Submit Form</button>
    <p id="form-result">not submitted</p>
    <div id="hover-target" onmouseover="document.querySelector('#hover-result').textContent='hovered'">Hover Target</div>
    <p id="hover-result">not hovered</p>
    <button id="key-target" onclick="document.querySelector('#key-result').textContent='button clicked'">Key Target</button>
    <input id="key-input" onkeydown="document.querySelector('#key-result').textContent='key:' + event.key" aria-label="Key Input">
    <p id="key-result">no key</p>
    <section id="bulk-list">
      <div class="bulk-item">High severity one</div>
      <div class="bulk-item">Low severity two</div>
      <div class="bulk-item">High severity three</div>
    </section>
    <table id="data-table"><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>Alpha</td><td>Open</td></tr><tr><td>Beta</td><td>Closed</td></tr></tbody></table>
    <a id="download-link" href="/download.txt">Download fixture</a>
    <a class="crawl-link" href="/crawl-a">Crawl A</a>
    <a class="crawl-link" href="/crawl-b">Crawl B</a>
    ${next}
  </main>
  <script>
    fetch('/api/data').then(r => r.json()).then(data => { window.__apiData = data; });
  </script>
</body>
</html>`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/' || url.pathname === '/page1') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page(1));
    return;
  }
  if (url.pathname === '/page2') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page(2));
    return;
  }
  if (url.pathname === '/crawl-a' || url.pathname === '/crawl-b') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>${url.pathname}</title><h1>${url.pathname}</h1><p>READY_MARKER crawl page</p>`);
    return;
  }
  if (url.pathname === '/api/data') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, source: 'browser-control-test' }));
    return;
  }
  if (url.pathname === '/download.txt') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('Owen browser control download fixture\n');
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`browser-control-test-server http://127.0.0.1:${port}`);
});
