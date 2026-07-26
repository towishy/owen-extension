import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const distDir = join(root, 'dist');
const outputPath = join(distDir, `owen-browser-bridge-${packageJson.version}.vsix`);
const vsceEntry = join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
const command = process.execPath;
const args = [vsceEntry, 'package', '--out', outputPath];

mkdirSync(distDir, { recursive: true });

const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}