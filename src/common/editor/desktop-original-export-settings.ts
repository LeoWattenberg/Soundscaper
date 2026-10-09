/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectEncodedAudioSampleRate } from './audio-file-metadata.js';
import { inspectAiffBlobPcm } from './aiff-pcm-chunk-reader.ts';
import { inspectWavBlobPcm } from './wav-import.js';
import { originalMpegExportSettings } from './desktop-original-mpeg-settings.ts';
import { readDesktopOriginalM4aMovie } from './desktop-original-m4a-movie.ts';
import { BIT_RATES } from './media-export-values.js';
import { sampleFrameToSeconds } from './timeline-time.ts';

type DataRecord = Readonly<Record<string, unknown>>;
export type DesktopOriginalExportSettings = Readonly<Record<string, unknown>>;

interface NamedByteSource {
	readonly name: string;
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): PromiseLike<ArrayBuffer> }>;
}

interface PcmSettings {
	readonly format?: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly sampleFormat: string;
	readonly bitDepth: number;
}

const MAXIMUM_HEADER_BYTES = 1024 * 1024;
const EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
	wav: 'wav', bwf: 'bwf', bw64: 'bw64', aif: 'aiff', aiff: 'aiff', aifc: 'aiff',
	flac: 'flac', mp3: 'mp3', mp2: 'mp2', ogg: 'ogg-vorbis', oga: 'ogg-vorbis',
	opus: 'opus', wv: 'wavpack', wavpack: 'wavpack', m4a: 'aac-m4a',
});

/** Remember facts from the imported bytes rather than the project's decoded float cache. */
export async function resolveDesktopOriginalExportSettings(
	fileValue: unknown,
	importedSources: readonly unknown[],
): Promise<DesktopOriginalExportSettings | null> {
	const file = byteSource(fileValue);
	if (!file) return null;
	const extension = file.name.toLowerCase().split('.').at(-1) ?? '';
	const sources = importedSources.filter(isRecord);
	const video = sources.find((source) => source.kind === 'video');
	if (video) return videoSettings(extension, video, sources);
	const source = sources.find((candidate) => candidate.kind === 'audio' || candidate.kind == null);
	let format = EXTENSIONS[extension];
	if (!source || !format) return null;
	try {
		const header = new Uint8Array(await file.slice(0, Math.min(file.size, MAXIMUM_HEADER_BYTES)).arrayBuffer());
		if (format === 'ogg-vorbis' && matchesEncodedContainer('opus', header)) format = 'opus';
		const pcm = await pcmSettings(format, file, header);
		if (pcm !== undefined) {
			if (!pcm || pcm.channelCount > 2) return null;
			return Object.freeze({ ...audioBase(pcm.format ?? format, pcm.sampleRate, pcm.channelCount),
				sampleFormat: pcm.sampleFormat, bitDepth: pcm.bitDepth });
		}
		if (!matchesEncodedContainer(format, header)) {
			const movie = format === 'aac-m4a' && ascii(header, 4, 4) === 'ftyp'
				? await readDesktopOriginalM4aMovie(file, MAXIMUM_HEADER_BYTES) : null;
			if (!movie || !hasAacSampleEntry(movie)) return null;
		}
		const sampleRate = positiveInteger(source.originalSampleRate) ?? positiveInteger(source.sampleRate)
			?? inspectEncodedAudioSampleRate(header);
		const channels = positiveInteger(source.channelCount);
		if (!sampleRate || !channels || channels > 2) return null;
		const settings: Record<string, unknown> = { ...audioBase(format, sampleRate, channels) };
		if (format === 'flac') {
			const bits = flacBitDepth(header);
			if (bits !== 16 && bits !== 24) return null;
			settings.bitDepth = bits;
			settings.sampleFormat = `int${String(bits)}`;
		} else if (format === 'wavpack') {
			if (header.length < 32) return null;
			const flags = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(24, true);
			if (flags & 0x80000008) return null; // DSD and hybrid encoding have no matching export mode.
			const bits = ((flags & 3) + 1) * 8 - (flags >>> 13 & 0x1f);
			if (![16, 24, 32].includes(bits)) return null;
			settings.bitDepth = bits;
			settings.sampleFormat = flags & 0x80 ? 'float32' : `int${String(bits)}`;
		} else if (format === 'mp3' || format === 'mp2') {
			const mpeg = originalMpegExportSettings(header, format, sourceBitRate(file, source, sampleRate));
			if (!mpeg || !BIT_RATES[format].includes(Number(mpeg.bitRate))
				|| (mpeg.averageBitRate !== undefined && !BIT_RATES.mp3.includes(Number(mpeg.averageBitRate)))) return null;
			Object.assign(settings, mpeg);
		} else if (format === 'opus' || format === 'aac-m4a') {
			const bitRate = sourceBitRate(file, source, sampleRate);
			if (bitRate) settings.bitRate = BIT_RATES[format].reduce((closest, rate) => (
				Math.abs(rate - bitRate) < Math.abs(closest - bitRate) ? rate : closest
			));
		}
		return Object.freeze(settings);
	} catch {
		// The import has already succeeded; an unprovable re-export disables the shortcut.
		return null;
	}
}

