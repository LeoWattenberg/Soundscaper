/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned lifecycle and progress authority for one aggregate assistance workflow. */

import { randomBytes } from 'node:crypto';

import {
	ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
	AssistanceWorkflowProgressTracker,
	assistanceWorkflowStageGraph,
	normalizeAssistanceWorkflowId,
	validateAssistanceWorkflow,
	type AssistanceWorkflowId,
	type AssistanceWorkflowOutputClaimV1,
	type AssistanceWorkflowProgressPhase,
	type AssistanceWorkflowProgressV1,
	type AssistanceWorkflowStageSpec,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import type {
	AssistanceWorkflowCustody,
	AssistanceWorkflowAuthenticatedOutputV1,
	AssistanceWorkflowCustodyHandleV1,
	AssistanceWorkflowOutputReservationRequest,
	AssistanceWorkflowProducerBindingRequest,
} from './assistance-workflow-custody.ts';

export const ASSISTANCE_WORKFLOW_BRIDGE_VERSION = 1;
export const ASSISTANCE_WORKFLOW_UNAVAILABLE_REASONS = Object.freeze([
	'workflow-runner-unavailable', 'stage-unavailable', 'model-unavailable',
] as const);

export type AssistanceWorkflowUnavailableReason =
	(typeof ASSISTANCE_WORKFLOW_UNAVAILABLE_REASONS)[number];

export interface AssistanceWorkflowJobV1 {
	readonly contractVersion: typeof ASSISTANCE_WORKFLOW_BRIDGE_VERSION;
	readonly jobId: string;
}

export interface AssistanceWorkflowCancellationV1 {
	readonly contractVersion: typeof ASSISTANCE_WORKFLOW_BRIDGE_VERSION;
	readonly jobId: string;
	readonly outcome: 'cancelled' | 'not-active';
}

export interface AssistanceWorkflowCompletedResultV1 {
	readonly contractVersion: typeof ASSISTANCE_WORKFLOW_BRIDGE_VERSION;
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowV1['workflowId'];
	readonly stageIds: readonly string[];
	readonly outputs: readonly AssistanceWorkflowOutputClaimV1[];
}

export type AssistanceWorkflowOutcomeV1 = Readonly<{
	contractVersion: typeof ASSISTANCE_WORKFLOW_BRIDGE_VERSION;
	jobId: string;
	workflowId: AssistanceWorkflowV1['workflowId'];
	outcome: 'completed';
	result: AssistanceWorkflowCompletedResultV1;
}> | Readonly<{
	contractVersion: typeof ASSISTANCE_WORKFLOW_BRIDGE_VERSION;
	jobId: string;
	workflowId: AssistanceWorkflowV1['workflowId'];
	outcome: 'unavailable';
	reason: AssistanceWorkflowUnavailableReason;
}>;

export type AssistanceWorkflowExecutionResult = Readonly<{
	outcome: 'completed';
}> | Readonly<{
	outcome: 'unavailable';
	reason: AssistanceWorkflowUnavailableReason;
}>;

export interface AssistanceWorkflowExecutionContext {
	readonly signal: AbortSignal;
	readonly stages: readonly AssistanceWorkflowStageSpec[];
	progress(
		stageId: string,
		phase: AssistanceWorkflowProgressPhase,
		completed?: number,
		total?: number,
	): void;
}

export interface AssistanceWorkflowServiceOptions {
	readonly mintJobId?: () => string;
	readonly custody?: Pick<AssistanceWorkflowCustody,
		'createJob' | 'assertJob' | 'reserveOutput' | 'bindProducer'
		| 'validateWorkflow' | 'openAuthenticatedOutput' | 'releaseJob'>;
	readonly onProgress?: (progress: AssistanceWorkflowProgressV1) => void;
	readonly execute?: (
		request: AssistanceWorkflowV1,
		context: AssistanceWorkflowExecutionContext,
	) => PromiseLike<AssistanceWorkflowExecutionResult> | AssistanceWorkflowExecutionResult;
}

interface ActiveRun {
	readonly controller: AbortController;
	readonly quiesced: Promise<void>;
}

export class AssistanceWorkflowCancelledError extends Error {
	readonly jobId: string;

	constructor(jobId: string, options?: ErrorOptions) {
		super('The assistance workflow was cancelled.', options);
		this.name = 'AssistanceWorkflowCancelledError';
		this.jobId = jobId;
	}
}

export function createAssistanceWorkflowService(options: AssistanceWorkflowServiceOptions = {}) {
	if (options.custody && options.mintJobId) {
		throw new TypeError('Workflow job identities must be minted by exactly one custody authority.');
	}
	const mintJobId = options.mintJobId ?? (() => randomBytes(20).toString('hex'));
	const jobs = new Set<string>();
	const completedJobs = new Set<string>();
	const reviewableJobs = new Set<string>();
	const activeRuns = new Map<string, ActiveRun>();

	async function createJob(): Promise<AssistanceWorkflowJobV1> {
		if (jobs.size >= 64) throw new Error('The assistance workflow job bound is exhausted.');
		const custodyJob = options.custody ? await options.custody.createJob() : null;
		const jobId = opaqueId(custodyJob?.jobId ?? mintJobId());
		if (custodyJob && custodyJob.contractVersion !== ASSISTANCE_WORKFLOW_BRIDGE_VERSION) {
			await options.custody?.releaseJob(jobId).catch(() => false);
			throw new TypeError('Workflow custody returned an unsupported job contract.');
		}
		if (jobs.has(jobId)) throw new Error('The assistance workflow job identity was reused.');
		jobs.add(jobId);
		return Object.freeze({ contractVersion: ASSISTANCE_WORKFLOW_BRIDGE_VERSION, jobId });
	}

	function assertJob(jobIdValue: unknown): void {
		const jobId = opaqueId(jobIdValue);
		if (!jobs.has(jobId)) {
			throw new Error('The assistance workflow job is unknown or completed.');
		}
		options.custody?.assertJob(jobId);
	}

	function admitWorkflow(value: unknown): AssistanceWorkflowV1 {
		const request = validateAssistanceWorkflow(value);
		assertJob(request.jobId);
		if (completedJobs.has(request.jobId)) {
			throw new Error('The assistance workflow job already completed execution.');
		}
		return options.custody?.validateWorkflow(request) ?? request;
	}

	async function reserveOutput(
		request: AssistanceWorkflowOutputReservationRequest,
	): Promise<AssistanceWorkflowCustodyHandleV1> {
		assertMutableJob(request?.jobId);
		if (!options.custody) throw new Error('Aggregate workflow custody is unavailable.');
		return options.custody.reserveOutput(request);
	}

	function bindProducer(
		request: AssistanceWorkflowProducerBindingRequest,
	): AssistanceWorkflowCustodyHandleV1 {
		assertMutableJob(request?.jobId);
		if (!options.custody) throw new Error('Aggregate workflow custody is unavailable.');
		return options.custody.bindProducer(request);
	}

	async function run(value: unknown): Promise<AssistanceWorkflowOutcomeV1> {
		const request = admitWorkflow(value);
		if (activeRuns.has(request.jobId)) throw new Error('The assistance workflow job is already running.');
		const controller = new AbortController();
		const execution = executeWorkflow(request, controller.signal);
		const active = Object.freeze({ controller, quiesced: execution.then(() => undefined, () => undefined) });
		activeRuns.set(request.jobId, active);
		try {
			const outcome = await execution;
			if (outcome.outcome === 'completed') reviewableJobs.add(request.jobId);
			return outcome;
		} catch (error) {
			if (controller.signal.aborted) {
				throw new AssistanceWorkflowCancelledError(request.jobId, {
					cause: controller.signal.reason ?? error,
				});
			}
			throw error;
		} finally {
			if (activeRuns.get(request.jobId) === active) activeRuns.delete(request.jobId);
			if (options.custody && jobs.has(request.jobId)) completedJobs.add(request.jobId);
			else jobs.delete(request.jobId);
		}
	}

	async function executeWorkflow(
		request: AssistanceWorkflowV1,
		signal: AbortSignal,
	): Promise<AssistanceWorkflowOutcomeV1> {
		const graph = assistanceWorkflowStageGraph(request.workflowId);
		const stages = Object.freeze(request.stageIds.map((stageId) =>
			graph.find((candidate) => candidate.stageId === stageId)!));
		const tracker = new AssistanceWorkflowProgressTracker(request);
		let sequence = 0;
		let last: AssistanceWorkflowProgressV1 | null = null;
		const progress: AssistanceWorkflowExecutionContext['progress'] = (
			stageId, phase, completedValue, totalValue,
		) => {
			signal.throwIfAborted();
			const stageIndex = request.stageIds.indexOf(stageId);
			const update = tracker.accept({
				contractVersion: ASSISTANCE_WORKFLOW_CONTRACT_VERSION,
				jobId: request.jobId,
				workflowId: request.workflowId,
				sequence,
				stageId,
				stageIndex,
				stageCount: stages.length,
				phase,
				completed: completedValue ?? null,
				total: totalValue ?? null,
			});
			sequence += 1;
			last = update;
			try { options.onProgress?.(update); } catch { /* Progress publication is observational. */ }
		};
		progress(stages[0]!.stageId, 'queued');
		const executionResult = options.execute
			? await options.execute(request, Object.freeze({ signal, stages, progress }))
			: unavailableExecution(stages, progress);
		signal.throwIfAborted();
		const result = validateExecutionResult(executionResult);
		if (result.outcome === 'unavailable') {
			return Object.freeze({
				contractVersion: ASSISTANCE_WORKFLOW_BRIDGE_VERSION,
				jobId: request.jobId,
				workflowId: request.workflowId,
				outcome: 'unavailable',
				reason: result.reason,
			});
		}
		const completedProgress = last as AssistanceWorkflowProgressV1 | null;
		if (!completedProgress || completedProgress.stageIndex !== stages.length - 1
			|| completedProgress.phase !== 'finalizing') {
			throw new TypeError('A completed assistance workflow must finalize every selected stage.');
		}
		const completed = Object.freeze({
			contractVersion: ASSISTANCE_WORKFLOW_BRIDGE_VERSION,
			jobId: request.jobId,
			workflowId: request.workflowId,
			stageIds: request.stageIds,
			outputs: request.outputs,
		});
		return Object.freeze({
			contractVersion: ASSISTANCE_WORKFLOW_BRIDGE_VERSION,
			jobId: request.jobId,
			workflowId: request.workflowId,
			outcome: 'completed',
			result: completed,
		});
	}

	async function cancel(jobIdValue: string): Promise<AssistanceWorkflowCancellationV1> {
		const jobId = opaqueId(jobIdValue);
		if (!jobs.has(jobId)) return cancellation(jobId, 'not-active');
		const active = activeRuns.get(jobId);
		active?.controller.abort(new AssistanceWorkflowCancelledError(jobId));
		if (active) await active.quiesced;
		activeRuns.delete(jobId);
		jobs.delete(jobId);
		completedJobs.delete(jobId);
		reviewableJobs.delete(jobId);
		await options.custody?.releaseJob(jobId);
		return cancellation(jobId, 'cancelled');
	}

	async function release(jobIdValue: string): Promise<boolean> {
		const jobId = opaqueId(jobIdValue);
		if (!jobs.has(jobId)) return false;
		if (activeRuns.has(jobId)) throw new Error('An active assistance workflow must be cancelled first.');
		jobs.delete(jobId);
		completedJobs.delete(jobId);
		reviewableJobs.delete(jobId);
		return options.custody ? options.custody.releaseJob(jobId) : true;
	}

	async function openOutput(value: unknown): Promise<AssistanceWorkflowAuthenticatedOutputV1> {
		const request = workflowOutputReadRequest(value);
		assertJob(request.jobId);
		if (!reviewableJobs.has(request.jobId)) {
			throw new Error('Only a completed assistance workflow may expose output for review.');
		}
		if (!options.custody) throw new Error('Aggregate workflow custody is unavailable.');
		const opened = await options.custody.openAuthenticatedOutput(request.claim);
		if (opened.custody.jobId !== request.jobId
			|| opened.custody.workflowId !== request.workflowId
			|| opened.custody.direction !== 'output'
			|| JSON.stringify(opened.workflowClaim) !== JSON.stringify(request.claim)) {
			throw new TypeError('The authenticated workflow output is not exactly correlated.');
		}
		return opened;
	}

	function assertMutableJob(jobIdValue: unknown): void {
		const jobId = opaqueId(jobIdValue);
		assertJob(jobId);
		if (activeRuns.has(jobId) || completedJobs.has(jobId)) {
			throw new Error('The assistance workflow custody is immutable after execution starts.');
		}
	}

	async function dispose(): Promise<void> {
		await Promise.all([...jobs].map((jobId) => cancel(jobId)));
	}

	return Object.freeze({ createJob, assertJob, admitWorkflow, reserveOutput,
		bindProducer, run, openOutput, cancel, release, dispose });
}

function workflowOutputReadRequest(value: unknown): Readonly<{
	jobId: string; workflowId: AssistanceWorkflowId; claim: AssistanceWorkflowOutputClaimV1;
}> {
	const record = exactRecord(value, ['jobId', 'workflowId', 'claim'], 'workflow output read request');
	const jobId = opaqueId(record.jobId);
	const workflowId = normalizeAssistanceWorkflowId(record.workflowId);
	const claim = exactRecord(record.claim,
		['claimVersion', 'direction', 'claimId', 'jobId', 'stageId', 'slotId'],
		'workflow output claim');
	if (claim.claimVersion !== 1 || claim.direction !== 'output'
		|| opaqueId(claim.jobId) !== jobId) {
		throw new TypeError('The workflow output claim is not job-correlated.');
	}
	return Object.freeze({ jobId, workflowId, claim: Object.freeze({ claimVersion: 1,
		direction: 'output', claimId: opaqueId(claim.claimId), jobId,
		stageId: slotId(claim.stageId), slotId: slotId(claim.slotId) }) });
}

function unavailableExecution(
	stages: readonly AssistanceWorkflowStageSpec[],
	progress: AssistanceWorkflowExecutionContext['progress'],
): AssistanceWorkflowExecutionResult {
	for (const [index, stage] of stages.entries()) {
		if (index > 0) progress(stage.stageId, 'queued');
		progress(stage.stageId, 'finalizing');
	}
	return Object.freeze({ outcome: 'unavailable', reason: 'workflow-runner-unavailable' });
}

function validateExecutionResult(value: unknown): AssistanceWorkflowExecutionResult {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError('The assistance workflow executor result is invalid.');
	}
	const record = value as Record<string, unknown>;
	if (record.outcome === 'completed' && Object.keys(record).length === 1) {
		return Object.freeze({ outcome: 'completed' });
	}
	if (record.outcome !== 'unavailable' || Object.keys(record).length !== 2
		|| typeof record.reason !== 'string'
		|| !ASSISTANCE_WORKFLOW_UNAVAILABLE_REASONS.includes(
			record.reason as AssistanceWorkflowUnavailableReason,
		)) {
		throw new TypeError('The assistance workflow executor result is invalid.');
	}
	return Object.freeze({ outcome: 'unavailable', reason: record.reason as AssistanceWorkflowUnavailableReason });
}

function cancellation(
	jobId: string,
	outcome: AssistanceWorkflowCancellationV1['outcome'],
): AssistanceWorkflowCancellationV1 {
	return Object.freeze({ contractVersion: ASSISTANCE_WORKFLOW_BRIDGE_VERSION, jobId, outcome });
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{40}$/u.test(value)) {
		throw new TypeError('The assistance workflow job ID is invalid.');
	}
	return value;
}

function slotId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u.test(value)) {
		throw new TypeError('The assistance workflow stage or slot is invalid.');
	}
	return value;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== keys.length
		|| Object.keys(record).some((key) => !keys.includes(key))) {
		throw new TypeError(`The ${label} carries unsupported fields.`);
	}
	return record;
}
