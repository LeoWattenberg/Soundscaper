/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_STREAM_QUEUE_PACKET_LIMIT,
	AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
} from './chunk-stream.js';
import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';

/**
 * The wire half of the milestone 5A real-time data plane: the vocabulary a
 * supervised native helper and an AudioWorklet agree on, and the closed-schema
 * validator that stands between them. It is separated from the pool and the
 * generation runtime in native-realtime-transport.ts, which re-exports
 * everything below, because a peer's first byte reaches this validator before
 * any state exists to corrupt. Nothing here reaches for SharedArrayBuffer: the
 * browser build ships without cross-origin isolation and 5A does not add it.
 */

export const NATIVE_REALTIME_PROTOCOL_VERSION = 1;
export const NATIVE_REALTIME_PACKET_FRAMES: number = AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES;
export const NATIVE_REALTIME_MAX_QUEUE_PACKETS: number = AUDIO_EDITOR_STREAM_QUEUE_PACKET_LIMIT;
export const NATIVE_REALTIME_MAX_GENERATION = 0xffff_ffff;

export const NATIVE_REALTIME_CLOSE_REASONS = Object.freeze([
	'completed', 'cancelled', 'underrun', 'non-contiguous',
	'queue-overflow', 'pool-leak', 'peer-loss', 'protocol-violation',
] as const);

export const NATIVE_REALTIME_ERROR_CODES = Object.freeze([
	'CLOSED_GENERATION', 'INVALID_FIELD', 'PACKET_DETACHED', 'PAYLOAD_TOO_LARGE', 'POOL_LEDGER',
	'PROTOCOL_VERSION', 'SHARED_MEMORY_FORBIDDEN', 'STALE_REPLAY', 'UNKNOWN_KEY', 'UNKNOWN_KIND',
] as const);

/**
 * An offline render is compared before it is committed, so it may be retried
 * from the canonical plan. A real-time generation has already been heard by the
 * time a retry could run, so a late packet is dropped and its generation closes
 * rather than replaying stale audio into the device.
 */
export const NATIVE_REALTIME_REPLAY_POLICY = Object.freeze({ realtime: 'never', offline: 'retry-from-canonical-plan' } as const);

export type NativeRealtimeCloseReason = (typeof NATIVE_REALTIME_CLOSE_REASONS)[number];
export type NativeRealtimeErrorCode = (typeof NATIVE_REALTIME_ERROR_CODES)[number];
export type NativeRealtimeCloseEvent = Readonly<{ generation: number; reason: NativeRealtimeCloseReason }>;
export type NativeRealtimeTransfer<Message> = Readonly<{ message: Message; transfer: readonly ArrayBuffer[] }>;

export class NativeRealtimeProtocolError extends Error {
	readonly code: NativeRealtimeErrorCode;
	readonly field: string;

	constructor(code: NativeRealtimeErrorCode, message: string, field = '') {
		super(message);
		this.name = 'NativeRealtimeProtocolError';
		this.code = code;
		this.field = field;
	}
}

type Envelope = Readonly<{ protocolVersion: number; generation: number }>;
type Planes = Readonly<{ channels: readonly Float32Array[] }>;

export type NativeRealtimeOpenMessage = Envelope & Readonly<{ kind: 'open'; startFrame: number; channelCount: number; frameCount: number; queueCapacity: number }>;
export type NativeRealtimeAudioMessage = Envelope & Planes & Readonly<{ kind: 'audio'; packetId: number; sequence: number; startFrame: number; frameCount: number }>;
export type NativeRealtimeReturnMessage = Envelope & Planes & Readonly<{ kind: 'return'; packetId: number; sequence: number }>;
export type NativeRealtimeCloseMessage = Envelope & Readonly<{ kind: 'close'; reason: NativeRealtimeCloseReason }>;
export type NativeRealtimeMessage =
	NativeRealtimeOpenMessage | NativeRealtimeAudioMessage | NativeRealtimeReturnMessage | NativeRealtimeCloseMessage;

/** What a return names, without the envelope the pool has no opinion about. */
export type NativeRealtimePacketDispatch = Omit<NativeRealtimeReturnMessage, 'kind' | 'protocolVersion'>;

const MESSAGE_KEYS = Object.freeze({
	open: ['channelCount', 'frameCount', 'generation', 'kind', 'protocolVersion', 'queueCapacity', 'startFrame'],
	audio: ['channels', 'frameCount', 'generation', 'kind', 'packetId', 'protocolVersion', 'sequence', 'startFrame'],
	return: ['channels', 'generation', 'kind', 'packetId', 'protocolVersion', 'sequence'],
	close: ['generation', 'kind', 'protocolVersion', 'reason'],
} as const);

