import * as assert from 'assert';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { BROWSER_ACTIONS, BROWSER_ACTION_REGISTRY } from '../browser-actions';
import { CommandQueueError, ExpiringCommandQueue } from '../command-queue';
import { isAllowedHost, normalizeAllowedHost } from '../host-policy';
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