function audioBase(format: string, sampleRate: number, channelCount: number): DataRecord {
	return { format, mode: 'mix', range: 'project', sampleRate,
		channelMapping: channelCount === 1 ? 'mono' : channelCount === 2 ? 'stereo' : 'preserve', includeTail: false };
}

async function pcmSettings(format: string, file: NamedByteSource, header: Uint8Array): Promise<PcmSettings | null | undefined> {
	if (format === 'wav' || format === 'bwf' || format === 'bw64') {
		if (!['RIFF', 'RIFX', 'RF64', 'BW64'].includes(ascii(header, 0, 4)) || ascii(header, 8, 4) !== 'WAVE') return null;
		const descriptor = await inspectWavBlobPcm(file);
		if (!descriptor) return null;
		const bitDepth = descriptor.validBitsPerSample ?? descriptor.bitDepth;
		const sampleFormat = descriptor.sampleFormat === 'float32' ? 'float32' : `int${String(bitDepth)}`;
		if (!['int16', 'int20', 'int24', 'float32'].includes(sampleFormat)) return null;
		const deliveryFormat = format === 'wav' && (descriptor.bext || descriptor.cart) ? 'bwf' : format;
		if (deliveryFormat !== 'wav' && sampleFormat === 'float32') return null;
		return { ...descriptor, sampleFormat, bitDepth, format: deliveryFormat };
	}
	if (format === 'aiff') {
		if (ascii(header, 0, 4) !== 'FORM') return null;
		return inspectAiffBlobPcm(file);
	}
	return undefined;
}

function videoSettings(extension: string, video: DataRecord, sources: readonly DataRecord[]): DesktopOriginalExportSettings | null {
	const format = extension === 'mp4' ? 'video-mp4' : extension === 'webm' ? 'video-webm' : null;
	if (!format || video.videoCodec !== (format === 'video-mp4' ? 'h264' : 'vp9')) return null;
	if (isRecord(video.timingDecision) && video.timingDecision.mode === 'conform-cfr-at-ingest') return null;
	if (video.audioCodec && video.audioCodec !== (format === 'video-mp4' ? 'aac' : 'opus')) return null;
	const width = positiveInteger(video.width);
	const height = positiveInteger(video.height);
	const rate = isRecord(video.frameRate) ? video.frameRate : null;
	if (!width || !height || width % 2 || height % 2 || !rate
		|| !positiveInteger(rate.num) || !positiveInteger(rate.den)) return null;
	const audio = sources.find((source) => source.kind === 'audio');
	const reportedAudio = isRecord(video.characteristics) && Array.isArray(video.characteristics.audioStreams)
		&& video.characteristics.audioStreams.length > 0;
	if (!audio && (video.hasAudio === true || reportedAudio)) return null;
	if (positiveInteger(audio?.channelCount) && Number(audio?.channelCount) > 2) return null;
	return Object.freeze({ format, range: 'project',
		canvas: Object.freeze({ size: Object.freeze({ width, height }),
			frameRate: Object.freeze({ num: rate.num, den: rate.den }), fit: 'contain' }),
		...(audio ? { audioLayout: audio.channelCount === 1 ? 'mono' : audio.channelCount === 2 ? 'stereo' : 'preserve' } : {}) });
}

