import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';

type BrowserCapturePayload = {
	source?: string;
	version?: string;
	collectedAt?: string;
	investigation?: {
		name?: string;
	};
	browserSession?: BrowserSessionState;
	page?: {
		url?: string;
		title?: string;
		visibleText?: string;
		selection?: string;
		html?: string;
		screenSummary?: Record<string, unknown>;
		metadata?: Record<string, unknown>;
	};
	screenshot?: {
		dataUrl?: string;
		mimeType?: string;
	};
};

type BrowserSessionState = {
	browserSessionId?: string;
	tabId?: number;
	windowId?: number;
	tabIndex?: number;
	url?: string;
	title?: string;
	captureGroup?: string;
	lastAction?: string;
	lastCommandId?: string;
	lastScreenshotIncluded?: boolean;
	lastCaptureId?: string;
	lastMarkdownPath?: string;
	lastScreenshotPath?: string;
	updatedAt?: string;
	screenSummary?: Record<string, unknown>;
};

type StoredCapture = {
	id: string;
	folder: string;
	host: string;
	groupName: string;
	jsonPath: string;
	markdownPath: string;
	screenshotPath?: string;
	url?: string;
	title?: string;
	collectedAt: string;
};

type CaptureGroupSummary = {
	host: string;
	groupName: string;
	folder: string;
	captureCount: number;
	timeRange?: {
		from: string;
		to: string;
	};
	captures: StoredCapture[];
};

type BrowserWaitCondition = {
	kind?: 'text' | 'element' | 'elementGone' | 'urlMatch' | 'spinnerGone' | 'elementStable' | 'urlSettled' | 'composite' | 'semantic' | 'networkIdle' | 'requestDone';
	text?: string;
	selector?: string;
	urlPattern?: string;
	semanticConditions?: string[];
	pollIntervalMs?: number;
	urlIncludes?: string[];
	statusIn?: number[];
	idleMs?: number;
	maxInflight?: number;
};

type BrowserStepInput = {
	action?: BrowserAction;
	selector?: string;
	text?: string;
	value?: string;
	url?: string;
	urls?: string[];
	formFields?: Record<string, string>;
	submitSelector?: string;
	submitText?: string;
	conditions?: Array<{ if?: { selector?: string; text?: string; urlPattern?: string }; then?: BrowserStepInput[]; else?: BrowserStepInput[] }>;
	linkSelector?: string;
	linkText?: string;
	key?: string;
	role?: string;
	label?: string;
	index?: number;
	maxPages?: number;
	maxTabs?: number;
	requiredFields?: string[];
	requiredTexts?: string[];
	acknowledgement?: string;
	nextSelector?: string;
	nextText?: string;
	extractSelectors?: Record<string, string>;
	waitAfterNavigateMs?: number;
	direction?: 'up' | 'down';
	delta?: number;
	options?: string[];
	wait?: BrowserWaitCondition;
	timeoutMs?: number;
	retries?: number;
	fallbackSelectors?: string[];
	fallbackTexts?: string[];
	autoHeal?: boolean;
	targetHint?: string;
	regionX?: number;
	regionY?: number;
	regionWidth?: number;
	regionHeight?: number;
	regionPadding?: number;
	targetTabIndex?: number;
	confirmDangerous?: boolean;
	captureAfter?: boolean;
	includeScreenshot?: boolean;
	includeHtml?: boolean;
	investigationName?: string;
	urlIncludes?: string[];
	durationMs?: number;
	maxEntries?: number;
	tableSelector?: string;
	headerMode?: 'auto' | 'thead' | 'firstRow';
	outputFormat?: 'json' | 'csv';
	checkpointName?: string;
	includeFormState?: boolean;
	strictUrlMatch?: boolean;
	reviewPrompt?: string;
	approvalKeyword?: string;
	itemSelector?: string;
	matchText?: string;
	matchMode?: 'includes' | 'equals' | 'regex';
	actionTemplate?: BrowserStepInput;
	maxItems?: number;
	semanticConditions?: string[];
	baseRunId?: string;
	newRunId?: string;
	ignoreSelectors?: string[];
	policyProfile?: string;
	onViolation?: 'block' | 'warn';
	targetScope?: 'auto' | 'main' | 'allFrames' | 'shadowDeep';
	frameDepth?: number;
	retryProfile?: 'conservative' | 'standard' | 'aggressive';
	captureBeforeAfter?: boolean;
	macroName?: string;
	params?: Record<string, unknown>;
	scenarioName?: string;
	scenarioTemplates?: Record<string, unknown>;
	steps?: BrowserStepInput[];
	assertText?: string;
	assertNoText?: string;
	assertSelector?: string;
	assertNotSelector?: string;
	assertScreenshotChanged?: boolean;
	selectorMemory?: boolean;
	watchDurationMs?: number;
	highlightSelectors?: string[];
	highlightText?: string;
	goal?: string;
	claim?: string;
	requiredClaims?: string[];
	keyColumns?: string[];
	waitCandidates?: string[];
	detailSelector?: string;
	waitPreset?: 'defenderIncidentReady' | 'azureBladeReady' | 'entraTableReady' | 'genericPortalReady';
	contractName?: string;
	contractSelectors?: string[];
	contractTexts?: string[];
	captureGroup?: string;
	jobName?: string;
	tabRoles?: Record<string, string[]>;
	expectedTabs?: number;
	returnToRole?: string;
	closeExtraTabs?: boolean;
	onUnexpectedTab?: 'capture' | 'warn' | 'block';
};

type BrowserPreset = 'defenderIncidentSurvey' | 'defenderIncidentAlerts' | 'defenderIncidentEvidence';

type BrowserAction =
	| 'readPage'
	| 'capture'
	| 'click'
	| 'type'
	| 'navigate'
	| 'waitForText'
	| 'wait'
	| 'waitPreset'
	| 'scroll'
	| 'hover'
	| 'keyPress'
	| 'selectOption'
	| 'clearInput'
	| 'back'
	| 'forward'
	| 'reload'
	| 'openInNewTab'
	| 'switchTab'
	| 'closeTab'
	| 'listInteractables'
	| 'inspectTargets'
	| 'captureElement'
	| 'captureRegion'
	| 'journeyCapture'
	| 'paginateCapture'
	| 'smartFormFill'
	| 'conditionalWorkflow'
	| 'multiTabCrawl'
	| 'runtimeSnapshot'
	| 'domDiffTimeline'
	| 'ocrSnapshot'
	| 'dataGapGuard'
	| 'exportReplay'
	| 'networkTraceCapture'
	| 'safeDownloadAndHash'
	| 'tableExtract'
	| 'stateCheckpoint'
	| 'rollbackToCheckpoint'
	| 'humanReviewGate'
	| 'bulkActionFromList'
	| 'semanticWait'
	| 'compareCaptureRuns'
	| 'policyGuard'
	| 'visualAssert'
	| 'accessibilitySnapshot'
	| 'mapForm'
	| 'watchPageChanges'
	| 'highlightEvidence'
	| 'planAndRun'
	| 'evidenceClaimCheck'
	| 'tableWatchAndDiff'
	| 'browserRunBundle'
	| 'safeActionPreview'
	| 'stableTargetProfile'
	| 'guidedDrilldown'
	| 'evidenceCompletenessCheck'
	| 'failureExplainer'
	| 'waitProfiler'
	| 'automationHealthScore'
	| 'sensitiveActionGuard'
	| 'tabOrchestrator'
	| 'popupGuard'
	| 'returnToTab'
	| 'tabRunSummary'
	| 'buildEvidencePack'
	| 'buildNavigationGraph'
	| 'assertPageContract'
	| 'createHandoff'
	| 'selectorHealthReport'
	| 'captureReviewQueue'
	| 'startBrowserJob'
	| 'getBrowserJob'
	| 'cancelBrowserJob'
	| 'recordWorkflow'
	| 'replayWorkflow'
	| 'runScenarioTemplate'
	| 'resumeAfterAuth'
	| 'runWorkflow';

type BrowserActInput = BrowserStepInput & {
	preset?: BrowserPreset;
	steps?: BrowserStepInput[];
	investigationName?: string;
};

type BrowserCommand = Required<Pick<BrowserActInput, 'action' | 'timeoutMs' | 'captureAfter' | 'includeScreenshot' | 'includeHtml'>> & {
	id: string;
	createdAt: string;
	selector?: string;
	text?: string;
	value?: string;
	url?: string;
	urls?: string[];
	formFields?: Record<string, string>;
	submitSelector?: string;
	submitText?: string;
	conditions?: Array<{ if?: { selector?: string; text?: string; urlPattern?: string }; then?: BrowserStepInput[]; else?: BrowserStepInput[] }>;
	linkSelector?: string;
	linkText?: string;
	key?: string;
	role?: string;
	label?: string;
	index?: number;
	maxPages?: number;
	maxTabs?: number;
	requiredFields?: string[];
	requiredTexts?: string[];
	acknowledgement?: string;
	nextSelector?: string;
	nextText?: string;
	extractSelectors?: Record<string, string>;
	waitAfterNavigateMs?: number;
	direction?: 'up' | 'down';
	delta?: number;
	options?: string[];
	wait?: BrowserWaitCondition;
	retries: number;
	fallbackSelectors: string[];
	fallbackTexts: string[];
	autoHeal: boolean;
	targetHint?: string;
	regionX?: number;
	regionY?: number;
	regionWidth?: number;
	regionHeight?: number;
	regionPadding?: number;
	targetTabIndex?: number;
	confirmDangerous: boolean;
	steps: BrowserStepInput[];
	preset?: BrowserPreset;
	urlIncludes: string[];
	durationMs: number;
	maxEntries: number;
	tableSelector?: string;
	headerMode?: 'auto' | 'thead' | 'firstRow';
	outputFormat?: 'json' | 'csv';
	checkpointName?: string;
	includeFormState: boolean;
	strictUrlMatch: boolean;
	reviewPrompt?: string;
	approvalKeyword?: string;
	itemSelector?: string;
	matchText?: string;
	matchMode?: 'includes' | 'equals' | 'regex';
	actionTemplate?: BrowserStepInput;
	maxItems: number;
	semanticConditions: string[];
	baseRunId?: string;
	newRunId?: string;
	ignoreSelectors: string[];
	policyProfile?: string;
	onViolation: 'block' | 'warn';
	targetScope?: 'auto' | 'main' | 'allFrames' | 'shadowDeep';
	frameDepth?: number;
	retryProfile: 'conservative' | 'standard' | 'aggressive';
	captureBeforeAfter: boolean;
	macroName?: string;
	params?: Record<string, unknown>;
	scenarioName?: string;
	scenarioTemplates?: Record<string, unknown>;
	assertText?: string;
	assertNoText?: string;
	assertSelector?: string;
	assertNotSelector?: string;
	assertScreenshotChanged: boolean;
	selectorMemory: boolean;
	watchDurationMs: number;
	highlightSelectors: string[];
	highlightText?: string;
	goal?: string;
	claim?: string;
	requiredClaims: string[];
	keyColumns: string[];
	waitCandidates: string[];
	detailSelector?: string;
	waitPreset?: 'defenderIncidentReady' | 'azureBladeReady' | 'entraTableReady' | 'genericPortalReady';
	contractName?: string;
	contractSelectors: string[];
	contractTexts: string[];
	captureGroup?: string;
	jobName?: string;
	tabRoles: Record<string, string[]>;
	expectedTabs?: number;
	returnToRole?: string;
	closeExtraTabs: boolean;
	onUnexpectedTab: 'capture' | 'warn' | 'block';
	investigationName?: string;
	allowedHosts: string[];
};

type BrowserCommandResult = {
	id?: string;
	ok?: boolean;
	result?: unknown;
	error?: string;
	capture?: BrowserCapturePayload;
};

type BrowserCommandCompletion = BrowserCommandResult & {
	storedCapture?: StoredCapture;
};

type AuthRequiredResult = {
	authRequired?: boolean;
	authUrl?: string;
	message?: string;
	resumeInput?: BrowserActInput;
	pages?: unknown[];
	visitedCount?: number;
};

type ReviewRequiredResult = {
	reviewRequired?: boolean;
	message?: string;
	approvalKeyword?: string;
};

