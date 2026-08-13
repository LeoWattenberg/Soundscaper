/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeFfmpegInputStream } from './video-keyframe-encoder-stream.ts';

export const VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES = 2 * 1024 * 1024 * 1024;

export interface VideoKeyframeAudioInputSource {
	readonly byteLength: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	read(
		offset: number,
		maximumBytes: number,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Uint8Array<ArrayBuffer>>;
}

export interface VideoKeyframeAudioInputAdmissionOptions {
	readonly maximumBytes?: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoKeyframeAudioInputWriteResult {
	readonly byteLength: number;
	readonly chunkCount: number;
}

const AUDIO_INPUT_SOURCES = new WeakSet<object>();

/** Snapshot and inspect one canonical float32 WAV without materializing its complete body. */
export async function admitVideoKeyframeAudioInput(
	value: Blob,
	options: VideoKeyframeAudioInputAdmissionOptions = {},
): Promise<VideoKeyframeAudioInputSource> {
	const settings = normalizeOptions(options);
	assertReady(settings);
	const snapshot = snapshotWav(value, settings.maximumBytes ?? VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES);
	const inspected = await inspectCanonicalFloat32Wav(snapshot, settings.signal);
	assertReady(settings);
	const sampleRate = inspected.sampleRate;
	const channelCount = inspected.channelCount;
	const frameCount = inspected.frameCount;
	const source: VideoKeyframeAudioInputSource = Object.freeze({
		byteLength: snapshot.size,
		sampleRate,
		channelCount,
		frameCount,
		async read(
			offsetValue: number,
			maximumBytesValue: number,
			readOptions: Readonly<{ signal?: AbortSignal }> = {},
		) {
			assertVideoKeyframeAudioInputSource(source);
			const offset = nonNegativeSafeInteger(offsetValue, 'audio input offset');
			const maximumBytes = positiveSafeInteger(maximumBytesValue, 'audio input maximumBytes');
			if (offset >= snapshot.size) {
				throw new RangeError('Video keyframe audio input offset is outside the WAV body.');
			}
			const signal = normalizeReadSignal(readOptions);
			throwIfAborted(signal);
			const end = Math.min(snapshot.size, offset + maximumBytes);
			const part = Blob.prototype.slice.call(snapshot, offset, end);
			const buffer = await part.arrayBuffer();
			throwIfAborted(signal);
			if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - offset) {
				throw new Error('Video keyframe audio input returned an inexact WAV slice.');
			}
			return new Uint8Array(buffer);
		},
	});
	AUDIO_INPUT_SOURCES.add(source);
	return source;
}

async function inspectCanonicalFloat32Wav(
	blob: Blob,
	signal: AbortSignal | undefined,
): Promise<Readonly<{ sampleRate: number; channelCount: number; frameCount: number }>> {
	const header = await readBlobRange(blob, 0, 12, signal);
	if (ascii(header, 0, 4) !== 'RIFF' || ascii(header, 8, 4) !== 'WAVE'
		|| uint32(header, 4) !== blob.size - 8) {
		throw new TypeError('Video keyframe audio input must be a canonical float32 WAV.');
	}
	let offset = 12;
	let chunks = 0;
	let format: Readonly<{
		sampleRate: number;
		channelCount: number;
		blockAlign: number;
	}> | null = null;
	let dataBytes: number | null = null;
	while (offset < blob.size) {
		chunks += 1;
		if (chunks > 64 || blob.size - offset < 8) invalidFloatWav();
		const chunk = await readBlobRange(blob, offset, 8, signal);
		const id = ascii(chunk, 0, 4);
		const byteLength = uint32(chunk, 4);
		const payloadOffset = offset + 8;
		const paddedBytes = byteLength + (byteLength & 1);
		if (paddedBytes > blob.size - payloadOffset) invalidFloatWav();
		if (id === 'fmt ') {
			if (format || byteLength < 16 || byteLength > 64) invalidFloatWav();
			format = inspectFloatFormat(
				await readBlobRange(blob, payloadOffset, byteLength, signal),
			);
		} else if (id === 'data') {
			if (dataBytes !== null) invalidFloatWav();
			dataBytes = byteLength;
		}
		offset = payloadOffset + paddedBytes;
	}
	if (!format || dataBytes === null || dataBytes < 1
		|| dataBytes % format.blockAlign !== 0) invalidFloatWav();
	const frameCount = dataBytes / format.blockAlign;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) invalidFloatWav();
	return Object.freeze({
		sampleRate: format.sampleRate,
		channelCount: format.channelCount,
		frameCount,
	});
}

function inspectFloatFormat(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const formatTag = view.getUint16(0, true);
	const channelCount = view.getUint16(2, true);
	const sampleRate = view.getUint32(4, true);
	const byteRate = view.getUint32(8, true);
	const blockAlign = view.getUint16(12, true);
	const bitDepth = view.getUint16(14, true);
	let subFormatTag = formatTag;
	if (formatTag === 0xfffe) {
		if (bytes.byteLength < 40 || view.getUint16(16, true) < 22
			|| view.getUint16(18, true) !== 32) invalidFloatWav();
		subFormatTag = view.getUint32(24, true);
		const guidTail = [0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71];
		for (const [index, expected] of guidTail.entries()) {
			if (view.getUint8(28 + index) !== expected) invalidFloatWav();
		}
	}
	if (subFormatTag !== 3 || bitDepth !== 32 || channelCount < 1 || channelCount > 32
		|| sampleRate < 1 || blockAlign !== channelCount * 4
		|| byteRate !== sampleRate * blockAlign) invalidFloatWav();
	return Object.freeze({ sampleRate, channelCount, blockAlign });
}

