/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-owned projection of the workflow-v1 methods in the shared preload. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	validateAssistanceWorkflowProgress,
	type AssistanceWorkflowProgressV1,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import {
	assistanceWorkflowCustodySlotSpec,
	createAssistanceWorkflowCustodyClaimV1,
	validateAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
	type AssistanceWorkflowCustodyClaimV1,
} from '../assistance/workflow-custody-v1.ts';

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

export interface LocalAssistanceWorkflowCustodyHandle {
	readonly custody: AssistanceWorkflowCustodyClaimV1;
	readonly workflowClaim: ReturnType<typeof workflowClaimFromCustodyV1>;
}

export interface LocalAssistanceWorkflowCustodyBridge {
	stageInput(request: Readonly<{
		jobId: string;
		workflowId: AssistanceWorkflowV1['workflowId'];
		stageId: string;
		slotId: string;
		mediaType: string;
		bytes: Blob;
		signal: AbortSignal;
	}>): Promise<LocalAssistanceWorkflowCustodyHandle>;
	reserveOutput(request: Readonly<{
		jobId: string;
		workflowId: AssistanceWorkflowV1['workflowId'];
		stageId: string;
		slotId: string;
		maximumByteLength: number;
	}>): Promise<LocalAssistanceWorkflowCustodyHandle>;
	bindProducer(request: Readonly<{
		jobId: string;
		workflowId: AssistanceWorkflowV1['workflowId'];
		stageId: string;
		slotId: string;
		producer: AssistanceWorkflowCustodyClaimV1;
	}>): Promise<LocalAssistanceWorkflowCustodyHandle>;
	release(jobId: string): Promise<boolean>;
}