let server: http.Server | undefined;
let output: vscode.OutputChannel;
let setupPanel: vscode.WebviewPanel | undefined;
const browserCommandQueue: BrowserCommand[] = [];
const browserCommandWaiters = new Map<string, { resolve: (value: BrowserCommandCompletion) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
const DEFAULT_ALLOWED_HOSTS = [
	'security.microsoft.com',
	'security.microsoft365.com',
	'entra.microsoft.com',
	'portal.azure.com',
	'*.microsoft.com'
];

export async function activate(context: vscode.ExtensionContext) {
	output = vscode.window.createOutputChannel('Owen Browser Bridge');
	context.subscriptions.push(output);

	context.subscriptions.push(
		vscode.commands.registerCommand('owen-browser-bridge.openSetupPage', async () => openSetupPage(context)),
		vscode.commands.registerCommand('owen-browser-bridge.startServer', async () => startServer(context, true)),
		vscode.commands.registerCommand('owen-browser-bridge.stopServer', async () => stopServer(true)),
		vscode.commands.registerCommand('owen-browser-bridge.showLatestCapture', async () => showLatestCapture(context)),
		vscode.commands.registerCommand('owen-browser-bridge.showActionTrace', async () => showActionTrace(context)),
		vscode.commands.registerCommand('owen-browser-bridge.openCapturesFolder', async () => openCapturesFolder(context)),
		vscode.commands.registerCommand('owen-browser-bridge.copyPairingToken', async () => copyPairingToken(context)),
		vscode.commands.registerCommand('owen-browser-bridge.regeneratePairingToken', async () => regeneratePairingToken(context)),
		vscode.lm.registerTool('get_latest_browser_capture', createLatestCaptureTool(context)),
		vscode.lm.registerTool('get_browser_state', createBrowserStateTool(context)),
		vscode.lm.registerTool('read_browser_capture', createReadCaptureTool(context)),
		vscode.lm.registerTool('read_browser_capture_group', createReadCaptureGroupTool(context)),
		vscode.lm.registerTool('browser_act', createBrowserActTool(context))
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

	if (request.url === '/commands/next' && request.method === 'GET') {
		if (!await isAuthorized(context, request)) {
			writeJson(response, 401, { error: 'unauthorized' });
			return;
		}

		writeJson(response, 200, { command: browserCommandQueue.shift() ?? null });
		return;
	}

	if (request.url === '/commands/result' && request.method === 'POST') {
		if (!await isAuthorized(context, request)) {
			writeJson(response, 401, { error: 'unauthorized' });
			return;
		}

		const completion = await completeBrowserCommand(context, JSON.parse(await readBody(request)) as BrowserCommandResult);
		writeJson(response, 200, { ok: true, storedCapture: completion.storedCapture });
		return;
	}

	if (request.url === '/commands/enqueue' && request.method === 'POST') {
		if (!await isAuthorized(context, request)) {
			writeJson(response, 401, { error: 'unauthorized' });
			return;
		}

		try {
			const input = JSON.parse(await readBody(request)) as BrowserActInput;
			const { command, completion } = await invokeBrowserAction(context, input);
			writeJson(response, 200, { ok: true, command, completion });
		} catch (error) {
			writeJson(response, 400, { error: String(error instanceof Error ? error.message : error) });
		}
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
	const pageUrl = parseUrl(payload.page?.url);
	const host = pageUrl?.hostname.toLowerCase() ?? 'unknown-host';
	const groupName = getCaptureGroupName(payload, pageUrl, collectedAt);
	const folder = path.join(baseDir, sanitizePathSegment(host), sanitizePathSegment(groupName));
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
	const stored = {
		id,
		folder,
		host,
		groupName,
		jsonPath,
		markdownPath,
		screenshotPath,
		url: redactedPayload.page?.url,
		title: redactedPayload.page?.title,
		collectedAt
	};
	await updateCaptureGroupFiles(folder, stored);
	await updateLatestBrowserState(context, redactedPayload.browserSession, stored);
	output.appendLine(`Stored capture ${id}: ${markdownPath}`);

	return stored;
}

async function showLatestCapture(context: vscode.ExtensionContext) {
	const latest = context.globalState.get<StoredCapture>('latestCapture');
	if (!latest) {
		vscode.window.showInformationMessage('No browser capture has been received yet.');
		return;
	}

	await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(latest.markdownPath));
}

async function showActionTrace(context: vscode.ExtensionContext) {
	const baseDir = await getCaptureBaseDir(context);
	const logDir = path.join(baseDir, '_action-logs');
	const entries = await fs.readdir(logDir, { withFileTypes: true }).catch(() => []);
	const latestLog = entries
		.filter(entry => entry.isFile() && entry.name.startsWith('browser-actions-') && entry.name.endsWith('.jsonl'))
		.map(entry => path.join(logDir, entry.name))
		.sort()
		.reverse()[0];

	if (!latestLog) {
		vscode.window.showInformationMessage('No browser action trace log exists yet.');
		return;
	}

	const lines = (await fs.readFile(latestLog, 'utf8'))
		.split(/\r?\n/)
		.filter(Boolean)
		.slice(-25)
		.map(line => JSON.parse(line) as Record<string, unknown>);
	const markdown = renderActionTraceMarkdown(latestLog, lines);
	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: true });
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

function createBrowserStateTool(context: vscode.ExtensionContext): vscode.LanguageModelTool<object> {
	return {
		async invoke() {
			const state = context.globalState.get<BrowserSessionState>('latestBrowserState');
			if (!state) {
				return new vscode.LanguageModelToolResult([
					vscode.LanguageModelDataPart.text('No browser state has been captured yet. Use #browserAct with readPage or capture first.', 'text/plain')
				]);
			}

			return new vscode.LanguageModelToolResult([
				vscode.LanguageModelDataPart.json(state),
				vscode.LanguageModelDataPart.text(renderBrowserStateMessage(state), 'text/plain')
			]);
		},
		prepareInvocation() {
			return { invocationMessage: 'Reading the latest Owen Browser Bridge browser state' };
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

function createReadCaptureGroupTool(context: vscode.ExtensionContext): vscode.LanguageModelTool<{ group?: string }> {
	return {
		async invoke(options) {
			const group = options.input.group?.trim();
			const summary = await resolveCaptureGroup(context, group);
			return captureGroupToolResult(summary);
		},
		prepareInvocation(options) {
			return { invocationMessage: `Reading browser capture group ${options.input.group ?? 'latest'}` };
		}
	};
}

function createBrowserActTool(context: vscode.ExtensionContext): vscode.LanguageModelTool<BrowserActInput> {
	return {
		async invoke(options) {
			const { command, completion } = await invokeBrowserAction(context, options.input);
			return new vscode.LanguageModelToolResult([
				vscode.LanguageModelDataPart.json({ command, completion }),
				vscode.LanguageModelDataPart.text(renderBrowserActMessage(command, completion), 'text/plain')
			]);
		},
		prepareInvocation(options) {
			return { invocationMessage: `Controlling paired browser: ${options.input.action ?? 'readPage'}` };
		}
	};
}

async function invokeBrowserAction(context: vscode.ExtensionContext, input: BrowserActInput) {
	const resumeRequested = (input.action as BrowserAction | undefined) === 'resumeAfterAuth';
	const command = resumeRequested
		? createResumeBrowserCommand(context)
		: createBrowserCommand(input);
	const completion = await enqueueBrowserCommand(command);
	const authRequired = parseAuthRequiredResult(completion.result);
	if (authRequired?.authRequired && authRequired.resumeInput) {
		await context.globalState.update('pendingAuthResumeInput', authRequired.resumeInput);
	}

	return { command, completion };
}

const SUPPORTED_BROWSER_ACTIONS: BrowserAction[] = [
	'readPage', 'capture', 'click', 'type', 'navigate', 'waitForText', 'wait', 'waitPreset', 'scroll', 'hover', 'keyPress',
	'selectOption', 'clearInput', 'back', 'forward', 'reload', 'openInNewTab', 'switchTab', 'closeTab',
	'listInteractables', 'inspectTargets', 'captureElement', 'captureRegion', 'journeyCapture', 'paginateCapture', 'smartFormFill', 'conditionalWorkflow',
	'multiTabCrawl', 'runtimeSnapshot', 'domDiffTimeline', 'ocrSnapshot', 'dataGapGuard', 'exportReplay',
	'networkTraceCapture', 'safeDownloadAndHash', 'tableExtract', 'stateCheckpoint', 'rollbackToCheckpoint',
	'humanReviewGate', 'bulkActionFromList', 'semanticWait', 'compareCaptureRuns', 'policyGuard', 'visualAssert', 'accessibilitySnapshot', 'mapForm',
	'watchPageChanges', 'highlightEvidence', 'planAndRun', 'evidenceClaimCheck', 'tableWatchAndDiff', 'browserRunBundle', 'safeActionPreview', 'stableTargetProfile', 'guidedDrilldown', 'evidenceCompletenessCheck',
	'failureExplainer', 'waitProfiler', 'automationHealthScore', 'sensitiveActionGuard', 'tabOrchestrator', 'popupGuard', 'returnToTab', 'tabRunSummary', 'buildEvidencePack', 'buildNavigationGraph', 'assertPageContract', 'createHandoff', 'selectorHealthReport',
	'captureReviewQueue', 'startBrowserJob', 'getBrowserJob', 'cancelBrowserJob', 'recordWorkflow', 'replayWorkflow', 'runScenarioTemplate',
	'resumeAfterAuth', 'runWorkflow'
];

const DESTRUCTIVE_BROWSER_ACTIONS: BrowserAction[] = ['closeTab'];

function createBrowserCommand(input: BrowserActInput): BrowserCommand {
	const action = (input.action ?? 'readPage') as BrowserAction;
	const timeoutMs = clampTimeout(input.timeoutMs);
	const retryProfile = clampRetryProfile(input.retryProfile);
	const retries = resolveRetries(input.retries, retryProfile);
	const allowedHosts = getConfig().get<string[]>('allowedHosts', []);
	const presetSteps = expandPreset(input.preset);
	const workflowSteps = normalizeSteps(input.steps);

	if (!SUPPORTED_BROWSER_ACTIONS.includes(action)) {
		throw new Error(`Unsupported browser action: ${String(action)}`);
	}

	validateBrowserStep({ ...input, action }, allowedHosts, true);
	for (const step of workflowSteps) {
		validateBrowserStep(step, allowedHosts, false);
	}
	for (const step of presetSteps) {
		validateBrowserStep(step, allowedHosts, false);
	}

	if (action === 'runWorkflow' && presetSteps.length === 0 && workflowSteps.length === 0) {
		throw new Error('browserAct runWorkflow requires preset or steps.');
	}

	if (action === 'resumeAfterAuth') {
		throw new Error('browserAct resumeAfterAuth must be invoked without additional inputs.');
	}

	return {
		id: `command-${formatTimestamp(new Date().toISOString())}-${crypto.randomBytes(3).toString('hex')}`,
		action,
		createdAt: new Date().toISOString(),
		selector: input.selector,
		text: input.text,
		value: input.value,
		url: input.url,
		urls: sanitizeStringList(input.urls),
		formFields: sanitizeSelectorMap(input.formFields),
		submitSelector: input.submitSelector,
		submitText: input.submitText,
		conditions: Array.isArray(input.conditions) ? input.conditions.slice(0, 20) : undefined,
		linkSelector: input.linkSelector,
		linkText: input.linkText,
		key: input.key,
		role: input.role,
		label: input.label,
		index: input.index,
		maxPages: clampMaxPages(input.maxPages),
		maxTabs: clampMaxTabs(input.maxTabs),
		requiredFields: sanitizeStringList(input.requiredFields),
		requiredTexts: sanitizeStringList(input.requiredTexts),
		acknowledgement: input.acknowledgement,
		nextSelector: input.nextSelector,
		nextText: input.nextText,
		extractSelectors: sanitizeSelectorMap(input.extractSelectors),
		waitAfterNavigateMs: clampWaitAfterNavigateMs(input.waitAfterNavigateMs),
		direction: input.direction,
		delta: input.delta,
		options: Array.isArray(input.options) ? input.options.filter(Boolean) : undefined,
		urlIncludes: sanitizeStringList(input.urlIncludes),
		durationMs: clampDurationMs(input.durationMs),
		maxEntries: clampMaxEntries(input.maxEntries),
		tableSelector: input.tableSelector,
		headerMode: input.headerMode,
		outputFormat: input.outputFormat,
		checkpointName: input.checkpointName,
		includeFormState: input.includeFormState ?? true,
		strictUrlMatch: input.strictUrlMatch ?? false,
		reviewPrompt: input.reviewPrompt,
		approvalKeyword: input.approvalKeyword,
		itemSelector: input.itemSelector,
		matchText: input.matchText,
		matchMode: input.matchMode,
		actionTemplate: input.actionTemplate,
		maxItems: clampMaxItems(input.maxItems),
		semanticConditions: sanitizeStringList(input.semanticConditions),
		baseRunId: input.baseRunId,
		newRunId: input.newRunId,
		ignoreSelectors: sanitizeStringList(input.ignoreSelectors),
		policyProfile: input.policyProfile,
		onViolation: input.onViolation === 'warn' ? 'warn' : 'block',
		wait: input.wait,
		retries,
		retryProfile,
		fallbackSelectors: sanitizeStringList(input.fallbackSelectors),
		fallbackTexts: sanitizeStringList(input.fallbackTexts),
		autoHeal: Boolean(input.autoHeal || input.targetHint),
		targetHint: input.targetHint,
		targetScope: clampTargetScope(input.targetScope),
		frameDepth: clampFrameDepth(input.frameDepth),
		regionX: clampRegionCoordinate(input.regionX),
		regionY: clampRegionCoordinate(input.regionY),
		regionWidth: clampRegionSize(input.regionWidth),
		regionHeight: clampRegionSize(input.regionHeight),
		regionPadding: clampRegionPadding(input.regionPadding),
		targetTabIndex: input.targetTabIndex,
		confirmDangerous: Boolean(input.confirmDangerous),
		steps: [...presetSteps, ...workflowSteps],
		preset: input.preset,
		timeoutMs,
		captureAfter: input.captureAfter ?? (action !== 'listInteractables' && action !== 'inspectTargets'),
		includeScreenshot: input.includeScreenshot ?? true,
		includeHtml: input.includeHtml ?? false,
		captureBeforeAfter: Boolean(input.captureBeforeAfter),
		macroName: sanitizeMacroName(input.macroName),
		params: sanitizeTemplateParams(input.params),
		scenarioName: sanitizeScenarioName(input.scenarioName),
		scenarioTemplates: sanitizeJsonObject(input.scenarioTemplates, 4),
		assertText: input.assertText,
		assertNoText: input.assertNoText,
		assertSelector: input.assertSelector,
		assertNotSelector: input.assertNotSelector,
		assertScreenshotChanged: Boolean(input.assertScreenshotChanged),
		selectorMemory: input.selectorMemory ?? true,
		watchDurationMs: clampWatchDurationMs(input.watchDurationMs),
		highlightSelectors: sanitizeStringList(input.highlightSelectors),
		highlightText: input.highlightText,
		goal: input.goal,
		claim: input.claim,
		requiredClaims: sanitizeStringList(input.requiredClaims),
		keyColumns: sanitizeStringList(input.keyColumns),
		waitCandidates: sanitizeStringList(input.waitCandidates),
		detailSelector: input.detailSelector,
		waitPreset: input.waitPreset,
		contractName: input.contractName,
		contractSelectors: sanitizeStringList(input.contractSelectors),
		contractTexts: sanitizeStringList(input.contractTexts),
		captureGroup: input.captureGroup,
		jobName: input.jobName,
		tabRoles: sanitizeStringArrayMap(input.tabRoles),
		expectedTabs: clampExpectedTabs(input.expectedTabs),
		returnToRole: input.returnToRole,
		closeExtraTabs: Boolean(input.closeExtraTabs),
		onUnexpectedTab: input.onUnexpectedTab === 'warn' || input.onUnexpectedTab === 'block' ? input.onUnexpectedTab : 'capture',
		investigationName: input.investigationName,
		allowedHosts
	};
}

function normalizeSteps(steps: BrowserStepInput[] | undefined) {
	if (!Array.isArray(steps)) {
		return [];
	}

	return steps
		.map(step => ({ ...step, action: (step.action ?? 'readPage') as BrowserAction }))
		.slice(0, 40);
}

function sanitizeStringList(values: string[] | undefined) {
	if (!Array.isArray(values)) {
		return [];
	}

	return values.map(item => item.trim()).filter(Boolean).slice(0, 10);
}

function sanitizeSelectorMap(values: Record<string, string> | undefined) {
	if (!values || typeof values !== 'object') {
		return undefined;
	}

	const entries = Object.entries(values)
		.filter(([key, value]) => key.trim().length > 0 && typeof value === 'string' && value.trim().length > 0)
		.slice(0, 20)
		.map(([key, value]) => [key.trim(), value.trim()] as const);

	if (entries.length === 0) {
		return undefined;
	}

	return Object.fromEntries(entries);
}

function sanitizeTemplateParams(values: Record<string, unknown> | undefined) {
	return sanitizeJsonObject(values, 4);
}

function sanitizeScenarioName(value: string | undefined) {
	const name = typeof value === 'string' ? value.trim() : '';
	return name.length > 0 ? name.slice(0, 120) : undefined;
}

function sanitizeJsonObject(values: Record<string, unknown> | undefined, depth: number): Record<string, unknown> | undefined {
	if (!values || typeof values !== 'object' || Array.isArray(values) || depth < 0) {
		return undefined;
	}

	const entries = Object.entries(values)
		.filter(([key]) => key.trim().length > 0)
		.slice(0, 50)
		.map(([key, value]) => [key.trim(), sanitizeJsonValue(value, depth)] as const)
		.filter(([, value]) => value !== undefined);

	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeJsonValue(value: unknown, depth: number): unknown {
	if (typeof value === 'string') {
		return value.slice(0, 4000);
	}

	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined;
	}

	if (typeof value === 'boolean' || value === null) {
		return value;
	}

	if (Array.isArray(value)) {
		if (depth <= 0) {
			return undefined;
		}
		const items = value.slice(0, 50).map(item => sanitizeJsonValue(item, depth - 1)).filter(item => item !== undefined);
		return items.length > 0 ? items : [];
	}

	if (value && typeof value === 'object') {
		if (depth <= 0) {
			return undefined;
		}
		return sanitizeJsonObject(value as Record<string, unknown>, depth - 1);
	}

	return undefined;
}

function sanitizeStringArrayMap(values: Record<string, string[]> | undefined) {
	if (!values || typeof values !== 'object') {
		return {};
	}

	const entries = Object.entries(values)
		.filter(([key, value]) => key.trim().length > 0 && Array.isArray(value))
		.slice(0, 20)
		.map(([key, value]) => [key.trim(), sanitizeStringList(value).slice(0, 20)] as const)
		.filter(([, value]) => value.length > 0);

	return Object.fromEntries(entries);
}

function expandPreset(preset: BrowserPreset | undefined): BrowserStepInput[] {
	if (!preset) {
		return [];
	}

	if (preset === 'defenderIncidentSurvey') {
		return [
			{ action: 'wait', wait: { kind: 'element', selector: '[role="tab"]' } },
			{ action: 'click', text: 'Overview' },
			{ action: 'wait', wait: { kind: 'text', text: 'Overview' } },
			{ action: 'capture' }
		];
	}

	if (preset === 'defenderIncidentAlerts') {
		return [
			{ action: 'wait', wait: { kind: 'element', selector: '[role="tab"]' } },
			{ action: 'click', text: 'Alerts' },
			{ action: 'wait', wait: { kind: 'urlMatch', urlPattern: '/alerts' } },
			{ action: 'capture' }
		];
	}

	return [
		{ action: 'wait', wait: { kind: 'element', selector: '[role="tab"]' } },
		{ action: 'click', text: 'Evidence' },
		{ action: 'wait', wait: { kind: 'urlMatch', urlPattern: '/evidence' } },
		{ action: 'capture' }
	];
}

function validateBrowserStep(step: BrowserStepInput, allowedHosts: string[], topLevel: boolean) {
	const action = (step.action ?? 'readPage') as BrowserAction;
	if (!SUPPORTED_BROWSER_ACTIONS.includes(action)) {
		throw new Error(`Unsupported browser action: ${String(action)}`);
	}

	if (DESTRUCTIVE_BROWSER_ACTIONS.includes(action) && !step.confirmDangerous) {
		throw new Error(`browserAct ${action} requires confirmDangerous=true.`);
	}

	if (action === 'navigate' || action === 'openInNewTab') {
		const pageUrl = parseUrl(step.url);
		if (!pageUrl) {
			throw new Error(`browserAct ${action} requires a valid url.`);
		}
		if (allowedHosts.length > 0 && !isAllowedHost(pageUrl.hostname, allowedHosts)) {
			throw new Error(`Navigation host is not allowed: ${pageUrl.hostname}`);
		}
	}

	if ((action === 'click' || action === 'hover') && !step.selector && !step.text && !step.label && !step.targetHint) {
		throw new Error(`browserAct ${action} requires selector, text, or label.`);
	}

	if (action === 'type' && typeof step.value !== 'string') {
		throw new Error('browserAct type requires value.');
	}

	if (action === 'type' && !step.selector && !step.text && !step.label && !step.targetHint) {
		throw new Error('browserAct type requires selector, text, or label.');
	}

	if (action === 'waitForText' && !step.text) {
		throw new Error('browserAct waitForText requires text.');
	}

	if (action === 'captureElement' && !step.selector && !step.text && !step.label && !step.targetHint) {
		throw new Error('browserAct captureElement requires selector, text, label, or targetHint.');
	}

	if (action === 'captureRegion') {
		if (typeof step.regionX !== 'number' || typeof step.regionY !== 'number') {
			throw new Error('browserAct captureRegion requires regionX and regionY.');
		}
		if (typeof step.regionWidth !== 'number' || typeof step.regionHeight !== 'number') {
			throw new Error('browserAct captureRegion requires regionWidth and regionHeight.');
		}
	}

	if (action === 'wait' && !step.wait?.kind) {
		throw new Error('browserAct wait requires wait.kind.');
	}

	if (action === 'waitPreset' && !step.waitPreset) {
		throw new Error('browserAct waitPreset requires waitPreset.');
	}

	if (action === 'wait' && step.wait?.kind === 'requestDone' && (!Array.isArray(step.wait.urlIncludes) || step.wait.urlIncludes.length === 0)) {
		throw new Error('browserAct wait requestDone requires wait.urlIncludes.');
	}

	if (action === 'runWorkflow' && !topLevel) {
		throw new Error('runWorkflow can only be used as the top-level action.');
	}

	if (action === 'resumeAfterAuth') {
		throw new Error('resumeAfterAuth can only be used as a top-level action.');
	}

	if (action === 'recordWorkflow' && (!step.macroName || (!Array.isArray(step.steps) || step.steps.length === 0))) {
		throw new Error('browserAct recordWorkflow requires macroName and steps.');
	}

	if (action === 'replayWorkflow' && !step.macroName) {
		throw new Error('browserAct replayWorkflow requires macroName.');
	}

	if (action === 'runScenarioTemplate') {
		if (!topLevel) {
			throw new Error('runScenarioTemplate can only be used as the top-level action.');
		}
		if (!step.scenarioName) {
			throw new Error('browserAct runScenarioTemplate requires scenarioName.');
		}
	}

	if (action === 'journeyCapture') {
		if (!Array.isArray(step.urls) || step.urls.length === 0) {
			throw new Error('browserAct journeyCapture requires urls.');
		}

		for (const targetUrl of step.urls) {
			const pageUrl = parseUrl(targetUrl);
			if (!pageUrl) {
				throw new Error(`browserAct journeyCapture requires valid urls. Invalid: ${targetUrl}`);
			}
			if (allowedHosts.length > 0 && !isAllowedHost(pageUrl.hostname, allowedHosts)) {
				throw new Error(`Navigation host is not allowed: ${pageUrl.hostname}`);
			}
		}
	}

	if (action === 'paginateCapture') {
		if (!step.nextSelector && !step.nextText) {
			throw new Error('browserAct paginateCapture requires nextSelector or nextText.');
		}
	}

	if (action === 'smartFormFill' && !step.formFields) {
		throw new Error('browserAct smartFormFill requires formFields.');
	}

	if (action === 'conditionalWorkflow' && (!Array.isArray(step.conditions) || step.conditions.length === 0)) {
		throw new Error('browserAct conditionalWorkflow requires conditions.');
	}

	if (action === 'multiTabCrawl' && !step.linkSelector && !step.linkText) {
		throw new Error('browserAct multiTabCrawl requires linkSelector or linkText.');
	}

	if (action === 'safeDownloadAndHash' && !step.selector && !step.text && !step.label && !step.url) {
		throw new Error('browserAct safeDownloadAndHash requires selector, text, label, or url.');
	}

	if ((action === 'stateCheckpoint' || action === 'rollbackToCheckpoint') && !step.checkpointName) {
		throw new Error(`browserAct ${action} requires checkpointName.`);
	}

	if (action === 'humanReviewGate' && !step.approvalKeyword) {
		throw new Error('browserAct humanReviewGate requires approvalKeyword.');
	}

	if (action === 'bulkActionFromList' && (!step.itemSelector || !step.actionTemplate?.action)) {
		throw new Error('browserAct bulkActionFromList requires itemSelector and actionTemplate.action.');
	}

	if (action === 'semanticWait' && (!Array.isArray(step.semanticConditions) || step.semanticConditions.length === 0)) {
		throw new Error('browserAct semanticWait requires semanticConditions.');
	}

	if (action === 'policyGuard' && !step.policyProfile) {
		throw new Error('browserAct policyGuard requires policyProfile.');
	}

	if (action === 'visualAssert' && !step.assertText && !step.assertNoText && !step.assertSelector && !step.assertNotSelector && !step.assertScreenshotChanged) {
		throw new Error('browserAct visualAssert requires at least one assertion input.');
	}

	if (action === 'highlightEvidence' && !step.selector && !step.text && !step.targetHint && (!Array.isArray(step.highlightSelectors) || step.highlightSelectors.length === 0) && !step.highlightText) {
		throw new Error('browserAct highlightEvidence requires selector, text, targetHint, highlightSelectors, or highlightText.');
	}

	if (action === 'planAndRun' && !step.goal && (!Array.isArray(step.steps) || step.steps.length === 0)) {
		throw new Error('browserAct planAndRun requires goal or steps.');
	}

	if (action === 'evidenceClaimCheck' && !step.claim) {
		throw new Error('browserAct evidenceClaimCheck requires claim.');
	}

	if (action === 'safeActionPreview' && !step.actionTemplate?.action && !step.selector && !step.text && !step.label && !step.targetHint) {
		throw new Error('browserAct safeActionPreview requires actionTemplate.action, selector, text, label, or targetHint.');
	}

	if (action === 'stableTargetProfile' && !step.selector && !step.text && !step.label && !step.targetHint) {
		throw new Error('browserAct stableTargetProfile requires selector, text, label, or targetHint.');
	}

	if (action === 'guidedDrilldown' && !step.tableSelector && !step.itemSelector) {
		throw new Error('browserAct guidedDrilldown requires tableSelector or itemSelector.');
	}

	if (action === 'evidenceCompletenessCheck' && !step.captureGroup && !step.investigationName && (!Array.isArray(step.requiredClaims) || step.requiredClaims.length === 0)) {
		throw new Error('browserAct evidenceCompletenessCheck requires captureGroup, investigationName, or requiredClaims.');
	}

	if (action === 'sensitiveActionGuard' && !step.actionTemplate?.action && !step.selector && !step.text && !step.label && !step.targetHint) {
		throw new Error('browserAct sensitiveActionGuard requires actionTemplate.action, selector, text, label, or targetHint.');
	}

	if (action === 'returnToTab' && !step.returnToRole && !Number.isInteger(step.targetTabIndex)) {
		throw new Error('browserAct returnToTab requires returnToRole or targetTabIndex.');
	}

	if (action === 'tabOrchestrator' && step.closeExtraTabs && !step.confirmDangerous) {
		throw new Error('browserAct tabOrchestrator closeExtraTabs requires confirmDangerous=true.');
	}

	if (action === 'buildEvidencePack' && !step.captureGroup && !step.investigationName) {
		throw new Error('browserAct buildEvidencePack requires captureGroup or investigationName.');
	}

	if (action === 'browserRunBundle' && !step.captureGroup && !step.investigationName) {
		throw new Error('browserAct browserRunBundle requires captureGroup or investigationName.');
	}

	if (action === 'assertPageContract' && !step.contractName && (!Array.isArray(step.contractSelectors) || step.contractSelectors.length === 0) && (!Array.isArray(step.contractTexts) || step.contractTexts.length === 0)) {
		throw new Error('browserAct assertPageContract requires contractName, contractSelectors, or contractTexts.');
	}

	if ((action === 'startBrowserJob' || action === 'getBrowserJob' || action === 'cancelBrowserJob') && !step.jobName) {
		throw new Error(`browserAct ${action} requires jobName.`);
	}

	if (step.targetScope && !['auto', 'main', 'allFrames', 'shadowDeep'].includes(step.targetScope)) {
		throw new Error('browserAct targetScope must be one of auto, main, allFrames, shadowDeep.');
	}

	const highRiskActions: BrowserAction[] = ['navigate', 'openInNewTab', 'closeTab', 'journeyCapture', 'paginateCapture', 'multiTabCrawl'];
	if (highRiskActions.includes(action) && step.acknowledgement && step.acknowledgement !== 'CONFIRM_BROWSER_ACTION') {
		throw new Error('Invalid acknowledgement value. Use CONFIRM_BROWSER_ACTION.');
	}
}

function enqueueBrowserCommand(command: BrowserCommand) {
	browserCommandQueue.push(command);
	output.appendLine(`Queued browser command ${command.id}: ${command.action} (queue: ${browserCommandQueue.length})`);
	return new Promise<BrowserCommandCompletion>((resolve, reject) => {
		const timeout = setTimeout(() => {
			browserCommandWaiters.delete(command.id);
			reject(new Error(`Timed out waiting for paired browser command result: ${command.id}`));
		}, command.timeoutMs + 35000);
		browserCommandWaiters.set(command.id, { resolve, reject, timeout });
	});
}

async function completeBrowserCommand(context: vscode.ExtensionContext, completion: BrowserCommandResult): Promise<BrowserCommandCompletion> {
	if (!completion.id) {
		throw new Error('Browser command result is missing id.');
	}

	const waiter = browserCommandWaiters.get(completion.id);
	if (!waiter) {
		await appendBrowserActionLog(context, completion.id, completion, undefined);
		return completion;
	}

	let storedCapture: StoredCapture | undefined;
	if (completion.capture) {
		storedCapture = await storeCapture(context, completion.capture);
		await context.globalState.update('latestCapture', storedCapture);
	}
	await updateLatestBrowserState(context, extractBrowserSessionState(completion), storedCapture);

	const result = { ...completion, storedCapture };
	await appendBrowserActionLog(context, completion.id, completion, storedCapture);
	await writeBrowserCommandArtifacts(context, result).catch(error => {
		output.appendLine(`Browser artifact generation failed: ${String(error)}`);
	});
	clearTimeout(waiter.timeout);
	browserCommandWaiters.delete(completion.id);
	if (completion.ok === false && completion.error !== 'AUTH_REQUIRED' && completion.error !== 'REVIEW_REQUIRED') {
		waiter.reject(new Error(completion.error ?? `Browser command failed: ${completion.id}`));
	} else {
		waiter.resolve(result);
	}

	return result;
}

async function writeBrowserCommandArtifacts(context: vscode.ExtensionContext, completion: BrowserCommandCompletion) {
	const result = completion.result as { action?: string; steps?: Array<{ result?: Record<string, unknown> }> } | undefined;
	const action = result?.action;
	if (!action || !result?.steps?.[0]?.result) {
		return;
	}

	const stepResult = result.steps[0].result;
	if (action === 'buildEvidencePack') {
		await writeEvidencePack(context, stepResult, completion);
		return;
	}

	if (action === 'buildNavigationGraph') {
		await writeNavigationGraph(context, stepResult);
		return;
	}

	if (action === 'createHandoff' || action === 'captureReviewQueue' || action === 'selectorHealthReport') {
		await writeBrowserReportArtifact(context, action, stepResult);
		return;
	}

	if (action === 'browserRunBundle') {
		await writeBrowserRunBundle(context, stepResult, completion);
		return;
	}

	if (action === 'evidenceCompletenessCheck') {
		await writeEvidenceCompletenessReport(context, stepResult);
	}
}

function extractBrowserSessionState(completion: BrowserCommandResult): BrowserSessionState | undefined {
	if (completion.capture?.browserSession) {
		return completion.capture.browserSession;
	}

	const result = completion.result;
	if (!result || typeof result !== 'object') {
		return undefined;
	}

	const browserSession = (result as { browserSession?: BrowserSessionState }).browserSession;
	return browserSession && typeof browserSession === 'object' ? browserSession : undefined;
}

async function updateLatestBrowserState(context: vscode.ExtensionContext, state: BrowserSessionState | undefined, storedCapture: StoredCapture | undefined) {
	if (!state && !storedCapture) {
		return;
	}

	const latest = context.globalState.get<BrowserSessionState>('latestBrowserState') ?? {};
	const next: BrowserSessionState = {
		...latest,
		...state,
		lastCaptureId: storedCapture?.id ?? state?.lastCaptureId ?? latest.lastCaptureId,
		lastMarkdownPath: storedCapture?.markdownPath ?? state?.lastMarkdownPath ?? latest.lastMarkdownPath,
		lastScreenshotPath: storedCapture?.screenshotPath ?? state?.lastScreenshotPath ?? latest.lastScreenshotPath,
		captureGroup: storedCapture?.groupName ?? state?.captureGroup ?? latest.captureGroup,
		url: storedCapture?.url ?? state?.url ?? latest.url,
		title: storedCapture?.title ?? state?.title ?? latest.title,
		updatedAt: state?.updatedAt ?? new Date().toISOString()
	};
	await context.globalState.update('latestBrowserState', next);
}

function clampTimeout(timeoutMs: number | undefined) {
	if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
		return 60000;
	}

	return Math.min(Math.max(Math.trunc(timeoutMs), 1000), 120000);
}

function clampRetries(retries: number | undefined) {
	if (typeof retries !== 'number' || !Number.isFinite(retries)) {
		return 1;
	}

	return Math.min(Math.max(Math.trunc(retries), 0), 3);
}

function clampRetryProfile(profile: BrowserStepInput['retryProfile']): 'conservative' | 'standard' | 'aggressive' {
	if (profile === 'conservative' || profile === 'aggressive') {
		return profile;
	}

	return 'standard';
}

function resolveRetries(retries: number | undefined, profile: 'conservative' | 'standard' | 'aggressive') {
	if (typeof retries === 'number' && Number.isFinite(retries)) {
		return clampRetries(retries);
	}

	if (profile === 'conservative') {
		return 0;
	}
 if (profile === 'aggressive') {
		return 3;
	}

	return 1;
}

function clampTargetScope(scope: BrowserStepInput['targetScope']) {
	if (scope === 'main' || scope === 'allFrames' || scope === 'shadowDeep') {
		return scope;
	}

	return 'auto';
}

function clampFrameDepth(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 2;
	}

	return Math.min(Math.max(Math.trunc(value), 0), 6);
}

function sanitizeMacroName(name: string | undefined) {
	if (typeof name !== 'string') {
		return undefined;
	}

	const sanitized = name.trim().slice(0, 64);
	return sanitized.length > 0 ? sanitized : undefined;
}

function clampMaxPages(maxPages: number | undefined) {
	if (typeof maxPages !== 'number' || !Number.isFinite(maxPages)) {
		return 5;
	}

	return Math.min(Math.max(Math.trunc(maxPages), 1), 30);
}

function clampWaitAfterNavigateMs(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 1200;
	}

	return Math.min(Math.max(Math.trunc(value), 200), 10000);
}

function clampMaxTabs(maxTabs: number | undefined) {
	if (typeof maxTabs !== 'number' || !Number.isFinite(maxTabs)) {
		return 5;
	}

	return Math.min(Math.max(Math.trunc(maxTabs), 1), 30);
}

function clampExpectedTabs(expectedTabs: number | undefined) {
	if (typeof expectedTabs !== 'number' || !Number.isFinite(expectedTabs)) {
		return undefined;
	}

	return Math.min(Math.max(Math.trunc(expectedTabs), 1), 50);
}

function clampDurationMs(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 10000;
	}

	return Math.min(Math.max(Math.trunc(value), 1000), 120000);
}

