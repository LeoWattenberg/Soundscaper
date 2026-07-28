/* SPDX-License-Identifier: AGPL-3.0-only */

const BOUNDED_BYTE_CHUNK = Symbol('bounded-byte-chunk');
const BOUNDED_AUDIO_CHUNK = Symbol('bounded-audio-chunk');
const BOUNDED_PORT_MESSAGE = Symbol('bounded-port-message');

type JsonValue = null | boolean | number | string | JsonObject | readonly JsonValue[];
type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export const PLATFORM_TRANSFER_HARD_LIMITS = Object.freeze({
	mediaChunkBytes: 16 * 1024 * 1024,
	audioChunkFrames: 65_536,
	audioChunkChannels: 32,
	messageBytes: 64 * 1024,
});

export interface AbortablePortOperation {
	readonly signal: AbortSignal;
}

export interface AudioTransferFormat {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly sampleFormat: 'f32-planar';
}

export interface BoundedByteChunk {
	readonly [BOUNDED_BYTE_CHUNK]: true;
	readonly kind: 'bytes';
	readonly sequence: number;
	readonly bytes: Uint8Array;
	readonly byteLength: number;
	readonly maximumByteLength: number;
	readonly final: boolean;
}

export interface BoundedAudioChunk {
	readonly [BOUNDED_AUDIO_CHUNK]: true;
	readonly kind: 'audio';
	readonly sequence: number;
	readonly channels: readonly Float32Array[];
	readonly channelCount: number;
	readonly frameCount: number;
	readonly maximumFrameCount: number;
	readonly byteLength: number;
	readonly startFrame: number;
}

export interface BoundedPortMessage<Payload = unknown> {
	readonly [BOUNDED_PORT_MESSAGE]: true;
	readonly kind: 'message';
	readonly type: string;
	readonly sequence: number;
	readonly payload: Payload;
	readonly encodedByteLength: number;
	readonly maximumEncodedBytes: number;
}

interface ByteChunkOptions {
	readonly sequence: number;
	readonly maximumByteLength: number;
	readonly final?: boolean;
}

interface AudioChunkOptions {
	readonly sequence: number;
	readonly maximumFrameCount: number;
	readonly startFrame?: number;
}

interface PortMessageOptions {
	readonly sequence: number;
	readonly maximumEncodedBytes: number;
}

export function createBoundedByteChunk(
	bytes: Uint8Array,
	options: ByteChunkOptions,
): BoundedByteChunk {
	const sequence = nonNegativeSafeInteger(options.sequence, 'sequence');
	const maximumByteLength = transferLimit(
		options.maximumByteLength,
		PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes,
		'maximumByteLength',
	);
	if (bytes.byteLength === 0) throw new RangeError('A bounded byte chunk must not be empty.');
	if (bytes.byteLength > maximumByteLength) {
		throw new RangeError('The byte chunk exceeds maximumByteLength.');
	}
	return Object.freeze({
		[BOUNDED_BYTE_CHUNK]: true as const,
		kind: 'bytes',
		sequence,
		bytes,
		byteLength: bytes.byteLength,
		maximumByteLength,
		final: options.final === true,
	});
}

export function createBoundedAudioChunk(
	channels: readonly Float32Array[],
	options: AudioChunkOptions,
): BoundedAudioChunk {
	const sequence = nonNegativeSafeInteger(options.sequence, 'sequence');
	const maximumFrameCount = transferLimit(
		options.maximumFrameCount,
		PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames,
		'maximumFrameCount',
	);
	if (channels.length === 0) throw new RangeError('A bounded audio chunk requires at least one channel.');
	if (channels.length > PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels) {
		throw new RangeError('The audio chunk exceeds the channel-count hard limit.');
	}
	const frameCount = channels[0]!.length;
	if (frameCount === 0) throw new RangeError('A bounded audio chunk must not be empty.');
	if (channels.some((channel) => channel.length !== frameCount)) {
		throw new RangeError('Every audio channel must have the same frame count.');
	}
	if (frameCount > maximumFrameCount) {
		throw new RangeError('The audio chunk exceeds maximumFrameCount.');
	}
	const startFrame = nonNegativeSafeInteger(options.startFrame ?? 0, 'startFrame');
	return Object.freeze({
		[BOUNDED_AUDIO_CHUNK]: true as const,
		kind: 'audio',
		sequence,
		channels: Object.freeze([...channels]),
		channelCount: channels.length,
		frameCount,
		maximumFrameCount,
		byteLength: channels.reduce((total, channel) => total + channel.byteLength, 0),
		startFrame,
	});
}

export function createBoundedPortMessage<Payload>(
	type: string,
	payload: Payload,
	options: PortMessageOptions,
): BoundedPortMessage<Payload> {
	const normalizedType = String(type).trim();
	if (!normalizedType) throw new TypeError('A bounded port message requires a type.');
	const sequence = nonNegativeSafeInteger(options.sequence, 'sequence');
	const maximumEncodedBytes = transferLimit(
		options.maximumEncodedBytes,
		PLATFORM_TRANSFER_HARD_LIMITS.messageBytes,
		'maximumEncodedBytes',
	);
	assertJsonCompatible(payload);
	const encoded = JSON.stringify({ type: normalizedType, sequence, payload });
	const encodedByteLength = new TextEncoder().encode(encoded).byteLength;
	if (encodedByteLength > maximumEncodedBytes) {
		throw new RangeError('The port message exceeds maximumEncodedBytes.');
	}
	const clonedPayload = freezeJsonValue(
		(JSON.parse(encoded) as Readonly<{ payload: JsonValue }>).payload,
	) as Payload;
	return Object.freeze({
		[BOUNDED_PORT_MESSAGE]: true,
		kind: 'message',
		type: normalizedType,
		sequence,
		payload: clonedPayload,
		encodedByteLength,
		maximumEncodedBytes,
	});
}

function transferLimit(value: number, hardLimit: number, name: string): number {
	const limit = nonNegativeSafeInteger(value, name);
	if (limit === 0) throw new RangeError(`${name} must be greater than zero.`);
	if (limit > hardLimit) throw new RangeError(`${name} exceeds the platform transfer hard limit.`);
	return limit;
}

function nonNegativeSafeInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function assertJsonCompatible(value: unknown, ancestors = new Set<object>()): asserts value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return;
		throw new TypeError('A bounded port message payload must contain only JSON-compatible values.');
	}
	if (typeof value !== 'object') {
		throw new TypeError('A bounded port message payload must contain only JSON-compatible values.');
	}
	if (ancestors.has(value)) {
		throw new TypeError('A bounded port message payload must not contain circular references.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('A bounded port message payload must contain only JSON-compatible values.');
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError('A bounded port message payload must contain only JSON-compatible values.');
	}
	ancestors.add(value);
	for (const nested of Array.isArray(value)
		? value as readonly unknown[]
		: Object.values(value as Readonly<Record<string, unknown>>)) {
		assertJsonCompatible(nested, ancestors);
	}
	ancestors.delete(value);
}

function freezeJsonValue<Value extends JsonValue>(value: Value): Value {
	if (value === null || typeof value !== 'object') return value;
	const nestedValues = Array.isArray(value)
		? value
		: Object.values(value as JsonObject);
	for (const nested of nestedValues) freezeJsonValue(nested);
	return Object.freeze(value);
}
