/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Contract-v1 bulk transport carried by one transferred MessagePort. Control
 * envelopes stay on the 64 KiB helper wire; this module admits only the bytes
 * and acknowledgements on the separately negotiated, digest-bound stream.
 */

import { createHash, type Hash } from 'node:crypto';

import {
	HelperContractViolationError,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';

export const HELPER_DATA_PLANE_VERSION = 1;
export const HELPER_DATA_CHUNK_MAXIMUM_BYTES = 16 * 1024 * 1024;
export const HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM = 8;
export const HELPER_DATA_PLANE_MAXIMUM_BYTES = 16 * 1024 ** 4;

export const HELPER_DATA_PLANE_DIRECTIONS = Object.freeze([
	'host-to-helper', 'helper-to-host',
] as const);
export type HelperDataPlaneDirection = (typeof HELPER_DATA_PLANE_DIRECTIONS)[number];

export const HELPER_DATA_PLANE_CANCEL_REASONS = Object.freeze([
	'host-abort', 'helper-abort', 'protocol-fault',
] as const);
export type HelperDataPlaneCancelReason = (typeof HELPER_DATA_PLANE_CANCEL_REASONS)[number];

/** Small control descriptor sent with the job while the port is transferred out-of-band. */
export interface HelperDataPlaneBinding {
	readonly dataPlaneVersion: typeof HELPER_DATA_PLANE_VERSION;
	readonly transport: 'message-port';
	readonly streamId: string;
	readonly direction: HelperDataPlaneDirection;
	readonly byteLength: number;
	readonly sha256: string;
	readonly maximumChunkBytes: number;
	readonly maximumInFlightChunks: number;
}

export interface HelperDataPlaneChunkMessage {
	readonly dataPlaneVersion: typeof HELPER_DATA_PLANE_VERSION;
	readonly type: 'chunk';
	readonly streamId: string;
	readonly sequence: number;
	readonly offset: number;
	readonly bytes: Uint8Array;
}

export interface HelperDataPlaneAckMessage {
	readonly dataPlaneVersion: typeof HELPER_DATA_PLANE_VERSION;
	readonly type: 'ack';
	readonly streamId: string;
	readonly sequence: number;
	readonly receivedBytes: number;
}

export interface HelperDataPlaneCompleteMessage {
	readonly dataPlaneVersion: typeof HELPER_DATA_PLANE_VERSION;
	readonly type: 'complete';
	readonly streamId: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface HelperDataPlaneCancelMessage {
	readonly dataPlaneVersion: typeof HELPER_DATA_PLANE_VERSION;
	readonly type: 'cancel';
	readonly streamId: string;
	readonly reason: HelperDataPlaneCancelReason;
}

export type HelperDataPlaneMessage =
	| HelperDataPlaneChunkMessage
	| HelperDataPlaneAckMessage
	| HelperDataPlaneCompleteMessage
	| HelperDataPlaneCancelMessage;

export interface HelperDataPlaneCompletion {
	readonly streamId: string;
	readonly byteLength: number;
	readonly sha256: string;
}

/** Minimal structural surface shared by Node and Electron MessagePort implementations. */
export interface HelperDataPlaneMessagePort {
	postMessage(message: HelperDataPlaneMessage, transfer?: readonly ArrayBuffer[]): void;
	close(): void;
}

const BINDING_KEYS = Object.freeze([
	'dataPlaneVersion', 'transport', 'streamId', 'direction', 'byteLength', 'sha256',
	'maximumChunkBytes', 'maximumInFlightChunks',
]);
const CHUNK_KEYS = Object.freeze([
	'dataPlaneVersion', 'type', 'streamId', 'sequence', 'offset', 'bytes',
]);
const ACK_KEYS = Object.freeze([
	'dataPlaneVersion', 'type', 'streamId', 'sequence', 'receivedBytes',
]);
const COMPLETE_KEYS = Object.freeze([
	'dataPlaneVersion', 'type', 'streamId', 'byteLength', 'sha256',
]);
const CANCEL_KEYS = Object.freeze([
	'dataPlaneVersion', 'type', 'streamId', 'reason',
]);
const SHA256 = /^[a-f\d]{64}$/u;
const STREAM_ID = /^[a-f\d]{40}$/u;

export function validateHelperDataPlaneBinding(value: unknown): HelperDataPlaneBinding {
	assertHelperWireEnvelope(value);
	const record = plainRecord(value);
	exactKeys(record, BINDING_KEYS);
	if (record.dataPlaneVersion !== HELPER_DATA_PLANE_VERSION || record.transport !== 'message-port') {
		malformed('A helper data-plane binding must name contract-v1 MessagePort transport.');
	}
	const direction = enumValue(record.direction, HELPER_DATA_PLANE_DIRECTIONS,
		'A helper data-plane binding must name its direction.');
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		transport: 'message-port',
		streamId: streamId(record.streamId),
		direction,
		byteLength: boundedInteger(record.byteLength, 0, HELPER_DATA_PLANE_MAXIMUM_BYTES,
			'A helper data-plane binding byte length is outside its bound.'),
		sha256: digest(record.sha256),
		maximumChunkBytes: boundedInteger(record.maximumChunkBytes, 1, HELPER_DATA_CHUNK_MAXIMUM_BYTES,
			'A helper data-plane chunk bound is outside its hard maximum.'),
		maximumInFlightChunks: boundedInteger(
			record.maximumInFlightChunks,
			1,
			HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM,
			'A helper data-plane backpressure window is outside its hard maximum.',
		),
	});
}

