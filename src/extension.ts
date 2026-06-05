import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';

type BrowserCapturePayload = {
	source?: string;
	version?: string;
	collectedAt?: string;
	page?: {
		url?: string;
		title?: string;
		visibleText?: string;
		selection?: string;
		html?: string;
		metadata?: Record<string, unknown>;
	};
	screenshot?: {
		dataUrl?: string;
		mimeType?: string;
	};
};

type StoredCapture = {
	id: string;
	folder: string;
	jsonPath: string;
	markdownPath: string;
	screenshotPath?: string;
	url?: string;
	title?: string;
	collectedAt: string;
};

let server: http.Server | undefined;
let output: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
	output = vscode.window.createOutputChannel('Owen Browser Bridge');
	context.subscriptions.push(output);

	context.subscriptions.push(
		vscode.commands.registerCommand('owen-browser-bridge.startServer', async () => startServer(context, true)),
		vscode.commands.registerCommand('owen-browser-bridge.stopServer', async () => stopServer(true)),
		vscode.commands.registerCommand('owen-browser-bridge.showLatestCapture', async () => showLatestCapture(context)),
		vscode.commands.registerCommand('owen-browser-bridge.openCapturesFolder', async () => openCapturesFolder(context)),
		vscode.commands.registerCommand('owen-browser-bridge.copyPairingToken', async () => copyPairingToken(context)),
		vscode.commands.registerCommand('owen-browser-bridge.regeneratePairingToken', async () => regeneratePairingToken(context)),
		vscode.lm.registerTool('get_latest_browser_capture', createLatestCaptureTool(context)),
		vscode.lm.registerTool('read_browser_capture', createReadCaptureTool(context))
	);

	if (getConfig().get<boolean>('autoStart', true)) {
		await startServer(context, false);
	}
}

async function startServer(context: vscode.ExtensionContext, notify: boolean) {
	if (server) {
		if (notify) {
			vscode.window.showInformationMessage('Owen Browser Bridge server is already running.');
		}
		return;
	}

	await ensurePairingToken(context);
	const port = getConfig().get<number>('port', 17321);

	server = http.createServer(async (request, response) => {
		try {
			await handleRequest(context, request, response);
		} catch (error) {
			output.appendLine(`Request failed: ${String(error)}`);
			writeJson(response, 500, { error: 'internal_error' });
		}
	});

	await new Promise<void>((resolve, reject) => {
		server?.once('error', reject);
		server?.listen(port, '127.0.0.1', () => resolve());
	});

	output.appendLine(`Listening on http://127.0.0.1:${port}`);
	if (notify) {
		vscode.window.showInformationMessage(`Owen Browser Bridge listening on 127.0.0.1:${port}.`);
	}
}

async function stopServer(notify: boolean) {
	if (!server) {
		if (notify) {
			vscode.window.showInformationMessage('Owen Browser Bridge server is not running.');
		}
		return;
	}

	await new Promise<void>((resolve, reject) => {
		server?.close(error => error ? reject(error) : resolve());
	});
	server = undefined;
	output.appendLine('Server stopped.');
	if (notify) {
		vscode.window.showInformationMessage('Owen Browser Bridge server stopped.');
	}
}

async function handleRequest(context: vscode.ExtensionContext, request: http.IncomingMessage, response: http.ServerResponse) {
	setCorsHeaders(response);

	if (request.method === 'OPTIONS') {
		response.writeHead(204);
		response.end();
		return;
	}

	if (request.url === '/health' && request.method === 'GET') {
		writeJson(response, 200, { ok: true, service: 'owen-browser-bridge' });
		return;
	}

	if (request.url === '/capture' && request.method === 'POST') {
		if (!await isAuthorized(context, request)) {
			writeJson(response, 401, { error: 'unauthorized' });
			return;
		}

		const payload = JSON.parse(await readBody(request)) as BrowserCapturePayload;
		const pageUrl = payload.page?.url ? new URL(payload.page.url) : undefined;
		const allowedHosts = getConfig().get<string[]>('allowedHosts', []);
		if (pageUrl && allowedHosts.length > 0 && !isAllowedHost(pageUrl.hostname, allowedHosts)) {
			writeJson(response, 403, { error: 'host_not_allowed', host: pageUrl.hostname });
			return;
		}

		const stored = await storeCapture(context, payload);
		await context.globalState.update('latestCapture', stored);
		writeJson(response, 201, stored);
		return;
	}

	writeJson(response, 404, { error: 'not_found' });
}