// Built once, because a worklet decides key membership on every packet it is
// handed and a set rebuilt per message would allocate on the audio thread.
const MESSAGE_KEY_SETS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
	open: new Set<string>(MESSAGE_KEYS.open), audio: new Set<string>(MESSAGE_KEYS.audio),
	return: new Set<string>(MESSAGE_KEYS.return), close: new Set<string>(MESSAGE_KEYS.close),
});

const NUMERIC_LIMITS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
	generation: [0, NATIVE_REALTIME_MAX_GENERATION], packetId: [0, NATIVE_REALTIME_MAX_QUEUE_PACKETS - 1],
	startFrame: [0, Number.MAX_SAFE_INTEGER], sequence: [0, Number.MAX_SAFE_INTEGER],
	channelCount: [1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels], queueCapacity: [1, NATIVE_REALTIME_MAX_QUEUE_PACKETS],
	frameCount: [1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames],
});

/**
 * Validates one wire message against a closed schema. Foreign prototypes,
 * accessor properties, unknown keys, non-finite numbers, shared memory and
 * oversize control payloads are all rejected before any field is trusted, so a
 * peer can neither run a getter on this side nor make it walk unbounded data.
 */
export function validateNativeRealtimeMessage(value: unknown): NativeRealtimeMessage {
	const record = asPlainRecord(value);
	assertControlPayloadSize(record);
	const version = readField(record, 'protocolVersion');
	if (version !== NATIVE_REALTIME_PROTOCOL_VERSION) {
		throw nativeRealtimeError('PROTOCOL_VERSION', `Unsupported native real-time protocol version ${describeNativeRealtimeValue(version)}.`, 'protocolVersion');
	}
	const kind = readField(record, 'kind');
	if (!isMessageKind(kind)) throw nativeRealtimeError('UNKNOWN_KIND', `Unknown message kind ${describeNativeRealtimeValue(kind)}.`, 'kind');
	assertClosedKeySet(record, MESSAGE_KEY_SETS[kind]);
	const fields: Record<string, unknown> = { protocolVersion: NATIVE_REALTIME_PROTOCOL_VERSION, kind };
	// Every schema key is read below, so a missing one is named by its reader
	// and this pass only has to prove that nothing extra rode along.
	for (const key of MESSAGE_KEYS[kind] as readonly string[]) {
		const limits = NUMERIC_LIMITS[key];
		if (limits) fields[key] = boundedNativeRealtimeInteger(readField(record, key), key, limits[0], limits[1]);
	}
	if (kind === 'close') {
		const reason = readField(record, 'reason');
		if (!isNativeRealtimeCloseReason(reason)) throw nativeRealtimeError('INVALID_FIELD', `${describeNativeRealtimeValue(reason)} is not a close reason.`, 'reason');
		fields.reason = reason;
	} else if (kind !== 'open') {
		const frames = kind === 'audio' ? (fields.frameCount as number) : null;
		fields.channels = validateChannels(readField(record, 'channels'), frames);
	}
	// Safe by construction: the key set is closed to this kind's schema and
	// every one of its fields has just been bounded or narrowed above.
	return Object.freeze(fields) as unknown as NativeRealtimeMessage;
}

function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw nativeRealtimeError('INVALID_FIELD', `A wire message must be a plain object, received ${describeNativeRealtimeValue(value)}.`);
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw nativeRealtimeError('INVALID_FIELD', 'A wire message must not carry a class prototype.');
	return value as Readonly<Record<string, unknown>>;
}

/**
 * Bounds the control half of a message before the schema is applied. PCM rides
 * its own bounded channel, so string cost is what matters; every property is
 * charged its worst-case UTF-8 size, which keeps both a megabyte-long field and
 * a key explosion out of a limit that is stated in bytes.
 */
function assertControlPayloadSize(record: Readonly<Record<string, unknown>>): void {
	let bytes = 0;
	for (const key of Object.getOwnPropertyNames(record)) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		const held = descriptor && 'value' in descriptor ? descriptor.value : undefined;
		bytes += key.length * 3 + (typeof held === 'string' ? held.length * 3 : 8);
		if (bytes > PLATFORM_TRANSFER_HARD_LIMITS.messageBytes) {
			throw nativeRealtimeError('PAYLOAD_TOO_LARGE', `A control payload may not exceed ${PLATFORM_TRANSFER_HARD_LIMITS.messageBytes} bytes.`, key);
		}
	}
}

function assertClosedKeySet(record: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): void {
	if (Object.getOwnPropertySymbols(record).length > 0) throw nativeRealtimeError('UNKNOWN_KEY', 'A wire message must not carry symbol keys.');
	for (const key of Object.getOwnPropertyNames(record)) {
		if (!allowed.has(key)) throw nativeRealtimeError('UNKNOWN_KEY', `Unknown wire message key ${JSON.stringify(key)}.`, key);
	}
}

