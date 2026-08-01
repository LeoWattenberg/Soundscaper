/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS = 32;
export const AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES = 128;
export const AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES = 16_384;
export const AUDIO_EDITOR_PCM_SINK_DEFAULT_MAX_PENDING_CHUNKS = 64;
export const AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS = 512;
export const AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES = 8_388_608;
export const AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES = 32 * 1024 ** 2;

export interface RealtimePcmSinkQueueAdmissionRequest {
	readonly channelCount: unknown;
	readonly chunkFrames: unknown;
	readonly maximumPendingChunks?: unknown;
	readonly maximumPendingBytes?: unknown;
	readonly backpressureHighWaterChunks?: unknown;
}

export interface RealtimePcmSinkQueueAdmission {
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly packetBytes: number;
	readonly maximumPendingChunks: number;
	readonly maximumPendingFrames: number;
	readonly maximumPendingBytes: number;
	readonly backpressureHighWaterChunks: number;
}

export interface AdmittedPlanarPcmPacket {
	readonly channels: readonly Float32Array[];
	readonly channelCount: number;
	readonly frames: number;
	readonly byteLength: number;
}

export function planRealtimePcmSinkQueueAdmission(
	request: RealtimePcmSinkQueueAdmissionRequest,
): RealtimePcmSinkQueueAdmission {
	const channelCount = integerInRange(
		request.channelCount,
		1,
		AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS,
		'channelCount',
	);
	const chunkFrames = integerInRange(
		request.chunkFrames,
		AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES,
		AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
		'chunkFrames',
	);
	const byteCeiling = request.maximumPendingBytes === undefined
		? AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES
		: integerInRange(
			request.maximumPendingBytes,
			1,
			AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES,
			'maximumPendingBytes',
		);
	const packetBytes = checkedProduct(
		[channelCount, chunkFrames, Float32Array.BYTES_PER_ELEMENT],
		'PCM packet byte length',
	);
	const maximumByBytes = Math.floor(byteCeiling / packetBytes);
	const maximumByFrames = Math.floor(AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES / chunkFrames);
	const derivedMaximum = Math.min(
		AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS,
		maximumByBytes,
		maximumByFrames,
	);
	if (derivedMaximum < 1) {
		throw new RangeError('The configured PCM packet exceeds the pending-PCM limit.');
	}

	let maximumPendingChunks: number;
	if (request.maximumPendingChunks === undefined) {
		maximumPendingChunks = Math.min(
			AUDIO_EDITOR_PCM_SINK_DEFAULT_MAX_PENDING_CHUNKS,
			derivedMaximum,
		);
	} else {
		maximumPendingChunks = integerInRange(
			request.maximumPendingChunks,
			1,
			AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS,
			'maximumPendingChunks',
		);
		if (maximumPendingChunks > derivedMaximum) {
			throw new RangeError(
				`maximumPendingChunks would exceed the 32 MiB pending-PCM limit; at most ${derivedMaximum} packets fit this geometry.`,
			);
		}
	}

	const defaultHighWater = Math.max(1, Math.floor(maximumPendingChunks / 2));
	const backpressureHighWaterChunks = request.backpressureHighWaterChunks === undefined
		? defaultHighWater
		: integerInRange(
			request.backpressureHighWaterChunks,
			1,
			defaultHighWater,
			'backpressureHighWaterChunks',
		);

	return Object.freeze({
		channelCount,
		chunkFrames,
		packetBytes,
		maximumPendingChunks,
		maximumPendingFrames: checkedProduct(
			[maximumPendingChunks, chunkFrames],
			'pending PCM frame count',
		),
		maximumPendingBytes: checkedProduct(
			[maximumPendingChunks, packetBytes],
			'pending PCM byte length',
		),
		backpressureHighWaterChunks,
	});
}

export function normalizePcmSinkMaximumPendingChunks(value: unknown): number {
	return value === undefined
		? AUDIO_EDITOR_PCM_SINK_DEFAULT_MAX_PENDING_CHUNKS
		: integerInRange(
			value,
			1,
			AUDIO_EDITOR_PCM_SINK_HARD_MAX_PENDING_CHUNKS,
			'maximumPendingChunks',
		);
}

export function normalizePcmSinkMaximumPendingFrames(value: unknown): number {
	return value === undefined
		? AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES
		: integerInRange(
			value,
			1,
			AUDIO_EDITOR_PCM_SINK_MAX_PENDING_FRAMES,
			'maximumPendingFrames',
		);
}

export function normalizePcmSinkMaximumPendingBytes(value: unknown): number {
	return value === undefined
		? AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES
		: integerInRange(
			value,
			1,
			AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES,
			'maximumPendingBytes',
		);
}

export function inspectPlanarPcmSinkPacket(input: unknown): AdmittedPlanarPcmPacket {
	if (!Array.isArray(input) || input.length < 1 || input.length > AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS) {
		throw new TypeError('A planar PCM packet with 1 to 32 channels is required.');
	}
	const buffers = new Set<ArrayBuffer>();
	let frames: number | null = null;
	for (const channel of input) {
		if (!(channel instanceof Float32Array)) {
			throw new TypeError('Planar PCM sink channels must be non-empty, equally sized Float32Array values.');
		}
		if (frames === null) frames = channel.length;
		if (channel.length !== frames || frames < 1) {
			throw new TypeError('Planar PCM sink channels must be non-empty, equally sized Float32Array values.');
		}
		if (frames > AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES) {
			throw new RangeError('A planar PCM sink packet may contain at most 16384 frames.');
		}
		const buffer = channel.buffer;
		if (
			!(buffer instanceof ArrayBuffer)
			|| channel.byteOffset !== 0
			|| channel.byteLength !== buffer.byteLength
			|| (buffer as ArrayBuffer & { readonly resizable?: boolean }).resizable === true
		) {
			throw new TypeError('Planar PCM sink channels require tight ArrayBuffer backing.');
		}
		if (buffers.has(buffer)) {
			throw new TypeError('Planar PCM sink channels require distinct ArrayBuffer backing.');
		}
		buffers.add(buffer);
	}
	const admittedFrames = frames as number;
	return Object.freeze({
		channels: Object.freeze([...input]) as readonly Float32Array[],
		channelCount: input.length,
		frames: admittedFrames,
		byteLength: checkedProduct(
			[input.length, admittedFrames, Float32Array.BYTES_PER_ELEMENT],
			'PCM packet byte length',
		),
	});
}

function integerInRange(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}.`);
	}
	return value as number;
}

function checkedProduct(values: readonly number[], name: string): number {
	let product = 1;
	for (const value of values) {
		if (product > Math.floor(Number.MAX_SAFE_INTEGER / value)) {
			throw new RangeError(`${name} exceeds the safe integer range.`);
		}
		product *= value;
	}
	return product;
}