export function validateHelperDataPlaneMessage(value: unknown): HelperDataPlaneMessage {
	const record = plainRecord(value);
	if (record.dataPlaneVersion !== HELPER_DATA_PLANE_VERSION) {
		malformed('The helper data-plane version is unsupported.');
	}
	if (record.type === 'chunk') return validateChunk(record);
	if (record.type === 'ack') return validateAck(record);
	if (record.type === 'complete') return validateComplete(record);
	if (record.type === 'cancel') return validateCancel(record);
	return malformed('A helper data-plane message must name a known type.');
}

/** Sender-side sequence and acknowledgement window for one exact transfer. */
export class HelperDataPlaneSender {
	readonly #binding: HelperDataPlaneBinding;
	readonly #hash: Hash = createHash('sha256');
	readonly #outstanding: Array<Readonly<{ sequence: number; endOffset: number }>> = [];
	#sequence = 0;
	#offset = 0;
	#closed = false;
	#cancelled = false;

	constructor(binding: HelperDataPlaneBinding) {
		this.#binding = validateHelperDataPlaneBinding(binding);
	}

	createChunk(value: Uint8Array): HelperDataPlaneChunkMessage {
		this.#assertOpen();
		if (this.#outstanding.length >= this.#binding.maximumInFlightChunks) {
			malformed('Helper data-plane backpressure forbids another in-flight chunk.');
		}
		const bytes = chunkBytes(new Uint8Array(value), this.#binding.maximumChunkBytes);
		if (this.#offset + bytes.byteLength > this.#binding.byteLength) {
			malformed('A helper data-plane chunk exceeds the exact bound transfer length.');
		}
		const message = Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'chunk' as const,
			streamId: this.#binding.streamId,
			sequence: this.#sequence,
			offset: this.#offset,
			bytes,
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
		if (message.type !== 'ack' || message.streamId !== this.#binding.streamId) {
			malformed('A helper data-plane sender received an acknowledgement for another stream.');
		}
		const expected = this.#outstanding[0];
		if (!expected || message.sequence !== expected.sequence || message.receivedBytes !== expected.endOffset) {
			malformed('A helper data-plane acknowledgement is out of sequence or has the wrong byte count.');
		}
		this.#outstanding.shift();
	}

	complete(): HelperDataPlaneCompleteMessage {
		this.#assertOpen();
		if (this.#offset !== this.#binding.byteLength || this.#outstanding.length !== 0) {
			malformed('A helper data-plane transfer cannot complete before all exact bytes are acknowledged.');
		}
		const sha256 = this.#hash.digest('hex');
		if (sha256 !== this.#binding.sha256) {
			this.#closed = true;
			malformed('A helper data-plane transfer does not match its control-bound digest.');
		}
		this.#closed = true;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'complete',
			streamId: this.#binding.streamId,
			byteLength: this.#binding.byteLength,
			sha256,
		});
	}

	cancel(reason: HelperDataPlaneCancelReason): HelperDataPlaneCancelMessage {
		this.#assertOpen();
		const admittedReason = enumValue(reason, HELPER_DATA_PLANE_CANCEL_REASONS,
			'A helper data-plane cancellation must name a known reason.');
		this.#cancelled = true;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'cancel',
			streamId: this.#binding.streamId,
			reason: admittedReason,
		});
	}

	acceptCancel(value: unknown): void {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'cancel' || message.streamId !== this.#binding.streamId) {
			malformed('A helper data-plane sender received cancellation for another stream.');
		}
		this.#cancelled = true;
	}

	#assertOpen(): void {
		if (this.#cancelled) malformed('The helper data-plane transfer is cancelled.');
		if (this.#closed) malformed('The helper data-plane transfer is already complete.');
	}
}

