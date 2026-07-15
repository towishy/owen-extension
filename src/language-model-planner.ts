import * as vscode from 'vscode';
import type { AgentDecision, AgentDecisionInput } from './agent-runner';
import { shouldUseFallback, type AgentRun, type CompletionEvidence, type CompletionJudgement } from './agent-runtime';

type ModelUsage = { modelId: string; inputTokens: number; outputTokens: number; fallbackUsed: boolean };

export type LanguageModelPlannerOptions = {
	modelId?: string;
	fallbackModelId?: string;
	allowedActions: string[];
	actionDescriptions?: Record<string, string>;
	token?: vscode.CancellationToken;
};

export async function createLanguageModelPlanner(options: LanguageModelPlannerOptions) {
	const models = await selectModels(options.modelId, options.fallbackModelId);
	return async (input: AgentDecisionInput): Promise<AgentDecision> => {
		const prompt = buildPlannerPrompt(input, options.allowedActions, options.actionDescriptions);
		const { parsed, usage } = await requestStructuredJson<AgentDecision>(
			models.primary,
			models.fallback,
			prompt,
			options.token,
			decision => validateDecision(decision, options.allowedActions)
		);
		return { ...parsed, usage };
	};
}

export async function createLanguageModelJudge(options: Omit<LanguageModelPlannerOptions, 'allowedActions'>) {
	const models = await selectModels(options.modelId, options.fallbackModelId);
	return async (run: AgentRun, evidence: CompletionEvidence) => {
		const prompt = [
			'You are the completion judge for an operator-supervised browser run.',
			'Return JSON only: {"passed":boolean,"status":"completed|partial","reason":string,"missingClaims":string[]}.',
			'Never mark a run completed when required claims are missing, a contract/assertion failed, or the trace lacks evidence.',
			`Goal: ${run.goal}`,
			`Plan: ${JSON.stringify(run.plan)}`,
			`Facts: ${JSON.stringify(run.facts)}`,
			`Evidence: ${JSON.stringify(evidence)}`,
			`Recent trace: ${JSON.stringify(run.events.slice(-12))}`
		].join('\n').slice(0, 48000);
		const result = await requestStructuredJson<CompletionJudgement>(models.primary, models.fallback, prompt, options.token);
		const judgement: CompletionJudgement = {
			passed: result.parsed.passed === true,
			status: result.parsed.passed === true ? 'completed' : 'partial',
			reason: String(result.parsed.reason || 'The completion judge did not provide a reason.'),
			missingClaims: Array.isArray(result.parsed.missingClaims) ? result.parsed.missingClaims.map(String).slice(0, 20) : []
		};
		return { judgement, usage: result.usage };
	};
}

export function parseStructuredJson<T>(text: string): T {
	const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
	const start = trimmed.indexOf('{');
	const end = trimmed.lastIndexOf('}');
	if (start < 0 || end <= start) {
		throw new Error('Model output was truncated or did not contain a JSON object.');
	}
	try {
		return JSON.parse(trimmed.slice(start, end + 1)) as T;
	} catch (error) {
		throw new Error(`Invalid JSON model response: ${String(error instanceof Error ? error.message : error)}`);
	}
}

async function selectModels(modelId?: string, fallbackModelId?: string) {
	const candidates = modelId
		? await vscode.lm.selectChatModels({ id: modelId })
		: await vscode.lm.selectChatModels({ vendor: 'copilot' });
	if (candidates.length === 0) {
		throw new Error(modelId ? `Configured browser agent model is unavailable: ${modelId}` : 'No Copilot language model is available for browser agent planning.');
	}
	const primary = candidates[0];
	let fallback: vscode.LanguageModelChat | undefined;
	if (fallbackModelId) {
		fallback = (await vscode.lm.selectChatModels({ id: fallbackModelId }))[0];
	} else {
		fallback = candidates.find(model => model.id !== primary.id);
	}
	return { primary, fallback };
}

