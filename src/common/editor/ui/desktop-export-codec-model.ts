/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pure desktop export-dialog model for exact main-process codec status. */

import type {
	DesktopAudioCodecCapabilityQuery,
	DesktopAudioCodecCapabilityResult,
} from '../../../../desktop/desktop-audio-codec-capability-contract.ts';
import {
	DESKTOP_AUDIO_CODEC_FORMATS,
	desktopAudioCodecEncodeBitRates,
	desktopAudioCodecEncodeSampleRates,
	type DesktopAudioCodecFormat,
} from '../../../../desktop/desktop-audio-codec-operation-contract.ts';
import { mp3CodecRateSettings } from '../media-export.js';
import {
	createDesktopAudioCodecCapabilityQuery,
	desktopAudioCodecCapabilityReason,
	desktopAudioCodecMediaExportCapabilities,
	type DesktopAudioCodecCapabilities,
} from '../desktop-audio-codec-capabilities.ts';

interface DesktopExportCodecSettings {
	readonly format?: unknown;
	readonly sampleRate?: unknown;
	readonly channelMapping?: unknown;
	readonly channelMatrix?: unknown;
	readonly binaural?: unknown;
	readonly sampleFormat?: unknown;
	readonly compressionLevel?: unknown;
	readonly quality?: unknown;
	readonly bitRate?: unknown;
}

interface DesktopExportCodecSelection {
	readonly format?: unknown;
}

const COMPRESSED = new Set<string>(DESKTOP_AUDIO_CODEC_FORMATS);
const WAVPACK_COMPRESSION_LEVELS = Object.freeze([0, 1, 2, 3, 4, 5] as const);
const FLAC_SAMPLE_FORMATS = Object.freeze(['int16', 'int24'] as const);
const VORBIS_QUALITIES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

export function createDesktopExportCodecQuery(
	settings: DesktopExportCodecSettings,
	projectChannelCount: unknown,
): DesktopAudioCodecCapabilityQuery {
	return createDesktopAudioCodecCapabilityQuery({
		sampleRate: integer(settings.sampleRate, 8_000, 192_000, 'sample rate'),
		channelCount: outputChannelCount(settings, projectChannelCount),
		operations: ['audio-encode'],
		encodeSettings: selectedEncodeSettings(settings),
	});
}

export function desktopExportCodecCapabilities(
	result: DesktopAudioCodecCapabilityResult | null,
	query: DesktopAudioCodecCapabilityQuery,
): DesktopAudioCodecCapabilities {
	return desktopAudioCodecMediaExportCapabilities(result, query);
}

export function desktopExportFormatAvailable(
	format: unknown,
	capabilities: DesktopAudioCodecCapabilities | null,
): boolean {
	const canonical = String(format);
	if (canonical === 'custom-ffmpeg') return false;
	if (!COMPRESSED.has(canonical)) return true;
	return capabilities?.formats[canonical]?.available === true;
}

export function desktopExportFormatReason(
	format: unknown,
	capabilities: DesktopAudioCodecCapabilities | null,
	invalidSettings = false,
): string | null {
	const canonical = String(format);
	if (canonical === 'custom-ffmpeg') {
		return 'Custom FFmpeg arguments are not available in the desktop codec broker.';
	}
	if (!COMPRESSED.has(canonical)) return null;
	if (invalidSettings) return desktopAudioCodecCapabilityReason('unsupported-settings');
	return capabilities?.formats[canonical]?.reason
		?? desktopAudioCodecCapabilityReason('configure-external-ffmpeg');
}

export function desktopExportWavPackCompressionLevels(
): readonly number[] {
	return WAVPACK_COMPRESSION_LEVELS;
}

export function desktopExportFlacSampleFormats(
): readonly ('int16' | 'int24')[] {
	return FLAC_SAMPLE_FORMATS;
}

/** Choices admitted by the strict desktop main-process operation contract. */
export function desktopExportBitRates(
	format: unknown,
	sampleRate?: unknown,
	channelCount?: unknown,
): readonly number[] {
	const canonical = String(format);
	if (!['mp3', 'opus', 'mp2', 'aac-m4a'].includes(canonical)) return Object.freeze([]);
	return desktopAudioCodecEncodeBitRates(
		canonical as DesktopAudioCodecFormat,
		sampleRate === undefined ? undefined : Number(sampleRate),
		channelCount === undefined ? undefined : Number(channelCount),
	);
}

export function desktopExportVorbisQualities(): readonly number[] {
	return VORBIS_QUALITIES;
}

export function desktopExportMaximumSampleRate(format: unknown): number {
	const canonical = String(format);
	if (!COMPRESSED.has(canonical)) return 384_000;
	return Math.max(...desktopAudioCodecEncodeSampleRates(canonical as DesktopAudioCodecFormat));
}

export function desktopExportSampleRates(format: unknown): readonly number[] {
	const canonical = String(format);
	return COMPRESSED.has(canonical)
		? desktopAudioCodecEncodeSampleRates(canonical as DesktopAudioCodecFormat)
		: Object.freeze([]);
}

export function desktopExportSelectionReason(
	settings: DesktopExportCodecSelection,
	capabilities: DesktopAudioCodecCapabilities | null,
	invalidQuery = false,
): string | null {
	if (!desktopExportFormatAvailable(settings.format, capabilities)) {
		return desktopExportFormatReason(settings.format, capabilities, invalidQuery);
	}
	return null;
}

function selectedEncodeSettings(
	settings: DesktopExportCodecSettings,
): Readonly<Partial<Record<DesktopAudioCodecFormat, unknown>>> {
	const format = String(settings.format ?? '');
	if (!COMPRESSED.has(format)) return Object.freeze({});
	let value: Readonly<Record<string, unknown>>;
	if (format === 'flac') value = Object.freeze({
		compressionLevel: Number(settings.compressionLevel),
		bitDepth: settings.sampleFormat === 'int16' ? 16 : settings.sampleFormat === 'int24' ? 24 : null,
	});
	else if (format === 'wavpack') value = Object.freeze({
		compressionLevel: Number(settings.compressionLevel),
	});
	else if (format === 'ogg-vorbis') value = Object.freeze({ quality: Number(settings.quality) });
	else if (format === 'mp3') value = mp3CodecRateSettings(settings);
	else value = Object.freeze({ bitrateKbps: Number(settings.bitRate) });
	return Object.freeze({ [format]: value });
}

function outputChannelCount(settings: DesktopExportCodecSettings, projectChannelCount: unknown): number {
	if (settings.binaural === true) return 2;
	if (settings.channelMapping === 'mono') return 1;
	if (settings.channelMapping === 'stereo') return 2;
	if (settings.channelMapping === 'preserve' || settings.channelMapping == null) {
		return integer(projectChannelCount ?? 2, 1, 8, 'channel count');
	}
	if (settings.channelMapping !== 'custom') throw new TypeError('The desktop export channel mapping is unsupported.');
	let parsed: unknown;
	try { parsed = JSON.parse(String(settings.channelMatrix ?? '')); }
	catch { throw new TypeError('The desktop export custom channel mapping is invalid.'); }
	const channels = Array.isArray(parsed) ? parsed
		: parsed && typeof parsed === 'object' ? (parsed as { readonly channels?: unknown }).channels : null;
	if (!Array.isArray(channels)) throw new TypeError('The desktop export custom channel mapping is invalid.');
	return integer(channels.length, 1, 8, 'channel count');
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`The desktop export ${label} is unsupported.`);
	}
	return number;
}