async function storeCapture(context: vscode.ExtensionContext, payload: BrowserCapturePayload): Promise<StoredCapture> {
	const collectedAt = payload.collectedAt ?? new Date().toISOString();
	const id = `capture-${formatTimestamp(collectedAt)}-${crypto.randomBytes(3).toString('hex')}`;
	const baseDir = await getCaptureBaseDir(context);
	const month = collectedAt.slice(0, 7).replace('-', '');
	const folder = path.join(baseDir, month);
	await fs.mkdir(folder, { recursive: true });

	const redactedPayload = redactPayload(payload);
	const jsonPath = path.join(folder, `${id}.json`);
	const markdownPath = path.join(folder, `${id}.md`);
	let screenshotPath: string | undefined;

	if (payload.screenshot?.dataUrl) {
		screenshotPath = path.join(folder, `${id}.png`);
		await fs.writeFile(screenshotPath, decodeDataUrl(payload.screenshot.dataUrl));
	}

	await fs.writeFile(jsonPath, JSON.stringify(redactedPayload, null, 2), 'utf8');
	await fs.writeFile(markdownPath, renderMarkdown(redactedPayload, screenshotPath ? path.basename(screenshotPath) : undefined), 'utf8');
	output.appendLine(`Stored capture ${id}: ${markdownPath}`);

	return {
		id,
		folder,
		jsonPath,
		markdownPath,
		screenshotPath,
		url: redactedPayload.page?.url,
		title: redactedPayload.page?.title,
		collectedAt
	};
}

async function showLatestCapture(context: vscode.ExtensionContext) {
	const latest = context.globalState.get<StoredCapture>('latestCapture');
	if (!latest) {
		vscode.window.showInformationMessage('No browser capture has been received yet.');
		return;
	}

	await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(latest.markdownPath));
}

function createLatestCaptureTool(context: vscode.ExtensionContext): vscode.LanguageModelTool<object> {
	return {
		async invoke() {
			const latest = context.globalState.get<StoredCapture>('latestCapture');
			if (!latest) {
				return new vscode.LanguageModelToolResult([
					vscode.LanguageModelDataPart.text('No browser capture has been received yet.', 'text/plain')
				]);
			}

			return captureToolResult(latest);
		},
		prepareInvocation() {
			return { invocationMessage: 'Reading the latest Owen Browser Bridge capture' };
		}
	};
}

function createReadCaptureTool(context: vscode.ExtensionContext): vscode.LanguageModelTool<{ idOrPath?: string }> {
	return {
		async invoke(options) {
			const latest = context.globalState.get<StoredCapture>('latestCapture');
			const idOrPath = options.input.idOrPath?.trim();
			if (!idOrPath && latest) {
				return captureToolResult(latest);
			}

			if (!idOrPath) {
				return new vscode.LanguageModelToolResult([
					vscode.LanguageModelDataPart.text('No capture id or path was provided, and there is no latest capture.', 'text/plain')
				]);
			}

			const resolved = await resolveCapture(context, idOrPath);
			return captureToolResult(resolved);
		},
		prepareInvocation(options) {
			return { invocationMessage: `Reading browser capture ${options.input.idOrPath ?? 'latest'}` };
		}
	};
}

