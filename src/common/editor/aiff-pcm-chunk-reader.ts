/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from './pcm-chunks.js';

const FORM_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const COMM_BYTES = 18;
const SSND_PREFIX_BYTES = 8;
const DEFAULT_MAXIMUM_CHUNKS = 4_096;
const MAXIMUM_CHUNKS = 65_536;
const MAXIMUM_CHANNELS = 64;

export type AiffPcmSampleFormat = 'int8' | 'int16' | 'int24' | 'int32';

export interface AiffBlobPcmSource {
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface AiffPcmDescriptor {
	readonly container: 'aiff';
	readonly encoding: 'pcm-integer';
	readonly sampleFormat: AiffPcmSampleFormat;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly bitDepth: number;
	readonly bytesPerSample: number;
	readonly blockAlign: number;
	readonly byteRate: number;
	readonly dataOffset: number;
	readonly dataByteLength: number;
	readonly formByteLength: number;
	readonly sourceByteLength: number;
}

export interface AiffBlobPcmChunk {
	readonly channels: readonly Float32Array[];
	readonly index: number;
	readonly frameOffset: number;
	readonly frames: number;
	readonly final: boolean;
	readonly descriptor: AiffPcmDescriptor;
}

export interface AiffBlobPcmChunkReader {
	readonly descriptor: AiffPcmDescriptor;
	readonly chunkFrames: number;
	readonly chunkCount: number;
	readChunk(
		chunkIndex: number,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<AiffBlobPcmChunk>;
}

interface AiffComm {
	readonly sampleFormat: AiffPcmSampleFormat;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly bitDepth: number;
	readonly bytesPerSample: number;
	readonly blockAlign: number;
	readonly byteRate: number;
}

interface AiffSoundData {
	readonly dataOffset: number;
	readonly dataByteLength: number;
}

const DESCRIPTOR_FIELDS = Object.freeze([
	'container', 'encoding', 'sampleFormat', 'sampleRate', 'channelCount',
	'frameCount', 'bitDepth', 'bytesPerSample', 'blockAlign', 'byteRate',
	'dataOffset', 'dataByteLength', 'formByteLength', 'sourceByteLength',
] as const);

/** Inspect classic uncompressed AIFF through bounded structural range reads. */
export async function inspectAiffBlobPcm(
	sourceValue: unknown,
	options: Readonly<{ signal?: AbortSignal; maxChunks?: number }> = {},
): Promise<AiffPcmDescriptor> {
	assertAiffBlobPcmSource(sourceValue);
	const source = sourceValue;
	const { signal } = options;
	const maximumChunks = integerInRange(
		options.maxChunks ?? DEFAULT_MAXIMUM_CHUNKS,
		1,
		MAXIMUM_CHUNKS,
		'maxChunks',
	);
	throwIfAborted(signal);
	if (source.size < FORM_HEADER_BYTES) {
		throw new Error('The AIFF file is too small to contain a FORM header.');
	}
	const header = await readSourceBytes(source, 0, FORM_HEADER_BYTES, signal);
	if (ascii(header, 0, 4) !== 'FORM') throw new Error('The file is not an AIFF FORM container.');
	const formType = ascii(header, 8, 4);
	if (formType === 'AIFC') {
		throw new Error('AIFF-C compressed or floating-point audio is unsupported for linked originals.');
	}
	if (formType !== 'AIFF') throw new Error('The FORM container is not classic AIFF.');
	const formPayloadBytes = dataView(header).getUint32(4, false);
	if (formPayloadBytes < 4) throw new Error('The AIFF FORM size is invalid.');
	const formByteLength = 8 + formPayloadBytes;
	if (formByteLength > source.size) throw new Error('The AIFF FORM payload is truncated.');

	let comm: AiffComm | null = null;
	let sound: AiffSoundData | null = null;
	let offset = FORM_HEADER_BYTES;
	let chunksRead = 0;
	while (offset < formByteLength) {
		throwIfAborted(signal);
		if (chunksRead >= maximumChunks) {
			throw new Error(`The AIFF file exceeds the ${maximumChunks}-chunk inspection limit.`);
		}
		if (formByteLength - offset < CHUNK_HEADER_BYTES) {
			throw new Error('The AIFF FORM ends inside a chunk header.');
		}
		const chunkHeader = await readSourceBytes(
			source,
			offset,
			offset + CHUNK_HEADER_BYTES,
			signal,
		);
		const chunkId = ascii(chunkHeader, 0, 4);
		const chunkBytes = dataView(chunkHeader).getUint32(4, false);
		const payloadOffset = offset + CHUNK_HEADER_BYTES;
		const payloadEnd = payloadOffset + chunkBytes;
		if (!Number.isSafeInteger(payloadEnd) || payloadEnd > formByteLength) {
			throw new Error(`The AIFF ${printableChunkId(chunkId)} chunk is truncated.`);
		}
		chunksRead += 1;
		if (chunkId === 'COMM') {
			if (comm) throw new Error('The AIFF file contains multiple COMM chunks.');
			if (chunkBytes !== COMM_BYTES) {
				throw new Error('The classic AIFF COMM chunk must contain exactly 18 bytes.');
			}
			comm = parseComm(await readSourceBytes(source, payloadOffset, payloadEnd, signal));
		} else if (chunkId === 'SSND') {
			if (sound) throw new Error('The AIFF file contains multiple SSND chunks.');
			if (chunkBytes < SSND_PREFIX_BYTES) {
				throw new Error('The AIFF SSND chunk is too small.');
			}
			const prefix = await readSourceBytes(
				source,
				payloadOffset,
				payloadOffset + SSND_PREFIX_BYTES,
				signal,
			);
			const view = dataView(prefix);
			const soundOffset = view.getUint32(0, false);
			const blockSize = view.getUint32(4, false);
			if (blockSize !== 0) {
				throw new Error('Blocked AIFF sound data is unsupported for linked originals.');
			}
			if (soundOffset > chunkBytes - SSND_PREFIX_BYTES) {
				throw new Error('The AIFF SSND sound-data offset exceeds its chunk.');
			}
			sound = Object.freeze({
				dataOffset: payloadOffset + SSND_PREFIX_BYTES + soundOffset,
				dataByteLength: chunkBytes - SSND_PREFIX_BYTES - soundOffset,
			});
		}
		const paddedEnd = payloadEnd + (chunkBytes % 2);
		if (paddedEnd > formByteLength) {
			throw new Error(`The AIFF ${printableChunkId(chunkId)} chunk is missing its alignment byte.`);
		}
		offset = paddedEnd;
	}
	if (!comm) throw new Error('The AIFF file does not contain one COMM chunk.');
	if (!sound) throw new Error('The AIFF file does not contain one SSND chunk.');
	const expectedDataBytes = comm.frameCount * comm.blockAlign;
	if (!Number.isSafeInteger(expectedDataBytes) || sound.dataByteLength !== expectedDataBytes) {
		throw new Error('The AIFF sound data does not match its declared PCM geometry.');
	}
	return descriptorFromFields({
		...comm,
		...sound,
		formByteLength,
		sourceByteLength: source.size,
	});
}

/** Bind an inspected AIFF descriptor to bounded random-access PCM reads. */
export function createAiffBlobPcmChunkReader(
	sourceValue: unknown,
	options: Readonly<{ descriptor: unknown; chunkFrames?: number }>,
): AiffBlobPcmChunkReader {
	assertAiffBlobPcmSource(sourceValue);
	if (!options || typeof options !== 'object') {
		throw new TypeError('AIFF PCM chunk reader options are required.');
	}
	const source = sourceValue;
	const descriptor = validateAiffPcmDescriptor(source, options.descriptor);
	const chunkFrames = integerInRange(
		options.chunkFrames ?? AUDIO_EDITOR_PCM_CHUNK_FRAMES,
		1,
		AUDIO_EDITOR_PCM_CHUNK_FRAMES,
		'chunkFrames',
	);
	const chunkCount = Math.ceil(descriptor.frameCount / chunkFrames);
	return Object.freeze({
		descriptor,
		chunkFrames,
		chunkCount,
		async readChunk(
			chunkIndex: number,
			{ signal }: Readonly<{ signal?: AbortSignal }> = {},
		): Promise<AiffBlobPcmChunk> {
			throwIfAborted(signal);
			if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
				throw new RangeError(`AIFF PCM chunk index must be an integer from 0 to ${chunkCount - 1}.`);
			}
			const frameOffset = chunkIndex * chunkFrames;
			const frames = Math.min(chunkFrames, descriptor.frameCount - frameOffset);
			const byteOffset = descriptor.dataOffset + frameOffset * descriptor.blockAlign;
			const bytes = await readSourceBytes(
				source,
				byteOffset,
				byteOffset + frames * descriptor.blockAlign,
				signal,
			);
			const channels = decodeInterleavedPcm(bytes, frames, descriptor);
			throwIfAborted(signal);
			return Object.freeze({
				channels,
				index: chunkIndex,
				frameOffset,
				frames,
				final: frameOffset + frames === descriptor.frameCount,
				descriptor,
			});
		},
	});
}

function parseComm(bytes: Uint8Array): AiffComm {
	const view = dataView(bytes);
	const channelCount = view.getUint16(0, false);
	const frameCount = view.getUint32(2, false);
	const bitDepth = view.getUint16(6, false);
	if (channelCount < 1 || channelCount > MAXIMUM_CHANNELS) {
		throw new RangeError(`AIFF channel count must be between 1 and ${MAXIMUM_CHANNELS}.`);
	}
	if (frameCount < 1) throw new RangeError('AIFF frame count must be positive.');
	const sampleFormat = sampleFormatForBitDepth(bitDepth);
	const bytesPerSample = bitDepth / 8;
	const blockAlign = channelCount * bytesPerSample;
	const sampleRate = readExtended80(view, 8);
	const byteRate = sampleRate * blockAlign;
	if (!Number.isSafeInteger(byteRate)) throw new RangeError('AIFF byte rate exceeds integer precision.');
	return Object.freeze({
		sampleFormat,
		sampleRate,
		channelCount,
		frameCount,
		bitDepth,
		bytesPerSample,
		blockAlign,
		byteRate,
	});
}

function readExtended80(view: DataView, offset: number): number {
	const signAndExponent = view.getUint16(offset, false);
	if ((signAndExponent & 0x8000) !== 0) throw new RangeError('AIFF sample rate must be positive.');
	const exponent = signAndExponent & 0x7fff;
	const high = view.getUint32(offset + 2, false);
	const low = view.getUint32(offset + 6, false);
	if (exponent === 0 || exponent === 0x7fff || (high & 0x8000_0000) === 0) {
		throw new RangeError('AIFF sample rate has an invalid extended-float encoding.');
	}
	const mantissa = high * 0x1_0000_0000 + low;
	const value = mantissa * 2 ** (exponent - 16_383 - 63);
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError('AIFF sample rate must be a positive safe integer.');
	}
	return value;
}

