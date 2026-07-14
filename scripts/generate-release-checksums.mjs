import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const distDir = join(root, 'dist');
const assets = [
  join(distDir, `owen-browser-bridge-${packageJson.version}.vsix`),
  join(distDir, `owen-browser-capture-browser-extension-${packageJson.version}.zip`)
];
mkdirSync(distDir, { recursive: true });
const lines = assets.map(asset => `${createHash('sha256').update(readFileSync(asset)).digest('hex')}  ${basename(asset)}`);
writeFileSync(join(distDir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
console.log('Created dist/SHA256SUMS.txt');