function clampWatchDurationMs(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 3000;
	}

	return Math.min(Math.max(Math.trunc(value), 500), 30000);
}

function clampMaxEntries(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 30;
	}

	return Math.min(Math.max(Math.trunc(value), 1), 200);
}

function clampMaxItems(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 20;
	}

	return Math.min(Math.max(Math.trunc(value), 1), 200);
}

function clampRegionCoordinate(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}

	return Math.min(Math.max(Math.trunc(value), -10000), 100000);
}

function clampRegionSize(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}

	return Math.min(Math.max(Math.trunc(value), 1), 100000);
}

function clampRegionPadding(value: number | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0;
	}

	return Math.min(Math.max(Math.trunc(value), 0), 200);
}

function renderBrowserActMessage(command: BrowserCommand, completion: BrowserCommandCompletion) {
	const authRequired = parseAuthRequiredResult(completion.result);
	if (completion.error === 'AUTH_REQUIRED' || authRequired?.authRequired) {
		const lines = [
			`Browser action paused for authentication: ${command.action}`,
			authRequired?.authUrl ? `Auth URL: ${authRequired.authUrl}` : undefined,
			authRequired?.visitedCount ? `Collected pages before pause: ${authRequired.visitedCount}` : undefined,
			'브라우저에서 인증을 완료한 뒤, 채팅에 "완료"라고 입력해 주세요.',
			'그 다음 Copilot이 #browserAct { "action": "resumeAfterAuth" } 호출로 이어서 진행합니다.'
		].filter(Boolean) as string[];
		return lines.join('\n');
	}

	const reviewRequired = parseReviewRequiredResult(completion.result);
	if (completion.error === 'REVIEW_REQUIRED' || reviewRequired?.reviewRequired) {
		const lines = [
			`Browser action paused for manual review: ${command.action}`,
			reviewRequired?.message ?? '승인 키워드 확인이 필요합니다.',
			reviewRequired?.approvalKeyword ? `승인 키워드: ${reviewRequired.approvalKeyword}` : undefined
		].filter(Boolean) as string[];
		return lines.join('\n');
	}

	const lines = [
		`Browser action completed: ${command.action}`,
		`Command: ${command.id}`
	];
	if (command.preset) {
		lines.push(`Preset: ${command.preset}`);
	}
	if (command.steps.length > 0) {
		lines.push(`Workflow steps: ${command.steps.length}`);
	}
	if (completion.storedCapture) {
		lines.push(`Stored capture: ${completion.storedCapture.markdownPath}`);
	}
	const browserSession = extractBrowserSessionState(completion);
	if (browserSession?.browserSessionId) {
		lines.push(`Browser session: ${browserSession.browserSessionId}`);
	}
	if (typeof browserSession?.tabIndex === 'number') {
		lines.push(`Active tab: ${browserSession.tabIndex} · ${browserSession.title ?? browserSession.url ?? 'Untitled'}`);
	}
	if (completion.result) {
		lines.push(`Result: ${JSON.stringify(completion.result).slice(0, 4000)}`);
	}
	return lines.join('\n');
}

