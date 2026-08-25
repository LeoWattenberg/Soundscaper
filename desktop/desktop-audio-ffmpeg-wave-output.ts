/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict authority for the float WAV emitted by the admitted external FFmpeg decoder. */

import {
	DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
	DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE,
	DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
	DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES,
	type DesktopDecodedAudioGeometry,
} from './desktop-audio-codec-operation-contract.ts';

export const DESKTOP_AUDIO_FFMPEG_WAVE_OVERHEAD_LIMIT_BYTES = 1024 * 1024;

export interface DesktopAudioFfmpegWaveOutput {
	readonly output: Uint8Array;
	readonly decodedGeometry: DesktopDecodedAudioGeometry;
}

export class DesktopAudioFfmpegWaveOutputError extends Error {
	readonly code = 'DESKTOP_AUDIO_FFMPEG_WAVE_OUTPUT_INVALID' as const;

	constructor(message: string) {
		super(message);
		this.name = 'DesktopAudioFfmpegWaveOutputError';
	}
}

interface WaveFormat {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly blockAlign: number;
}

interface WaveData {
	readonly offset: number;
	readonly byteLength: number;
}

const MAXIMUM_CHUNK_COUNT = 256;
const FLOAT_FORMAT = 3;
const EXTENSIBLE_FORMAT = 0xfffe;
const FLOAT_SUBFORMAT = Object.freeze([
	3, 0, 0, 0, 0, 0, 0x10, 0,
	0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71,
] as const);

export function parseDesktopAudioFfmpegWaveOutput(
	value: unknown,
	maximumPcmBytes: number,
): DesktopAudioFfmpegWaveOutput {
	const maximum = boundedInteger(
		maximumPcmBytes, 1, DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES, 'PCM output bound',
	);
	if (!(value instanceof Uint8Array) || value.byteLength < 44
		|| value.byteLength > maximum + DESKTOP_AUDIO_FFMPEG_WAVE_OVERHEAD_LIMIT_BYTES) {
		throw invalid('The decoded FFmpeg WAV is outside its byte bound.');
	}
	const input = value;
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	if (ascii(input, 0) !== 'RIFF' || ascii(input, 8) !== 'WAVE'
		|| view.getUint32(4, true) + 8 !== input.byteLength) {
		throw invalid('The decoded FFmpeg output is not one exact RIFF/WAVE file.');
	}
	let format: WaveFormat | null = null;
	let data: WaveData | null = null;
	let offset = 12;
	let chunkCount = 0;
	while (offset < input.byteLength) {
		if (input.byteLength - offset < 8 || ++chunkCount > MAXIMUM_CHUNK_COUNT) {
			throw invalid('The decoded FFmpeg WAV chunk table is invalid.');
		}
		const id = ascii(input, offset);
		const byteLength = view.getUint32(offset + 4, true);
		const dataOffset = offset + 8;
		const dataEnd = dataOffset + byteLength;
		const paddedEnd = dataEnd + (byteLength % 2);
		if (!Number.isSafeInteger(paddedEnd) || dataEnd > input.byteLength || paddedEnd > input.byteLength) {
			throw invalid('The decoded FFmpeg WAV chunk exceeds its RIFF boundary.');
		}
		if (id === 'fmt ') {
			if (format !== null) throw invalid('The decoded FFmpeg WAV repeats its format authority.');
			format = parseFormat(input, view, dataOffset, byteLength);
		} else if (id === 'data') {
			if (data !== null || byteLength < 1) {
				throw invalid('The decoded FFmpeg WAV has invalid PCM data authority.');
			}
			data = Object.freeze({ offset: dataOffset, byteLength });
		}
		offset = paddedEnd;
	}
	if (offset !== input.byteLength || format === null || data === null) {
		throw invalid('The decoded FFmpeg WAV is missing exact format or PCM data.');
	}
	if (input.byteLength - data.byteLength > DESKTOP_AUDIO_FFMPEG_WAVE_OVERHEAD_LIMIT_BYTES
		|| data.byteLength > maximum || data.byteLength % format.blockAlign !== 0) {
		throw invalid('The decoded FFmpeg WAV PCM exceeds its bound or contains incomplete frames.');
	}
	const frameCount = data.byteLength / format.blockAlign;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
		throw invalid('The decoded FFmpeg WAV frame count is invalid.');
	}
	return Object.freeze({
		output: input.slice(data.offset, data.offset + data.byteLength),
		decodedGeometry: Object.freeze({
			sampleRate: format.sampleRate, channelCount: format.channelCount, frameCount,
		}),
	});
}

function parseFormat(
	input: Uint8Array,
	view: DataView,
	offset: number,
	byteLength: number,
): WaveFormat {
	if (byteLength < 16 || byteLength > 64) {
		throw invalid('The decoded FFmpeg WAV format chunk is outside its bound.');
	}
	const formatTag = view.getUint16(offset, true);
	const channelCount = boundedInteger(
		view.getUint16(offset + 2, true), 1, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
		'channel count',
	);
	const sampleRate = boundedInteger(
		view.getUint32(offset + 4, true), DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
		DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE, 'sample rate',
	);
	const blockAlign = channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (view.getUint32(offset + 8, true) !== sampleRate * blockAlign
		|| view.getUint16(offset + 12, true) !== blockAlign
		|| view.getUint16(offset + 14, true) !== 32) {
		throw invalid('The decoded FFmpeg WAV does not describe interleaved float32 PCM.');
	}
	if (formatTag === FLOAT_FORMAT) {
		if (byteLength !== 16 && (byteLength !== 18 || view.getUint16(offset + 16, true) !== 0)) {
			throw invalid('The decoded FFmpeg float WAV extension is invalid.');
		}
	} else if (formatTag === EXTENSIBLE_FORMAT) {
		if (byteLength !== 40 || view.getUint16(offset + 16, true) !== 22
			|| view.getUint16(offset + 18, true) !== 32
			|| !FLOAT_SUBFORMAT.every((byte, index) => input[offset + 24 + index] === byte)) {
			throw invalid('The decoded FFmpeg extensible WAV subformat is not float32 PCM.');
		}
	} else throw invalid('The decoded FFmpeg WAV sample format is unsupported.');
	return Object.freeze({ sampleRate, channelCount, blockAlign });
}

function ascii(input: Uint8Array, offset: number): string {
	if (input.byteLength - offset < 4) return '';
	return String.fromCharCode(input[offset]!, input[offset + 1]!, input[offset + 2]!, input[offset + 3]!);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw invalid(`The decoded FFmpeg WAV ${label} is outside its bound.`);
	}
	return Number(value);
}

function invalid(message: string): DesktopAudioFfmpegWaveOutputError {
	return new DesktopAudioFfmpegWaveOutputError(message);
}
