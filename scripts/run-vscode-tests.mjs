import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const executable = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vscode-test.cmd' : 'vscode-test');
const testPort = String(30000 + (process.pid % 20000));
const result = spawnSync(executable, process.argv.slice(2), {
  cwd: root,
  env: { ...process.env, OWEN_BROWSER_BRIDGE_TEST_PORT: testPort },
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
process.exit(result.status ?? 1);
