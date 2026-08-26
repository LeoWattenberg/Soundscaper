/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless MessagePort transfer adapter for slotted aggregate workflow inputs. */

import { AssistanceOperationTransfers } from './assistance-operation-transfers.ts';
import type { AssistanceInputRole } from './assistance-data-claims.ts';
import {
	assistanceWorkflowCustodySlotSpec,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import {
	normalizeAssistanceWorkflowId,
	type AssistanceWorkflowId,
} from '../src/common/editor/assistance/workflow.ts';
import type {
	AssistanceWorkflowCustody,
	AssistanceWorkflowCustodyHandleV1,
} from './assistance-workflow-custody.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';

interface WorkflowInputTransfer {
	readonly jobId: string;
	readonly workflowId: AssistanceWorkflowId;
	readonly stageId: string;
	readonly slotId: string;
}

export interface AssistanceWorkflowTransfersOptions {
	readonly custody: AssistanceWorkflowCustody;
	readonly mintStreamId?: () => string;
	readonly negotiationTimeoutMs?: number;
}

export class AssistanceWorkflowTransfers {
	readonly #custody: AssistanceWorkflowCustody;
	readonly #transfers: AssistanceOperationTransfers;
	readonly #pending = new Map<string, WorkflowInputTransfer>();

	constructor(options: AssistanceWorkflowTransfersOptions) {
		if (!options?.custody || typeof options.custody.stageRawInput !== 'function'
			|| typeof options.custody.bindStagedInput !== 'function') {
			throw new TypeError('Workflow transfers require main-owned aggregate custody.');
		}
		this.#custody = options.custody;
		this.#transfers = new AssistanceOperationTransfers({
			operations: {
				assertJob: (jobId) => options.custody.assertJob(jobId),
				stageInput: (request) => options.custody.stageRawInput(request),
				openOutput: async () => { throw new Error('Workflow output reading is not requested here.'); },
			},
			...(options.mintStreamId ? { mintStreamId: options.mintStreamId } : {}),
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

	async cancelJob(jobIdValue: unknown): Promise<void> {
		const jobId = opaqueId(jobIdValue, 'job');
		await this.#transfers.cancelJob(jobId);
		for (const [streamId, pending] of this.#pending) {
			if (pending.jobId === jobId) this.#pending.delete(streamId);
		}
	}

	async dispose(): Promise<void> {
		this.#pending.clear();
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