async function captureToolResult(capture: StoredCapture) {
	const markdown = await fs.readFile(capture.markdownPath, 'utf8').catch(() => '');
	const json = await fs.readFile(capture.jsonPath, 'utf8').then(text => JSON.parse(text)).catch(() => undefined);
	return new vscode.LanguageModelToolResult([
		vscode.LanguageModelDataPart.json(capture),
		vscode.LanguageModelDataPart.text(markdown, 'text/markdown'),
		...(json ? [vscode.LanguageModelDataPart.json(json)] : []),
		vscode.LanguageModelDataPart.text(capture.screenshotPath ? `Screenshot path: ${capture.screenshotPath}` : 'No screenshot was stored.', 'text/plain')
	]);
}

async function resolveCapture(context: vscode.ExtensionContext, idOrPath: string): Promise<StoredCapture> {
	const directPath = path.isAbsolute(idOrPath) ? idOrPath : path.resolve(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', idOrPath);
	if (directPath.endsWith('.md') || directPath.endsWith('.json')) {
		const parsed = path.parse(directPath);
		const jsonPath = directPath.endsWith('.json') ? directPath : path.join(parsed.dir, `${parsed.name}.json`);
		const markdownPath = directPath.endsWith('.md') ? directPath : path.join(parsed.dir, `${parsed.name}.md`);
		return captureFromPaths(parsed.name, jsonPath, markdownPath);
	}

	const baseDir = await getCaptureBaseDir(context);
	const jsonPath = await findCaptureJson(baseDir, idOrPath);
	const parsed = path.parse(jsonPath);
	return captureFromPaths(parsed.name, jsonPath, path.join(parsed.dir, `${parsed.name}.md`));
}

async function captureFromPaths(id: string, jsonPath: string, markdownPath: string): Promise<StoredCapture> {
	const jsonText = await fs.readFile(jsonPath, 'utf8');
	const payload = JSON.parse(jsonText) as BrowserCapturePayload;
	const screenshotPath = path.join(path.dirname(jsonPath), `${id}.png`);
	const hasScreenshot = await fs.stat(screenshotPath).then(() => true).catch(() => false);
	return {
		id,
		folder: path.dirname(jsonPath),
		jsonPath,
		markdownPath,
		screenshotPath: hasScreenshot ? screenshotPath : undefined,
		url: payload.page?.url,
		title: payload.page?.title,
		collectedAt: payload.collectedAt ?? new Date().toISOString()
	};
}

async function findCaptureJson(baseDir: string, id: string): Promise<string> {
	const months = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
	for (const month of months) {
		if (!month.isDirectory()) {
			continue;
		}
		const candidate = path.join(baseDir, month.name, `${id}.json`);
		if (await fs.stat(candidate).then(() => true).catch(() => false)) {
			return candidate;
		}
	}

	throw new Error(`Browser capture not found: ${id}`);
}

async function openCapturesFolder(context: vscode.ExtensionContext) {
	const captureDir = await getCaptureBaseDir(context);
	await fs.mkdir(captureDir, { recursive: true });
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(captureDir), { forceNewWindow: false });
}

async function copyPairingToken(context: vscode.ExtensionContext) {
	const token = await ensurePairingToken(context);
	await vscode.env.clipboard.writeText(token);
	vscode.window.showInformationMessage('Owen Browser Bridge pairing token copied to clipboard.');
}

async function regeneratePairingToken(context: vscode.ExtensionContext) {
	const token = crypto.randomBytes(24).toString('base64url');
	await context.secrets.store('pairingToken', token);
	await vscode.env.clipboard.writeText(token);
	vscode.window.showWarningMessage('Owen Browser Bridge pairing token regenerated and copied. Update the browser extension settings.');
}

async function ensurePairingToken(context: vscode.ExtensionContext) {
	const existing = await context.secrets.get('pairingToken');
	if (existing) {
		return existing;
	}

	const token = crypto.randomBytes(24).toString('base64url');
	await context.secrets.store('pairingToken', token);
	return token;
}

