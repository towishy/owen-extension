export type AgentRunStatus =
	| 'queued'
	| 'observing'
	| 'planning'
	| 'acting'
	| 'verifying'
	| 'waiting_review'
	| 'completed'
	| 'partial'
	| 'failed'
	| 'cancelled';

export type AgentPlanItem = {
	id: string;
	goal: string;
	status: 'pending' | 'active' | 'completed' | 'blocked' | 'skipped';
	completionCriteria: string[];
};

export type AgentObservation = {
	url: string;
	title?: string;
	tabId?: number;
	targetId?: string;
	domHash?: string;
	elementCount?: number;
	pageRevision?: string;
	capturedAt?: string;
};

export type AgentRunEvent = {
	type: 'observation' | 'plan' | 'action' | 'effect' | 'fact' | 'error' | 'review' | 'judgement';
	at: string;
	summary: string;
	data?: Record<string, unknown>;
};

export type AgentRun = {
	runId: string;
	goal: string;
	status: AgentRunStatus;
	createdAt: string;
	updatedAt: string;
	maxSteps: number;
	stepsUsed: number;
	maxRetriesPerStep: number;
	planRevision: number;
	plan: AgentPlanItem[];
	hardConstraints: string[];
	facts: string[];
	unresolved: string[];
	events: AgentRunEvent[];
	recentFingerprints: string[];
	repetitionCount: number;
	replanCount: number;
	metrics: {
		observations: number;
		actions: number;
		modelRequests: number;
		fallbacks: number;
		inputTokens: number;
		outputTokens: number;
		modelIds: string[];
	};
};

export type CompletionEvidence = {
	requiredClaims?: string[];
	verifiedClaims?: string[];
	contractPassed?: boolean;
	assertionsPassed?: boolean;
	evidenceComplete?: boolean;
	authRequired?: boolean;
	captchaDetected?: boolean;
	reviewRequired?: boolean;
	errors?: string[];
};

export type CompletionJudgement = {
	status: Extract<AgentRunStatus, 'completed' | 'partial' | 'failed' | 'waiting_review'>;
	passed: boolean;
	reason: string;
	missingClaims: string[];
};

export type ContextCompaction = {
	goal: string;
	status: AgentRunStatus;
	budget: { used: number; remaining: number; maximum: number };
	hardConstraints: string[];
	plan: AgentPlanItem[];
	facts: string[];
	unresolved: string[];
	recentEvents: AgentRunEvent[];
	replanRequired: boolean;
};

export function createAgentRun(
	runId: string,
	goal: string,
	options: { maxSteps?: number; maxRetriesPerStep?: number; hardConstraints?: string[] } = {}
): AgentRun {
	const now = new Date().toISOString();
	return {
		runId,
		goal: goal.trim(),
		status: 'queued',
		createdAt: now,
		updatedAt: now,
		maxSteps: clampInteger(options.maxSteps, 1, 50, 12),
		stepsUsed: 0,
		maxRetriesPerStep: clampInteger(options.maxRetriesPerStep, 0, 3, 2),
		planRevision: 0,
		plan: [],
		hardConstraints: uniqueStrings(options.hardConstraints ?? []),
		facts: [],
		unresolved: [],
		events: [],
		recentFingerprints: [],
		repetitionCount: 0,
		replanCount: 0,
		metrics: {
			observations: 0,
			actions: 0,
			modelRequests: 0,
			fallbacks: 0,
			inputTokens: 0,
			outputTokens: 0,
			modelIds: []
		}
	};
}

export function observationFingerprint(observation: AgentObservation) {
	return [
		normalizeUrl(observation.url),
		observation.tabId ?? '',
		observation.targetId ?? '',
		observation.domHash ?? '',
		observation.elementCount ?? '',
		observation.pageRevision ?? ''
	].join('|');
}