function renderBrowserStateMessage(state: BrowserSessionState) {
	const summary = state.screenSummary;
	const counts = summary?.counts as Record<string, unknown> | undefined;
	const lines = [
		`Browser state: ${state.browserSessionId ?? 'unknown session'}`,
		state.title ? `Title: ${state.title}` : undefined,
		state.url ? `URL: ${state.url}` : undefined,
		typeof state.tabIndex === 'number' ? `Tab index: ${state.tabIndex}` : undefined,
		state.lastAction ? `Last action: ${state.lastAction}` : undefined,
		state.captureGroup ? `Capture group: ${state.captureGroup}` : undefined,
		state.lastMarkdownPath ? `Latest capture: ${state.lastMarkdownPath}` : undefined,
		state.lastScreenshotPath ? `Latest screenshot: ${state.lastScreenshotPath}` : undefined,
		counts ? `Screen counts: ${JSON.stringify(counts)}` : undefined,
		summary ? 'Use screenSummary.interactables, formFields, headings, landmarks, tables, and viewport to decide the next browser action.' : undefined
	].filter(Boolean) as string[];
	return lines.join('\n');
}

function renderActionTraceMarkdown(logPath: string, entries: Record<string, unknown>[]) {
	const lines = [
		'# Owen Browser Action Trace',
		'',
		`Log: ${logPath}`,
		'',
		'| Time | Command | OK | Action | Notes |',
		'| --- | --- | --- | --- | --- |'
	];

	for (const entry of entries) {
		const result = entry.result as Record<string, unknown> | undefined;
		const steps = Array.isArray(result?.steps) ? result.steps : [];
		const firstStep = steps[0] as Record<string, unknown> | undefined;
		const action = String(result?.action ?? firstStep?.action ?? 'unknown');
		const notes = summarizeTraceEntry(entry);
		lines.push(`| ${escapeMarkdownTable(String(entry.loggedAt ?? ''))} | ${escapeMarkdownTable(String(entry.commandId ?? ''))} | ${entry.ok === false ? 'no' : 'yes'} | ${escapeMarkdownTable(action)} | ${escapeMarkdownTable(notes)} |`);
	}

	return `${lines.join('\n')}\n`;
}

