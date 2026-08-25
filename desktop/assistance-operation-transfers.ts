/* SPDX-License-Identifier: AGPL-3.0-only */

/** Negotiated MessagePort transport for renderer-pathless assistance data. */

import { randomBytes } from 'node:crypto';

import {
	ASSISTANCE_DATA_CLAIM_VERSION,
	validateAssistanceOutputClaim,
	validateAssistanceStagedInputClaim,
	type AssistanceInputRole,
	type AssistanceOutputClaim,
	type AssistanceStagedInputClaim,
} from './assistance-data-claims.ts';
import { ASSISTANCE_OPERATION_BRIDGE_VERSION } from './assistance-operation-service.ts';
import type { createAssistanceOperationService } from './assistance-operation-service.ts';
import {
	receiveHelperDataPlaneInputStream,
	sendHelperDataPlaneFile,
	type HelperDataPlaneByteSink,
	type HelperDataPlaneIoPort,
} from './helper-data-plane-io.ts';
import {
	HELPER_DATA_PLANE_INPUT_AUTHENTICATION,
	validateHelperDataPlaneInputReservation,
	type HelperDataPlaneInputReservation,
} from './helper-data-plane-input-reservation.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	validateHelperDataPlaneBinding,
	type HelperDataPlaneBinding,
	type HelperDataPlaneCompletion,
} from './helper-data-plane.ts';

const ID = /^[a-f\d]{40}$/u;
const MAXIMUM_PENDING_TRANSFERS = 64;
const DEFAULT_NEGOTIATION_TIMEOUT_MS = 30_000;

type Operations = Pick<ReturnType<typeof createAssistanceOperationService>,
	'assertJob' | 'stageInput' | 'openOutput'>;

export interface AssistanceOperationTransfersOptions {
	readonly operations: Operations;
	readonly mintStreamId?: () => string;
	readonly negotiationTimeoutMs?: number;
	readonly sendFile?: typeof sendHelperDataPlaneFile;
}

export interface AssistanceInputTransferOffer {
	readonly contractVersion: typeof ASSISTANCE_OPERATION_BRIDGE_VERSION;
	readonly jobId: string;
	readonly streamId: string;
	readonly reservation: HelperDataPlaneInputReservation;
}

export interface AssistanceOutputTransferOffer {
	readonly contractVersion: typeof ASSISTANCE_OPERATION_BRIDGE_VERSION;
	readonly jobId: string;
	readonly binding: HelperDataPlaneBinding;
}

interface PendingInput {
	readonly jobId: string;
	readonly role: AssistanceInputRole;
	readonly mediaType: string;
	readonly expectedSha256: string;
	readonly reservation: HelperDataPlaneInputReservation;
	readonly controller: AbortController;
	readonly completion: Promise<AssistanceStagedInputClaim>;
	readonly resolve: (claim: AssistanceStagedInputClaim) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
	attached: boolean;
	transfer: Promise<void> | null;
}

interface PendingOutput {
	readonly jobId: string;
	readonly claim: AssistanceOutputClaim;
	readonly binding: HelperDataPlaneBinding;
	readonly path: string;
	readonly controller: AbortController;
	transfer: Promise<void> | null;
}

export class AssistanceOperationTransfers {
	readonly #operations: Operations;
	readonly #mintStreamId: () => string;
	readonly #timeoutMs: number;
	readonly #sendFile: typeof sendHelperDataPlaneFile;
	readonly #inputs = new Map<string, PendingInput>();
	readonly #outputs = new Map<string, PendingOutput>();

