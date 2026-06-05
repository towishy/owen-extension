import AdmZip from 'adm-zip';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const vsixName = `owen-browser-bridge-${version}.vsix`;
const zipName = `owen-browser-capture-browser-extension-${version}.zip`;
const distDir = join(root, 'dist');
const vsix = join(distDir, vsixName);
const browserZip = join(distDir, zipName);
const browserZipRoot = `owen-browser-capture-browser-extension-${version}`;

for (const asset of [vsix, browserZip]) {
  const stat = statSync(asset, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size <= 0) {
    throw new Error(`Missing or empty release asset: ${asset}`);
  }
}

const zip = new AdmZip(browserZip);
const entries = new Set(zip.getEntries().map(entry => entry.entryName));
for (const file of ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css']) {
  const expected = `${browserZipRoot}/${file}`;
  if (!entries.has(expected)) {
    throw new Error(`Browser extension ZIP is missing ${expected}`);
  }
}

console.log(`Verified release assets for v${version}:`);
console.log(`- dist/${vsixName}`);
console.log(`- dist/${zipName}`);