function summarizeTraceEntry(entry: Record<string, unknown>) {
	if (entry.error) {
		return String(entry.error);
	}

	const result = entry.result as Record<string, unknown> | undefined;
	const steps = Array.isArray(result?.steps) ? result.steps : [];
	const beforeAfterDiff = result?.beforeAfterDiff ? `diff=${JSON.stringify(result.beforeAfterDiff).slice(0, 160)}` : undefined;
	const storedCapture = entry.storedCapture as Record<string, unknown> | undefined;
	return [
		steps.length > 0 ? `steps=${steps.length}` : undefined,
		beforeAfterDiff,
		storedCapture?.markdownPath ? `capture=${storedCapture.markdownPath}` : undefined
	].filter(Boolean).join('; ') || 'completed';
}

function escapeMarkdownTable(value: string) {
	return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 500);
}

function parseAuthRequiredResult(result: unknown): AuthRequiredResult | undefined {
	if (!result || typeof result !== 'object') {
		return undefined;
	}

	const candidate = result as AuthRequiredResult;
	return candidate.authRequired ? candidate : undefined;
}

function parseReviewRequiredResult(result: unknown): ReviewRequiredResult | undefined {
	if (!result || typeof result !== 'object') {
		return undefined;
	}

	const candidate = result as ReviewRequiredResult;
	return candidate.reviewRequired ? candidate : undefined;
}

function createResumeBrowserCommand(context: vscode.ExtensionContext): BrowserCommand {
	const resumeInput = context.globalState.get<BrowserActInput>('pendingAuthResumeInput');
	if (!resumeInput) {
		throw new Error('No pending auth-resume command exists. Start a browserAct action first.');
	}

	return createBrowserCommand(resumeInput);
}