function matchesEncodedContainer(format: string, bytes: Uint8Array): boolean {
	if (format === 'flac') return flacOffset(bytes) !== null;
	if (format === 'wavpack') return ascii(bytes, 0, 4) === 'wvpk';
	if (format === 'aac-m4a') return ascii(bytes, 4, 4) === 'ftyp' && hasAacSampleEntry(bytes);
	if (format === 'opus' || format === 'ogg-vorbis') {
		if (ascii(bytes, 0, 4) !== 'OggS' || bytes.byteLength < 28) return false;
		const offset = 27 + bytes[26]!;
		return format === 'opus' ? ascii(bytes, offset, 8) === 'OpusHead'
			: bytes[offset] === 1 && ascii(bytes, offset + 1, 6) === 'vorbis';
	}
	if (format === 'mp3' || format === 'mp2') {
		const offset = id3Offset(bytes);
		if (offset === null || offset + 4 > bytes.byteLength || bytes[offset] !== 0xff
			|| (bytes[offset + 1]! & 0xe0) !== 0xe0) return false;
		const layer = (bytes[offset + 1]! >>> 1) & 3;
		return layer === (format === 'mp3' ? 1 : 2) && inspectEncodedAudioSampleRate(bytes) !== null;
	}
	return false;
}

function hasAacSampleEntry(bytes: Uint8Array): boolean {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let remainingWork = MAXIMUM_HEADER_BYTES;
	// A sample entry proves its codec; an ftyp brand alone also names ALAC files.
	// Apparent sample entries may overlap, so bound work as well as input bytes.
	for (let offset = 4; offset + 32 <= bytes.length; offset += 1) {
		if (remainingWork-- <= 0) return false;
		if (ascii(bytes, offset, 4) !== 'mp4a') continue;
		const size = view.getUint32(offset - 4, false);
		if (size < 36 || size > bytes.length - offset + 4) continue;
		const end = offset - 4 + size;
		for (let cursor = offset + 28; cursor + 13 <= end; cursor += 1) {
			if (remainingWork-- <= 0) return false;
			if (ascii(bytes, cursor, 4) !== 'esds') continue;
			// DecoderConfigDescriptor (04) carries the MPEG-4 audio object type 40.
			for (let descriptor = cursor + 8; descriptor + 2 < end; descriptor += 1) {
				if (remainingWork-- <= 0) return false;
				if (bytes[descriptor] !== 4) continue;
				let payload = descriptor + 1;
				for (let lengthByte = 0; lengthByte < 4 && payload < end; lengthByte += 1) {
					if ((bytes[payload++]! & 0x80) === 0) return bytes[payload] === 0x40;
				}
			}
		}
	}
	return false;
}

function sourceBitRate(file: NamedByteSource, source: DataRecord, sampleRate: number): number | null {
	const frames = positiveInteger(source.frameCount);
	if (!frames) return null;
	const durationSeconds = sampleFrameToSeconds(frames, positiveInteger(source.sampleRate) ?? sampleRate);
	const kilobits = Math.round(file.size * 8 / durationSeconds / 1000);
	return kilobits > 0 ? kilobits : null;
}

function flacOffset(bytes: Uint8Array): number | null {
	const offset = id3Offset(bytes);
	return offset !== null && ascii(bytes, offset, 4) === 'fLaC' && bytes.byteLength >= offset + 42
		&& (bytes[offset + 4]! & 0x7f) === 0 ? offset : null;
}

function flacBitDepth(bytes: Uint8Array): number | null {
	const offset = flacOffset(bytes);
	if (offset === null) return null;
	return ((bytes[offset + 20]! & 1) << 4 | bytes[offset + 21]! >>> 4) + 1;
}

function id3Offset(bytes: Uint8Array): number | null {
	if (ascii(bytes, 0, 3) !== 'ID3') return 0;
	if (bytes.byteLength < 10) return null;
	let size = 0;
	for (let index = 6; index < 10; index += 1) {
		const byte = bytes[index]!;
		if (byte & 0x80) return null;
		size = size * 128 + byte;
	}
	return 10 + size + (bytes[5]! & 0x10 ? 10 : 0);
}

function ascii(bytes: Uint8Array, offset: number, count: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + count));
}

function positiveInteger(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is DataRecord {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function byteSource(value: unknown): NamedByteSource | null {
	if (!isRecord(value) || typeof value.name !== 'string' || !positiveInteger(value.size)
		|| typeof value.slice !== 'function') return null;
	return value as unknown as NamedByteSource;
}