export function recordObservation(run: AgentRun, observation: AgentObservation, windowSize = 8) {
	const fingerprint = observationFingerprint(observation);
	const recentFingerprints = [...run.recentFingerprints, fingerprint].slice(-clampInteger(windowSize, 3, 20, 8));
	let repetitionCount = 0;
	for (let index = recentFingerprints.length - 1; index >= 0 && recentFingerprints[index] === fingerprint; index -= 1) {
		repetitionCount += 1;
	}
	return appendEvent({
		...run,
		status: 'planning',
		recentFingerprints,
		repetitionCount,
		metrics: { ...run.metrics, observations: run.metrics.observations + 1 }
	}, {
		type: 'observation',
		at: observation.capturedAt ?? new Date().toISOString(),
		summary: `${observation.title || 'Untitled page'} (${normalizeUrl(observation.url)})`,
		data: { ...observation, fingerprint }
	});
}

export function replacePlan(run: AgentRun, items: Omit<AgentPlanItem, 'id' | 'status'>[]) {
	const revision = run.planRevision + 1;
	const plan = items.slice(0, 20).map((item, index) => ({
		...item,
		id: `plan-${revision}-${index + 1}`,
		status: index === 0 ? 'active' as const : 'pending' as const,
		completionCriteria: uniqueStrings(item.completionCriteria)
	}));
	return appendEvent({ ...run, status: 'acting', plan, planRevision: revision }, {
		type: 'plan',
		at: new Date().toISOString(),
		summary: `Plan revision ${revision} with ${plan.length} item(s).`
	});
}

export function compactAgentContext(run: AgentRun, recentEventLimit = 6): ContextCompaction {
	return {
		goal: run.goal,
		status: run.status,
		budget: {
			used: run.stepsUsed,
			remaining: Math.max(run.maxSteps - run.stepsUsed, 0),
			maximum: run.maxSteps
		},
		hardConstraints: run.hardConstraints,
		plan: run.plan,
		facts: run.facts.slice(-30),
		unresolved: run.unresolved.slice(-20),
		recentEvents: run.events.slice(-clampInteger(recentEventLimit, 1, 20, 6)),
		replanRequired: run.repetitionCount >= 3
	};
}

export function staleBatchReason(before: AgentObservation, after: AgentObservation, actionMutatesState: boolean) {
	if (before.tabId !== after.tabId || before.targetId !== after.targetId) {
		return 'active target changed';
	}
	if (normalizeUrl(before.url) !== normalizeUrl(after.url)) {
		return 'URL changed';
	}
	if (before.pageRevision && after.pageRevision && before.pageRevision !== after.pageRevision) {
		return 'page revision changed';
	}
	if (actionMutatesState && before.domHash && after.domHash && before.domHash !== after.domHash) {
		return 'DOM changed after a state-changing action';
	}
	return undefined;
}

export function judgeCompletion(evidence: CompletionEvidence): CompletionJudgement {
	if (evidence.authRequired || evidence.captchaDetected || evidence.reviewRequired) {
		return {
			status: 'waiting_review',
			passed: false,
			reason: evidence.authRequired ? 'Authentication is required.' : evidence.captchaDetected ? 'CAPTCHA requires operator review.' : 'Operator review is required.',
			missingClaims: []
		};
	}

	const requiredClaims = uniqueStrings(evidence.requiredClaims ?? []);
	const verified = new Set(uniqueStrings(evidence.verifiedClaims ?? []).map(value => value.toLowerCase()));
	const missingClaims = requiredClaims.filter(claim => !verified.has(claim.toLowerCase()));
	const errors = uniqueStrings(evidence.errors ?? []);
	const checks = [evidence.contractPassed, evidence.assertionsPassed, evidence.evidenceComplete].filter(value => value !== undefined);
	const failedChecks = checks.filter(value => value === false).length;

	if (errors.length > 0 && verified.size === 0) {
		return { status: 'failed', passed: false, reason: errors[0], missingClaims };
	}
	if (missingClaims.length > 0 || failedChecks > 0 || errors.length > 0) {
		return {
			status: 'partial',
			passed: false,
			reason: missingClaims.length > 0 ? `Missing ${missingClaims.length} required claim(s).` : failedChecks > 0 ? 'One or more completion checks failed.' : 'The run completed with errors.',
			missingClaims
		};
	}
	if (checks.length === 0 && requiredClaims.length === 0) {
		return { status: 'partial', passed: false, reason: 'No completion evidence was supplied.', missingClaims: [] };
	}
	return { status: 'completed', passed: true, reason: 'All supplied completion evidence passed.', missingClaims: [] };
}

