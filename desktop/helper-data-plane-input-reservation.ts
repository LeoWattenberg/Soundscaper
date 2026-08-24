/* SPDX-License-Identifier: AGPL-3.0-only */

/** Trailer-authenticated host-to-helper input whose digest is learned while producing it. */

import { createHash, type Hash } from 'node:crypto';

import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM,
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	type HelperDataPlaneAckMessage,
	type HelperDataPlaneCancelMessage,
	type HelperDataPlaneCancelReason,
	type HelperDataPlaneChunkMessage,
	type HelperDataPlaneCompleteMessage,
	type HelperDataPlaneCompletion,
	validateHelperDataPlaneMessage,
} from './helper-data-plane.ts';
import {
	HelperContractViolationError,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';

export const HELPER_DATA_PLANE_INPUT_AUTHENTICATION = 'trailer-sha256-v1';

export interface HelperDataPlaneInputReservation {
	readonly dataPlaneVersion: typeof HELPER_DATA_PLANE_VERSION;
	readonly transport: 'message-port';
	readonly streamId: string;
	readonly direction: 'host-to-helper';
	readonly authentication: typeof HELPER_DATA_PLANE_INPUT_AUTHENTICATION;
	readonly byteLength: number;
	readonly maximumChunkBytes: number;
	readonly maximumInFlightChunks: number;
}

const KEYS = Object.freeze([
	'dataPlaneVersion', 'transport', 'streamId', 'direction', 'authentication',
	'byteLength', 'maximumChunkBytes', 'maximumInFlightChunks',
]);
const STREAM_ID = /^[a-f\d]{40}$/u;

export function validateHelperDataPlaneInputReservation(
	value: unknown,
): HelperDataPlaneInputReservation {
	assertHelperWireEnvelope(value);
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		return malformed('A helper input reservation must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== KEYS.length || keys.some((key) => !KEYS.includes(key))) {
		return malformed('A helper input reservation must carry exactly its closed schema keys.');
	}
	if (record.dataPlaneVersion !== HELPER_DATA_PLANE_VERSION
		|| record.transport !== 'message-port' || record.direction !== 'host-to-helper'
		|| record.authentication !== HELPER_DATA_PLANE_INPUT_AUTHENTICATION
		|| typeof record.streamId !== 'string' || !STREAM_ID.test(record.streamId)) {
		return malformed('A helper input reservation must name its exact trailer-authenticated stream.');
	}
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		transport: 'message-port',
		streamId: record.streamId,
		direction: 'host-to-helper',
		authentication: HELPER_DATA_PLANE_INPUT_AUTHENTICATION,
		byteLength: integer(record.byteLength, 1, HELPER_DATA_PLANE_MAXIMUM_BYTES,
			'A helper input reservation byte length is outside its bound.'),
		maximumChunkBytes: integer(record.maximumChunkBytes, 1, HELPER_DATA_CHUNK_MAXIMUM_BYTES,
			'A helper input reservation chunk bound exceeds 16 MiB.'),
		maximumInFlightChunks: integer(record.maximumInFlightChunks, 1,
			HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM,
			'A helper input reservation backpressure window exceeds its hard bound.'),
	});
}

/** Sender state used by main while it relays one renderer-produced chunk at a time. */
export class HelperDataPlaneInputSender {
	readonly #reservation: HelperDataPlaneInputReservation;
	readonly #hash: Hash = createHash('sha256');
	readonly #outstanding: Array<Readonly<{ sequence: number; endOffset: number }>> = [];
	#sequence = 0;
	#offset = 0;
	#closed = false;
	#cancelled = false;

	constructor(value: HelperDataPlaneInputReservation) {
		this.#reservation = validateHelperDataPlaneInputReservation(value);
	}

