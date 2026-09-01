/* SPDX-License-Identifier: AGPL-3.0-only */

/** Capability preflight and fixed, pathless FFmpeg argv for the desktop audio contract. */

import {
	assertDesktopAudioCodecRequest,
	getDesktopAudioFormatDescriptor,
	type DesktopAudioCodecFormat,
	type DesktopAudioEncodeRequest,
} from './desktop-audio-codec-operation-contract.ts';

export const DESKTOP_AUDIO_FFMPEG_INPUT_NAME = 'soundscaper-codec-input.media';
export const DESKTOP_AUDIO_FFMPEG_OUTPUT_BASENAME = 'soundscaper-codec-output';

export interface DesktopAudioFfmpegCapabilityTuple {
	readonly direction: 'decode' | 'encode';
	readonly demuxerAnyOf: readonly string[];
	readonly decoderAnyOf: readonly string[];
	readonly encoderAnyOf: readonly string[];
	readonly muxerAnyOf: readonly string[];
	readonly filterAllOf: readonly string[];
}

export interface DesktopAudioFfmpegCapabilitySets {
	readonly demuxers: readonly string[];
	readonly decoders: readonly string[];
	readonly encoders: readonly string[];
	readonly muxers: readonly string[];
	readonly filters: readonly string[];
}

export interface DesktopAudioFfmpegPlan {
	/** The main process reserves this basename inside a private per-operation directory. */
	readonly inputName: typeof DESKTOP_AUDIO_FFMPEG_INPUT_NAME;
	/** The main process derives this basename solely from the closed output format. */
	readonly outputName: string;
	/** Pass directly to spawn/execFile with shell disabled; never append renderer data. */
	readonly arguments: readonly string[];
}

interface DecodeFormatPlan {
	readonly demuxerAnyOf: readonly string[];
	readonly decoderAnyOf: readonly string[];
}

interface EncodeFormatPlan {
	readonly encoder: string;
	readonly muxer: string;
}

const DECODE_FORMATS: Readonly<Record<DesktopAudioCodecFormat, Readonly<DecodeFormatPlan>>> = Object.freeze({
	flac: decodeFormat(['flac'], ['flac']),
	mp3: decodeFormat(['mp3'], ['mp3float']),
	'ogg-vorbis': decodeFormat(['ogg'], ['vorbis']),
	opus: decodeFormat(['ogg'], ['opus']),
	wavpack: decodeFormat(['wv'], ['wavpack']),
	mp2: decodeFormat(['mp3'], ['mp2float']),
	'aac-m4a': decodeFormat(['mov', 'm4a', 'mp4'], ['aac']),
});

const ENCODE_FORMATS: Readonly<Record<DesktopAudioCodecFormat, Readonly<EncodeFormatPlan>>> = Object.freeze({
	flac: Object.freeze({ encoder: 'flac', muxer: 'flac' }),
	mp3: Object.freeze({ encoder: 'libmp3lame', muxer: 'mp3' }),
	'ogg-vorbis': Object.freeze({ encoder: 'libvorbis', muxer: 'ogg' }),
	opus: Object.freeze({ encoder: 'libopus', muxer: 'opus' }),
	wavpack: Object.freeze({ encoder: 'wavpack', muxer: 'wv' }),
	mp2: Object.freeze({ encoder: 'mp2', muxer: 'mp2' }),
	'aac-m4a': Object.freeze({ encoder: 'aac', muxer: 'ipod' }),
});

const BASE_ARGUMENTS = Object.freeze([
	'-nostdin', '-hide_banner', '-loglevel', 'error', '-nostats', '-xerror', '-y',
] as const);
const AUDIO_MAP_ARGUMENTS = Object.freeze([
	'-map', '0:a:0', '-map_metadata', '-1', '-map_chapters', '-1', '-vn', '-sn', '-dn',
] as const);
const PCM_DEMUXERS = Object.freeze(['f32le']);
const PCM_DECODERS = Object.freeze(['pcm_f32le']);
const PCM_ENCODERS = Object.freeze(['pcm_f32le']);
const PCM_WAVE_MUXERS = Object.freeze(['wav']);
const REQUIRED_ENCODE_FILTERS = Object.freeze(['aresample']);

export function deriveDesktopAudioFfmpegCapabilityTuple(
	request: unknown,
): Readonly<DesktopAudioFfmpegCapabilityTuple> {
	assertDesktopAudioCodecRequest(request);
	if (request.operation === 'audio-decode') {
		const format = DECODE_FORMATS[request.format];
		return Object.freeze({
			direction: 'decode', demuxerAnyOf: format.demuxerAnyOf,
			decoderAnyOf: format.decoderAnyOf, encoderAnyOf: PCM_ENCODERS,
			muxerAnyOf: PCM_WAVE_MUXERS, filterAllOf: Object.freeze([]),
		});
	}
	const format = ENCODE_FORMATS[request.format];
	return Object.freeze({
		direction: 'encode', demuxerAnyOf: PCM_DEMUXERS, decoderAnyOf: PCM_DECODERS,
		encoderAnyOf: Object.freeze([format.encoder]), muxerAnyOf: Object.freeze([format.muxer]),
		filterAllOf: REQUIRED_ENCODE_FILTERS,
	});
}