	constructor(options: AssistanceOperationTransfersOptions) {
		this.#operations = options.operations;
		this.#mintStreamId = options.mintStreamId ?? (() => randomBytes(20).toString('hex'));
		this.#timeoutMs = integer(options.negotiationTimeoutMs ?? DEFAULT_NEGOTIATION_TIMEOUT_MS,
			1, 300_000, 'Assistance transfer timeout is invalid.');
		this.#sendFile = options.sendFile ?? sendHelperDataPlaneFile;
	}

	prepareInput(value: unknown): AssistanceInputTransferOffer {
		this.#assertCapacity();
		const request = inputRequest(value);
		this.#operations.assertJob(request.jobId);
		const streamId = opaqueId(this.#mintStreamId(), 'stream');
		if (this.#inputs.has(streamId) || this.#outputs.has(streamId)) {
			throw new Error('An assistance transfer stream identity collided.');
		}
		const reservation = validateHelperDataPlaneInputReservation({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION, transport: 'message-port', streamId,
			direction: 'host-to-helper', authentication: HELPER_DATA_PLANE_INPUT_AUTHENTICATION,
			byteLength: request.byteLength, maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES,
			maximumInFlightChunks: 1,
		});
		let resolve!: (claim: AssistanceStagedInputClaim) => void;
		let reject!: (error: Error) => void;
		const completion = new Promise<AssistanceStagedInputClaim>((yes, no) => { resolve = yes; reject = no; });
		void completion.catch(() => undefined);
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort(abortError('Assistance input negotiation timed out.'));
			this.#failInput(streamId, abortError('Assistance input negotiation timed out.'));
		}, this.#timeoutMs);
		this.#inputs.set(streamId, {
			...request, expectedSha256: request.sha256, reservation, controller,
			completion, resolve, reject, timeout, attached: false, transfer: null,
		});
		return Object.freeze({ contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION,
			jobId: request.jobId, streamId, reservation });
	}

	acceptInputPort(value: unknown, port: HelperDataPlaneIoPort): Promise<void> {
		const control = inputPortRequest(value);
		const pending = this.#inputs.get(control.streamId);
		if (!pending || pending.jobId !== control.jobId || pending.attached
			|| !sameInputReservation(pending.reservation, control.reservation)) {
			port.close();
			throw new Error('The assistance input port has no exact pending negotiation.');
		}
		pending.attached = true;
		clearTimeout(pending.timeout);
		const queue = new AssistanceTransferByteQueue();
		const staged = this.#operations.stageInput({
			jobId: pending.jobId, role: pending.role, mediaType: pending.mediaType,
			byteLength: pending.reservation.byteLength, bytes: queue,
			signal: pending.controller.signal,
		});
		const received = receiveHelperDataPlaneInputStream({
			reservation: pending.reservation, port, sink: queue, signal: pending.controller.signal,
		});
		const transfer = (async (): Promise<void> => {
			try {
				const [claim, completion] = await Promise.all([staged, received]);
				assertInputCompletion(claim, completion, pending.expectedSha256);
				pending.resolve(claim);
			} catch (error) {
				pending.controller.abort(error);
				queue.abort(error);
				await Promise.allSettled([staged, received]);
				pending.reject(asError(error, 'The assistance input transfer failed.'));
				throw error;
			}
		})();
		pending.transfer = transfer;
		return transfer;
	}

	async awaitInput(value: unknown): Promise<AssistanceStagedInputClaim> {
		const request = transferIdRequest(value);
		const pending = this.#inputs.get(request.streamId);
		if (!pending || pending.jobId !== request.jobId) {
			throw new Error('The assistance input transfer is unknown or already settled.');
		}
		try { return await pending.completion; }
		finally { clearTimeout(pending.timeout); this.#inputs.delete(request.streamId); }
	}

	async prepareOutput(value: unknown): Promise<AssistanceOutputTransferOffer> {
		this.#assertCapacity();
		const request = outputRequest(value);
		const opened = await this.#operations.openOutput(request);
		const binding = validateHelperDataPlaneBinding(opened.binding);
		if (binding.direction !== 'helper-to-host' || this.#inputs.has(binding.streamId)
			|| this.#outputs.has(binding.streamId)) {
			throw new Error('The assistance output transfer binding is invalid or duplicated.');
		}
		this.#outputs.set(binding.streamId, {
			jobId: request.jobId, claim: request.claim, binding, path: opened.path,
			controller: new AbortController(), transfer: null,
		});
		return Object.freeze({ contractVersion: ASSISTANCE_OPERATION_BRIDGE_VERSION,
			jobId: request.jobId, binding });
	}

	acceptOutputPort(value: unknown, port: HelperDataPlaneIoPort): Promise<void> {
		const control = outputPortRequest(value);
		const pending = this.#outputs.get(control.streamId);
		if (!pending || pending.jobId !== control.jobId || pending.transfer
			|| !sameBinding(pending.binding, control.binding)) {
			port.close();
			throw new Error('The assistance output port has no exact pending negotiation.');
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
		const tasks: Promise<unknown>[] = [];
		for (const [streamId, pending] of this.#inputs) {
			if (pending.jobId !== jobId) continue;
			const error = abortError('The assistance input transfer was cancelled.');
			pending.controller.abort(error); pending.reject(error); clearTimeout(pending.timeout);
			if (pending.transfer) tasks.push(pending.transfer);
			else this.#inputs.delete(streamId);
		}
		for (const [streamId, pending] of this.#outputs) {
			if (pending.jobId !== jobId) continue;
			pending.controller.abort(abortError('The assistance output transfer was cancelled.'));
			if (pending.transfer) tasks.push(pending.transfer);
			else this.#outputs.delete(streamId);
		}
		await Promise.allSettled(tasks);
	}

	async dispose(): Promise<void> {
		const jobs = new Set([...this.#inputs.values(), ...this.#outputs.values()].map(({ jobId }) => jobId));
		await Promise.all([...jobs].map((jobId) => this.cancelJob(jobId)));
	}

	#failInput(streamId: string, error: Error): void {
		const pending = this.#inputs.get(streamId);
		if (!pending) return;
		clearTimeout(pending.timeout); pending.reject(error);
		if (!pending.attached) this.#inputs.delete(streamId);
	}

	#assertCapacity(): void {
		if (this.#inputs.size + this.#outputs.size >= MAXIMUM_PENDING_TRANSFERS) {
			throw new Error('The assistance transfer negotiation bound is exhausted.');
		}
	}
}

class AssistanceTransferByteQueue implements AsyncIterable<Uint8Array>, HelperDataPlaneByteSink {
	#offered: Readonly<{ bytes: Uint8Array; consumed: () => void }> | null = null;
	#waiting: (() => void) | null = null;
	#complete = false;
	#failure: Error | null = null;