export function shouldUseFallback(error: unknown) {
	const message = String(error instanceof Error ? error.message : error).toLowerCase();
	return ['truncat', 'schema', 'parse', 'invalid json', 'timeout', 'timed out'].some(signal => message.includes(signal));
}

function appendEvent(run: AgentRun, event: AgentRunEvent): AgentRun {
	return {
		...run,
		updatedAt: event.at,
		events: [...run.events, event].slice(-200)
	};
}

function normalizeUrl(value: string) {
	try {
		const url = new URL(value);
		url.hash = '';
		return url.toString();
	} catch {
		return value.trim();
	}
}

function uniqueStrings(values: string[]) {
	return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function clampInteger(value: number | undefined, minimum: number, maximum: number, fallback: number) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}

export function recordAgentStep(
	run: AgentRun,
	input: {
		type: Extract<AgentRunEvent['type'], 'action' | 'effect' | 'fact' | 'error' | 'review' | 'judgement'>;
		summary: string;
		data?: Record<string, unknown>;
		facts?: string[];
		unresolved?: string[];
		status?: AgentRunStatus;
		consumeStep?: boolean;
	}
) {
	const actions = run.metrics.actions + (input.type === 'action' ? 1 : 0);
	return appendEvent({
		...run,
		status: input.status ?? run.status,
		stepsUsed: run.stepsUsed + (input.consumeStep ? 1 : 0),
		facts: uniqueStrings([...run.facts, ...(input.facts ?? [])]).slice(-100),
		unresolved: uniqueStrings(input.unresolved ?? run.unresolved).slice(-50),
		metrics: { ...run.metrics, actions }
	}, {
		type: input.type,
		at: new Date().toISOString(),
		summary: input.summary,
		data: input.data
	});
}

export function markAgentReplan(run: AgentRun, reason: string) {
	return appendEvent({ ...run, status: 'planning', replanCount: run.replanCount + 1 }, {
		type: 'plan',
		at: new Date().toISOString(),
		summary: `Replan requested: ${reason}`
	});
}

export function finalizeAgentRun(run: AgentRun, judgement: CompletionJudgement) {
	return appendEvent({ ...run, status: judgement.status }, {
		type: 'judgement',
		at: new Date().toISOString(),
		summary: judgement.reason,
		data: { passed: judgement.passed, missingClaims: judgement.missingClaims }
	});
}

export function recordModelUsage(
	run: AgentRun,
	usage: { modelId: string; inputTokens?: number; outputTokens?: number; fallbackUsed?: boolean }
) {
	return {
		...run,
		metrics: {
			...run.metrics,
			modelRequests: run.metrics.modelRequests + 1,
			fallbacks: run.metrics.fallbacks + (usage.fallbackUsed ? 1 : 0),
			inputTokens: run.metrics.inputTokens + Math.max(Math.trunc(usage.inputTokens ?? 0), 0),
			outputTokens: run.metrics.outputTokens + Math.max(Math.trunc(usage.outputTokens ?? 0), 0),
			modelIds: uniqueStrings([...run.metrics.modelIds, usage.modelId])
		}
	};
}

export function updatePlanProgress(run: AgentRun, completedIds: string[] = [], blockedId?: string) {
	const completed = new Set(completedIds);
	let activated = false;
	const plan = run.plan.map(item => {
		if (completed.has(item.id)) {
			return { ...item, status: 'completed' as const };
		}
		if (blockedId === item.id) {
			return { ...item, status: 'blocked' as const };
		}
		if (!activated && item.status !== 'completed' && item.status !== 'blocked' && item.status !== 'skipped') {
			activated = true;
			return { ...item, status: 'active' as const };
		}
		return item.status === 'active' ? { ...item, status: 'pending' as const } : item;
	});
	return { ...run, plan };
}