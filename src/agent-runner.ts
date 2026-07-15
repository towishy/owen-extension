import {
    compactAgentContext,
    createAgentRun,
    finalizeAgentRun,
    judgeCompletion,
    markAgentReplan,
    recordAgentStep,
    recordModelUsage,
    recordObservation,
    replacePlan,
    updatePlanProgress,
    type AgentObservation,
    type AgentPlanItem,
    type AgentRun,
    type CompletionEvidence,
    type CompletionJudgement,
    type ContextCompaction
} from './agent-runtime';

export type AgentBrowserAction = {
	action: string;
	[key: string]: unknown;
};

export type AgentBrowserResult = {
	ok: boolean;
	error?: string;
	authRequired?: boolean;
	reviewRequired?: boolean;
	browserState?: Record<string, unknown>;
	raw?: unknown;
};

export type AgentDecision = {
	evaluation: string;
	memory: string;
	nextGoal: string;
	plan?: Array<Omit<AgentPlanItem, 'id' | 'status'>>;
	completedPlanItemIds?: string[];
	blockedPlanItemId?: string;
	action?: AgentBrowserAction;
	facts?: string[];
	unresolved?: string[];
	done?: boolean;
	completionEvidence?: CompletionEvidence;
	usage?: { modelId: string; inputTokens?: number; outputTokens?: number; fallbackUsed?: boolean };
};

export type AgentDecisionInput = {
	context: ContextCompaction;
	browserState?: Record<string, unknown>;
	forceReplan: boolean;
};

export type AgentRunDependencies = {
	execute: (action: AgentBrowserAction) => Promise<AgentBrowserResult>;
	decide: (input: AgentDecisionInput) => Promise<AgentDecision>;
	observe: (result: AgentBrowserResult) => AgentObservation;
	judge?: (run: AgentRun, evidence: CompletionEvidence) => Promise<{
		judgement: CompletionJudgement;
		usage?: { modelId: string; inputTokens?: number; outputTokens?: number; fallbackUsed?: boolean };
	}>;
	persist?: (run: AgentRun) => Promise<void>;
	isCancelled?: () => boolean;
};

export type AgentRunOptions = {
	maxSteps?: number;
	maxRetriesPerStep?: number;
	hardConstraints?: string[];
	requiredClaims?: string[];
};

const STATE_CHANGING_ACTIONS = new Set([
	'click', 'type', 'navigate', 'scroll', 'keyPress', 'selectOption', 'clearInput', 'back', 'forward', 'reload',
	'openInNewTab', 'switchTab', 'closeTab', 'smartFormFill', 'rollbackToCheckpoint', 'tabOrchestrator', 'returnToTab'
]);

export class AgentRunner {
	constructor(private readonly dependencies: AgentRunDependencies) {}