	write(bytes: Uint8Array): Promise<void> {
		if (this.#failure || this.#complete || this.#offered) {
			return Promise.reject(this.#failure ?? new Error('The assistance input queue is not writable.'));
		}
		return new Promise((resolve) => {
			this.#offered = Object.freeze({ bytes: new Uint8Array(bytes), consumed: resolve });
			this.#wake();
		});
	}

	complete(): void { this.#complete = true; this.#wake(); }
	abort(reason: unknown): void {
		if (this.#failure) return;
		this.#failure = asError(reason, 'The assistance input queue was cancelled.');
		this.#offered?.consumed(); this.#offered = null; this.#wake();
	}

	[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
		return Object.freeze({
			next: () => this.#next(),
			return: async (): Promise<IteratorResult<Uint8Array>> => {
				this.abort(abortError('The assistance staging consumer closed.'));
				return { done: true, value: undefined };
			},
		});
	}

	async #next(): Promise<IteratorResult<Uint8Array>> {
		if (this.#failure) throw this.#failure;
		if (this.#offered) {
			const offered = this.#offered; this.#offered = null; offered.consumed();
			return { done: false, value: offered.bytes };
		}
		if (this.#complete) return { done: true, value: undefined };
		await new Promise<void>((resolve) => { this.#waiting = resolve; });
		return this.#next();
	}

	#wake(): void { const waiting = this.#waiting; this.#waiting = null; waiting?.(); }
}

function inputRequest(value: unknown): Readonly<{
	jobId: string; role: AssistanceInputRole; mediaType: string; byteLength: number; sha256: string;
}> {
	const record = exactRecord(value, ['jobId', 'role', 'mediaType', 'byteLength', 'sha256'], 'input request');
	const validated = validateAssistanceStagedInputClaim({
		claimVersion: ASSISTANCE_DATA_CLAIM_VERSION, claimId: '0'.repeat(40),
		jobId: record.jobId, role: record.role, mediaType: record.mediaType,
		byteLength: record.byteLength, sha256: record.sha256,
	});
	return Object.freeze({ jobId: validated.jobId, role: validated.role, mediaType: validated.mediaType,
		byteLength: validated.byteLength, sha256: validated.sha256 });
}

function inputPortRequest(value: unknown): Readonly<{
	jobId: string; streamId: string; reservation: HelperDataPlaneInputReservation;
}> {
	const record = exactRecord(value, ['jobId', 'streamId', 'reservation'], 'input port request');
	return Object.freeze({ jobId: opaqueId(record.jobId, 'job'), streamId: opaqueId(record.streamId, 'stream'),
		reservation: validateHelperDataPlaneInputReservation(record.reservation) });
}

function outputRequest(value: unknown): Readonly<{ jobId: string; claim: AssistanceOutputClaim }> {
	const record = exactRecord(value, ['jobId', 'claim'], 'output read request');
	const jobId = opaqueId(record.jobId, 'job'); const claim = validateAssistanceOutputClaim(record.claim);
	if (claim.jobId !== jobId) throw new Error('The assistance output claim belongs to another job.');
	return Object.freeze({ jobId, claim });
}

function outputPortRequest(value: unknown): Readonly<{
	jobId: string; streamId: string; binding: HelperDataPlaneBinding;
}> {
	const record = exactRecord(value, ['jobId', 'streamId', 'binding'], 'output port request');
	return Object.freeze({ jobId: opaqueId(record.jobId, 'job'), streamId: opaqueId(record.streamId, 'stream'),
		binding: validateHelperDataPlaneBinding(record.binding) });
}

function transferIdRequest(value: unknown): Readonly<{ jobId: string; streamId: string }> {
	const record = exactRecord(value, ['jobId', 'streamId'], 'transfer identity');
	return Object.freeze({ jobId: opaqueId(record.jobId, 'job'), streamId: opaqueId(record.streamId, 'stream') });
}

function assertInputCompletion(
	claim: AssistanceStagedInputClaim,
	completion: HelperDataPlaneCompletion,
	expectedSha256: string,
): void {
	if (claim.byteLength !== completion.byteLength || claim.sha256 !== completion.sha256
		|| claim.sha256 !== expectedSha256) {
		throw new Error('The staged assistance input disagrees with its exact SHA-256 transfer binding.');
	}
}

function sameInputReservation(left: HelperDataPlaneInputReservation, right: HelperDataPlaneInputReservation): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
function sameBinding(left: HelperDataPlaneBinding, right: HelperDataPlaneBinding): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The assistance ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>; const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`The assistance ${label} must carry exactly its schema keys.`);
	}
	return record;
}
function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The assistance ${label} id is invalid.`);
	return value;
}
function integer(value: unknown, minimum: number, maximum: number, message: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new RangeError(message);
	return Number(value);
}
function abortError(message: string): Error { return new DOMException(message, 'AbortError'); }
function asError(value: unknown, fallback: string): Error { return value instanceof Error ? value : new Error(fallback); }