async function appendBrowserActionLog(context: vscode.ExtensionContext, commandId: string, completion: BrowserCommandResult, storedCapture: StoredCapture | undefined) {
	const baseDir = await getCaptureBaseDir(context);
	const logDir = path.join(baseDir, '_action-logs');
	await fs.mkdir(logDir, { recursive: true });
	const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	const line = JSON.stringify({
		loggedAt: new Date().toISOString(),
		commandId,
		ok: completion.ok !== false,
		error: completion.error,
		result: completion.result,
		storedCapture: storedCapture ? {
			id: storedCapture.id,
			groupName: storedCapture.groupName,
			url: storedCapture.url,
			markdownPath: storedCapture.markdownPath
		} : undefined
	});
	await fs.appendFile(path.join(logDir, `browser-actions-${day}.jsonl`), `${line}\n`, 'utf8');
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

async function captureGroupToolResult(summary: CaptureGroupSummary) {
	const captures = [];
	for (const capture of summary.captures) {
		captures.push({
			metadata: capture,
			markdown: await fs.readFile(capture.markdownPath, 'utf8').catch(() => ''),
			json: await fs.readFile(capture.jsonPath, 'utf8').then(text => JSON.parse(text)).catch(() => undefined)
		});
	}

	const summaryMarkdown = await fs.readFile(path.join(summary.folder, '_summary.md'), 'utf8').catch(() => renderCaptureGroupMarkdown(summary));
	return new vscode.LanguageModelToolResult([
		vscode.LanguageModelDataPart.json(summary),
		vscode.LanguageModelDataPart.text(summaryMarkdown, 'text/markdown'),
		vscode.LanguageModelDataPart.json(captures),
		vscode.LanguageModelDataPart.text('Analyze these browser captures as one related investigation. Correlate URLs, timestamps, entities, visible evidence, screenshots, missing context, risk, and next actions.', 'text/plain')
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

async function resolveCaptureGroup(context: vscode.ExtensionContext, group: string | undefined): Promise<CaptureGroupSummary> {
	const baseDir = await getCaptureBaseDir(context);
	if (!group) {
		const latest = context.globalState.get<StoredCapture>('latestCapture');
		if (!latest) {
			throw new Error('No capture group was provided, and there is no latest capture.');
		}

		return readCaptureGroup(latest.folder);
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
	const directPath = path.isAbsolute(group) ? group : path.resolve(workspaceFolder, group);
	if (await isDirectory(directPath)) {
		return readResolvableCaptureGroup(directPath);
	}

	const normalizedGroup = group.replace(/^[\\/]+|[\\/]+$/g, '');
	const groupParts = normalizedGroup.split(/[\\/]/).filter(Boolean);
	const relativeCandidates = groupParts.length === 1
		? await latestGroupFoldersForHost(baseDir, sanitizePathSegment(groupParts[0]))
		: [
			normalizedGroup,
			groupParts.map(sanitizePathSegment).join(path.sep)
		];

	for (const candidate of relativeCandidates) {
		const folder = path.resolve(baseDir, candidate);
		if (await isDirectory(folder)) {
			return readResolvableCaptureGroup(folder);
		}
	}

	throw new Error(`Browser capture group not found: ${group}`);
}

async function captureFromPaths(id: string, jsonPath: string, markdownPath: string): Promise<StoredCapture> {
	const jsonText = await fs.readFile(jsonPath, 'utf8');
	const payload = JSON.parse(jsonText) as BrowserCapturePayload;
	const screenshotPath = path.join(path.dirname(jsonPath), `${id}.png`);
	const hasScreenshot = await fs.stat(screenshotPath).then(() => true).catch(() => false);
	const pageUrl = parseUrl(payload.page?.url);
	return {
		id,
		folder: path.dirname(jsonPath),
		host: pageUrl?.hostname.toLowerCase() ?? path.basename(path.dirname(path.dirname(jsonPath))),
		groupName: path.basename(path.dirname(jsonPath)),
		jsonPath,
		markdownPath,
		screenshotPath: hasScreenshot ? screenshotPath : undefined,
		url: payload.page?.url,
		title: payload.page?.title,
		collectedAt: payload.collectedAt ?? new Date().toISOString()
	};
}

async function findCaptureJson(baseDir: string, id: string): Promise<string> {
	return findFileRecursive(baseDir, `${id}.json`, `Browser capture not found: ${id}`);
}

async function updateCaptureGroupFiles(folder: string, latestCapture: StoredCapture) {
	const summary = await readCaptureGroup(folder, latestCapture);
	await fs.writeFile(path.join(folder, '_index.json'), JSON.stringify(summary, null, 2), 'utf8');
	await fs.writeFile(path.join(folder, '_summary.md'), renderCaptureGroupMarkdown(summary), 'utf8');
}

async function readCaptureGroup(folder: string, knownCapture?: StoredCapture): Promise<CaptureGroupSummary> {
	const entries = await fs.readdir(folder, { withFileTypes: true });
	const captures = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.startsWith('_')) {
			continue;
		}

		const id = path.basename(entry.name, '.json');
		const jsonPath = path.join(folder, entry.name);
		const markdownPath = path.join(folder, `${id}.md`);
		if (knownCapture?.id === id) {
			captures.push(knownCapture);
			continue;
		}

		captures.push(await captureFromPaths(id, jsonPath, markdownPath));
	}

	captures.sort((left, right) => left.collectedAt.localeCompare(right.collectedAt));
	const first = captures[0];
	const last = captures[captures.length - 1];
	return {
		host: first?.host ?? path.basename(path.dirname(folder)),
		groupName: first?.groupName ?? path.basename(folder),
		folder,
		captureCount: captures.length,
		timeRange: first && last ? { from: first.collectedAt, to: last.collectedAt } : undefined,
		captures
	};
}

async function readResolvableCaptureGroup(folder: string) {
	const summary = await readCaptureGroup(folder);
	if (summary.captureCount > 0) {
		return summary;
	}

	const latestChild = await latestChildGroupFolder(folder);
	if (latestChild) {
		return readCaptureGroup(latestChild);
	}

	return summary;
}

async function latestChildGroupFolder(folder: string) {
	const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
	const childFolders = entries
		.filter(entry => entry.isDirectory())
		.map(entry => path.join(folder, entry.name))
		.sort()
		.reverse();
	return childFolders[0];
}

async function latestGroupFoldersForHost(baseDir: string, hostSegment: string) {
	const hostFolder = path.join(baseDir, hostSegment);
	const entries = await fs.readdir(hostFolder, { withFileTypes: true }).catch(() => []);
	return entries
		.filter(entry => entry.isDirectory())
		.map(entry => path.join(hostSegment, entry.name))
		.sort()
		.reverse()
		.slice(0, 1);
}

async function findFileRecursive(folder: string, fileName: string, notFoundMessage: string): Promise<string> {
	const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const candidate = path.join(folder, entry.name);
		if (entry.isFile() && entry.name === fileName) {
			return candidate;
		}

		if (entry.isDirectory()) {
			const found = await findFileRecursive(candidate, fileName, '').catch(() => undefined);
			if (found) {
				return found;
			}
		}
	}

	throw new Error(notFoundMessage);
}

async function isDirectory(candidate: string) {
	return fs.stat(candidate).then(stat => stat.isDirectory()).catch(() => false);
}

async function openCapturesFolder(context: vscode.ExtensionContext) {
	const captureDir = await getCaptureBaseDir(context);
	await fs.mkdir(captureDir, { recursive: true });
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(captureDir), { forceNewWindow: false });
}

async function openSetupPage(context: vscode.ExtensionContext) {
	if (setupPanel) {
		setupPanel.reveal(vscode.ViewColumn.One);
		await updateSetupPage(context, setupPanel);
		return;
	}

	setupPanel = vscode.window.createWebviewPanel(
		'owenBrowserBridgeSetup',
		'Owen Browser Bridge Setup',
		vscode.ViewColumn.One,
		{ enableScripts: true }
	);

	setupPanel.onDidDispose(() => {
		setupPanel = undefined;
	}, undefined, context.subscriptions);

	setupPanel.webview.onDidReceiveMessage(async message => {
		const command = typeof message?.command === 'string' ? message.command : '';
		try {
			if (command === 'startServer') {
				await startServer(context, true);
			} else if (command === 'stopServer') {
				await stopServer(true);
			} else if (command === 'copyPairingToken') {
				await copyPairingToken(context);
			} else if (command === 'regeneratePairingToken') {
				await regeneratePairingToken(context);
			} else if (command === 'openCapturesFolder') {
				await openCapturesFolder(context);
			} else if (command === 'showLatestCapture') {
				await showLatestCapture(context);
			} else if (command === 'addAllowedHost') {
				await addAllowedHost(message.host);
			} else if (command === 'updateAllowedHost') {
				await updateAllowedHost(message.index, message.host);
			} else if (command === 'removeAllowedHost') {
				await removeAllowedHost(message.index);
			} else if (command === 'allowAllHosts') {
				await allowAllHosts();
			} else if (command === 'restoreDefaultAllowedHosts') {
				await restoreDefaultAllowedHosts();
			} else if (command === 'updateCaptureDirectory') {
				await updateCaptureDirectory(message.captureDirectory);
			} else if (command === 'updatePlatformCaptureDirectories') {
				await updatePlatformCaptureDirectories(message.windowsCaptureDirectory, message.macCaptureDirectory);
			} else if (command === 'resetCaptureDirectory') {
				await resetCaptureDirectory();
			}
		} finally {
			if (setupPanel) {
				await updateSetupPage(context, setupPanel);
			}
		}
	}, undefined, context.subscriptions);

	await updateSetupPage(context, setupPanel);
}

async function updateSetupPage(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
	const port = getConfig().get<number>('port', 17321);
	const captureDirectorySetting = getConfig().get<string>('captureDirectory', 'raw/browser-captures');
	const captureDirectoryByPlatform = getConfig().get<Record<string, string>>('captureDirectoryByPlatform', {});
	const effectiveCaptureDirectorySetting = getConfiguredCaptureDirectory();
	const captureDir = await getCaptureBaseDir(context);
	const allowedHosts = getConfig().get<string[]>('allowedHosts', []);
	const latest = context.globalState.get<StoredCapture>('latestCapture');
	panel.webview.html = renderSetupPage(panel.webview, {
		isRunning: Boolean(server),
		port,
		captureDirectorySetting,
		windowsCaptureDirectorySetting: getCaptureDirectorySettingForKeys(captureDirectoryByPlatform, ['win32', 'windows', 'win']) ?? '',
		macCaptureDirectorySetting: getCaptureDirectorySettingForKeys(captureDirectoryByPlatform, ['darwin', 'mac', 'macos']) ?? '',
		effectiveCaptureDirectorySetting,
		platform: process.platform,
		captureDir,
		allowedHosts,
		latest
	});
}

function renderSetupPage(webview: vscode.Webview, state: { isRunning: boolean; port: number; captureDirectorySetting: string; windowsCaptureDirectorySetting: string; macCaptureDirectorySetting: string; effectiveCaptureDirectorySetting: string; platform: NodeJS.Platform; captureDir: string; allowedHosts: string[]; latest?: StoredCapture }) {
	const nonce = crypto.randomBytes(16).toString('base64url');
	const statusClass = state.isRunning ? 'running' : 'stopped';
	const statusText = state.isRunning ? `Running on 127.0.0.1:${state.port}` : 'Stopped';
	const latestText = state.latest ? `${state.latest.id} · ${state.latest.title ?? state.latest.url ?? 'Untitled capture'}` : 'No capture received yet';
	const allHostsAllowed = state.allowedHosts.length === 0;
	const allowedHostRows = state.allowedHosts.length > 0
		? state.allowedHosts.map((host, index) => `<div class="host-row">
				<input aria-label="Allowed host ${index + 1}" data-host-index="${index}" value="${escapeHtml(host)}" placeholder="security.microsoft.com or https://portal.azure.com">
				<button class="secondary" data-command="updateAllowedHost" data-host-index="${index}">Save</button>
				<button class="secondary danger" data-command="removeAllowedHost" data-host-index="${index}">Remove</button>
			</div>`).join('')
		: '<p class="meta">No host restrictions. Any host is accepted.</p>';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Owen Browser Bridge Setup</title>
	<style>
		:root { color-scheme: light dark; }
		body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
		main { max-width: 820px; padding: 28px; }
		h1 { font-size: 24px; margin: 0 0 8px; }
		p { line-height: 1.55; }
		.card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 18px; margin: 16px 0; background: var(--vscode-sideBar-background); }
		.status { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
		.status::before { content: ''; width: 10px; height: 10px; border-radius: 999px; background: var(--vscode-testing-iconFailed); }
		.status.running::before { background: var(--vscode-testing-iconPassed); }
		.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
		button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; border-radius: 4px; padding: 8px 12px; cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		button.danger { color: var(--vscode-errorForeground); }
		button:disabled { opacity: 0.55; cursor: not-allowed; }
		input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 8px 10px; }
		.host-list { display: grid; gap: 10px; margin-top: 12px; }
		.host-row { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto; gap: 8px; align-items: center; }
		.add-host { display: grid; grid-template-columns: minmax(220px, 1fr) auto; gap: 8px; align-items: center; margin-top: 14px; }
		@media (max-width: 620px) { .host-row, .add-host { grid-template-columns: 1fr; } }
		.meta { color: var(--vscode-descriptionForeground); font-size: 12px; word-break: break-all; }
		.steps { margin: 10px 0 0; padding-left: 20px; }
		.steps li { margin: 6px 0; }
	</style>
</head>
<body>
	<main>
		<h1>Owen Browser Bridge Setup</h1>
		<p>Start the local bridge, copy the pairing token, then paste it into the Owen Capture browser extension popup.</p>

		<section class="card">
			<div class="status ${statusClass}">${escapeHtml(statusText)}</div>
			<div class="actions">
				<button data-command="startServer" ${state.isRunning ? 'disabled' : ''}>Start Server</button>
				<button class="secondary" data-command="stopServer" ${state.isRunning ? '' : 'disabled'}>Stop Server</button>
			</div>
			<p class="meta">Port: ${state.port}</p>
		</section>

		<section class="card">
			<strong>Pairing token</strong>
			<p>The token is kept in VS Code SecretStorage and is copied to the clipboard only when you click the button.</p>
			<div class="actions">
				<button data-command="copyPairingToken">Copy Pairing Token</button>
				<button class="secondary" data-command="regeneratePairingToken">Regenerate and Copy Token</button>
			</div>
		</section>

		<section class="card">
			<strong>Next steps</strong>
			<ol class="steps">
				<li>Open the Owen Capture extension popup in Chrome or Edge.</li>
				<li>Confirm the port is <strong>${state.port}</strong>.</li>
				<li>Paste the pairing token and save settings.</li>
				<li>Open a page listed in <strong>Allowed Hosts</strong> and click <strong>Send Current Tab</strong>.</li>
			</ol>
		</section>

		<section class="card">
			<strong>Allowed Hosts</strong>
			<p>Add exact hosts, URLs, or wildcard suffixes such as <code>security.microsoft.com</code>, <code>https://portal.azure.com</code>, or <code>*.microsoft.com</code>.</p>
			<p class="meta">${allHostsAllowed ? 'All domains are currently accepted for captures and Copilot browser actions.' : 'Only the hosts listed below are accepted.'}</p>
			<div class="actions">
				<button class="secondary danger" data-command="allowAllHosts" ${allHostsAllowed ? 'disabled' : ''}>Allow All Domains</button>
				<button class="secondary" data-command="restoreDefaultAllowedHosts" ${allHostsAllowed ? '' : 'disabled'}>Restore Microsoft Defaults</button>
			</div>
			<div class="host-list">
				${allowedHostRows}
			</div>
			<div class="add-host">
				<input id="newAllowedHost" aria-label="New allowed host" placeholder="entra.microsoft.com or https://security.microsoft.com">
				<button data-command="addAllowedHost">Add Host</button>
			</div>
		</section>

		<section class="card">
			<strong>Capture Directory</strong>
			<p>Set where JSON, Markdown, and PNG capture files are stored. Windows and Mac directory paths are used first on their matching OS. The fallback path is used when no OS-specific path is set.</p>
			<p class="meta">Fallback directory path</p>
			<div class="add-host">
				<input id="captureDirectory" aria-label="Capture directory" value="${escapeHtml(state.captureDirectorySetting)}" placeholder="raw/browser-captures or C:\\OWEN\\Drive\\wiki_raw_articles\\browser-captures">
				<button data-command="updateCaptureDirectory">Save Directory</button>
			</div>
			<p class="meta">Windows directory path</p>
			<div class="add-host">
				<input id="windowsCaptureDirectory" aria-label="Windows capture directory" value="${escapeHtml(state.windowsCaptureDirectorySetting)}" placeholder="C:\\OWEN\\Drive\\wiki_raw_articles\\browser-captures">
				<button data-command="updatePlatformCaptureDirectories">Save OS Directories</button>
			</div>
			<p class="meta">Mac directory path</p>
			<div class="add-host">
				<input id="macCaptureDirectory" aria-label="Mac capture directory" value="${escapeHtml(state.macCaptureDirectorySetting)}" placeholder="/Users/owen/work/wiki_raw_articles/browser-captures">
				<button data-command="updatePlatformCaptureDirectories">Save OS Directories</button>
			</div>
			<p class="meta">Current platform: ${escapeHtml(state.platform)} · Effective setting: ${escapeHtml(state.effectiveCaptureDirectorySetting)}</p>
			<p class="meta">Resolved folder: ${escapeHtml(state.captureDir)}</p>
			<div class="actions">
				<button class="secondary danger" data-command="resetCaptureDirectory">Reset to Default</button>
			</div>
		</section>

		<section class="card">
			<strong>Captures</strong>
			<p class="meta">Folder: ${escapeHtml(state.captureDir)}</p>
			<p class="meta">Latest: ${escapeHtml(latestText)}</p>
			<div class="actions">
				<button class="secondary" data-command="openCapturesFolder">Open Captures Folder</button>
				<button class="secondary" data-command="showLatestCapture" ${state.latest ? '' : 'disabled'}>Show Latest Capture</button>
			</div>
		</section>
	</main>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.querySelectorAll('[data-command]').forEach(button => {
			button.addEventListener('click', () => {
				const command = button.dataset.command;
				if (command === 'addAllowedHost') {
					vscode.postMessage({ command, host: document.getElementById('newAllowedHost').value });
					return;
				}
				if (command === 'updateAllowedHost') {
					const index = Number(button.dataset.hostIndex);
					const input = document.querySelector('[data-host-index="' + index + '"]');
					vscode.postMessage({ command, index, host: input.value });
					return;
				}
				if (command === 'removeAllowedHost') {
					vscode.postMessage({ command, index: Number(button.dataset.hostIndex) });
					return;
				}
				if (command === 'updateCaptureDirectory') {
					vscode.postMessage({ command, captureDirectory: document.getElementById('captureDirectory').value });
					return;
				}
				if (command === 'updatePlatformCaptureDirectories') {
					vscode.postMessage({
						command,
						windowsCaptureDirectory: document.getElementById('windowsCaptureDirectory').value,
						macCaptureDirectory: document.getElementById('macCaptureDirectory').value
					});
					return;
				}
				vscode.postMessage({ command });
			});
		});
	</script>
</body>
</html>`;
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

async function addAllowedHost(input: unknown) {
	const host = normalizeAllowedHostInput(input);
	if (!host) {
		vscode.window.showWarningMessage('Enter a host or URL to allow.');
		return;
	}

	const hosts = getConfig().get<string[]>('allowedHosts', []);
	if (hosts.map(entry => entry.toLowerCase()).includes(host.toLowerCase())) {
		vscode.window.showInformationMessage(`Allowed host already exists: ${host}`);
		return;
	}

	await setAllowedHosts([...hosts, host]);
	vscode.window.showInformationMessage(`Allowed host added: ${host}`);
}

async function updateAllowedHost(indexInput: unknown, hostInput: unknown) {
	const index = typeof indexInput === 'number' ? indexInput : Number.NaN;
	const host = normalizeAllowedHostInput(hostInput);
	const hosts = getConfig().get<string[]>('allowedHosts', []);
	if (!Number.isInteger(index) || index < 0 || index >= hosts.length) {
		vscode.window.showWarningMessage('Allowed host entry was not found.');
		return;
	}
	if (!host) {
		vscode.window.showWarningMessage('Enter a host or URL to allow.');
		return;
	}

	const nextHosts = [...hosts];
	nextHosts[index] = host;
	await setAllowedHosts(dedupeAllowedHosts(nextHosts));
	vscode.window.showInformationMessage(`Allowed host updated: ${host}`);
}

async function removeAllowedHost(indexInput: unknown) {
	const index = typeof indexInput === 'number' ? indexInput : Number.NaN;
	const hosts = getConfig().get<string[]>('allowedHosts', []);
	if (!Number.isInteger(index) || index < 0 || index >= hosts.length) {
		vscode.window.showWarningMessage('Allowed host entry was not found.');
		return;
	}

	const removed = hosts[index];
	await setAllowedHosts(hosts.filter((_, hostIndex) => hostIndex !== index));
	vscode.window.showInformationMessage(`Allowed host removed: ${removed}`);
}

async function setAllowedHosts(hosts: string[]) {
	await getConfig().update('allowedHosts', hosts, vscode.ConfigurationTarget.Global);
}

async function allowAllHosts() {
	await setAllowedHosts([]);
	vscode.window.showWarningMessage('Owen Browser Bridge now accepts captures and browser actions from any host.');
}

async function restoreDefaultAllowedHosts() {
	await setAllowedHosts(DEFAULT_ALLOWED_HOSTS);
	vscode.window.showInformationMessage('Allowed hosts restored to Microsoft portal defaults.');
}

async function updateCaptureDirectory(input: unknown) {
	if (typeof input !== 'string' || !input.trim()) {
		vscode.window.showWarningMessage('Enter a capture directory path.');
		return;
	}

	const captureDirectory = input.trim();
	await getConfig().update('captureDirectory', captureDirectory, vscode.ConfigurationTarget.Global);
	vscode.window.showInformationMessage(`Capture directory updated: ${captureDirectory}`);
}

async function updatePlatformCaptureDirectories(windowsInput: unknown, macInput: unknown) {
	const current = getConfig().get<Record<string, string>>('captureDirectoryByPlatform', {});
	const next = { ...current };
	clearCaptureDirectoryKeys(next, ['win32', 'windows', 'win']);
	clearCaptureDirectoryKeys(next, ['darwin', 'mac', 'macos']);

	const windowsCaptureDirectory = typeof windowsInput === 'string' ? windowsInput.trim() : '';
	const macCaptureDirectory = typeof macInput === 'string' ? macInput.trim() : '';
	if (windowsCaptureDirectory) {
		next.win32 = windowsCaptureDirectory;
	}
	if (macCaptureDirectory) {
		next.darwin = macCaptureDirectory;
	}

	await getConfig().update('captureDirectoryByPlatform', next, vscode.ConfigurationTarget.Global);
	vscode.window.showInformationMessage('OS-specific capture directories updated.');
}

function clearCaptureDirectoryKeys(values: Record<string, string>, keys: string[]) {
	for (const key of keys) {
		delete values[key];
	}
}

async function resetCaptureDirectory() {
	await getConfig().update('captureDirectory', undefined, vscode.ConfigurationTarget.Global);
	vscode.window.showInformationMessage('Capture directory reset to the default setting.');
}

function normalizeAllowedHostInput(input: unknown) {
	if (typeof input !== 'string') {
		return undefined;
	}

	const trimmed = input.trim();
	if (!trimmed) {
		return undefined;
	}

	return normalizeAllowedHost(trimmed);
}

function dedupeAllowedHosts(hosts: string[]) {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const host of hosts) {
		const key = host.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(host);
		}
	}
	return deduped;
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
	const configured = getConfiguredCaptureDirectory();
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceFolder) {
		return path.resolve(workspaceFolder, configured);
	}

	return path.join(context.globalStorageUri.fsPath, configured);
}

function getConfiguredCaptureDirectory() {
	const platformDirectory = getPlatformCaptureDirectory(getConfig().get<Record<string, string>>('captureDirectoryByPlatform', {}));
	return platformDirectory ?? getConfig().get<string>('captureDirectory', 'raw/browser-captures');
}

function getPlatformCaptureDirectory(values: Record<string, string> | undefined) {
	if (!values || typeof values !== 'object') {
		return undefined;
	}

	const aliases: Partial<Record<NodeJS.Platform, string[]>> = {
		aix: ['aix'],
		android: ['android'],
		darwin: ['darwin', 'mac', 'macos'],
		freebsd: ['freebsd'],
		haiku: ['haiku'],
		linux: ['linux'],
		openbsd: ['openbsd'],
		sunos: ['sunos'],
		win32: ['win32', 'windows', 'win']
	};

	for (const key of aliases[process.platform] ?? [process.platform]) {
		const value = values[key]?.trim();
		if (value) {
			return value;
		}
	}

	return undefined;
}

function getCaptureDirectorySettingForKeys(values: Record<string, string> | undefined, keys: string[]) {
	if (!values || typeof values !== 'object') {
		return undefined;
	}

	for (const key of keys) {
		const value = values[key]?.trim();
		if (value) {
			return value;
		}
	}

	return undefined;
}

function parseUrl(value: string | undefined) {
	if (!value) {
		return undefined;
	}

	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

function getCaptureGroupName(payload: BrowserCapturePayload, pageUrl: URL | undefined, collectedAt: string) {
	const explicitName = payload.investigation?.name?.trim();
	if (explicitName) {
		return explicitName;
	}

	const inferredName = inferInvestigationName(pageUrl);
	if (inferredName) {
		return inferredName;
	}

	return collectedAt.slice(0, 10).replace(/-/g, '');
}

function inferInvestigationName(pageUrl: URL | undefined) {
	if (!pageUrl) {
		return undefined;
	}

	for (const key of ['incidentId', 'incidentid', 'incident', 'alertId', 'alertid', 'alert']) {
		const value = pageUrl.searchParams.get(key);
		if (value) {
			return `${key.toLowerCase()}-${value}`;
		}
	}

	const segments = pageUrl.pathname.split('/').filter(Boolean);
	for (let index = 0; index < segments.length - 1; index += 1) {
		const segment = segments[index].toLowerCase();
		if (['incident', 'incidents', 'alert', 'alerts'].includes(segment)) {
			return `${segment.replace(/s$/, '')}-${segments[index + 1]}`;
		}
	}

	return undefined;
}

function sanitizePathSegment(value: string) {
	return (value || 'unknown')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120) || 'unknown';
}

function redactPayload(payload: BrowserCapturePayload): BrowserCapturePayload {
	const copy = JSON.parse(JSON.stringify(payload)) as BrowserCapturePayload;
	copy.browserSession = redactUnknown(copy.browserSession) as BrowserSessionState | undefined;
	if (copy.page) {
		copy.page.url = redactText(copy.page.url);
		copy.page.title = redactText(copy.page.title);
		copy.page.visibleText = redactText(copy.page.visibleText);
		copy.page.selection = redactText(copy.page.selection);
		copy.page.html = copy.page.html ? (redactText(copy.page.html) ?? '').slice(0, 250000) : undefined;
		copy.page.screenSummary = redactUnknown(copy.page.screenSummary) as Record<string, unknown> | undefined;
		copy.page.metadata = redactUnknown(copy.page.metadata) as Record<string, unknown> | undefined;
	}
	return copy;
}

function redactUnknown(value: unknown): unknown {
	if (typeof value === 'string') {
		return redactText(value);
	}
	if (Array.isArray(value)) {
		return value.map(item => redactUnknown(item));
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactUnknown(item)]));
	}
	return value;
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

	const profile = getConfig().get<string>('redactionProfile', 'standard');
	if (profile === 'off') {
		return value;
	}

	let redacted = value
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
		.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-guid]')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted-token]')
		.replace(/(access_token|refresh_token|id_token|sessionid|session_id|sid)=([^\s&]+)/gi, '$1=[redacted-token]');

	if (profile === 'strict') {
		redacted = redacted
			.replace(/\b(?:[A-Za-z0-9+/]{20,}={0,2})\b/g, '[redacted-long-token]')
			.replace(/\b(?:[0-9a-f]{32,})\b/gi, '[redacted-hex-token]');
	}

	for (const pattern of getConfig().get<string[]>('customRedactionPatterns', [])) {
		try {
			redacted = redacted.replace(new RegExp(pattern, 'g'), '[redacted-custom]');
		} catch {
			output?.appendLine(`Ignoring invalid custom redaction pattern: ${pattern}`);
		}
	}

	return redacted;
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

	if (payload.browserSession) {
		lines.push('## Browser Session', '', '```json', JSON.stringify(payload.browserSession, null, 2), '```', '');
	}

	if (page.screenSummary) {
		lines.push('## Screen Summary', '', '```json', JSON.stringify(page.screenSummary, null, 2), '```', '');
	}

	if (page.visibleText) {
		lines.push('## Visible Text', '', page.visibleText.slice(0, 50000), '');
	}

	if (page.metadata) {
		lines.push('## Metadata', '', '```json', JSON.stringify(page.metadata, null, 2), '```', '');
	}

	lines.push('## Copilot Prompt', '', 'Analyze this browser capture using the screen summary, JSON, visible text, metadata, and screenshot stored next to this note. Highlight evidence, risk, likely next actions, and missing context.', '');
	return lines.join('\n');
}

function renderCaptureGroupMarkdown(summary: CaptureGroupSummary) {
	const lines = [
		'---',
		'type: browser-capture-group',
		`created: ${new Date().toISOString().slice(0, 10)}`,
		'tags: [type/browser-capture-group]',
		'---',
		'',
		`# ${summary.host} - ${summary.groupName}`,
		'',
		'> [!summary]',
		`> Host: ${summary.host}`,
		`> Group: ${summary.groupName}`,
		`> Captures: ${summary.captureCount}`,
		`> Time range: ${summary.timeRange ? `${summary.timeRange.from} to ${summary.timeRange.to}` : '(none)'}`,
		'',
		'## Captures',
		''
	];

	for (const capture of summary.captures) {
		lines.push(`- ${capture.collectedAt} - [[${path.basename(capture.markdownPath)}|${capture.title ?? capture.id}]] - ${capture.url ?? '(unknown URL)'}`);
	}

	lines.push(
		'',
		'## Copilot Prompt',
		'',
		'Analyze every capture in this folder as one related browser investigation. Correlate URL order, timestamps, entities, visible text, metadata, screenshots, risk, missing context, and next actions.',
		''
	);
	return lines.join('\n');
}

