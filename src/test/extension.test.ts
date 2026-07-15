import * as assert from 'assert';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { AgentActionPluginRegistry } from '../agent-action-registry';
import { AgentRunner, type AgentBrowserResult } from '../agent-runner';
import {
    compactAgentContext,
    createAgentRun,
    judgeCompletion,
    recordObservation,
    replacePlan,
    shouldUseFallback,
    staleBatchReason
} from '../agent-runtime';
import { BRIDGE_PROTOCOL_VERSION, BrowserAgentRegistry, requireCompatibleProtocol } from '../bridge-protocol';
import { BROWSER_ACTIONS, BROWSER_ACTION_REGISTRY } from '../browser-actions';
import { writeCaptureIntegrityManifest } from '../capture-integrity';
import { CommandQueueError, ExpiringCommandQueue } from '../command-queue';
import { isAllowedHost, normalizeAllowedHost } from '../host-policy';
import { parseStructuredJson } from '../language-model-planner';
import { redactSensitiveText } from '../redaction';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('command queue discards expired commands before delivery', () => {
		const queue = new ExpiringCommandQueue<{ id: string; expiresAt: string }>(5);
		queue.enqueue({ id: 'expired', expiresAt: new Date(999).toISOString() }, 0);
		queue.enqueue({ id: 'active', expiresAt: new Date(2000).toISOString() }, 0);

		assert.strictEqual(queue.take(1000)?.id, 'active');
		assert.strictEqual(queue.length, 0);
	});

	test('command queue supports explicit timeout removal', () => {
		const queue = new ExpiringCommandQueue<{ id: string; expiresAt: string }>(5);
		queue.enqueue({ id: 'command-1', expiresAt: new Date(2000).toISOString() }, 0);

		assert.strictEqual(queue.remove('command-1'), true);
		assert.strictEqual(queue.take(1000), undefined);
	});

	test('command queue rejects overflow and duplicate ids', () => {
		const queue = new ExpiringCommandQueue<{ id: string; expiresAt: string }>(1);
		queue.enqueue({ id: 'command-1', expiresAt: new Date(2000).toISOString() }, 0);

		assert.throws(
			() => queue.enqueue({ id: 'command-1', expiresAt: new Date(2000).toISOString() }, 0),
			(error: unknown) => error instanceof CommandQueueError && error.code === 'duplicate_command'
		);
		assert.throws(
			() => queue.enqueue({ id: 'command-2', expiresAt: new Date(2000).toISOString() }, 0),
			(error: unknown) => error instanceof CommandQueueError && error.code === 'queue_full'
		);
	});

	test('command queue leases, acknowledges, and completes without early removal', () => {
		const queue = new ExpiringCommandQueue<{ id: string; expiresAt: string; targetAgentId?: string }>(5);
		queue.enqueue({ id: 'command-1', expiresAt: new Date(10000).toISOString(), targetAgentId: 'edge' }, 0);

		const lease = queue.lease('edge', 2000, 1000, item => item.targetAgentId === 'edge');
		assert.strictEqual(lease?.item.id, 'command-1');
		assert.strictEqual(lease?.deliveryAttempt, 1);
		assert.strictEqual(queue.length, 1);
		assert.strictEqual(queue.lease('chrome', 2000, 1500), undefined);
		assert.strictEqual(queue.acknowledge('command-1', 'edge', 4000, 1500), true);
		assert.strictEqual(queue.complete('command-1', 'chrome'), false);
		assert.strictEqual(queue.complete('command-1', 'edge'), true);
		assert.strictEqual(queue.length, 0);
	});

	test('command queue redelivers an expired lease and filters by agent', () => {
		const queue = new ExpiringCommandQueue<{ id: string; expiresAt: string; targetAgentId?: string }>(5);
		queue.enqueue({ id: 'edge-only', expiresAt: new Date(10000).toISOString(), targetAgentId: 'edge' }, 0);
		assert.strictEqual(queue.lease('chrome', 1000, 100, item => !item.targetAgentId || item.targetAgentId === 'chrome'), undefined);
		assert.strictEqual(queue.lease('edge', 1000, 100, item => !item.targetAgentId || item.targetAgentId === 'edge')?.deliveryAttempt, 1);
		assert.strictEqual(queue.lease('edge', 1000, 1200, item => !item.targetAgentId || item.targetAgentId === 'edge')?.deliveryAttempt, 2);
	});

	test('command queue requires an active lease for owned completion', () => {
		const queue = new ExpiringCommandQueue<{ id: string; expiresAt: string }>(5);
		queue.enqueue({ id: 'command-1', expiresAt: new Date(10000).toISOString() }, 0);
		assert.strictEqual(queue.complete('command-1', 'edge'), false);
		assert.strictEqual(queue.lease('edge', 1000, 100)?.ownerId, 'edge');
		assert.strictEqual(queue.isLeaseOwner('command-1', 'edge'), true);
		assert.strictEqual(queue.complete('command-1', 'edge'), true);
	});

	test('browser agent registry selects one agent and requires routing when multiple are active', () => {
		const agents = new BrowserAgentRegistry();
		agents.touch({ id: 'edge', browserName: 'Edge', protocolVersion: BRIDGE_PROTOCOL_VERSION }, 1000);
		assert.strictEqual(agents.resolveTarget(undefined, undefined, 1000), 'edge');
		agents.touch({ id: 'chrome', browserName: 'Chrome', protocolVersion: BRIDGE_PROTOCOL_VERSION }, 1200);
		assert.throws(() => agents.resolveTarget(undefined, undefined, 1200), /Multiple browser agents/);
		assert.strictEqual(agents.resolveTarget('chrome', undefined, 1200), 'chrome');
		assert.strictEqual(agents.resolveTarget(undefined, 'edge', 1200), 'edge');
	});

	test('bridge protocol rejects incompatible browser versions', () => {
		assert.doesNotThrow(() => requireCompatibleProtocol(BRIDGE_PROTOCOL_VERSION));
		assert.throws(() => requireCompatibleProtocol('2.0'), /protocol mismatch/);
		assert.throws(() => requireCompatibleProtocol(undefined), /received missing/);
	});

	test('agent runtime clamps budgets and detects repeated observations', () => {
		let run = createAgentRun('run-1', 'Review the incident', { maxSteps: 500, maxRetriesPerStep: 9 });
		assert.strictEqual(run.maxSteps, 50);
		assert.strictEqual(run.maxRetriesPerStep, 3);
		for (let index = 0; index < 3; index += 1) {
			run = recordObservation(run, { url: 'https://security.microsoft.com/incidents#overview', domHash: 'same', elementCount: 10 });
		}
		assert.strictEqual(run.repetitionCount, 3);
		assert.strictEqual(compactAgentContext(run).replanRequired, true);
	});

	test('agent runtime compacts plan, constraints, facts, and recent events', () => {
		let run = createAgentRun('run-2', 'Collect evidence', { hardConstraints: ['read only', 'read only'] });
		run = replacePlan(run, [{ goal: 'Inspect the page', completionCriteria: ['page ready'] }]);
		run = recordObservation(run, { url: 'https://security.microsoft.com', title: 'Security' });
		const context = compactAgentContext(run, 1);
		assert.deepStrictEqual(context.hardConstraints, ['read only']);
		assert.strictEqual(context.plan[0].status, 'active');
		assert.strictEqual(context.recentEvents.length, 1);
	});

	test('agent runtime invalidates stale write batches after page changes', () => {
		const before = { url: 'https://example.com/a', tabId: 1, domHash: 'before', pageRevision: '1' };
		assert.strictEqual(staleBatchReason(before, { ...before, url: 'https://example.com/b' }, false), 'URL changed');
		assert.strictEqual(staleBatchReason(before, { ...before, domHash: 'after' }, true), 'DOM changed after a state-changing action');
		assert.strictEqual(staleBatchReason(before, before, true), undefined);
	});

	test('agent runtime judges completion from evidence instead of action success', () => {
		assert.strictEqual(judgeCompletion({}).status, 'partial');
		assert.strictEqual(judgeCompletion({ authRequired: true }).status, 'waiting_review');
		assert.strictEqual(judgeCompletion({ requiredClaims: ['severity'], verifiedClaims: [] }).status, 'partial');
		assert.strictEqual(judgeCompletion({ requiredClaims: ['severity'], verifiedClaims: ['severity'], contractPassed: true }).status, 'completed');
	});

	test('agent runtime limits fallback to recoverable model failures', () => {
		assert.strictEqual(shouldUseFallback(new Error('Model output was truncated')), true);
		assert.strictEqual(shouldUseFallback(new Error('Invalid JSON schema response')), true);
		assert.strictEqual(shouldUseFallback(new Error('Host is not allowed')), false);
	});

	test('agent runner observes after every state-changing action and completes with evidence', async () => {
		const actions: string[] = [];
		const persisted: string[] = [];
		let decisionCount = 0;
		const runner = new AgentRunner({
			execute: async action => {
				actions.push(action.action);
				return { ok: true, browserState: { url: 'https://example.com', domHash: `state-${actions.length}` } };
			},
			observe: result => ({
				url: String(result.browserState?.url),
				domHash: String(result.browserState?.domHash)
			}),
			decide: async () => {
				decisionCount += 1;
				return decisionCount === 1
					? { evaluation: 'Page is ready.', memory: 'Ready.', nextGoal: 'Open details.', action: { action: 'click', targetHint: 'Details' } }
					: {
						evaluation: 'Details are visible.', memory: 'Evidence collected.', nextGoal: 'Finish.', done: true,
						completionEvidence: { requiredClaims: ['details'], verifiedClaims: ['details'], assertionsPassed: true }
					};
			},
			persist: async run => { persisted.push(run.status); }
		});

		const run = await runner.run('run-test', 'Open details', { maxSteps: 4 });
		assert.deepStrictEqual(actions, ['readPage', 'click', 'readPage']);
		assert.strictEqual(run.status, 'completed');
		assert.ok(persisted.includes('verifying'));
	});

	test('agent runner stops for authentication instead of replanning', async () => {
		const authResult: AgentBrowserResult = { ok: false, authRequired: true };
		const runner = new AgentRunner({
			execute: async () => authResult,
			observe: () => ({ url: '' }),
			decide: async () => ({ evaluation: '', memory: '', nextGoal: '' })
		});
		const run = await runner.run('run-auth', 'Read portal');
		assert.strictEqual(run.status, 'waiting_review');
	});

	test('agent runner resumes with existing plan, history, and metrics', async () => {
		let previous = createAgentRun('run-resume', 'Resume evidence review');
		previous = replacePlan(previous, [{ goal: 'Verify evidence', completionCriteria: ['evidence visible'] }]);
		previous = recordObservation(previous, { url: 'https://example.com', domHash: 'before' });
		const runner = new AgentRunner({
			execute: async () => ({ ok: true, browserState: { url: 'https://example.com', domHash: 'after' } }),
			observe: result => ({ url: String(result.browserState?.url), domHash: String(result.browserState?.domHash) }),
			decide: async () => ({
				evaluation: 'Evidence is visible.', memory: 'Verified.', nextGoal: 'Finish.', done: true,
				completionEvidence: { evidenceComplete: true }
			})
		});

		const resumed = await runner.run(previous.runId, previous.goal, {}, previous);
		assert.strictEqual(resumed.status, 'completed');
		assert.strictEqual(resumed.createdAt, previous.createdAt);
		assert.strictEqual(resumed.planRevision, 1);
		assert.ok(resumed.events.some(event => event.summary === 'Run resumed by the operator.'));
		assert.ok(resumed.metrics.observations > previous.metrics.observations);
	});

	test('custom agent action registry enforces namespace, risk, and disposal', () => {
		const registry = new AgentActionPluginRegistry();
		assert.throws(() => registry.register({
			name: 'custom.write' as const,
			description: 'Unsafe low-risk write.',
			capability: 'browser-write',
			risk: 'low',
			handler: async () => ({ ok: true })
		}), /must be sensitive or destructive/);
		const disposable = registry.register({
			name: 'custom.collect-evidence',
			description: 'Collect domain-specific evidence.',
			capability: 'evidence',
			risk: 'low',
			handler: async () => ({ ok: true })
		});
		registry.register({
			name: 'custom.delete-policy',
			description: 'Delete a policy.',
			capability: 'browser-write',
			risk: 'destructive',
			handler: async () => ({ ok: true })
		});
		assert.deepStrictEqual(registry.listAutonomous().map(plugin => plugin.name), ['custom.collect-evidence']);
		disposable.dispose();
		assert.strictEqual(registry.get('custom.collect-evidence'), undefined);
	});

	test('language model planner parses fenced JSON and rejects truncated output', () => {
		assert.deepStrictEqual(parseStructuredJson<{ done: boolean }>('```json\n{"done":true}\n```'), { done: true });
		assert.throws(() => parseStructuredJson('{"done":'), /truncated/);
	});

	test('bridge HTTP protocol leases, acknowledges, completes, and deduplicates results', async function () {
		this.timeout(10000);
		const extension = vscode.extensions.getExtension('towishy.owen-browser-bridge');
		assert.ok(extension);
		const port = Number(process.env.OWEN_BROWSER_BRIDGE_TEST_PORT);
		assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
		try {
			await extension.activate();
			await vscode.commands.executeCommand('owen-browser-bridge.startServer');
			await vscode.commands.executeCommand('owen-browser-bridge.copyPairingToken');
			const token = await vscode.env.clipboard.readText();
			const headers = { 'Content-Type': 'application/json', 'X-Owen-Bridge-Token': token };
			const agentId = 'integration-agent';
			const nextUrl = `http://127.0.0.1:${port}/commands/next?protocolVersion=${BRIDGE_PROTOCOL_VERSION}&agentId=${agentId}&waitMs=5000`;
			assert.strictEqual((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
			assert.strictEqual((await fetch(nextUrl)).status, 401);
			assert.strictEqual((await fetch(`http://127.0.0.1:${port}/commands/next?protocolVersion=2.0&agentId=${agentId}`, { headers })).status, 409);
			assert.strictEqual((await fetch(nextUrl, { headers })).status, 200);

			const enqueue = fetch(`http://127.0.0.1:${port}/commands/enqueue`, {
				method: 'POST', headers, body: JSON.stringify({ action: 'readPage', targetAgentId: agentId, captureAfter: false })
			});
			const deliveryResponse = await fetch(nextUrl, { headers });
			const delivery = await deliveryResponse.json() as { command?: { id: string } };
			assert.strictEqual(deliveryResponse.status, 200);
			assert.ok(delivery.command?.id);

			const commandId = delivery.command.id;
			assert.strictEqual((await fetch(`http://127.0.0.1:${port}/commands/ack`, {
				method: 'POST', headers, body: JSON.stringify({ id: commandId, agentId: 'wrong-agent' })
			})).status, 409);
			assert.strictEqual((await fetch(`http://127.0.0.1:${port}/commands/ack`, {
				method: 'POST', headers, body: JSON.stringify({ id: commandId, agentId })
			})).status, 200);

			const result = { id: commandId, agentId, ok: true, result: { action: 'readPage', steps: [] } };
			const wrongResult = await fetch(`http://127.0.0.1:${port}/commands/result`, {
				method: 'POST', headers, body: JSON.stringify({ ...result, agentId: 'wrong-agent' })
			});
			assert.strictEqual(wrongResult.status, 409);
			assert.strictEqual((await wrongResult.json() as { discardResult?: boolean }).discardResult, true);
			assert.strictEqual((await fetch(`http://127.0.0.1:${port}/commands/result`, {
				method: 'POST', headers, body: JSON.stringify(result)
			})).status, 200);
			assert.strictEqual((await fetch(`http://127.0.0.1:${port}/commands/result`, {
				method: 'POST', headers, body: JSON.stringify(result)
			})).status, 200);
			assert.strictEqual((await enqueue).status, 200);
		} finally {
			if (extension.isActive) {
				await vscode.commands.executeCommand('owen-browser-bridge.stopServer');
			}
		}
	});

	test('capture integrity manifest records SHA-256 and size', async () => {
		const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'owen-capture-integrity-'));
		try {
			const capturePath = path.join(folder, 'capture.json');
			await fs.writeFile(capturePath, 'abc', 'utf8');
			const { manifestPath, manifest } = await writeCaptureIntegrityManifest('capture-1', folder, [capturePath]);
			assert.strictEqual(manifest.files[0].size, 3);
			assert.strictEqual(manifest.files[0].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
			assert.strictEqual(JSON.parse(await fs.readFile(manifestPath, 'utf8')).captureId, 'capture-1');
		} finally {
			await fs.rm(folder, { recursive: true, force: true });
		}
	});

	test('browser action registry matches the contributed tool schema', async () => {
		const packageJson = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
		const browserAct = packageJson.contributes.languageModelTools.find((tool: { name: string }) => tool.name === 'browser_act');
		assert.deepStrictEqual(browserAct.inputSchema.properties.action.enum, [...BROWSER_ACTIONS]);
		assert.strictEqual(BROWSER_ACTION_REGISTRY.length, BROWSER_ACTIONS.length);
		assert.strictEqual(BROWSER_ACTION_REGISTRY.find(item => item.name === 'closeTab')?.risk, 'destructive');
	});

	test('categorized browser tools match registry categories', async () => {
		const packageJson = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
		for (const category of ['read', 'interact', 'workflow', 'evidence', 'admin']) {
			const tool = packageJson.contributes.languageModelTools.find((item: { name: string }) => item.name === `browser_${category}`);
			const expected = BROWSER_ACTION_REGISTRY.filter(item => item.category === category).map(item => item.name);
			assert.deepStrictEqual(tool.inputSchema.properties.action.enum, expected, `browser_${category} schema drifted`);
		}
	});

	test('browser read tools expose non-empty text parts', async () => {
		const extension = vscode.extensions.getExtension('towishy.owen-browser-bridge');
		assert.ok(extension);
		await extension.activate();

		for (const toolName of ['get_latest_browser_capture', 'get_browser_state', 'read_browser_capture']) {
			const result = await vscode.lm.invokeTool(toolName, {
				input: {},
				toolInvocationToken: undefined
			});
			const textParts = result.content.filter(part => part instanceof vscode.LanguageModelTextPart);
			assert.ok(textParts.length > 0, `${toolName} returned no LanguageModelTextPart`);
			assert.ok(textParts.some(part => part.value.trim().length > 0), `${toolName} returned only empty text`);
		}
	});

	test('package and browser manifest versions stay aligned', async () => {
		const packageJson = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
		const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../browser-extension/manifest.json'), 'utf8'));
		assert.strictEqual(manifest.version, packageJson.version);
	});

	test('destructive actions are not exposed by the read tool', () => {
		assert.notStrictEqual(BROWSER_ACTION_REGISTRY.find(item => item.name === 'closeTab')?.category, 'read');
	});

	test('standard redaction removes common identity and network values', () => {
		const input = 'user@example.com 10.2.3.4 123e4567-e89b-12d3-a456-426614174000';
		assert.strictEqual(redactSensitiveText(input, 'standard'), '[redacted-email] [redacted-ip] [redacted-guid]');
	});

	test('standard redaction removes bearer and query tokens', () => {
		const input = 'Bearer abc.def_123 access_token=secret-value&sid=session-value';
		assert.strictEqual(redactSensitiveText(input, 'standard'), 'Bearer [redacted-token] access_token=[redacted-token]&sid=[redacted-token]');
	});

	test('strict redaction removes long opaque and hexadecimal tokens', () => {
		const input = 'ABCDEFGHIJKLMNOPQRSTUVWX 0123456789abcdef0123456789abcdef';
		assert.strictEqual(redactSensitiveText(input, 'strict'), '[redacted-long-token] [redacted-long-token]');
	});

	test('redaction off preserves input', () => {
		assert.strictEqual(redactSensitiveText('user@example.com', 'off'), 'user@example.com');
	});

	test('custom redaction patterns are applied and invalid patterns are reported', () => {
		const invalid: string[] = [];
		const result = redactSensitiveText('case-123 keep', 'standard', ['case-\\d+', '['], pattern => invalid.push(pattern));
		assert.strictEqual(result, '[redacted-custom] keep');
		assert.deepStrictEqual(invalid, ['[']);
	});

	test('host policy accepts exact and wildcard hosts', () => {
		assert.strictEqual(isAllowedHost('portal.azure.com', ['portal.azure.com']), true);
		assert.strictEqual(isAllowedHost('security.microsoft.com', ['*.microsoft.com']), true);
	});

	test('host policy rejects suffix lookalikes', () => {
		assert.strictEqual(isAllowedHost('evilmicrosoft.com', ['*.microsoft.com']), false);
		assert.strictEqual(isAllowedHost('microsoft.com.evil.test', ['*.microsoft.com']), false);
	});

	test('host normalization accepts URLs and removes paths', () => {
		assert.strictEqual(normalizeAllowedHost('HTTPS://Portal.Azure.com/path'), 'portal.azure.com');
		assert.strictEqual(normalizeAllowedHost('security.microsoft.com/incidents'), 'security.microsoft.com');
		assert.strictEqual(normalizeAllowedHost('  '), undefined);
	});
});