/** Receiver-side exact sequence, byte count, and digest admission. */
export class HelperDataPlaneReceiver {
	readonly #binding: HelperDataPlaneBinding;
	readonly #hash: Hash = createHash('sha256');
	#sequence = 0;
	#receivedBytes = 0;
	#closed = false;
	#cancelled = false;

	constructor(binding: HelperDataPlaneBinding) {
		this.#binding = validateHelperDataPlaneBinding(binding);
	}

	acceptChunk(value: unknown): HelperDataPlaneAckMessage {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'chunk' || message.streamId !== this.#binding.streamId) {
			malformed('A helper data-plane receiver received a chunk for another stream.');
		}
		if (message.sequence !== this.#sequence) {
			malformed('A helper data-plane chunk arrived outside the exact sequence.');
		}
		if (message.offset !== this.#receivedBytes) {
			malformed('A helper data-plane chunk arrived at the wrong exact offset.');
		}
		if (message.bytes.byteLength > this.#binding.maximumChunkBytes
			|| this.#receivedBytes + message.bytes.byteLength > this.#binding.byteLength) {
			malformed('A helper data-plane chunk exceeds its negotiated transfer bound.');
		}
		this.#hash.update(message.bytes);
		this.#receivedBytes += message.bytes.byteLength;
		this.#sequence += 1;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'ack',
			streamId: this.#binding.streamId,
			sequence: message.sequence,
			receivedBytes: this.#receivedBytes,
		});
	}

	acceptComplete(value: unknown): HelperDataPlaneCompletion {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'complete' || message.streamId !== this.#binding.streamId
			|| message.byteLength !== this.#binding.byteLength || message.sha256 !== this.#binding.sha256) {
			malformed('A helper data-plane completion does not match its control binding.');
		}
		if (this.#receivedBytes !== this.#binding.byteLength) {
			malformed('A helper data-plane completion arrived before the exact byte length.');
		}
		const sha256 = this.#hash.digest('hex');
		if (sha256 !== this.#binding.sha256) {
			this.#closed = true;
			malformed('A helper data-plane receiver computed a different transfer digest.');
		}
		this.#closed = true;
		return Object.freeze({
			streamId: this.#binding.streamId,
			byteLength: this.#binding.byteLength,
			sha256,
		});
	}

	acceptCancel(value: unknown): void {
		this.#assertOpen();
		const message = validateHelperDataPlaneMessage(value);
		if (message.type !== 'cancel' || message.streamId !== this.#binding.streamId) {
			malformed('A helper data-plane receiver received cancellation for another stream.');
		}
		this.#cancelled = true;
	}

	cancel(reason: HelperDataPlaneCancelReason): HelperDataPlaneCancelMessage {
		this.#assertOpen();
		const admittedReason = enumValue(reason, HELPER_DATA_PLANE_CANCEL_REASONS,
			'A helper data-plane cancellation must name a known reason.');
		this.#cancelled = true;
		return Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'cancel',
			streamId: this.#binding.streamId,
			reason: admittedReason,
		});
	}

	#assertOpen(): void {
		if (this.#cancelled) malformed('The helper data-plane transfer is cancelled.');
		if (this.#closed) malformed('The helper data-plane transfer is already complete.');
	}
}

