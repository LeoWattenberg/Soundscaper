/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-owned projection of the workflow-v1 methods in the shared preload. */

import {
	validateAssistanceWorkflow,
	validateAssistanceWorkflowProgress,
	type AssistanceWorkflowProgressV1,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';

export const LOCAL_ASSISTANCE_WORKFLOW_UNAVAILABLE_REASONS = Object.freeze([
	'workflow-runner-unavailable', 'stage-unavailable', 'model-unavailable',
] as const);

export type LocalAssistanceWorkflowUnavailableReason =
	(typeof LOCAL_ASSISTANCE_WORKFLOW_UNAVAILABLE_REASONS)[number];

export type LocalAssistanceWorkflowOutcome = Readonly<{
	contractVersion: 1;
	jobId: string;
	workflowId: AssistanceWorkflowV1['workflowId'];
	outcome: 'completed';
	result: Readonly<{
		contractVersion: 1;
		jobId: string;
		workflowId: AssistanceWorkflowV1['workflowId'];
		stageIds: readonly string[];
		outputs: AssistanceWorkflowV1['outputs'];
	}>;
}> | Readonly<{
	contractVersion: 1;
	jobId: string;
	workflowId: AssistanceWorkflowV1['workflowId'];
	outcome: 'unavailable';
	reason: LocalAssistanceWorkflowUnavailableReason;
}> | Readonly<{
	contractVersion: 1;
	jobId: string;
	workflowId: AssistanceWorkflowV1['workflowId'];
	outcome: 'consent-declined';
}>;

export interface LocalAssistanceWorkflowBridge {
	createJob(): Promise<Readonly<{ contractVersion: 1; jobId: string }>>;
	run(request: AssistanceWorkflowV1): Promise<LocalAssistanceWorkflowOutcome>;
	cancel(jobId: string): Promise<Readonly<{
		contractVersion: 1;
		jobId: string;
		outcome: 'cancelled' | 'not-active';
	}>>;
	onProgress(listener: (progress: AssistanceWorkflowProgressV1) => void): () => void;
}

const METHODS = Object.freeze(['createJob', 'run', 'cancel', 'onProgress'] as const);
const JOB_ID = /^[a-f\d]{40}$/u;

export function resolveLocalAssistanceWorkflowBridge(value: unknown): LocalAssistanceWorkflowBridge | null {
	if (!isRecord(value)) return null;
	const keys = Object.keys(value);
	if (keys.length !== METHODS.length || keys.some((key) => !METHODS.includes(
		key as typeof METHODS[number],
	)) || METHODS.some((method) => typeof value[method] !== 'function')) return null;
	const invoke = (method: typeof METHODS[number], ...args: readonly unknown[]) =>
		(value[method] as (...parameters: readonly unknown[]) => unknown).apply(value, [...args]);
	const active = new Map<string, AssistanceWorkflowV1>();
	return Object.freeze({
		async createJob() {
			const record = exactRecord(await invoke('createJob'), ['contractVersion', 'jobId'], 'job');
			if (record.contractVersion !== 1) throw new TypeError('The workflow contract version is unsupported.');
			return Object.freeze({ contractVersion: 1 as const, jobId: jobId(record.jobId) });
		},
		async run(requestValue: AssistanceWorkflowV1) {
			const request = validateAssistanceWorkflow(requestValue);
			if (active.has(request.jobId)) throw new Error('The assistance workflow is already active.');
			active.set(request.jobId, request);
			try { return normalizeOutcome(await invoke('run', request), request); }
			finally { active.delete(request.jobId); }
		},
		async cancel(jobIdValue: string) {
			const expectedJobId = jobId(jobIdValue);
			const record = exactRecord(await invoke('cancel', expectedJobId),
				['contractVersion', 'jobId', 'outcome'], 'cancellation');
			if (record.contractVersion !== 1 || jobId(record.jobId) !== expectedJobId
				|| (record.outcome !== 'cancelled' && record.outcome !== 'not-active')) {
				throw new TypeError('The assistance workflow cancellation is not correlated.');
			}
			return Object.freeze({ contractVersion: 1 as const, jobId: expectedJobId,
				outcome: record.outcome });
		},
		onProgress(listener: (progress: AssistanceWorkflowProgressV1) => void) {
			if (typeof listener !== 'function') throw new TypeError('A workflow progress listener is required.');
			const unsubscribe = invoke('onProgress', (progressValue: unknown) => {
				if (!isRecord(progressValue) || typeof progressValue.jobId !== 'string') return;
				const request = active.get(progressValue.jobId);
				if (!request) return;
				try { listener(validateAssistanceWorkflowProgress(progressValue, request)); }
				catch { /* Reject malformed, uncorrelated, or stale desktop events. */ }
			});
			if (typeof unsubscribe !== 'function') throw new TypeError('Workflow progress needs an unsubscribe function.');
			return () => { (unsubscribe as () => void)(); };
		},
	});
}

function normalizeOutcome(
	value: unknown,
	request: AssistanceWorkflowV1,
): LocalAssistanceWorkflowOutcome {
	const record = isRecord(value) ? value : {};
	if (record.outcome === 'consent-declined') {
		const exact = exactRecord(value,
			['contractVersion', 'jobId', 'workflowId', 'outcome'], 'outcome');
		correlate(exact, request);
		return Object.freeze({ contractVersion: 1, jobId: request.jobId,
			workflowId: request.workflowId, outcome: 'consent-declined' });
	}
	if (record.outcome === 'unavailable') {
		const exact = exactRecord(value,
			['contractVersion', 'jobId', 'workflowId', 'outcome', 'reason'], 'outcome');
		correlate(exact, request);
		if (!LOCAL_ASSISTANCE_WORKFLOW_UNAVAILABLE_REASONS.includes(
			exact.reason as LocalAssistanceWorkflowUnavailableReason,
		)) throw new TypeError('The assistance workflow unavailable reason is invalid.');
		return Object.freeze({ contractVersion: 1, jobId: request.jobId,
			workflowId: request.workflowId, outcome: 'unavailable',
			reason: exact.reason as LocalAssistanceWorkflowUnavailableReason });
	}
	const exact = exactRecord(value,
		['contractVersion', 'jobId', 'workflowId', 'outcome', 'result'], 'outcome');
	correlate(exact, request);
	if (exact.outcome !== 'completed') throw new TypeError('The assistance workflow outcome is invalid.');
	const result = exactRecord(exact.result,
		['contractVersion', 'jobId', 'workflowId', 'stageIds', 'outputs'], 'result');
	correlate(result, request);
	if (JSON.stringify(result.stageIds) !== JSON.stringify(request.stageIds)
		|| JSON.stringify(result.outputs) !== JSON.stringify(request.outputs)) {
		throw new TypeError('The assistance workflow result disagrees with its exact request.');
	}
	return Object.freeze({ contractVersion: 1, jobId: request.jobId, workflowId: request.workflowId,
		outcome: 'completed', result: Object.freeze({ contractVersion: 1, jobId: request.jobId,
			workflowId: request.workflowId, stageIds: request.stageIds, outputs: request.outputs }) });
}

function correlate(record: Record<string, unknown>, request: AssistanceWorkflowV1): void {
	if (record.contractVersion !== 1 || record.jobId !== request.jobId
		|| record.workflowId !== request.workflowId) {
		throw new TypeError('The assistance workflow response is not correlated.');
	}
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).length !== fields.length
		|| Object.keys(value).some((key) => !fields.includes(key))) {
		throw new TypeError(`The assistance workflow ${label} has invalid schema fields.`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value);
}

function jobId(value: unknown): string {
	if (typeof value !== 'string' || !JOB_ID.test(value)) {
		throw new TypeError('The assistance workflow opaque ID is invalid.');
	}
	return value;
}