function readField(record: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor) throw nativeRealtimeError('INVALID_FIELD', `${key} is required.`, key);
	if (!('value' in descriptor)) throw nativeRealtimeError('INVALID_FIELD', `${key} must be a data property, not an accessor.`, key);
	return descriptor.value;
}

export function boundedNativeRealtimeInteger(value: unknown, field: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw nativeRealtimeError('INVALID_FIELD', `${field} must be a safe integer in [${minimum}, ${maximum}], received ${describeNativeRealtimeValue(value)}.`, field);
	}
	return value;
}

function validateChannels(value: unknown, frameCount: number | null): readonly Float32Array[] {
	const maxChannels = PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels;
	if (!Array.isArray(value) || value.length < 1 || value.length > maxChannels) {
		throw nativeRealtimeError('INVALID_FIELD', `channels must hold 1 to ${maxChannels} planar Float32Array channels.`, 'channels');
	}
	const planes = value as readonly unknown[];
	const head = planes[0];
	const frames = frameCount ?? (head instanceof Float32Array ? head.length : 0);
	if (frames < 1 || frames > PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames) {
		throw nativeRealtimeError('INVALID_FIELD', `channels must hold 1 to ${PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames} frames.`, 'channels');
	}
	const channels: Float32Array[] = [];
	for (const [index, channel] of planes.entries()) {
		const field = `channels[${index}]`;
		if (!(channel instanceof Float32Array)) throw nativeRealtimeError('INVALID_FIELD', `${field} must be a Float32Array.`, field);
		assertOrdinaryNativeRealtimeBuffer(channel.buffer, field);
		if (channel.length !== frames) throw nativeRealtimeError('INVALID_FIELD', `${field} must hold exactly ${frames} frames.`, field);
		// Overlapping planes would let one packet claim samples it does not own,
		// and returning a pair of them would cost the pool a buffer for good.
		for (const seen of channels) {
			if (sharesSamples(seen, channel)) throw nativeRealtimeError('INVALID_FIELD', `${field} overlaps another channel.`, field);
		}
		channels.push(channel);
	}
	return Object.freeze(channels);
}

/** Planar channels may be packed into one buffer, but never over each other. */
function sharesSamples(first: Float32Array, second: Float32Array): boolean {
	return first.buffer === second.buffer
		&& first.byteOffset < second.byteOffset + second.byteLength
		&& second.byteOffset < first.byteOffset + first.byteLength;
}

export function assertOrdinaryNativeRealtimeBuffer(buffer: ArrayBufferLike, field: string): void {
	if (buffer instanceof ArrayBuffer) return;
	if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
		throw nativeRealtimeError('SHARED_MEMORY_FORBIDDEN', `${field} must not be backed by SharedArrayBuffer.`, field);
	}
	throw nativeRealtimeError('INVALID_FIELD', `${field} must be backed by an ordinary ArrayBuffer.`, field);
}

/**
 * Every buffer a message hands over, listed once. Planar channels packed into
 * one buffer transfer once, because transferring the same buffer twice throws
 * and would tear the packet apart on the way out.
 */
export function transferListForNativeRealtimeChannels(channels: readonly Float32Array[]): readonly ArrayBuffer[] {
	const buffers: ArrayBuffer[] = [];
	for (const [index, channel] of channels.entries()) {
		assertOrdinaryNativeRealtimeBuffer(channel.buffer, `channels[${index}]`);
		if (!buffers.includes(channel.buffer as ArrayBuffer)) buffers.push(channel.buffer as ArrayBuffer);
	}
	return Object.freeze(buffers);
}

function isMessageKind(value: unknown): value is keyof typeof MESSAGE_KEYS {
	return typeof value === 'string' && Object.hasOwn(MESSAGE_KEYS, value);
}

export function isNativeRealtimeCloseReason(value: unknown): value is NativeRealtimeCloseReason {
	return typeof value === 'string' && (NATIVE_REALTIME_CLOSE_REASONS as readonly string[]).includes(value);
}

export function nativeRealtimeError(code: NativeRealtimeErrorCode, message: string, field = ''): NativeRealtimeProtocolError {
	return new NativeRealtimeProtocolError(code, message, field);
}

/** Keeps a thrown cause typed, so no close path has to discard why it closed. */
export function asNativeRealtimeError(error: unknown): NativeRealtimeProtocolError {
	return error instanceof NativeRealtimeProtocolError ? error : nativeRealtimeError('INVALID_FIELD', String(error));
}

export function describeNativeRealtimeValue(value: unknown): string {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'object' && value !== null) return Object.prototype.toString.call(value);
	return String(value);
}