function validateChunk(record: Record<string, unknown>): HelperDataPlaneChunkMessage {
	exactKeys(record, CHUNK_KEYS);
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		type: 'chunk',
		streamId: streamId(record.streamId),
		sequence: boundedInteger(record.sequence, 0, Number.MAX_SAFE_INTEGER,
			'A helper data-plane chunk sequence is invalid.'),
		offset: boundedInteger(record.offset, 0, HELPER_DATA_PLANE_MAXIMUM_BYTES,
			'A helper data-plane chunk offset is invalid.'),
		bytes: chunkBytes(record.bytes, HELPER_DATA_CHUNK_MAXIMUM_BYTES),
	});
}

function validateAck(record: Record<string, unknown>): HelperDataPlaneAckMessage {
	exactKeys(record, ACK_KEYS);
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		type: 'ack',
		streamId: streamId(record.streamId),
		sequence: boundedInteger(record.sequence, 0, Number.MAX_SAFE_INTEGER,
			'A helper data-plane acknowledgement sequence is invalid.'),
		receivedBytes: boundedInteger(record.receivedBytes, 0, HELPER_DATA_PLANE_MAXIMUM_BYTES,
			'A helper data-plane acknowledgement byte count is invalid.'),
	});
}

function validateComplete(record: Record<string, unknown>): HelperDataPlaneCompleteMessage {
	exactKeys(record, COMPLETE_KEYS);
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		type: 'complete',
		streamId: streamId(record.streamId),
		byteLength: boundedInteger(record.byteLength, 0, HELPER_DATA_PLANE_MAXIMUM_BYTES,
			'A helper data-plane completion byte length is invalid.'),
		sha256: digest(record.sha256),
	});
}

function validateCancel(record: Record<string, unknown>): HelperDataPlaneCancelMessage {
	exactKeys(record, CANCEL_KEYS);
	return Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		type: 'cancel',
		streamId: streamId(record.streamId),
		reason: enumValue(record.reason, HELPER_DATA_PLANE_CANCEL_REASONS,
			'A helper data-plane cancellation must name a known reason.'),
	});
}

function chunkBytes(value: unknown, maximumBytes: number): Uint8Array {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
		|| !(value.buffer instanceof ArrayBuffer)
		|| (typeof SharedArrayBuffer === 'function' && value.buffer instanceof SharedArrayBuffer)
		|| value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength) {
		malformed('A helper data-plane chunk must tightly own an ordinary Uint8Array buffer.');
	}
	if (value.byteLength === 0) malformed('A helper data-plane chunk must not be empty.');
	if (value.byteLength > maximumBytes) {
		throw new HelperContractViolationError('oversized',
			'A helper data-plane chunk exceeds the 16 MiB hard limit.');
	}
	return new Uint8Array(value);
}

function streamId(value: unknown): string {
	if (typeof value !== 'string' || !STREAM_ID.test(value)) {
		malformed('A helper data-plane stream id must be fixed-length lowercase hex.');
	}
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		malformed('A helper data-plane digest must be lowercase SHA-256.');
	}
	return value;
}

function plainRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		malformed('A helper data-plane value must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		malformed('A helper data-plane value must use a plain prototype.');
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') malformed('A helper data-plane value must not carry symbol keys.');
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
			malformed('A helper data-plane value must contain only enumerable data properties.');
		}
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		malformed('A helper data-plane value must carry exactly its schema keys.');
	}
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	message: string,
): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) malformed(message);
	return value as Values[number];
}

function boundedInteger(value: unknown, minimum: number, maximum: number, message: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) malformed(message);
	return Number(value);
}

function malformed(message: string): never {
	throw new HelperContractViolationError('malformed', message);
}
