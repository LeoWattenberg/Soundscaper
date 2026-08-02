/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeBextMetadata,
	type BextMetadata,
	type BextMetadataInput,
} from './broadcast-wave.ts';
import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from './pcm-chunks.js';
import { dataView, readBlobBytes, throwIfAborted } from './wav-import-io.ts';

export const WAV_PCM_MINIMUM_FORMAT_BYTES = 16;
export const WAV_PCM_EXTENSIBLE_FORMAT_BYTES = 40;

const RIFF_HEADER_BYTES = 12;
const MAX_CHANNEL_COUNT = 64;
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const EXTENSIBLE_GUID_TAIL = Object.freeze([
	0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

export type WavPcmEncoding = 'pcm-integer' | 'ieee-float';
export type WavPcmSampleFormat =
	| 'uint8'
	| 'int16'
	| 'int20'
	| 'int24'
	| 'int32'
	| 'float32'
	| 'float64';

export interface WavBlobPcmSource {
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface WavPcmDescriptorWarning {
	readonly code: string;
	readonly message: string;
}

export interface WavPcmDescriptor {
	readonly container: 'wav';
	readonly encoding: WavPcmEncoding;
	readonly sampleFormat: WavPcmSampleFormat;
	readonly formatTag: number;
	readonly subFormatTag: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly bitDepth: number;
	readonly validBitsPerSample: number;
	readonly bytesPerSample: number;
	readonly blockAlign: number;
	readonly byteRate: number;
	readonly channelMask: number;
	readonly bext: BextMetadata | null;
	readonly metadataWarnings: readonly WavPcmDescriptorWarning[];
	readonly dataOffset: number;
	readonly dataByteLength: number;
	readonly riffByteLength: number;
	readonly sourceByteLength: number;
	readonly [field: string]: unknown;
}

export interface WavPcmFormat {
	readonly encoding: WavPcmEncoding;
	readonly sampleFormat: WavPcmSampleFormat;
	readonly formatTag: number;
	readonly subFormatTag: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly bitDepth: number;
	readonly validBitsPerSample: number;
	readonly bytesPerSample: number;
	readonly blockAlign: number;
	readonly byteRate: number;
	readonly channelMask: number;
}

export interface WavBlobPcmChunk {
	readonly channels: readonly Float32Array[];
	readonly index: number;
	readonly frameOffset: number;
	readonly frames: number;
	readonly final: boolean;
	readonly descriptor: WavPcmDescriptor;
}

export interface WavBlobPcmChunkReader {
	readonly descriptor: WavPcmDescriptor;
	readonly chunkFrames: number;
	readonly chunkCount: number;
	readChunk(
		chunkIndex: number,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<WavBlobPcmChunk>;
}

export interface WavBlobPcmChunkReaderOptions {
	readonly descriptor: unknown;
	readonly chunkFrames?: number;
}

/**
 * Bind a previously inspected descriptor to bounded, random-access PCM reads.
 * Creation performs no source I/O; each read materializes only one encoded
 * slice and its exact planar Float32 result.
 */
export function createWavBlobPcmChunkReader(
	sourceValue: unknown,
	options: WavBlobPcmChunkReaderOptions,
): WavBlobPcmChunkReader {
	assertWavBlobPcmSource(sourceValue);
	if (!options || typeof options !== 'object') throw new TypeError('WAV PCM chunk reader options are required.');
	const source = sourceValue;
	const descriptor = validateWavPcmDescriptor(source, options.descriptor);
	const chunkFrames = positiveIntegerInRange(
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
		): Promise<WavBlobPcmChunk> {
			throwIfAborted(signal);
			if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
				throw new RangeError(`WAV PCM chunk index must be an integer from 0 to ${chunkCount - 1}.`);
			}
			const frameOffset = chunkIndex * chunkFrames;
			const frames = Math.min(chunkFrames, descriptor.frameCount - frameOffset);
			const byteOffset = descriptor.dataOffset + frameOffset * descriptor.blockAlign;
			const encoded = await readBlobBytes(
				source as Blob,
				byteOffset,
				byteOffset + frames * descriptor.blockAlign,
				signal,
			);
			const channels = decodeInterleavedPcm(encoded, frames, descriptor);
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

export function parseWavPcmFormat(bytes: Uint8Array, declaredBytes: number): WavPcmFormat {
	const view = dataView(bytes);
	const formatTag = view.getUint16(0, true);
	const channelCount = view.getUint16(2, true);
	const sampleRate = view.getUint32(4, true);
	const byteRate = view.getUint32(8, true);
	const blockAlign = view.getUint16(12, true);
	const bitDepth = view.getUint16(14, true);
	if (channelCount < 1 || channelCount > MAX_CHANNEL_COUNT) {
		throw new RangeError(`WAV channel count must be between 1 and ${MAX_CHANNEL_COUNT}.`);
	}
	if (!sampleRate) throw new RangeError('WAV sample rate must be positive.');

	let subFormatTag = formatTag;
	let validBitsPerSample = bitDepth;
	let channelMask = 0;
	if (formatTag === WAVE_FORMAT_EXTENSIBLE) {
		if (declaredBytes < WAV_PCM_EXTENSIBLE_FORMAT_BYTES || bytes.byteLength < WAV_PCM_EXTENSIBLE_FORMAT_BYTES) {
			throw new Error('The extensible WAV format chunk is too small.');
		}
		const extensionBytes = view.getUint16(16, true);
		if (extensionBytes < 22) throw new Error('The extensible WAV format payload is incomplete.');
		validBitsPerSample = view.getUint16(18, true);
		channelMask = view.getUint32(20, true);
		subFormatTag = view.getUint32(24, true);
		for (let index = 0; index < EXTENSIBLE_GUID_TAIL.length; index += 1) {
			if (view.getUint8(28 + index) !== EXTENSIBLE_GUID_TAIL[index]) {
				throw new Error('The extensible WAV subformat GUID is unsupported.');
			}
		}
	}

	const encoding = subFormatTag === WAVE_FORMAT_PCM
		? 'pcm-integer'
		: subFormatTag === WAVE_FORMAT_IEEE_FLOAT ? 'ieee-float' : null;
	if (!encoding) throw new Error(`WAV format ${subFormatTag} is compressed or unsupported.`);
	const integerDepth = bitDepth === 8 || bitDepth === 16 || bitDepth === 20 || bitDepth === 24 || bitDepth === 32;
	const floatDepth = bitDepth === 32 || bitDepth === 64;
	if ((encoding === 'pcm-integer' && !integerDepth) || (encoding === 'ieee-float' && !floatDepth)) {
		throw new Error(`${encoding === 'ieee-float' ? 'IEEE float' : 'Integer PCM'} WAV bit depth ${bitDepth} is unsupported.`);
	}
	if (validBitsPerSample < 1 || validBitsPerSample > bitDepth) {
		throw new Error('The WAV valid-bits field is outside its sample container.');
	}
	if (encoding === 'ieee-float' && validBitsPerSample !== bitDepth) {
		throw new Error('IEEE float WAV samples must use their full container width.');
	}
	const bytesPerSample = Math.ceil(bitDepth / 8);
	const expectedBlockAlign = channelCount * bytesPerSample;
	if (blockAlign !== expectedBlockAlign) {
		throw new Error(`WAV block alignment must be ${expectedBlockAlign} bytes for this format.`);
	}
	const expectedByteRate = sampleRate * blockAlign;
	if (byteRate !== expectedByteRate) throw new Error(`WAV byte rate must be ${expectedByteRate}.`);
	const sampleFormat: WavPcmSampleFormat = encoding === 'ieee-float'
		? bitDepth === 32 ? 'float32' : 'float64'
		: bitDepth === 8 ? 'uint8'
			: bitDepth === 16 ? 'int16'
				: bitDepth === 20 ? 'int20'
					: bitDepth === 24 ? 'int24' : 'int32';

	return {
		formatTag,
		subFormatTag,
		encoding,
		sampleFormat,
		sampleRate,
		channelCount,
		bitDepth,
		validBitsPerSample,
		bytesPerSample,
		blockAlign,
		byteRate,
		channelMask,
	};
}

export function validateWavPcmDescriptor(
	source: WavBlobPcmSource,
	descriptorValue: unknown,
): WavPcmDescriptor {
	if (!descriptorValue || typeof descriptorValue !== 'object' || Array.isArray(descriptorValue)) {
		throw new TypeError('A WAV PCM descriptor is required.');
	}
	const descriptor = descriptorValue as Readonly<Record<string, unknown>>;
	if (descriptor.container !== 'wav') throw new TypeError('A WAV PCM descriptor is required.');
	if (descriptor.sourceByteLength !== source.size) throw new Error('The WAV descriptor belongs to a different-sized Blob.');
	if (!Array.isArray(descriptor.metadataWarnings)
		|| descriptor.metadataWarnings.some((warning: unknown) => !warning || typeof warning !== 'object'
			|| typeof (warning as Readonly<{ code?: unknown }>).code !== 'string'
			|| typeof (warning as Readonly<{ message?: unknown }>).message !== 'string')) {
		throw new TypeError('WAV descriptor metadata warnings are invalid.');
	}
	validateBextMetadata(descriptor.bext);
	const integerFields = [
		'sampleRate', 'channelCount', 'frameCount', 'bitDepth', 'validBitsPerSample', 'bytesPerSample',
		'blockAlign', 'byteRate', 'dataOffset', 'dataByteLength', 'riffByteLength', 'sourceByteLength',
	] as const;
	for (const field of integerFields) {
		const value = descriptor[field];
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
			throw new TypeError(`WAV descriptor ${field} is invalid.`);
		}
	}
	for (const field of ['formatTag', 'subFormatTag', 'channelMask'] as const) {
		const value = descriptor[field];
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
			throw new TypeError(`WAV descriptor ${field} is invalid.`);
		}
	}
	if ((descriptor.sampleRate as number) < 1 || (descriptor.channelCount as number) < 1
		|| (descriptor.channelCount as number) > MAX_CHANNEL_COUNT || (descriptor.frameCount as number) < 1) {
		throw new TypeError('WAV descriptor PCM geometry is invalid.');
	}
	const sampleFormat = descriptor.sampleFormat;
	const format = typeof sampleFormat === 'string' && Object.hasOwn(SAMPLE_FORMATS, sampleFormat)
		? SAMPLE_FORMATS[sampleFormat as WavPcmSampleFormat]
		: undefined;
	if (!format || descriptor.bitDepth !== format.bitDepth || descriptor.bytesPerSample !== format.bytesPerSample
		|| descriptor.encoding !== format.encoding || descriptor.subFormatTag !== format.subFormatTag
		|| (descriptor.formatTag !== format.subFormatTag && descriptor.formatTag !== WAVE_FORMAT_EXTENSIBLE)) {
		throw new TypeError('WAV descriptor sample format is invalid.');
	}
	if ((descriptor.validBitsPerSample as number) < 1
		|| (descriptor.validBitsPerSample as number) > (descriptor.bitDepth as number)
		|| (descriptor.encoding === 'ieee-float' && descriptor.validBitsPerSample !== descriptor.bitDepth)) {
		throw new TypeError('WAV descriptor valid-bits field is invalid.');
	}
	const expectedBlockAlign = (descriptor.channelCount as number) * (descriptor.bytesPerSample as number);
	const expectedDataBytes = (descriptor.frameCount as number) * (descriptor.blockAlign as number);
	const dataEnd = (descriptor.dataOffset as number) + (descriptor.dataByteLength as number);
	if (descriptor.blockAlign !== expectedBlockAlign
		|| descriptor.byteRate !== (descriptor.sampleRate as number) * (descriptor.blockAlign as number)
		|| (descriptor.dataOffset as number) < RIFF_HEADER_BYTES || !Number.isSafeInteger(expectedDataBytes)
		|| !Number.isSafeInteger(dataEnd) || expectedDataBytes !== descriptor.dataByteLength
		|| dataEnd > (descriptor.riffByteLength as number) || (descriptor.riffByteLength as number) > source.size) {
		throw new TypeError('WAV descriptor data range is invalid.');
	}
	return Object.freeze(descriptorValue) as WavPcmDescriptor;
}

const SAMPLE_FORMATS = Object.freeze({
	uint8: { bitDepth: 8, bytesPerSample: 1, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
	int16: { bitDepth: 16, bytesPerSample: 2, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
	int20: { bitDepth: 20, bytesPerSample: 3, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
	int24: { bitDepth: 24, bytesPerSample: 3, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
	int32: { bitDepth: 32, bytesPerSample: 4, encoding: 'pcm-integer', subFormatTag: WAVE_FORMAT_PCM },
	float32: { bitDepth: 32, bytesPerSample: 4, encoding: 'ieee-float', subFormatTag: WAVE_FORMAT_IEEE_FLOAT },
	float64: { bitDepth: 64, bytesPerSample: 8, encoding: 'ieee-float', subFormatTag: WAVE_FORMAT_IEEE_FLOAT },
} as const satisfies Readonly<Record<WavPcmSampleFormat, Readonly<{
	bitDepth: number;
	bytesPerSample: number;
	encoding: WavPcmEncoding;
	subFormatTag: number;
}>>>);

function decodeInterleavedPcm(
	bytes: Uint8Array,
	frameCount: number,
	descriptor: WavPcmDescriptor,
): readonly Float32Array[] {
	const channels = Array.from({ length: descriptor.channelCount }, () => new Float32Array(frameCount));
	const view = dataView(bytes);
	let byteOffset = 0;
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < descriptor.channelCount; channel += 1) {
			channels[channel][frame] = readPcmSample(view, byteOffset, descriptor.sampleFormat);
			byteOffset += descriptor.bytesPerSample;
		}
	}
	return channels;
}

function readPcmSample(view: DataView, offset: number, sampleFormat: WavPcmSampleFormat): number {
	if (sampleFormat === 'uint8') return (view.getUint8(offset) - 128) / 128;
	if (sampleFormat === 'int16') return view.getInt16(offset, true) / 0x8000;
	if (sampleFormat === 'int20' || sampleFormat === 'int24') {
		let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
		if (value & 0x800000) value |= 0xff000000;
		return value / 0x800000;
	}
	if (sampleFormat === 'int32') return view.getInt32(offset, true) / 0x80000000;
	const value = sampleFormat === 'float32' ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
	return Number.isFinite(value) ? value : 0;
}

function validateBextMetadata(value: unknown): void {
	if (value == null) return;
	try {
		const input = value as BextMetadataInput;
		const normalized = normalizeBextMetadata(input, { version: input.version });
		const keys = Object.keys(normalized) as (keyof BextMetadata)[];
		if (!value || typeof value !== 'object' || Array.isArray(value)
			|| Object.keys(value).length !== keys.length
			|| keys.some((key) => !Object.hasOwn(value, key)
				|| !Object.is((value as Readonly<Record<keyof BextMetadata, unknown>>)[key], normalized[key]))) {
			throw new TypeError();
		}
	} catch {
		throw new TypeError('WAV descriptor BEXT metadata is invalid.');
	}
}

function assertWavBlobPcmSource(value: unknown): asserts value is WavBlobPcmSource {
	if (!value || typeof value !== 'object') throw new TypeError('A Blob or File with size and slice() is required.');
	const source = value as Readonly<{ size?: unknown; slice?: unknown }>;
	if (typeof source.size !== 'number' || !Number.isSafeInteger(source.size) || source.size < 0
		|| typeof source.slice !== 'function') {
		throw new TypeError('A Blob or File with size and slice() is required.');
	}
}

function positiveIntegerInRange(value: number, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
	}
	return value;
}
