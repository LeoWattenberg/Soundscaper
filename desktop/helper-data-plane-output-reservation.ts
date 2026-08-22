/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed helper-to-host stream authority for bytes whose digest is not known before work. */

import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM,
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	type HelperDataPlaneAckMessage,
	type HelperDataPlaneCancelMessage,
	type HelperDataPlaneCancelReason,
	type HelperDataPlaneCompletion,
	validateHelperDataPlaneMessage,
} from './helper-data-plane.ts';
import {
	HelperContractViolationError,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';
import { createHash, type Hash } from 'node:crypto';

export interface HelperDataPlaneOutputReservation {
	readonly dataPlaneVersion: typeof HELPER_DATA_PLANE_VERSION;
	readonly transport: 'message-port';
	readonly streamId: string;
	readonly direction: 'helper-to-host';
	/** Exact output length when the format fixes it; null for bounded variable output. */
	readonly exactByteLength: number | null;
	readonly maximumByteLength: number;
	readonly maximumChunkBytes: number;
	readonly maximumInFlightChunks: number;
}

const RESERVATION_KEYS = Object.freeze([
	'dataPlaneVersion', 'transport', 'streamId', 'direction', 'exactByteLength',
	'maximumByteLength', 'maximumChunkBytes', 'maximumInFlightChunks',
]);
const STREAM_ID = /^[a-f\d]{40}$/u;

export function validateHelperDataPlaneOutputReservation(
	value: unknown,
): HelperDataPlaneOutputReservation {
	assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		malformed('A helper output reservation must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== RESERVATION_KEYS.length
		|| keys.some((key) => !RESERVATION_KEYS.includes(key))) {
		malformed('A helper output reservation must carry exactly its closed schema keys.');
	}
	if (record.dataPlaneVersion !== HELPER_DATA_PLANE_VERSION
		|| record.transport !== 'message-port' || record.direction !== 'helper-to-host'
		|| typeof record.streamId !== 'string' || !STREAM_ID.test(record.streamId)) {
		malformed('A helper output reservation must name its exact contract-v1 stream.');
	}
	const maximumByteLength = integer(
		record.maximumByteLength, 1, HELPER_DATA_PLANE_MAXIMUM_BYTES,
		'A helper output reservation maximum byte length is outside its bound.',
	);
	const exactByteLength = record.exactByteLength === null ? null : integer(
		record.exactByteLength, 1, maximumByteLength,
		'A helper output reservation exact byte length exceeds its maximum.',
	);
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		transport: 'message-port',
		streamId: record.streamId,
		direction: 'helper-to-host',
		exactByteLength,
		maximumByteLength,
		maximumChunkBytes: integer(
			record.maximumChunkBytes, 1, HELPER_DATA_CHUNK_MAXIMUM_BYTES,
			'A helper output reservation chunk bound exceeds 16 MiB.',
		),
		maximumInFlightChunks: integer(
			record.maximumInFlightChunks, 1, HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM,
			'A helper output reservation backpressure window exceeds its hard bound.',
		),
	});
}

export function assertHelperDataPlaneOutputCompletion(
	value: unknown,
	reservationValue: HelperDataPlaneOutputReservation,
): HelperDataPlaneCompletion {
	const reservation = validateHelperDataPlaneOutputReservation(reservationValue);
	assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		malformed('A helper output completion must be a record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== 3 || !keys.includes('streamId')
		|| !keys.includes('byteLength') || !keys.includes('sha256')) {
		malformed('A helper output completion must carry its exact closed identity.');
	}
	const complete = validateHelperDataPlaneMessage({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		type: 'complete',
		...record,
	});
	if (complete.type !== 'complete' || complete.streamId !== reservation.streamId
		|| complete.byteLength < 1 || complete.byteLength > reservation.maximumByteLength
		|| (reservation.exactByteLength !== null
			&& complete.byteLength !== reservation.exactByteLength)) {
		malformed('A helper output completion exceeds or disagrees with its reservation.');
	}
	return Object.freeze({
		streamId: complete.streamId,
		byteLength: complete.byteLength,
		sha256: complete.sha256,
	});
}

/** Receiver-side sequence, digest, and dynamic-length admission for one reserved output. */
export class HelperDataPlaneOutputReceiver {
	readonly #reservation: HelperDataPlaneOutputReservation;
	readonly #hash: Hash = createHash('sha256');
	#sequence = 0;
	#receivedBytes = 0;
	#closed = false;
	#cancelled = false;

	constructor(reservation: HelperDataPlaneOutputReservation) {
		this.#reservation = validateHelperDataPlaneOutputReservation(reservation);
	}

	acceptChunk(value: unknown): HelperDataPlaneAckMessage {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'chunk' || message.streamId !== this.#reservation.streamId
			|| message.sequence !== this.#sequence || message.offset !== this.#receivedBytes
			|| message.bytes.byteLength > this.#reservation.maximumChunkBytes
			|| this.#receivedBytes + message.bytes.byteLength > this.#reservation.maximumByteLength) {
			malformed('A reserved helper output chunk exceeds its exact sequence or byte authority.');
		}
		this.#hash.update(message.bytes);
		this.#receivedBytes += message.bytes.byteLength;
		this.#sequence += 1;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'ack',
			streamId: this.#reservation.streamId,
			sequence: message.sequence,
			receivedBytes: this.#receivedBytes,
		});
	}

	acceptComplete(value: unknown): HelperDataPlaneCompletion {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'complete') {
			malformed('A reserved helper output accepts only an exact completion frame.');
		}
		const completion = assertHelperDataPlaneOutputCompletion({
			streamId: message.streamId,
			byteLength: message.byteLength,
			sha256: message.sha256,
		}, this.#reservation);
		const sha256 = this.#hash.digest('hex');
		this.#closed = true;
		if (completion.byteLength !== this.#receivedBytes || completion.sha256 !== sha256) {
			malformed('A reserved helper output completion disagrees with its received bytes.');
		}
		return completion;
	}

	acceptCancel(value: unknown): void {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'cancel' || message.streamId !== this.#reservation.streamId) {
			malformed('A reserved helper output received cancellation for another stream.');
		}
		this.#cancelled = true;
	}

	cancel(reason: HelperDataPlaneCancelReason): HelperDataPlaneCancelMessage {
		this.#assertOpen();
		if (!['host-abort', 'helper-abort', 'protocol-fault'].includes(reason)) {
			malformed('A reserved helper output cancellation reason is unsupported.');
		}
		this.#cancelled = true;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'cancel', streamId: this.#reservation.streamId, reason,
		});
	}

	#assertOpen(): void {
		if (this.#cancelled) malformed('The reserved helper output transfer is cancelled.');
		if (this.#closed) malformed('The reserved helper output transfer is already complete.');
	}
}

function integer(value: unknown, minimum: number, maximum: number, message: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		malformed(message);
	}
	return Number(value);
}

function malformed(message: string): never {
	throw new HelperContractViolationError('malformed', message);
}