async function readBlobRange(
	blob: Blob,
	offset: number,
	byteLength: number,
	signal: AbortSignal | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
	throwIfAborted(signal);
	const part = Blob.prototype.slice.call(blob, offset, offset + byteLength);
	const buffer = await part.arrayBuffer();
	throwIfAborted(signal);
	if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== byteLength) invalidFloatWav();
	return new Uint8Array(buffer);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let value = '';
	for (let index = 0; index < length; index += 1) {
		value += String.fromCharCode(bytes[offset + index]!);
	}
	return value;
}

function uint32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function invalidFloatWav(): never {
	throw new TypeError('Video keyframe audio input must be a canonical float32 WAV.');
}

export function assertVideoKeyframeAudioInputSource(
	value: unknown,
): asserts value is VideoKeyframeAudioInputSource {
	if (!value || typeof value !== 'object' || !AUDIO_INPUT_SOURCES.has(value)) {
		throw new TypeError('An authenticated float32 WAV audio input source is required.');
	}
}

/** Copy authenticated WAV slices into a ring with exact byte accounting and backpressure. */
export async function writeVideoKeyframeAudioInput(
	sourceValue: VideoKeyframeAudioInputSource,
	stream: VideoKeyframeFfmpegInputStream,
	capacityBytes: number,
	options: Readonly<{ signal: AbortSignal; assertCurrent?: () => void }>,
): Promise<VideoKeyframeAudioInputWriteResult> {
	assertVideoKeyframeAudioInputSource(sourceValue);
	const source = sourceValue;
	const capacity = positiveSafeInteger(capacityBytes, 'audio input ring capacity');
	let offset = 0;
	let chunkCount = 0;
	while (offset < source.byteLength) {
		assertWriteReady(options);
		const requested = Math.min(capacity, source.byteLength - offset);
		const chunk = await source.read(offset, requested, { signal: options.signal });
		assertWriteReady(options);
		if (chunk.byteLength !== requested) {
			throw new Error('Video keyframe audio input slices must fill their exact bounded request.');
		}
		await stream.write(chunk, { signal: options.signal });
		assertWriteReady(options);
		offset += chunk.byteLength;
		chunkCount += 1;
	}
	await stream.close();
	assertWriteReady(options);
	return Object.freeze({ byteLength: offset, chunkCount });
}

function snapshotWav(value: Blob, maximumBytes: number): Blob {
	if (typeof Blob !== 'function' || !(value instanceof Blob)) {
		throw new TypeError('Video keyframe audio input must be a Blob.');
	}
	const sizeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
	const typeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')?.get;
	if (!sizeGetter || !typeGetter) throw new Error('Canonical Blob accessors are unavailable.');
	const size = Reflect.apply(sizeGetter, value, []) as unknown;
	const type = Reflect.apply(typeGetter, value, []) as unknown;
	if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > maximumBytes) {
		throw new RangeError(
			`Video keyframe float32 WAV bytes must be 1 through ${String(maximumBytes)}.`,
		);
	}
	if (type !== 'audio/wav') {
		throw new TypeError('Video keyframe audio input Blob type must be audio/wav.');
	}
	return Blob.prototype.slice.call(value, 0, size, 'audio/wav');
}

function normalizeOptions(
	value: VideoKeyframeAudioInputAdmissionOptions,
): Required<Pick<VideoKeyframeAudioInputAdmissionOptions, 'maximumBytes'>>
	& Omit<VideoKeyframeAudioInputAdmissionOptions, 'maximumBytes'> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Video keyframe audio input admission options must be an object.');
	}
	for (const key of Reflect.ownKeys(value)) {
		if (key !== 'maximumBytes' && key !== 'signal' && key !== 'assertCurrent') {
			throw new TypeError('Video keyframe audio input admission options have an unsupported field.');
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Video keyframe audio input options.${String(key)} must be a data property.`);
		}
	}
	const maximumBytes = Object.hasOwn(value, 'maximumBytes')
		? positiveSafeInteger(value.maximumBytes, 'maximumAudioBytes')
		: VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES;
	if (maximumBytes > VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES) {
		throw new RangeError(
			`maximumAudioBytes cannot exceed ${String(VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES)}.`,
		);
	}
	if (value.signal !== undefined
		&& (typeof AbortSignal !== 'function' || !(value.signal instanceof AbortSignal))) {
		throw new TypeError('Video keyframe audio input signal must be an AbortSignal.');
	}
	if (value.assertCurrent !== undefined && typeof value.assertCurrent !== 'function') {
		throw new TypeError('Video keyframe audio input assertCurrent must be a function.');
	}
	return Object.freeze({
		maximumBytes,
		...(value.signal ? { signal: value.signal } : {}),
		...(value.assertCurrent ? { assertCurrent: value.assertCurrent } : {}),
	});
}

function normalizeReadSignal(value: Readonly<{ signal?: AbortSignal }>): AbortSignal | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Video keyframe audio input read options must be an object.');
	}
	for (const key of Reflect.ownKeys(value)) {
		if (key !== 'signal') throw new TypeError('Video keyframe audio input read options have an unsupported field.');
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Video keyframe audio input signal must be a data property.');
		}
	}
	if (value.signal !== undefined
		&& (typeof AbortSignal !== 'function' || !(value.signal instanceof AbortSignal))) {
		throw new TypeError('Video keyframe audio input read signal must be an AbortSignal.');
	}
	return value.signal;
}

function assertReady(options: VideoKeyframeAudioInputAdmissionOptions): void {
	throwIfAborted(options.signal);
	options.assertCurrent?.();
}

function assertWriteReady(
	options: Readonly<{ signal: AbortSignal; assertCurrent?: () => void }>,
): void {
	throwIfAborted(options.signal);
	options.assertCurrent?.();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? abortError();
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
