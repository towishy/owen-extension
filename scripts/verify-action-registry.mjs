import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { BROWSER_ACTIONS, BROWSER_ACTION_REGISTRY } = require(join(root, 'out', 'browser-actions.js'));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const protocolRuntime = readFileSync(join(root, 'browser-extension', 'protocol-runtime.js'), 'utf8');
const tools = packageJson.contributes.languageModelTools;

assertEqual(toolActions('browser_act'), BROWSER_ACTIONS, 'browser_act');
for (const toolName of ['browser_act', 'browser_read', 'browser_interact', 'browser_workflow', 'browser_evidence', 'browser_admin']) {
  const tool = tools.find(item => item.name === toolName);
  if (tool?.inputSchema?.properties?.targetAgentId?.type !== 'string') {
    throw new Error(`${toolName} does not expose targetAgentId for multi-agent routing.`);
  }
}
for (const category of ['read', 'interact', 'workflow', 'evidence', 'admin']) {
  const expected = BROWSER_ACTION_REGISTRY.filter(item => item.category === category).map(item => item.name);
  assertEqual(toolActions(`browser_${category}`), expected, `browser_${category}`);
}

for (const definition of BROWSER_ACTION_REGISTRY) {
  if (!Array.isArray(definition.requiredInputs) || typeof definition.supportsEffectPolicy !== 'boolean' || typeof definition.requiresConfirmation !== 'boolean') {
    throw new Error(`Incomplete action registry metadata: ${definition.name}`);
  }
  if (definition.minProtocolVersion !== '3.0') {
    throw new Error(`Unexpected protocol version for ${definition.name}: ${definition.minProtocolVersion}`);
  }
}

if (!protocolRuntime.includes("const PROTOCOL_VERSION = '3.0'")) {
  throw new Error('Browser protocol runtime is not aligned with action registry protocol 3.0.');
}

console.log(`Verified ${BROWSER_ACTION_REGISTRY.length} browser action definitions and categorized LM tool schemas.`);

function toolActions(name) {
  const tool = tools.find(item => item.name === name);
  if (!tool) {
    throw new Error(`Missing language model tool: ${name}`);
  }
  return tool.inputSchema?.properties?.action?.enum ?? [];
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} action schema drifted from BROWSER_ACTION_REGISTRY.`);
  }
}