async function isAuthorized(context: vscode.ExtensionContext, request: http.IncomingMessage) {
	const expected = await ensurePairingToken(context);
	const actual = request.headers['x-owen-bridge-token'];
	if (typeof actual !== 'string') {
		return false;
	}

	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function readBody(request: http.IncomingMessage) {
	return new Promise<string>((resolve, reject) => {
		const chunks: Buffer[] = [];
		request.on('data', chunk => chunks.push(Buffer.from(chunk)));
		request.on('error', reject);
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
	});
}

async function getCaptureBaseDir(context: vscode.ExtensionContext) {
	const configured = getConfig().get<string>('captureDirectory', 'raw/browser-captures');
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceFolder) {
		return path.resolve(workspaceFolder, configured);
	}

	return path.join(context.globalStorageUri.fsPath, configured);
}

function redactPayload(payload: BrowserCapturePayload): BrowserCapturePayload {
	const copy = JSON.parse(JSON.stringify(payload)) as BrowserCapturePayload;
	if (copy.page) {
		copy.page.url = redactText(copy.page.url);
		copy.page.title = redactText(copy.page.title);
		copy.page.visibleText = redactText(copy.page.visibleText);
		copy.page.selection = redactText(copy.page.selection);
		copy.page.html = copy.page.html ? (redactText(copy.page.html) ?? '').slice(0, 250000) : undefined;
	}
	return copy;
}

function isAllowedHost(hostname: string, allowedHosts: string[]) {
	const normalizedHost = hostname.toLowerCase();
	return allowedHosts.some(entry => {
		const normalizedEntry = normalizeAllowedHost(entry);
		if (!normalizedEntry) {
			return false;
		}

		if (normalizedEntry.startsWith('*.')) {
			const suffix = normalizedEntry.slice(1);
			return normalizedHost.endsWith(suffix);
		}

		return normalizedHost === normalizedEntry;
	});
}

function normalizeAllowedHost(entry: string) {
	const trimmed = entry.trim().toLowerCase();
	if (!trimmed) {
		return undefined;
	}

	if (trimmed.includes('://')) {
		return new URL(trimmed).hostname;
	}

	return trimmed.split('/')[0];
}

function redactText(value: string | undefined) {
	if (!value) {
		return value;
	}

	return value
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
		.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-guid]')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted-token]');
}

function renderMarkdown(payload: BrowserCapturePayload, screenshotFile?: string) {
	const page = payload.page ?? {};
	const lines = [
		'---',
		'type: browser-capture',
		`created: ${new Date().toISOString().slice(0, 10)}`,
		'tags: [type/browser-capture]',
		'---',
		'',
		`# ${page.title ?? 'Browser Capture'}`,
		'',
		'> [!summary]',
		`> URL: ${page.url ?? '(unknown)'}`,
		`> Collected: ${payload.collectedAt ?? new Date().toISOString()}`,
		'',
	];

	if (screenshotFile) {
		lines.push('## Screenshot', '', `![[${screenshotFile}]]`, '');
	}

	if (page.selection) {
		lines.push('## Selection', '', page.selection, '');
	}

	if (page.visibleText) {
		lines.push('## Visible Text', '', page.visibleText.slice(0, 50000), '');
	}

	if (page.metadata) {
		lines.push('## Metadata', '', '```json', JSON.stringify(page.metadata, null, 2), '```', '');
	}

	lines.push('## Copilot Prompt', '', 'Analyze this browser capture using the JSON, visible text, metadata, and screenshot stored next to this note. Highlight evidence, risk, likely next actions, and missing context.', '');
	return lines.join('\n');
}

function decodeDataUrl(dataUrl: string) {
	const base64 = dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
	return Buffer.from(base64, 'base64');
}

function setCorsHeaders(response: http.ServerResponse) {
	response.setHeader('Access-Control-Allow-Origin', '*');
	response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Owen-Bridge-Token');
}

function writeJson(response: http.ServerResponse, statusCode: number, body: unknown) {
	response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
	response.end(JSON.stringify(body));
}

function formatTimestamp(iso: string) {
	return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function getConfig() {
	return vscode.workspace.getConfiguration('owenBrowserBridge');
}

export async function deactivate() {
	await stopServer(false);
}
