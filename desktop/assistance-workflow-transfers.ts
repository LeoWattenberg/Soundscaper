/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless MessagePort transfer adapter for slotted aggregate workflow data. */

import { randomBytes } from 'node:crypto';

import { AssistanceOperationTransfers } from './assistance-operation-transfers.ts';
import {
	validateAssistanceOutputClaim,
	type AssistanceInputRole,
} from './assistance-data-claims.ts';
import {
	assistanceWorkflowCustodySlotSpec,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import {
	normalizeAssistanceWorkflowId,
	type AssistanceWorkflowId,
	type AssistanceWorkflowOutputClaimV1,
} from '../src/common/editor/assistance/workflow.ts';
import type {
	AssistanceWorkflowCustody,
	AssistanceWorkflowCustodyHandleV1,
} from './assistance-workflow-custody.ts';
import type { createAssistanceWorkflowService } from './assistance-workflow-service.ts';
import {
	sendHelperDataPlaneFile,
	type HelperDataPlaneIoPort,
} from './helper-data-plane-io.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	validateHelperDataPlaneBinding,
	type HelperDataPlaneBinding,
} from './helper-data-plane.ts';

const MAXIMUM_PENDING_OUTPUTS = 64;

type Workflows = Pick<ReturnType<typeof createAssistanceWorkflowService>, 'openOutput'>;

interface WorkflowInputTransfer {
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly stageId: string;
	readonly slotId: string;
}

interface WorkflowOutputTransfer {
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly workflowClaim: AssistanceWorkflowOutputClaimV1;
	readonly mediaType: string;
	readonly binding: HelperDataPlaneBinding;
	readonly path: string;
	readonly controller: AbortController;
	transfer: Promise<void> | null;
}

export interface AssistanceWorkflowOutputTransferOffer {
	readonly contractVersion: 1;
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly workflowClaim: AssistanceWorkflowOutputClaimV1;
	readonly mediaType: string;
	readonly binding: HelperDataPlaneBinding;
}

export interface AssistanceWorkflowTransfersOptions {
	readonly custody: AssistanceWorkflowCustody;
	readonly workflows: Workflows;
	readonly mintStreamId?: () => string;
	readonly negotiationTimeoutMs?: number;
	readonly sendFile?: typeof sendHelperDataPlaneFile;
}

export class AssistanceWorkflowTransfers {
	readonly #custody: AssistanceWorkflowCustody;
	readonly #workflows: Workflows;
	readonly #transfers: AssistanceOperationTransfers;
	readonly #mintStreamId: () => string;
	readonly #sendFile: typeof sendHelperDataPlaneFile;
	readonly #pending = new Map<string, WorkflowInputTransfer>();
	readonly #outputs = new Map<string, WorkflowOutputTransfer>();