async function requestStructuredJson<T>(
	primary: vscode.LanguageModelChat,
	fallback: vscode.LanguageModelChat | undefined,
	prompt: string,
	token?: vscode.CancellationToken,
	validate?: (value: T) => void
) {
	try {
		return await requestModel<T>(primary, prompt, false, token, validate);
	} catch (error) {
		if (!fallback || !shouldUseFallback(error)) {
			throw error;
		}
		return requestModel<T>(fallback, prompt, true, token, validate);
	}
}

async function requestModel<T>(
	model: vscode.LanguageModelChat,
	prompt: string,
	fallbackUsed: boolean,
	token?: vscode.CancellationToken,
	validate?: (value: T) => void
) {
	const inputTokens = await safeCountTokens(model, prompt, token);
	const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
	let text = '';
	for await (const chunk of response.text) {
		text += chunk;
	}
	const outputTokens = await safeCountTokens(model, text, token);
	const parsed = parseStructuredJson<T>(text);
	validate?.(parsed);
	return {
		parsed,
		usage: { modelId: model.id, inputTokens, outputTokens, fallbackUsed } satisfies ModelUsage
	};
}

function buildPlannerPrompt(input: AgentDecisionInput, allowedActions: string[], actionDescriptions: Record<string, string> = {}) {
	return [
		'You are the planner for Owen Browser Bridge, an operator-supervised browser agent.',
		'Return one JSON object only. Do not wrap it in Markdown.',
		'Output schema:',
		'{"evaluation":string,"memory":string,"nextGoal":string,"plan":[{"goal":string,"completionCriteria":string[]}],"completedPlanItemIds":string[],"blockedPlanItemId":string,"action":{"action":string,...},"facts":string[],"unresolved":string[],"done":boolean,"completionEvidence":{"requiredClaims":string[],"verifiedClaims":string[],"contractPassed":boolean,"assertionsPassed":boolean,"evidenceComplete":boolean}}',
		'Choose exactly one action or done=true. Never return multiple actions or a steps array.',
		'Do not type passwords, MFA codes, tokens, cookies, or secrets. Do not claim success without visible evidence.',
		'Destructive, approval, policy-change, download, upload, and bulk actions require an explicit human review action first.',
		input.forceReplan ? 'The run is stalled. Select a materially different approach or finish with partial evidence.' : '',
		`Allowed actions: ${allowedActions.join(', ')}`,
		Object.keys(actionDescriptions).length > 0 ? `Custom action catalog: ${JSON.stringify(actionDescriptions)}` : '',
		`Compacted run context: ${JSON.stringify(input.context)}`,
		`Current browser state: ${JSON.stringify(input.browserState ?? {}).slice(0, 30000)}`
	].filter(Boolean).join('\n').slice(0, 48000);
}

function validateDecision(decision: AgentDecision, allowedActions: string[]) {
	if (!decision || typeof decision !== 'object') {
		throw new Error('Invalid planner schema: decision must be an object.');
	}
	for (const field of ['evaluation', 'memory', 'nextGoal'] as const) {
		if (typeof decision[field] !== 'string') {
			throw new Error(`Invalid planner schema: ${field} must be a string.`);
		}
	}
	if (decision.done !== true && (!decision.action || typeof decision.action.action !== 'string')) {
		throw new Error('Invalid planner schema: one action or done=true is required.');
	}
	if (decision.action && !allowedActions.includes(decision.action.action)) {
		throw new Error(`Invalid planner schema: action is not allowed: ${decision.action.action}`);
	}
	if (decision.action && Array.isArray(decision.action.steps)) {
		throw new Error('Invalid planner schema: steps arrays are not allowed in an Agent Run decision.');
	}
}

async function safeCountTokens(model: vscode.LanguageModelChat, text: string, token?: vscode.CancellationToken) {
	try {
		return await model.countTokens(text, token);
	} catch {
		return 0;
	}
}