	createChunk(value: Uint8Array): HelperDataPlaneChunkMessage {
		this.#assertOpen();
		if (this.#outstanding.length >= this.#reservation.maximumInFlightChunks) {
			return malformed('Helper input backpressure forbids another in-flight chunk.');
		}
		const bytes = ownedBytes(value, this.#reservation.maximumChunkBytes);
		if (this.#offset + bytes.byteLength > this.#reservation.byteLength) {
			return malformed('A helper input chunk exceeds its exact reserved length.');
		}
		const message = Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION, type: 'chunk' as const,
			streamId: this.#reservation.streamId, sequence: this.#sequence,
			offset: this.#offset, bytes,
		});
		this.#hash.update(bytes);
		this.#offset += bytes.byteLength;
		this.#outstanding.push(Object.freeze({ sequence: this.#sequence, endOffset: this.#offset }));
		this.#sequence += 1;
		return message;
	}

	acceptAck(value: unknown): void {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		const expected = this.#outstanding[0];
		if (message.type !== 'ack' || message.streamId !== this.#reservation.streamId
			|| !expected || message.sequence !== expected.sequence
			|| message.receivedBytes !== expected.endOffset) {
			return malformed('A helper input acknowledgement is out of sequence or has the wrong byte count.');
		}
		this.#outstanding.shift();
	}

	complete(): HelperDataPlaneCompleteMessage {
		this.#assertOpen();
		if (this.#offset !== this.#reservation.byteLength || this.#outstanding.length !== 0) {
			return malformed('A helper input cannot complete before every exact byte is acknowledged.');
		}
		this.#closed = true;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION, type: 'complete',
			streamId: this.#reservation.streamId, byteLength: this.#offset,
			sha256: this.#hash.digest('hex'),
		});
	}

	acceptCancel(value: unknown): void {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'cancel' || message.streamId !== this.#reservation.streamId) {
			return malformed('A helper input sender received cancellation for another stream.');
		}
		this.#cancelled = true;
	}

	cancel(reason: HelperDataPlaneCancelReason): HelperDataPlaneCancelMessage {
		this.#assertOpen();
		if (!['host-abort', 'helper-abort', 'protocol-fault'].includes(reason)) {
			return malformed('A helper input cancellation reason is unsupported.');
		}
		this.#cancelled = true;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION, type: 'cancel',
			streamId: this.#reservation.streamId, reason,
		});
	}

	#assertOpen(): void {
		if (this.#cancelled) malformed('The helper input transfer is cancelled.');
		if (this.#closed) malformed('The helper input transfer is already complete.');
	}
}

/** Helper-side receiver verifies the trailer against the bytes delivered to the native stdin. */
export class HelperDataPlaneInputReceiver {
	readonly #reservation: HelperDataPlaneInputReservation;
	readonly #hash: Hash = createHash('sha256');
	#sequence = 0;
	#receivedBytes = 0;
	#closed = false;
	#cancelled = false;

	constructor(value: HelperDataPlaneInputReservation) {
		this.#reservation = validateHelperDataPlaneInputReservation(value);
	}

	acceptChunk(value: unknown): Readonly<{ message: HelperDataPlaneChunkMessage; ack: HelperDataPlaneAckMessage }> {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'chunk' || message.streamId !== this.#reservation.streamId
			|| message.sequence !== this.#sequence || message.offset !== this.#receivedBytes
			|| message.bytes.byteLength > this.#reservation.maximumChunkBytes
			|| this.#receivedBytes + message.bytes.byteLength > this.#reservation.byteLength) {
			return malformed('A helper input chunk exceeds its exact sequence or byte authority.');
		}
		this.#hash.update(message.bytes);
		this.#receivedBytes += message.bytes.byteLength;
		this.#sequence += 1;
		return Object.freeze({ message, ack: Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION, type: 'ack',
			streamId: this.#reservation.streamId, sequence: message.sequence,
			receivedBytes: this.#receivedBytes,
		}) });
	}

	acceptComplete(value: unknown): HelperDataPlaneCompletion {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'complete' || message.streamId !== this.#reservation.streamId
			|| message.byteLength !== this.#reservation.byteLength
			|| this.#receivedBytes !== this.#reservation.byteLength) {
			return malformed('A helper input completion disagrees with its exact reserved length.');
		}
		const sha256 = this.#hash.digest('hex');
		this.#closed = true;
		if (message.sha256 !== sha256) {
			return malformed('A helper input trailer disagrees with its received bytes.');
		}
		return Object.freeze({ streamId: message.streamId, byteLength: message.byteLength, sha256 });
	}

	acceptCancel(value: unknown): void {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'cancel' || message.streamId !== this.#reservation.streamId) {
			return malformed('A helper input receiver received cancellation for another stream.');
		}
		this.#cancelled = true;
	}

	cancel(reason: HelperDataPlaneCancelReason): HelperDataPlaneCancelMessage {
		this.#assertOpen(); this.#cancelled = true;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION, type: 'cancel',
			streamId: this.#reservation.streamId, reason,
		});
	}

	#assertOpen(): void {
		if (this.#cancelled) malformed('The helper input transfer is cancelled.');
		if (this.#closed) malformed('The helper input transfer is already complete.');
	}
}

function ownedBytes(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maximum) {
		return malformed('A helper input chunk is empty or exceeds its exact chunk bound.');
	}
	return new Uint8Array(value);
}

function integer(value: unknown, minimum: number, maximum: number, message: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		return malformed(message);
	}
	return Number(value);
}

function malformed(message: string): never {
	throw new HelperContractViolationError('malformed', message);
}
