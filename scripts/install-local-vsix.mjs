import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const packageJsonPath = join(repoRoot, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
const vsixPath = join(repoRoot, 'dist', `owen-browser-bridge-${version}.vsix`);

if (!existsSync(vsixPath)) {
  console.error(`VSIX not found: ${vsixPath}`);
  console.error('Run npm run package first to build release assets.');
  process.exit(1);
}

function runCode(args, options = {}) {
  if (process.platform === 'win32') {
    const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
    const commandLine = ['code', ...args.map(psQuote)].join(' ');
    return spawnSync('powershell', ['-NoProfile', '-Command', commandLine], {
      ...options
    });
  }

  return spawnSync('code', args, {
    ...options
  });
}

const install = runCode(['--install-extension', vsixPath, '--force'], {
  stdio: 'inherit'
});

if (install.status !== 0) {
  console.error('Failed to install VSIX into local VS Code. Ensure the code command is available in PATH.');
  process.exit(install.status ?? 1);
}

const verify = runCode(['--list-extensions', '--show-versions'], {
  encoding: 'utf8'
});

if (verify.status === 0) {
  const lines = String(verify.stdout || '').split(/\r?\n/);
  const installed = lines.find(line => line.toLowerCase().startsWith('towishy.owen-browser-bridge@'));
  if (installed) {
    console.log(`Installed: ${installed}`);
  }
}

console.log(`Local VS Code install complete for version ${version}.`);
