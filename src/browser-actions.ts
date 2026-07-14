export const BROWSER_ACTIONS = [
	'readPage', 'capture', 'click', 'type', 'navigate', 'waitForText', 'wait', 'waitPreset', 'scroll', 'hover', 'keyPress',
	'selectOption', 'clearInput', 'back', 'forward', 'reload', 'openInNewTab', 'switchTab', 'closeTab',
	'listInteractables', 'inspectTargets', 'captureElement', 'captureRegion', 'journeyCapture', 'paginateCapture', 'smartFormFill', 'conditionalWorkflow',
	'multiTabCrawl', 'runtimeSnapshot', 'domDiffTimeline', 'ocrSnapshot', 'dataGapGuard', 'exportReplay', 'networkTraceCapture',
	'safeDownloadAndHash', 'tableExtract', 'stateCheckpoint', 'rollbackToCheckpoint', 'humanReviewGate', 'bulkActionFromList',
	'semanticWait', 'compareCaptureRuns', 'policyGuard', 'visualAssert', 'accessibilitySnapshot', 'mapForm', 'watchPageChanges',
	'highlightEvidence', 'planAndRun', 'evidenceClaimCheck', 'tableWatchAndDiff', 'browserRunBundle', 'safeActionPreview',
	'stableTargetProfile', 'guidedDrilldown', 'evidenceCompletenessCheck', 'failureExplainer', 'waitProfiler', 'automationHealthScore',
	'sensitiveActionGuard', 'tabOrchestrator', 'popupGuard', 'returnToTab', 'tabRunSummary', 'buildEvidencePack',
	'buildNavigationGraph', 'assertPageContract', 'createHandoff', 'selectorHealthReport', 'captureReviewQueue', 'startBrowserJob',
	'getBrowserJob', 'cancelBrowserJob', 'recordWorkflow', 'replayWorkflow', 'listScenarioTemplates', 'saveScenarioTemplate',
	'deleteScenarioTemplate', 'exportScenarioTemplates', 'runScenarioTemplate', 'resumeAfterAuth', 'runWorkflow'
] as const;

export type BrowserAction = typeof BROWSER_ACTIONS[number];
export type BrowserActionCategory = 'read' | 'interact' | 'workflow' | 'evidence' | 'admin';
export type BrowserActionRisk = 'read' | 'write' | 'destructive';

const DESTRUCTIVE_ACTIONS = new Set<BrowserAction>(['closeTab']);
const WRITE_ACTIONS = new Set<BrowserAction>([
	'click', 'type', 'navigate', 'scroll', 'keyPress', 'selectOption', 'clearInput', 'back', 'forward', 'reload',
	'openInNewTab', 'switchTab', 'journeyCapture', 'paginateCapture', 'smartFormFill', 'conditionalWorkflow',
	'multiTabCrawl', 'rollbackToCheckpoint', 'bulkActionFromList', 'planAndRun', 'guidedDrilldown', 'tabOrchestrator',
	'returnToTab', 'startBrowserJob', 'cancelBrowserJob', 'replayWorkflow', 'saveScenarioTemplate', 'deleteScenarioTemplate',
	'runScenarioTemplate', 'resumeAfterAuth', 'runWorkflow'
]);
const EVIDENCE_ACTIONS = new Set<BrowserAction>([
	'capture', 'captureElement', 'captureRegion', 'ocrSnapshot', 'dataGapGuard', 'networkTraceCapture', 'tableExtract',
	'compareCaptureRuns', 'visualAssert', 'accessibilitySnapshot', 'highlightEvidence', 'evidenceClaimCheck', 'tableWatchAndDiff',
	'browserRunBundle', 'evidenceCompletenessCheck', 'buildEvidencePack', 'buildNavigationGraph', 'createHandoff', 'captureReviewQueue'
]);
const WORKFLOW_ACTIONS = new Set<BrowserAction>([
	'journeyCapture', 'paginateCapture', 'conditionalWorkflow', 'multiTabCrawl', 'domDiffTimeline', 'bulkActionFromList',
	'planAndRun', 'guidedDrilldown', 'startBrowserJob', 'getBrowserJob', 'cancelBrowserJob', 'recordWorkflow',
	'replayWorkflow', 'listScenarioTemplates', 'saveScenarioTemplate', 'deleteScenarioTemplate', 'exportScenarioTemplates',
	'runScenarioTemplate', 'resumeAfterAuth', 'runWorkflow'
]);
const ADMIN_ACTIONS = new Set<BrowserAction>([
	'selectorHealthReport', 'captureReviewQueue', 'startBrowserJob', 'getBrowserJob', 'cancelBrowserJob', 'recordWorkflow',
	'listScenarioTemplates', 'saveScenarioTemplate', 'deleteScenarioTemplate', 'exportScenarioTemplates'
]);

export function getBrowserActionDefinition(name: BrowserAction) {
	const risk: BrowserActionRisk = DESTRUCTIVE_ACTIONS.has(name) ? 'destructive' : WRITE_ACTIONS.has(name) ? 'write' : 'read';
	const category: BrowserActionCategory = ADMIN_ACTIONS.has(name)
		? 'admin'
		: WORKFLOW_ACTIONS.has(name)
		? 'workflow'
		: EVIDENCE_ACTIONS.has(name) ? 'evidence' : risk !== 'read' ? 'interact' : 'read';
	return { name, category, risk };
}

export const BROWSER_ACTION_REGISTRY = BROWSER_ACTIONS.map(getBrowserActionDefinition);