async function writeEvidencePack(context: vscode.ExtensionContext, stepResult: Record<string, unknown>, completion: BrowserCommandCompletion) {
	const captureGroup = String(stepResult.captureGroup ?? '').trim();
	const baseDir = await getCaptureBaseDir(context);
	const groupFolder = await findCaptureGroupFolder(baseDir, captureGroup);
	if (!groupFolder) {
		throw new Error(`Evidence pack capture group not found: ${captureGroup}`);
	}

	const summary = await readCaptureGroup(groupFolder);
	const actionEntries = await readRecentActionLogEntries(baseDir, 100);
	const relatedEntries = actionEntries.filter(entry => {
		const stored = entry.storedCapture as Record<string, unknown> | undefined;
		return stored?.groupName === summary.groupName || String(stored?.markdownPath ?? '').startsWith(groupFolder);
	});
	const pack = {
		generatedAt: new Date().toISOString(),
		captureGroup: summary,
		requestedByCommand: completion.id,
		actionLogCount: relatedEntries.length,
		actionLogs: relatedEntries,
		latestCommandResult: stepResult
	};
	await fs.writeFile(path.join(groupFolder, '_evidence-pack.json'), JSON.stringify(pack, null, 2), 'utf8');
	await fs.writeFile(path.join(groupFolder, '_evidence-pack.md'), renderEvidencePackMarkdown(pack), 'utf8');
}