	async run(runId: string, goal: string, options: AgentRunOptions = {}, previousRun?: AgentRun) {
		let run = previousRun
			? recordAgentStep({ ...previousRun, status: 'queued' }, { type: 'fact', summary: 'Run resumed by the operator.', status: 'queued' })
			: createAgentRun(runId, goal, options);
		await this.persist(run);

		while (run.stepsUsed < run.maxSteps) {
			if (this.dependencies.isCancelled?.()) {
			run = recordAgentStep(run, { type: 'review', summary: 'Run cancelled by the operator.', status: 'cancelled' });
			await this.persist(run);
			return run;
			}

			const observationResult = await this.dependencies.execute({ action: 'readPage', captureAfter: false, includeScreenshot: false });
			if (!observationResult.ok) {
				run = this.finishFromBrowserFailure(run, observationResult);
				await this.persist(run);
				return run;
			}

			run = recordObservation(run, this.dependencies.observe(observationResult));
			if (run.repetitionCount >= 3) {
				run = markAgentReplan(run, `The same browser state was observed ${run.repetitionCount} times.`);
			}
			if (run.repetitionCount >= 5 || run.replanCount >= 3) {
				run = finalizeAgentRun(run, {
					status: 'partial',
					passed: false,
					reason: 'The run stalled after repeated replanning and requires operator handoff.',
					missingClaims: options.requiredClaims ?? []
				});
				await this.persist(run);
				return run;
			}

			const decision = await this.dependencies.decide({
				context: compactAgentContext(run),
				browserState: observationResult.browserState,
				forceReplan: run.repetitionCount >= 3
			});
			if (decision.usage) {
				run = recordModelUsage(run, decision.usage);
			}
			if (decision.plan) {
				run = replacePlan(run, decision.plan);
			}
			run = updatePlanProgress(run, decision.completedPlanItemIds, decision.blockedPlanItemId);
			run = recordAgentStep(run, {
				type: 'fact',
				summary: `${decision.evaluation} Next: ${decision.nextGoal}`,
				facts: decision.facts,
				unresolved: decision.unresolved,
				data: { memory: decision.memory }
			});

			if (decision.done) {
				const evidence = {
					...decision.completionEvidence,
					requiredClaims: decision.completionEvidence?.requiredClaims ?? options.requiredClaims
				};
				let judgement = judgeCompletion(evidence);
				if (judgement.passed && this.dependencies.judge) {
					try {
						const judged = await this.dependencies.judge(run, evidence);
						judgement = judged.judgement;
						if (judged.usage) {
							run = recordModelUsage(run, judged.usage);
						}
					} catch {
						// Deterministic evidence remains authoritative when the optional judge is unavailable.
					}
				}
				run = finalizeAgentRun(run, judgement);
				await this.persist(run);
				return run;
			}

			if (!decision.action) {
				run = finalizeAgentRun(run, {
					status: 'failed',
					passed: false,
					reason: 'The planner returned neither an action nor a completion decision.',
					missingClaims: options.requiredClaims ?? []
				});
				await this.persist(run);
				return run;
			}

			const action = enforceSingleAction(decision.action);
			run = recordAgentStep(run, {
				type: 'action',
				summary: `Executing ${action.action}: ${decision.nextGoal}`,
				data: { action },
				status: 'acting',
				consumeStep: true
			});
			await this.persist(run);

			const actionResult = await this.dependencies.execute(action);
			if (!actionResult.ok) {
				run = this.finishFromBrowserFailure(run, actionResult);
				await this.persist(run);
				return run;
			}
			run = recordAgentStep(run, {
				type: 'effect',
				summary: `${action.action} completed; browser state will be observed again before another action.`,
				data: { mutatesState: STATE_CHANGING_ACTIONS.has(action.action) },
				status: 'verifying'
			});
			await this.persist(run);
		}

		run = finalizeAgentRun(run, {
			status: 'partial',
			passed: false,
			reason: `The run reached its ${run.maxSteps}-step budget.`,
			missingClaims: options.requiredClaims ?? []
		});
		await this.persist(run);
		return run;
	}

	private finishFromBrowserFailure(run: AgentRun, result: AgentBrowserResult) {
		if (result.authRequired || result.reviewRequired) {
			return finalizeAgentRun(run, judgeCompletion({ authRequired: result.authRequired, reviewRequired: result.reviewRequired }));
		}
		return finalizeAgentRun(recordAgentStep(run, {
			type: 'error',
			summary: result.error || 'Browser action failed.',
			data: { result: result.raw as Record<string, unknown> | undefined }
		}), judgeCompletion({ errors: [result.error || 'Browser action failed.'] }));
	}

	private async persist(run: AgentRun) {
		await this.dependencies.persist?.(run);
	}
}

function enforceSingleAction(action: AgentBrowserAction) {
	if (!action.action || typeof action.action !== 'string') {
		throw new Error('Agent action must include an action name.');
	}
	if (Array.isArray(action.steps) && action.steps.length > 1) {
		throw new Error('Agent runs allow only one browser action per observation cycle.');
	}
	return { ...action, captureAfter: action.captureAfter ?? false };
}