export function isDesktopAudioFfmpegCapabilityTupleSatisfied(
	tuple: DesktopAudioFfmpegCapabilityTuple,
	capabilities: DesktopAudioFfmpegCapabilitySets,
): boolean {
	const demuxers = new Set(capabilities.demuxers);
	const decoders = new Set(capabilities.decoders);
	const encoders = new Set(capabilities.encoders);
	const muxers = new Set(capabilities.muxers);
	const filters = new Set(capabilities.filters);
	return tuple.demuxerAnyOf.some((name) => demuxers.has(name))
		&& tuple.decoderAnyOf.some((name) => decoders.has(name))
		&& tuple.encoderAnyOf.some((name) => encoders.has(name))
		&& tuple.muxerAnyOf.some((name) => muxers.has(name))
		&& tuple.filterAllOf.every((name) => filters.has(name));
}

export function buildDesktopAudioFfmpegPlan(
	request: unknown,
): Readonly<DesktopAudioFfmpegPlan> {
	assertDesktopAudioCodecRequest(request);
	const outputExtension = request.operation === 'audio-decode'
		? '.wav'
		: getDesktopAudioFormatDescriptor(request.format).fileExtension;
	const outputName = `${DESKTOP_AUDIO_FFMPEG_OUTPUT_BASENAME}${outputExtension}`;
	const inputFormat = request.operation === 'audio-decode'
		? DECODE_FORMATS[request.format].demuxerAnyOf[0]
		: 'f32le';
	if (inputFormat === undefined) throw new TypeError('The desktop audio FFmpeg input format is unavailable.');
	const inputDecoder = request.operation === 'audio-decode'
		? DECODE_FORMATS[request.format].decoderAnyOf[0]
		: null;
	if (request.operation === 'audio-decode' && inputDecoder === undefined) {
		throw new TypeError('The desktop audio FFmpeg input decoder is unavailable.');
	}
	const outputFormat = request.operation === 'audio-decode'
		? 'wav'
		: ENCODE_FORMATS[request.format].muxer;
	const encoder = request.operation === 'audio-decode'
		? 'pcm_f32le'
		: ENCODE_FORMATS[request.format].encoder;
	const codecArguments = request.operation === 'audio-decode'
		? []
		: encodeSettingsArguments(request);
	const arguments_ = Object.freeze([
		...BASE_ARGUMENTS,
		'-protocol_whitelist', 'file',
		'-f', inputFormat,
		...(request.operation === 'audio-decode'
			? ['-c:a', inputDecoder!]
			: ['-ar', String(request.sampleRate), '-ac', String(request.channelCount)]),
		'-i', DESKTOP_AUDIO_FFMPEG_INPUT_NAME,
		...AUDIO_MAP_ARGUMENTS,
		...(request.operation === 'audio-encode'
			? ['-af', 'aresample', '-ar', String(request.sampleRate), '-ac', String(request.channelCount)]
			: []),
		'-c:a', encoder,
		...codecArguments,
		'-threads', '1',
		'-fs', String(request.maximumOutputBytes),
		'-f', outputFormat,
		outputName,
	]);
	return Object.freeze({
		inputName: DESKTOP_AUDIO_FFMPEG_INPUT_NAME, outputName, arguments: arguments_,
	});
}

function encodeSettingsArguments(request: DesktopAudioEncodeRequest): readonly string[] {
	switch (request.format) {
		case 'flac':
			return Object.freeze([
				'-sample_fmt', request.settings.bitDepth === 16 ? 's16' : 's32',
				...(request.settings.bitDepth === 24 ? ['-bits_per_raw_sample', '24'] : []),
				'-compression_level', String(request.settings.compressionLevel),
			]);
		case 'mp3':
			return Object.freeze(['-b:a', `${String(request.settings.bitrateKbps)}k`]);
		case 'ogg-vorbis':
			return Object.freeze(['-q:a', String(request.settings.quality)]);
		case 'opus':
			return Object.freeze([
				'-b:a', `${String(request.settings.bitrateKbps)}k`, '-vbr', 'on', '-application', 'audio',
			]);
		case 'wavpack':
			return Object.freeze(['-compression_level', String(request.settings.compressionLevel)]);
		case 'mp2':
		case 'aac-m4a':
			return Object.freeze(['-b:a', `${String(request.settings.bitrateKbps)}k`]);
		default:
			return assertNever(request);
	}
}

function decodeFormat(
	demuxerAnyOf: readonly string[], decoderAnyOf: readonly string[],
): Readonly<DecodeFormatPlan> {
	return Object.freeze({
		demuxerAnyOf: Object.freeze([...demuxerAnyOf]),
		decoderAnyOf: Object.freeze([...decoderAnyOf]),
	});
}

function assertNever(value: never): never {
	throw new TypeError(`Unsupported desktop audio FFmpeg request: ${String(value)}`);
}
