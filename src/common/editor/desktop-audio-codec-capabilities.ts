/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-side presentation of sanitized, exact main-process codec status. */

import {
	DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION,
	normalizeDesktopAudioCodecCapabilityQuery,
	normalizeDesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityEntry,
	type DesktopAudioCodecCapabilityProvider,
	type DesktopAudioCodecCapabilityQuery,
	type DesktopAudioCodecCapabilityReason,
	type DesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityTuple,
} from '../../../desktop/desktop-audio-codec-capability-contract.ts';
import {
	DESKTOP_AUDIO_CODEC_FORMATS,
	OPUS_VBR_MODE_ON,
	desktopAudioCodecEncodeBitRates,
	type DesktopAudioCodecFormat,
} from '../../../desktop/desktop-audio-codec-operation-contract.ts';
import { createMediaExportCapabilities } from './media-export.js';

export const DESKTOP_AUDIO_CODEC_PREFERENCES_REASON =
	'Configure FFmpeg in Edit > Preferences > General to enable this desktop format.';

export interface DesktopAudioCodecFormatCapability {
	readonly available: boolean;
	readonly provider: DesktopAudioCodecCapabilityProvider | null;
	readonly reason: string | null;
	readonly missingEncoders: readonly string[];
	readonly missingMuxers: readonly string[];
}

export interface DesktopAudioCodecCapabilities {
	readonly profileId: string;
	readonly ffmpegAvailable: boolean;
	readonly encoders: readonly string[];
	readonly muxers: readonly string[];
	readonly formats: Readonly<Record<string, DesktopAudioCodecFormatCapability>>;
}

export interface DesktopAudioCodecCapabilityQueryOptions {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly operations?: readonly ('audio-decode' | 'audio-encode')[];
	readonly encodeSettings?: Readonly<Partial<Record<DesktopAudioCodecFormat, unknown>>>;
}

export type DesktopAudioCodecCapabilityQueryPort = (
	query: DesktopAudioCodecCapabilityQuery,
) => unknown | Promise<unknown>;

const COMPRESSED_FORMATS = new Set<string>(DESKTOP_AUDIO_CODEC_FORMATS);
const EMPTY = Object.freeze([]) as readonly string[];

export function createDesktopAudioCodecCapabilityQuery(
	options: DesktopAudioCodecCapabilityQueryOptions,
): DesktopAudioCodecCapabilityQuery {
	const operations = options.operations ?? ['audio-encode', 'audio-decode'];
	return normalizeDesktopAudioCodecCapabilityQuery({
		schemaVersion: DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION,
		operations: DESKTOP_AUDIO_CODEC_FORMATS.flatMap((format) => operations.map((operation) => ({
			operation, format, sampleRate: options.sampleRate, channelCount: options.channelCount,
			settings: operation === 'audio-decode'
				? { sampleFormat: 'f32le' }
				: options.encodeSettings?.[format]
					?? defaultEncodeSettings(format, options.sampleRate, options.channelCount),
		}))),
	});
}

export function createDesktopAudioCodecSingleCapabilityQuery(
	tuple: DesktopAudioCodecCapabilityTuple,
): DesktopAudioCodecCapabilityQuery {
	return normalizeDesktopAudioCodecCapabilityQuery({
		schemaVersion: DESKTOP_AUDIO_CODEC_CAPABILITY_SCHEMA_VERSION, operations: [tuple],
	});
}

export async function queryDesktopAudioCodecCapability(
	port: DesktopAudioCodecCapabilityQueryPort,
	tuple: DesktopAudioCodecCapabilityTuple,
): Promise<DesktopAudioCodecCapabilityEntry> {
	if (typeof port !== 'function') throw new TypeError('The desktop audio codec capability port is unavailable.');
	const query = createDesktopAudioCodecSingleCapabilityQuery(tuple);
	const result = normalizeDesktopAudioCodecCapabilityResult(await port(query), query);
	return result.capabilities[0]!;
}

export function desktopAudioCodecMediaExportCapabilities(
	resultValue: DesktopAudioCodecCapabilityResult | null,
	queryValue: DesktopAudioCodecCapabilityQuery,
): DesktopAudioCodecCapabilities {
	const query = normalizeDesktopAudioCodecCapabilityQuery(queryValue);
	const result = resultValue === null
		? null
		: normalizeDesktopAudioCodecCapabilityResult(resultValue, query);
	const base = createMediaExportCapabilities({
		ffmpegAvailable: false,
		profile: Object.freeze({ id: 'desktop-main-audio-codecs', encoders: EMPTY, muxers: EMPTY }),
	}) as unknown as DesktopAudioCodecCapabilities;
	const formats: Record<string, DesktopAudioCodecFormatCapability> = {};
	for (const [format, capability] of Object.entries(base.formats)) {
		if (COMPRESSED_FORMATS.has(format)) {
			const entry = result?.capabilities.find((candidate) => (
				candidate.operation === 'audio-encode' && candidate.format === format
			));
			formats[format] = Object.freeze({
				available: entry?.available === true,
				provider: entry?.available === true ? entry.provider : null,
				reason: entry?.available === true ? null : desktopAudioCodecCapabilityReason(entry?.reason ?? null),
				missingEncoders: EMPTY,
				missingMuxers: EMPTY,
			});
		} else if (format === 'custom-ffmpeg') {
			formats[format] = Object.freeze({
				available: false,
				provider: null,
				reason: 'Custom FFmpeg arguments are not admitted by the desktop codec broker.',
				missingEncoders: EMPTY,
				missingMuxers: EMPTY,
			});
		} else formats[format] = Object.freeze({ ...capability, provider: null });
	}
	return Object.freeze({
		profileId: 'desktop-main-audio-codecs',
		ffmpegAvailable: result?.capabilities.some((entry) => (
			entry.available && entry.provider === 'external-ffmpeg'
		)) ?? false,
		encoders: EMPTY,
		muxers: EMPTY,
		formats: Object.freeze(formats),
	});
}

export function desktopAudioCodecCapabilityReason(
	reason: DesktopAudioCodecCapabilityReason | null,
): string {
	if (reason === 'unsupported-settings') {
		return 'The selected sample rate or channel layout is unsupported. Configure FFmpeg in Edit > Preferences > General or choose other export settings.';
	}
	if (reason === 'unsupported-by-configured-ffmpeg') {
		return 'The configured FFmpeg does not support this exact operation. Choose another FFmpeg build in Edit > Preferences > General.';
	}
	return DESKTOP_AUDIO_CODEC_PREFERENCES_REASON;
}

function defaultEncodeSettings(
	format: DesktopAudioCodecFormat,
	sampleRate: number,
	channelCount: number,
): Readonly<Record<string, number>> {
	if (format === 'flac') return Object.freeze({ compressionLevel: 5, bitDepth: 24 });
	if (format === 'wavpack') return Object.freeze({ compressionLevel: 2 });
	if (format === 'ogg-vorbis') return Object.freeze({ quality: 5 });
	/* Opus states Audacity's default VBR Mode alongside its bitrate. */
	if (format === 'opus') return Object.freeze({ bitrateKbps: 160, vbrMode: OPUS_VBR_MODE_ON });
	if (format === 'mp2') return Object.freeze({ bitrateKbps: 256 });
	return Object.freeze({
		bitrateKbps: desktopAudioCodecEncodeBitRates(format, sampleRate, channelCount)[0]
			?? desktopAudioCodecEncodeBitRates(format)[0] ?? 32,
	});
}