	constructor(options: AssistanceWorkflowTransfersOptions) {
		if (!options?.custody || typeof options.custody.stageRawInput !== 'function'
			|| typeof options.custody.bindStagedInput !== 'function'
			|| !options.workflows || typeof options.workflows.openOutput !== 'function') {
			throw new TypeError('Workflow transfers require main-owned aggregate custody.');
		}
		this.#custody = options.custody;
		this.#workflows = options.workflows;
		this.#mintStreamId = options.mintStreamId ?? (() => randomBytes(20).toString('hex'));
		this.#sendFile = options.sendFile ?? sendHelperDataPlaneFile;
		this.#transfers = new AssistanceOperationTransfers({
			operations: {
				assertJob: (jobId) => options.custody.assertJob(jobId),
				stageInput: (request) => options.custody.stageRawInput(request),
				openOutput: async () => { throw new Error('Workflow output reading is not requested here.'); },
			},
			mintStreamId: this.#mintStreamId,
			...(options.negotiationTimeoutMs
				? { negotiationTimeoutMs: options.negotiationTimeoutMs } : {}),
		});
	}

	prepareInput(value: unknown): ReturnType<AssistanceOperationTransfers['prepareInput']> {
		const request = inputRequest(value);
		const spec = assistanceWorkflowCustodySlotSpec(
			request.workflowId, request.stageId, 'input', request.slotId,
		);
		if (!spec.mediaTypes.includes(request.mediaType)) {
			throw new TypeError('The workflow input media type is incompatible with its exact slot.');
		}
		const offer = this.#transfers.prepareInput({ jobId: request.jobId,
			role: spec.role as AssistanceInputRole, mediaType: request.mediaType,
			byteLength: request.byteLength, sha256: request.sha256 });
		if (this.#pending.has(offer.streamId)) {
			throw new Error('The workflow input stream identity was reused.');
		}
		this.#pending.set(offer.streamId, Object.freeze({ jobId: request.jobId,
			workflowId: request.workflowId, stageId: request.stageId, slotId: request.slotId }));
		return offer;
	}

	acceptInputPort(value: unknown, port: HelperDataPlaneIoPort): Promise<void> {
		return this.#transfers.acceptInputPort(value, port);
	}

	async awaitInput(value: unknown): Promise<AssistanceWorkflowCustodyHandleV1> {
		const request = transferRequest(value);
		const pending = this.#pending.get(request.streamId);
		if (!pending || pending.jobId !== request.jobId) {
			throw new Error('The workflow input transfer is unknown or already settled.');
		}
		try {
			const claim = await this.#transfers.awaitInput(request);
			return this.#custody.bindStagedInput({ ...pending, claim });
		} finally {
			this.#pending.delete(request.streamId);
		}
	}

	async prepareOutput(value: unknown): Promise<AssistanceWorkflowOutputTransferOffer> {
		if (this.#outputs.size >= MAXIMUM_PENDING_OUTPUTS) {
			throw new Error('The workflow output transfer bound is exhausted.');
		}
		const request = outputReadRequest(value);
		const opened = await this.#workflows.openOutput(request);
		const claim = validateAssistanceOutputClaim(opened.claim);
		const spec = assistanceWorkflowCustodySlotSpec(
			request.workflowId, request.claim.stageId, 'output', request.claim.slotId,
		);
		if (JSON.stringify(opened.workflowClaim) !== JSON.stringify(request.claim)
			|| opened.custody.jobId !== request.jobId
			|| opened.custody.workflowId !== request.workflowId
			|| opened.custody.claimId !== request.claim.claimId
			|| claim.jobId !== request.jobId || claim.claimId !== request.claim.claimId
			|| claim.role !== spec.role || !spec.mediaTypes.includes(claim.mediaType)) {
			throw new TypeError('The opened workflow output is not exactly correlated.');
		}
		const streamId = opaqueId(this.#mintStreamId(), 'stream');
		if (this.#pending.has(streamId) || this.#outputs.has(streamId)) {
			throw new Error('The workflow output stream identity was reused.');
		}
		const binding = validateHelperDataPlaneBinding({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION, transport: 'message-port', streamId,
			direction: 'helper-to-host', byteLength: claim.byteLength, sha256: claim.sha256,
			maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES, maximumInFlightChunks: 1,
		});
		this.#outputs.set(streamId, { jobId: request.jobId, workflowId: request.workflowId,
			workflowClaim: request.claim, mediaType: claim.mediaType, binding, path: opened.path,
			controller: new AbortController(), transfer: null });
		return Object.freeze({ contractVersion: 1, jobId: request.jobId,
			workflowId: request.workflowId, workflowClaim: request.claim,
			mediaType: claim.mediaType, binding });
	}

	acceptOutputPort(value: unknown, port: HelperDataPlaneIoPort): Promise<void> {
		const control = outputPortRequest(value);
		const pending = this.#outputs.get(control.streamId);
		if (!pending || pending.transfer || pending.jobId !== control.jobId
			|| pending.workflowId !== control.workflowId
			|| JSON.stringify(pending.workflowClaim) !== JSON.stringify(control.workflowClaim)
			|| JSON.stringify(pending.binding) !== JSON.stringify(control.binding)) {
			port.close();
			throw new Error('The workflow output port has no exact pending negotiation.');
		}
		const transfer = this.#sendFile({ binding: pending.binding, path: pending.path,
			port, signal: pending.controller.signal }).then(() => undefined).finally(() => {
				this.#outputs.delete(control.streamId);
			});
		pending.transfer = transfer;
		return transfer;
	}

	async cancelJob(jobIdValue: unknown): Promise<void> {
		const jobId = opaqueId(jobIdValue, 'job');
		const tasks: Promise<unknown>[] = [this.#transfers.cancelJob(jobId)];
		for (const [streamId, pending] of this.#pending) {
			if (pending.jobId === jobId) this.#pending.delete(streamId);
		}
		for (const [streamId, pending] of this.#outputs) {
			if (pending.jobId !== jobId) continue;
			pending.controller.abort(new DOMException('Workflow output review was cancelled.', 'AbortError'));
			if (pending.transfer) tasks.push(pending.transfer);
			else this.#outputs.delete(streamId);
		}
		await Promise.allSettled(tasks);
		for (const [streamId, pending] of this.#outputs) {
			if (pending.jobId === jobId) this.#outputs.delete(streamId);
		}
	}

	async dispose(): Promise<void> {
		this.#pending.clear();
		const jobs = new Set([...this.#outputs.values()].map(({ jobId }) => jobId));
		await Promise.all([...jobs].map((jobId) => this.cancelJob(jobId)));
		await this.#transfers.dispose();
	}
}

function inputRequest(value: unknown): Readonly<{
	jobId: string; workflowId: AssistanceWorkflowId; stageId: string; slotId: string;
	mediaType: string; byteLength: number; sha256: string;
}> {
	const row = exactRecord(value, [
		'jobId', 'workflowId', 'stageId', 'slotId', 'mediaType', 'byteLength', 'sha256',
	], 'workflow input transfer');
	return Object.freeze({ jobId: opaqueId(row.jobId, 'job'),
		workflowId: normalizeAssistanceWorkflowId(row.workflowId),
		stageId: slotId(row.stageId, 'stage'), slotId: slotId(row.slotId, 'slot'),
		mediaType: mediaType(row.mediaType), byteLength: positiveBytes(row.byteLength),
		sha256: digest(row.sha256) });
}

function transferRequest(value: unknown): Readonly<{ jobId: string; streamId: string }> {
	const row = exactRecord(value, ['jobId', 'streamId'], 'workflow input transfer identity');
	return Object.freeze({ jobId: opaqueId(row.jobId, 'job'), streamId: opaqueId(row.streamId, 'stream') });
}

function outputReadRequest(value: unknown): Readonly<{
	jobId: string; workflowId: AssistanceWorkflowId; claim: AssistanceWorkflowOutputClaimV1;
}> {
	const row = exactRecord(value, ['jobId', 'workflowId', 'claim'], 'workflow output read request');
	const jobId = opaqueId(row.jobId, 'job');
	const workflowId = normalizeAssistanceWorkflowId(row.workflowId);
	const claim = workflowOutputClaim(row.claim, jobId, workflowId);
	return Object.freeze({ jobId, workflowId, claim });
}

function outputPortRequest(value: unknown): Readonly<{
	jobId: string; workflowId: AssistanceWorkflowId; workflowClaim: AssistanceWorkflowOutputClaimV1;
	streamId: string; binding: HelperDataPlaneBinding;
}> {
	const row = exactRecord(value,
		['jobId', 'workflowId', 'workflowClaim', 'streamId', 'binding'],
		'workflow output port request');
	const jobId = opaqueId(row.jobId, 'job');
	const workflowId = normalizeAssistanceWorkflowId(row.workflowId);
	const workflowClaim = workflowOutputClaim(row.workflowClaim, jobId, workflowId);
	const streamId = opaqueId(row.streamId, 'stream');
	const binding = validateHelperDataPlaneBinding(row.binding);
	if (binding.streamId !== streamId || binding.direction !== 'helper-to-host') {
		throw new TypeError('The workflow output binding is not correlated.');
	}
	return Object.freeze({ jobId, workflowId, workflowClaim, streamId, binding });
}

function workflowOutputClaim(
	value: unknown, jobId: string, workflowId: AssistanceWorkflowId,
): AssistanceWorkflowOutputClaimV1 {
	const row = exactRecord(value,
		['claimVersion', 'direction', 'claimId', 'jobId', 'stageId', 'slotId'],
		'workflow output claim');
	const stageId = slotId(row.stageId, 'stage');
	const claimSlotId = slotId(row.slotId, 'slot');
	if (row.claimVersion !== 1 || row.direction !== 'output'
		|| opaqueId(row.jobId, 'job') !== jobId) {
		throw new TypeError('The workflow output claim is not job-correlated.');
	}
	assistanceWorkflowCustodySlotSpec(workflowId, stageId, 'output', claimSlotId);
	return Object.freeze({ claimVersion: 1, direction: 'output',
		claimId: opaqueId(row.claimId, 'claim'), jobId, stageId, slotId: claimSlotId });
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))) {
		throw new TypeError(`The ${label} schema fields are invalid.`);
	}
	return row;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f\d]{40}$/u.test(value)) {
		throw new TypeError(`The workflow ${label} ID is invalid.`);
	}
	return value;
}

function slotId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u.test(value)) {
		throw new TypeError(`The workflow ${label} is invalid.`);
	}
	return value;
}

function mediaType(value: unknown): string {
	if (typeof value !== 'string' || value.length > 255
		|| !/^[a-z\d][a-z\d!#$&^_.+-]*\/[a-z\d][a-z\d!#$&^_.+-]*$/u.test(value)) {
		throw new TypeError('The workflow media type is invalid.');
	}
	return value;
}

function positiveBytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 16 * 1024 ** 4) {
		throw new RangeError('The workflow input byte length is invalid.');
	}
	return Number(value);
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) {
		throw new TypeError('The workflow input digest is invalid.');
	}
	return value;
}