async function writeNavigationGraph(context: vscode.ExtensionContext, stepResult: Record<string, unknown>) {
	const baseDir = await getCaptureBaseDir(context);
	const folder = path.join(baseDir, '_navigation-graphs');
	await fs.mkdir(folder, { recursive: true });
	const id = `navigation-graph-${formatTimestamp(new Date().toISOString())}`;
	const jsonPath = path.join(folder, `${id}.json`);
	const markdownPath = path.join(folder, `${id}.md`);
	await fs.writeFile(jsonPath, JSON.stringify(stepResult, null, 2), 'utf8');
	await fs.writeFile(markdownPath, renderNavigationGraphMarkdown(stepResult), 'utf8');
}

async function writeBrowserReportArtifact(context: vscode.ExtensionContext, action: string, stepResult: Record<string, unknown>) {
	const baseDir = await getCaptureBaseDir(context);
	const folder = path.join(baseDir, '_reports');
	await fs.mkdir(folder, { recursive: true });
	const id = `${action}-${formatTimestamp(new Date().toISOString())}`;
	await fs.writeFile(path.join(folder, `${id}.json`), JSON.stringify(stepResult, null, 2), 'utf8');
	await fs.writeFile(path.join(folder, `${id}.md`), renderBrowserReportMarkdown(action, stepResult), 'utf8');
}

async function writeBrowserRunBundle(context: vscode.ExtensionContext, stepResult: Record<string, unknown>, completion: BrowserCommandCompletion) {
	const captureGroup = String(stepResult.captureGroup ?? '').trim();
	const baseDir = await getCaptureBaseDir(context);
	const groupFolder = await findCaptureGroupFolder(baseDir, captureGroup);
	if (!groupFolder) {
		throw new Error(`Browser run bundle capture group not found: ${captureGroup}`);
	}

	const summary = await readCaptureGroup(groupFolder);
	const actionLogs = await readRecentActionLogEntries(baseDir, 200);
	const relatedLogs = actionLogs.filter(entry => {
		const stored = entry.storedCapture as Record<string, unknown> | undefined;
		return stored?.groupName === summary.groupName || String(stored?.markdownPath ?? '').startsWith(groupFolder);
	});
	const bundleId = `browser-run-bundle-${formatTimestamp(new Date().toISOString())}`;
	const bundleFolder = path.join(groupFolder, '_run-bundles', bundleId);
	await fs.mkdir(bundleFolder, { recursive: true });
	const manifest = {
		bundleId,
		generatedAt: new Date().toISOString(),
		requestedByCommand: completion.id,
		captureGroup: summary,
		actionLogCount: relatedLogs.length,
		actionLogs: relatedLogs,
		latestCommandResult: stepResult,
		artifacts: {
			evidencePackJson: path.join(groupFolder, '_evidence-pack.json'),
			evidencePackMarkdown: path.join(groupFolder, '_evidence-pack.md')
		}
	};
	await fs.writeFile(path.join(bundleFolder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
	await fs.writeFile(path.join(bundleFolder, 'README.md'), renderBrowserRunBundleMarkdown(manifest), 'utf8');
	await fs.writeFile(path.join(bundleFolder, 'action-logs.json'), JSON.stringify(relatedLogs, null, 2), 'utf8');
}

async function writeEvidenceCompletenessReport(context: vscode.ExtensionContext, stepResult: Record<string, unknown>) {
	const captureGroup = String(stepResult.captureGroup ?? '').trim();
	const baseDir = await getCaptureBaseDir(context);
	const groupFolder = await findCaptureGroupFolder(baseDir, captureGroup);
	if (!groupFolder) {
		await writeBrowserReportArtifact(context, 'evidenceCompletenessCheck', stepResult);
		return;
	}

	const summary = await readCaptureGroup(groupFolder);
	const claims = Array.isArray(stepResult.requiredClaims) ? stepResult.requiredClaims.map(String).filter(Boolean) : [];
	const captureTexts = await Promise.all(summary.captures.map(async capture => ({
		id: capture.id,
		path: capture.markdownPath,
		text: await fs.readFile(capture.markdownPath, 'utf8').catch(() => '')
	})));
	const checks = claims.map(claim => {
		const terms = claim.toLowerCase().split(/[^a-z0-9가-힣_.-]+/).filter(term => term.length >= 3).slice(0, 20);
		const matches = captureTexts.map(capture => {
			const text = capture.text.toLowerCase();
			const matchedTerms = terms.filter(term => text.includes(term));
			return { captureId: capture.id, markdownPath: capture.path, matchedTerms, supportRatio: terms.length ? matchedTerms.length / terms.length : 0 };
		}).filter(match => match.matchedTerms.length > 0);
		const bestRatio = matches.reduce((max, match) => Math.max(max, match.supportRatio), 0);
		return { claim, status: bestRatio >= 0.65 ? 'covered' : bestRatio >= 0.35 ? 'partial' : 'missing', bestRatio, matches };
	});
	const report = {
		...stepResult,
		generatedAt: new Date().toISOString(),
		captureGroup: summary,
		checks,
		coveredCount: checks.filter(check => check.status === 'covered').length,
		partialCount: checks.filter(check => check.status === 'partial').length,
		missingCount: checks.filter(check => check.status === 'missing').length
	};
	await fs.writeFile(path.join(groupFolder, '_evidence-completeness.json'), JSON.stringify(report, null, 2), 'utf8');
	await fs.writeFile(path.join(groupFolder, '_evidence-completeness.md'), renderEvidenceCompletenessMarkdown(report), 'utf8');
}

async function findCaptureGroupFolder(baseDir: string, captureGroup: string) {
	if (!captureGroup) {
		const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
		const latestHost = entries.filter(entry => entry.isDirectory()).map(entry => path.join(baseDir, entry.name)).sort().reverse()[0];
		return latestHost ? latestChildGroupFolder(latestHost) : undefined;
	}

	const direct = path.resolve(baseDir, captureGroup);
	if (await isDirectory(direct)) {
		return direct;
	}

	const normalized = captureGroup.replace(/^[\\/]+|[\\/]+$/g, '');
	const directRelative = path.join(baseDir, ...normalized.split(/[\\/]/).map(sanitizePathSegment));
	if (await isDirectory(directRelative)) {
		return directRelative;
	}

	return findFolderByBaseName(baseDir, sanitizePathSegment(path.basename(normalized)));
}

async function findFolderByBaseName(folder: string, name: string): Promise<string | undefined> {
	const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const candidate = path.join(folder, entry.name);
		if (!entry.isDirectory()) {
			continue;
		}
		if (entry.name === name) {
			return candidate;
		}
		const found = await findFolderByBaseName(candidate, name);
		if (found) {
			return found;
		}
	}
	return undefined;
}

async function readRecentActionLogEntries(baseDir: string, limit: number) {
	const logDir = path.join(baseDir, '_action-logs');
	const files = (await fs.readdir(logDir, { withFileTypes: true }).catch(() => []))
		.filter(entry => entry.isFile() && entry.name.startsWith('browser-actions-') && entry.name.endsWith('.jsonl'))
		.map(entry => path.join(logDir, entry.name))
		.sort()
		.reverse();
	const entries: Record<string, unknown>[] = [];
	for (const file of files.slice(0, 5)) {
		const lines = (await fs.readFile(file, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean).slice(-limit);
		for (const line of lines) {
			try {
				entries.push(JSON.parse(line) as Record<string, unknown>);
			} catch {
				// Ignore malformed action-log lines.
			}
		}
	}
	return entries.slice(-limit);
}

function renderEvidencePackMarkdown(pack: { generatedAt: string; captureGroup: CaptureGroupSummary; actionLogCount: number; latestCommandResult: Record<string, unknown> }) {
	const lines = [
		'# Evidence Pack',
		'',
		`Generated: ${pack.generatedAt}`,
		`Host: ${pack.captureGroup.host}`,
		`Group: ${pack.captureGroup.groupName}`,
		`Captures: ${pack.captureGroup.captureCount}`,
		`Related action logs: ${pack.actionLogCount}`,
		'',
		'## Captures',
		''
	];
	for (const capture of pack.captureGroup.captures) {
		lines.push(`- ${capture.collectedAt} - ${path.basename(capture.markdownPath)} - ${capture.title ?? capture.id}`);
	}
	lines.push('', '## Latest Command Result', '', '```json', JSON.stringify(pack.latestCommandResult, null, 2), '```', '');
	return lines.join('\n');
}

function renderNavigationGraphMarkdown(graph: Record<string, unknown>) {
	const nodes = Array.isArray(graph.nodes) ? graph.nodes as Record<string, unknown>[] : [];
	const edges = Array.isArray(graph.edges) ? graph.edges as Record<string, unknown>[] : [];
	const lines = ['# Navigation Graph', '', `Generated: ${graph.generatedAt ?? new Date().toISOString()}`, '', `Nodes: ${nodes.length}`, `Edges: ${edges.length}`, '', '## Nodes', ''];
	for (const node of nodes) {
		lines.push(`- ${node.createdAt ?? ''} - ${node.action ?? ''} - ${node.title ?? node.url ?? node.id}`);
	}
	lines.push('', '## Edges', '');
	for (const edge of edges) {
		lines.push(`- ${edge.from} -> ${edge.to}`);
	}
	return `${lines.join('\n')}\n`;
}

function renderBrowserReportMarkdown(action: string, report: Record<string, unknown>) {
	return ['# Browser Report', '', `Action: ${action}`, `Generated: ${new Date().toISOString()}`, '', '```json', JSON.stringify(report, null, 2), '```', ''].join('\n');
}

function renderBrowserRunBundleMarkdown(bundle: { bundleId: string; generatedAt: string; captureGroup: CaptureGroupSummary; actionLogCount: number; latestCommandResult: Record<string, unknown> }) {
	const lines = [
		'# Browser Run Bundle',
		'',
		`Bundle: ${bundle.bundleId}`,
		`Generated: ${bundle.generatedAt}`,
		`Host: ${bundle.captureGroup.host}`,
		`Group: ${bundle.captureGroup.groupName}`,
		`Captures: ${bundle.captureGroup.captureCount}`,
		`Action logs: ${bundle.actionLogCount}`,
		'',
		'## Captures',
		''
	];
	for (const capture of bundle.captureGroup.captures) {
		lines.push(`- ${capture.collectedAt} - ${path.basename(capture.markdownPath)} - ${capture.title ?? capture.id}`);
	}
	lines.push('', '## Latest Command Result', '', '```json', JSON.stringify(bundle.latestCommandResult, null, 2), '```', '');
	return lines.join('\n');
}

function renderEvidenceCompletenessMarkdown(report: { generatedAt: string; captureGroup: CaptureGroupSummary; coveredCount: number; partialCount: number; missingCount: number; checks: Array<{ claim: string; status: string; bestRatio: number; matches: Array<{ captureId: string; matchedTerms: string[] }> }> }) {
	const lines = [
		'# Evidence Completeness',
		'',
		`Generated: ${report.generatedAt}`,
		`Host: ${report.captureGroup.host}`,
		`Group: ${report.captureGroup.groupName}`,
		`Captures: ${report.captureGroup.captureCount}`,
		`Covered: ${report.coveredCount}`,
		`Partial: ${report.partialCount}`,
		`Missing: ${report.missingCount}`,
		'',
		'## Claims',
		''
	];
	for (const check of report.checks) {
		lines.push(`- ${check.status} (${check.bestRatio.toFixed(2)}) - ${check.claim}`);
		for (const match of check.matches.slice(0, 3)) {
			lines.push(`  - ${match.captureId}: ${match.matchedTerms.join(', ')}`);
		}
	}
	return `${lines.join('\n')}\n`;
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
