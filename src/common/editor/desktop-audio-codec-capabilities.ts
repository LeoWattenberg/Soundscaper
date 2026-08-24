/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-side presentation of sanitized, exact main-process codec status. */

import {
	normalizeDesktopAudioCodecCapabilityQuery,
	normalizeDesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityEntry,
	type DesktopAudioCodecCapabilityQuery,
	type DesktopAudioCodecCapabilityReason,
	type DesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityTuple,
} from '../../../desktop/desktop-audio-codec-capability-contract.ts';
import { DESKTOP_AUDIO_CODEC_FORMATS } from '../../../desktop/desktop-audio-codec-operation-contract.ts';
import { createMediaExportCapabilities } from './media-export.js';

export const DESKTOP_AUDIO_CODEC_PREFERENCES_REASON =
	'Configure FFmpeg in Edit > Preferences > General to enable this desktop format.';

export interface DesktopAudioCodecFormatCapability {
	readonly available: boolean;
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
		schemaVersion: 1,
		operations: DESKTOP_AUDIO_CODEC_FORMATS.flatMap((format) => operations.map((operation) => ({
			operation, format, sampleRate: options.sampleRate, channelCount: options.channelCount,
		}))),
	});
}

export function createDesktopAudioCodecSingleCapabilityQuery(
	tuple: DesktopAudioCodecCapabilityTuple,
): DesktopAudioCodecCapabilityQuery {
	return normalizeDesktopAudioCodecCapabilityQuery({ schemaVersion: 1, operations: [tuple] });
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
				reason: entry?.available === true ? null : desktopAudioCodecCapabilityReason(entry?.reason ?? null),
				missingEncoders: EMPTY,
				missingMuxers: EMPTY,
			});
		} else if (format === 'custom-ffmpeg') {
			formats[format] = Object.freeze({
				available: false,
				reason: 'Custom FFmpeg arguments are not admitted by the desktop codec broker.',
				missingEncoders: EMPTY,
				missingMuxers: EMPTY,
			});
		} else formats[format] = capability;
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