export interface LocalAssistanceWorkflowBridge {
	readonly custody?: LocalAssistanceWorkflowCustodyBridge;
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
	if ((keys.length !== METHODS.length && keys.length !== METHODS.length + 1)
		|| keys.some((key) => key !== 'custody' && !METHODS.includes(
			key as typeof METHODS[number],
	)) || METHODS.some((method) => typeof value[method] !== 'function')) return null;
	const custody = value.custody === undefined ? undefined : resolveCustody(value.custody);
	if (value.custody !== undefined && custody === null) return null;
	const invoke = (method: typeof METHODS[number], ...args: readonly unknown[]) =>
		(value[method] as (...parameters: readonly unknown[]) => unknown).apply(value, [...args]);
	const active = new Map<string, AssistanceWorkflowV1>();
	return Object.freeze({
		...(custody ? { custody } : {}),
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

function resolveCustody(value: unknown): LocalAssistanceWorkflowCustodyBridge | null {
	if (!isRecord(value)) return null;
	const methods = ['stageInput', 'reserveOutput', 'bindProducer', 'release'] as const;
	if (Object.keys(value).length !== methods.length || Object.keys(value).some((key) => !methods.includes(
		key as typeof methods[number],
	)) || methods.some((method) => typeof value[method] !== 'function')) return null;
	const invoke = (method: typeof methods[number], ...args: readonly unknown[]) =>
		(value[method] as (...parameters: readonly unknown[]) => unknown).apply(value, [...args]);
	return Object.freeze({
		async stageInput(requestValue: Parameters<LocalAssistanceWorkflowCustodyBridge['stageInput']>[0]) {
			const request = custodyInputRequest(requestValue);
			request.signal.throwIfAborted();
			const bytes = new Uint8Array(await request.bytes.arrayBuffer());
			request.signal.throwIfAborted();
			const digest = bytesToHex(sha256(bytes));
			const result = custodyHandle(await invoke('stageInput', Object.freeze({
				jobId: request.jobId, workflowId: request.workflowId,
				stageId: request.stageId, slotId: request.slotId,
				mediaType: request.mediaType, byteLength: bytes.byteLength,
				sha256: digest, bytes: request.bytes,
			})), request, 'input');
			if (result.custody.byteLength !== bytes.byteLength || result.custody.sha256 !== digest
				|| result.custody.mediaType !== request.mediaType || result.custody.producer !== null) {
				throw new TypeError('Staged workflow custody disagrees with its exact Blob.');
			}
			request.signal.throwIfAborted();
			return result;
		},
		async reserveOutput(requestValue: Parameters<LocalAssistanceWorkflowCustodyBridge['reserveOutput']>[0]) {
			const request = custodyReservationRequest(requestValue);
			const result = custodyHandle(await invoke('reserveOutput', request), request, 'output');
			if (result.custody.maximumByteLength !== request.maximumByteLength
				|| result.custody.byteLength !== null || result.custody.sha256 !== null) {
				throw new TypeError('Workflow output custody disagrees with its exact reservation.');
			}
			return result;
		},
		async bindProducer(requestValue: Parameters<LocalAssistanceWorkflowCustodyBridge['bindProducer']>[0]) {
			const request = custodyProducerRequest(requestValue);
			const result = custodyHandle(await invoke('bindProducer', request), request, 'input');
			const producer = result.custody.producer;
			if (!producer || producer.stageId !== request.producer.stageId
				|| producer.slotId !== request.producer.slotId
				|| producer.claimId !== request.producer.claimId
				|| result.custody.claimId !== request.producer.claimId) {
				throw new TypeError('Workflow producer custody is not exactly correlated.');
			}
			return result;
		},
		async release(jobIdValue: string) {
			const released = await invoke('release', jobId(jobIdValue));
			if (typeof released !== 'boolean') throw new TypeError('Workflow custody release must be boolean.');
			return released;
		},
	});
}

interface CustodyIdentity {
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowV1['workflowId'];
	readonly stageId: string;
	readonly slotId: string;
}

function custodyHandle(
	value: unknown,
	expected: CustodyIdentity,
	direction: 'input' | 'output',
): LocalAssistanceWorkflowCustodyHandle {
	const row = exactRecord(value, ['custody', 'workflowClaim'], 'custody result');
	const custody = validateAssistanceWorkflowCustodyClaimV1(row.custody);
	const workflowClaim = workflowClaimFromCustodyV1(custody);
	if (custody.direction !== direction || custody.jobId !== expected.jobId
		|| custody.workflowId !== expected.workflowId || custody.stageId !== expected.stageId
		|| custody.slotId !== expected.slotId
		|| JSON.stringify(row.workflowClaim) !== JSON.stringify(workflowClaim)) {
		throw new TypeError('Workflow custody result is not exactly correlated.');
	}
	return Object.freeze({ custody, workflowClaim });
}

function custodyInputRequest(
	value: Parameters<LocalAssistanceWorkflowCustodyBridge['stageInput']>[0],
): Parameters<LocalAssistanceWorkflowCustodyBridge['stageInput']>[0] {
	exactRecord(value, [
		'jobId', 'workflowId', 'stageId', 'slotId', 'mediaType', 'bytes', 'signal',
	], 'custody input request');
	if (!(value?.signal instanceof AbortSignal) || !(value.bytes instanceof Blob)
		|| value.bytes.size < 1) throw new TypeError('Workflow custody needs a nonempty Blob and signal.');
	const identity = custodyIdentity(value, 'input');
	const spec = assistanceWorkflowCustodySlotSpec(
		identity.workflowId, identity.stageId, 'input', identity.slotId,
	);
	if (!spec.mediaTypes.includes(value.mediaType)) {
		throw new TypeError('Workflow input media type is incompatible with its slot.');
	}
	return Object.freeze({ ...identity, mediaType: value.mediaType,
		bytes: value.bytes.slice(0, value.bytes.size, value.mediaType), signal: value.signal });
}

function custodyReservationRequest(
	value: Parameters<LocalAssistanceWorkflowCustodyBridge['reserveOutput']>[0],
): Parameters<LocalAssistanceWorkflowCustodyBridge['reserveOutput']>[0] {
	exactRecord(value, [
		'jobId', 'workflowId', 'stageId', 'slotId', 'maximumByteLength',
	], 'custody reservation request');
	const identity = custodyIdentity(value, 'output');
	if (!Number.isSafeInteger(value.maximumByteLength) || value.maximumByteLength < 1
		|| value.maximumByteLength > 16 * 1024 ** 4) {
		throw new RangeError('Workflow output reservation size is invalid.');
	}
	return Object.freeze({ ...identity, maximumByteLength: value.maximumByteLength });
}

function custodyProducerRequest(
	value: Parameters<LocalAssistanceWorkflowCustodyBridge['bindProducer']>[0],
): Parameters<LocalAssistanceWorkflowCustodyBridge['bindProducer']>[0] {
	exactRecord(value, [
		'jobId', 'workflowId', 'stageId', 'slotId', 'producer',
	], 'custody producer request');
	const identity = custodyIdentity(value);
	const producer = validateAssistanceWorkflowCustodyClaimV1(value.producer);
	if (producer.direction !== 'output' || producer.jobId !== identity.jobId
		|| producer.workflowId !== identity.workflowId) {
		throw new TypeError('Workflow producer custody must belong to the same job and recipe.');
	}
	createAssistanceWorkflowCustodyClaimV1({ custodyVersion: 1,
		workflowId: identity.workflowId, direction: 'input', jobId: identity.jobId,
		stageId: identity.stageId, slotId: identity.slotId, claimId: producer.claimId,
		role: producer.role, mediaType: producer.mediaType, byteLength: null, sha256: null,
		maximumByteLength: producer.maximumByteLength,
		producer: { stageId: producer.stageId, slotId: producer.slotId, claimId: producer.claimId },
	});
	return Object.freeze({ ...identity, producer });
}

function custodyIdentity(
	value: CustodyIdentity,
	direction?: 'input' | 'output',
): CustodyIdentity {
	if (!value || typeof value !== 'object') throw new TypeError('Workflow custody identity is required.');
	const expectedJobId = jobId(value.jobId);
	if (direction) {
		assistanceWorkflowCustodySlotSpec(value.workflowId, value.stageId, direction, value.slotId);
	} else {
		// Normalization still derives the closed workflow before producer validation below.
		assistanceWorkflowStageGraph(value.workflowId);
	}
	return Object.freeze({ jobId: expectedJobId, workflowId: value.workflowId,
		stageId: value.stageId, slotId: value.slotId });
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