function validateAiffPcmDescriptor(
	source: AiffBlobPcmSource,
	value: unknown,
): AiffPcmDescriptor {
	const candidate = closedDescriptor(value);
	if (candidate.container !== 'aiff' || candidate.encoding !== 'pcm-integer') {
		throw new TypeError('An AIFF PCM descriptor is required.');
	}
	const sampleFormat = sampleFormatForBitDepth(positiveSafeInteger(candidate.bitDepth, 'bitDepth'));
	if (candidate.sampleFormat !== sampleFormat) {
		throw new TypeError('AIFF PCM descriptor sample format is invalid.');
	}
	const sampleRate = positiveSafeInteger(candidate.sampleRate, 'sampleRate');
	const channelCount = positiveSafeInteger(candidate.channelCount, 'channelCount');
	if (channelCount > MAXIMUM_CHANNELS) throw new TypeError('AIFF PCM descriptor channel count is invalid.');
	const frameCount = positiveSafeInteger(candidate.frameCount, 'frameCount');
	const bytesPerSample = positiveSafeInteger(candidate.bytesPerSample, 'bytesPerSample');
	const expectedBytesPerSample = Number(candidate.bitDepth) / 8;
	const blockAlign = positiveSafeInteger(candidate.blockAlign, 'blockAlign');
	const byteRate = positiveSafeInteger(candidate.byteRate, 'byteRate');
	const dataOffset = positiveSafeInteger(candidate.dataOffset, 'dataOffset');
	const dataByteLength = positiveSafeInteger(candidate.dataByteLength, 'dataByteLength');
	const formByteLength = positiveSafeInteger(candidate.formByteLength, 'formByteLength');
	const sourceByteLength = positiveSafeInteger(candidate.sourceByteLength, 'sourceByteLength');
	const expectedDataBytes = frameCount * blockAlign;
	const dataEnd = dataOffset + dataByteLength;
	if (sourceByteLength !== source.size) {
		throw new Error('The AIFF descriptor belongs to a different-sized source.');
	}
	if (bytesPerSample !== expectedBytesPerSample
		|| blockAlign !== channelCount * bytesPerSample
		|| byteRate !== sampleRate * blockAlign
		|| !Number.isSafeInteger(expectedDataBytes) || dataByteLength !== expectedDataBytes
		|| dataOffset < FORM_HEADER_BYTES || !Number.isSafeInteger(dataEnd)
		|| dataEnd > formByteLength || formByteLength > sourceByteLength) {
		throw new TypeError('AIFF PCM descriptor geometry or data range is invalid.');
	}
	return descriptorFromFields({
		sampleFormat,
		sampleRate,
		channelCount,
		frameCount,
		bitDepth: Number(candidate.bitDepth),
		bytesPerSample,
		blockAlign,
		byteRate,
		dataOffset,
		dataByteLength,
		formByteLength,
		sourceByteLength,
	});
}

function descriptorFromFields(
	fields: Omit<AiffPcmDescriptor, 'container' | 'encoding'>,
): AiffPcmDescriptor {
	return Object.freeze({
		container: 'aiff' as const,
		encoding: 'pcm-integer' as const,
		...fields,
	});
}

function closedDescriptor(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An AIFF PCM descriptor is required.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== DESCRIPTOR_FIELDS.length
		|| keys.some((key) => typeof key !== 'string' || !DESCRIPTOR_FIELDS.includes(key as never))) {
		throw new TypeError('AIFF PCM descriptor fields are invalid.');
	}
	const output: Record<string, unknown> = {};
	for (const field of DESCRIPTOR_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`AIFF PCM descriptor ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function decodeInterleavedPcm(
	bytes: Uint8Array,
	frameCount: number,
	descriptor: AiffPcmDescriptor,
): readonly Float32Array[] {
	const channels = Array.from(
		{ length: descriptor.channelCount },
		() => new Float32Array(frameCount),
	);
	const view = dataView(bytes);
	let offset = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < descriptor.channelCount; channel += 1) {
			channels[channel]![frame] = readSample(view, offset, descriptor.sampleFormat);
			offset += descriptor.bytesPerSample;
		}
	}
	return Object.freeze(channels);
}

function readSample(view: DataView, offset: number, format: AiffPcmSampleFormat): number {
	if (format === 'int8') return view.getInt8(offset) / 0x80;
	if (format === 'int16') return view.getInt16(offset, false) / 0x8000;
	if (format === 'int24') {
		let value = (view.getUint8(offset) << 16)
			| (view.getUint8(offset + 1) << 8)
			| view.getUint8(offset + 2);
		if ((value & 0x800000) !== 0) value |= 0xff000000;
		return value / 0x800000;
	}
	return view.getInt32(offset, false) / 0x80000000;
}

function sampleFormatForBitDepth(value: number): AiffPcmSampleFormat {
	if (value === 8) return 'int8';
	if (value === 16) return 'int16';
	if (value === 24) return 'int24';
	if (value === 32) return 'int32';
	throw new RangeError(`AIFF integer PCM bit depth ${value} is unsupported.`);
}

async function readSourceBytes(
	source: AiffBlobPcmSource,
	start: number,
	end: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	throwIfAborted(signal);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
		|| start < 0 || end < start || end > source.size) {
		throw new RangeError('AIFF source range is invalid.');
	}
	const part = source.slice(start, end);
	if (!part || typeof part.arrayBuffer !== 'function') {
		throw new TypeError('AIFF source slices must provide arrayBuffer().');
	}
	const buffer = await part.arrayBuffer();
	throwIfAborted(signal);
	if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - start) {
		throw new Error('An AIFF source range returned an unexpected number of bytes.');
	}
	return new Uint8Array(buffer);
}

function assertAiffBlobPcmSource(value: unknown): asserts value is AiffBlobPcmSource {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An AIFF source with size and slice() is required.');
	}
	const source = value as Readonly<{ size?: unknown; slice?: unknown }>;
	if (!Number.isSafeInteger(source.size) || Number(source.size) < 0 || typeof source.slice !== 'function') {
		throw new TypeError('An AIFF source with size and slice() is required.');
	}
}

function positiveSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new TypeError(`AIFF PCM descriptor ${field} is invalid.`);
	}
	return Number(value);
}

function integerInRange(value: number, minimum: number, maximum: number, field: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${field} must be an integer from ${minimum} to ${maximum}.`);
	}
	return value;
}

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let value = '';
	for (let index = 0; index < length; index += 1) {
		value += String.fromCharCode(bytes[offset + index]!);
	}
	return value;
}

function printableChunkId(value: string): string {
	return JSON.stringify(value.replace(/[^\x20-\x7e]/gu, '?'));
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') {
		throw new DOMException('AIFF PCM reading was cancelled.', 'AbortError');
	}
	const error = new Error('AIFF PCM reading was cancelled.');
	error.name = 'AbortError';
	throw error;
}
