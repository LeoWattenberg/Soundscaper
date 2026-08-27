/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pure option projection shared by the browser and desktop export dialog. */

import {
	desktopExportBitRates,
	desktopExportFlacSampleFormats,
	desktopExportMaximumSampleRate,
	desktopExportSampleRates,
	desktopExportVorbisQualities,
	desktopExportWavPackCompressionLevels,
} from './desktop-export-codec-model.ts';
import { getMediaExportFormat } from '../media-export.js';

interface DialogOption {
	readonly value: string;
	readonly label: string;
}

const BROWSER_BIT_RATES: Readonly<Record<string, readonly number[]>> = Object.freeze({
	mp3: Object.freeze([128, 192, 256, 320]),
	opus: Object.freeze([64, 96, 128, 160, 192, 256]),
	mp2: Object.freeze([128, 160, 192, 224, 256, 320, 384]),
	'aac-m4a': Object.freeze([96, 128, 160, 192, 256, 320]),
});
const BROWSER_DEDICATED_FORMATS = new Set([
	'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2',
]);
const BROWSER_CODEC_FORMATS = new Set([...BROWSER_DEDICATED_FORMATS, 'aac-m4a']);
const BROWSER_STEREO_FORMATS = new Set(['mp3', 'ogg-vorbis', 'opus', 'mp2']);
const EMPTY_METADATA: Readonly<Record<string, unknown>> = Object.freeze({});
const COMMON_SAMPLE_RATES = Object.freeze([
	8_000, 16_000, 22_050, 32_000, 44_100, 48_000, 88_200, 96_000, 192_000, 384_000,
]);
const BROWSER_EXACT_SAMPLE_RATES: Readonly<Record<string, readonly number[]>> = Object.freeze({
	mp3: Object.freeze([32_000, 44_100, 48_000]),
	mp2: Object.freeze([32_000, 44_100, 48_000]),
	opus: Object.freeze([48_000]),
});
const BROWSER_MAXIMUM_SAMPLE_RATES: Readonly<Record<string, number>> = Object.freeze({
	flac: 192_000,
	'ogg-vorbis': 192_000,
	opus: 48_000,
	wavpack: 192_000,
	mp3: 48_000,
	mp2: 48_000,
	'aac-m4a': 96_000,
});

export function exportDialogBitRateOptions(
	format: unknown,
	desktop: boolean,
	sampleRate?: unknown,
	channelCount?: unknown,
): readonly DialogOption[] {
	let rates = desktop
		? desktopExportBitRates(format, sampleRate, channelCount)
		: BROWSER_BIT_RATES[String(format)] ?? [];
	if (!desktop && String(format) === 'mp2' && Number(channelCount) === 1) {
		rates = rates.filter((rate) => rate <= 192);
	}
	return Object.freeze(rates.map((rate) => Object.freeze({ value: String(rate), label: `${String(rate)} kbps` })));
}

export function exportDialogBitRateSelectionReason(
	format: unknown,
	bitRate: unknown,
	options: readonly DialogOption[],
	desktop: boolean,
): string | null {
	if (!desktop || !['mp3', 'opus', 'mp2', 'aac-m4a'].includes(String(format))
		|| options.some(({ value }) => value === String(bitRate))) return null;
	return 'The selected bitrate would be changed by this codec at the current sample rate and channel count.';
}

export function exportDialogVorbisQualityOptions(desktop: boolean): readonly DialogOption[] {
	const qualities = desktop ? desktopExportVorbisQualities() : Array.from({ length: 11 }, (_, index) => index);
	return Object.freeze(qualities.map((quality) => Object.freeze({
		value: String(quality), label: String(quality),
	})));
}

export function exportDialogMaximumAudioSampleRate(format: unknown, desktop: boolean): number {
	return desktop
		? desktopExportMaximumSampleRate(format)
		: BROWSER_MAXIMUM_SAMPLE_RATES[String(format)] ?? 384_000;
}

export function constrainExportDialogSampleRate(value: unknown, format: unknown, desktop: boolean): string {
	const maximum = exportDialogMaximumAudioSampleRate(format, desktop);
	const numeric = Number(value);
	const requested = Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 48_000;
	const bounded = Math.max(8_000, Math.min(requested, maximum));
	const exactRates = exactSampleRates(format, desktop);
	const candidates = exactRates.length > 0 ? exactRates : [bounded];
	return String(candidates.reduce((nearest, candidate) => (
		Math.abs(candidate - bounded) < Math.abs(nearest - bounded) ? candidate : nearest
	), candidates[0] ?? maximum));
}

export function exportDialogSampleRateSuggestions(
	maximumSampleRate: number,
	projectSampleRate: unknown,
	format?: unknown,
	desktop = false,
): readonly number[] {
	const exactRates = exactSampleRates(format, desktop);
	const candidates = exactRates.length > 0
		? [...exactRates]
		: [...COMMON_SAMPLE_RATES, Number(projectSampleRate)];
	return Object.freeze(candidates.filter((value, index) => (
		Number.isSafeInteger(value) && value > 0 && value <= maximumSampleRate
		&& candidates.indexOf(value) === index
	)));
}

export function exportDialogSampleFormats(format: unknown, desktop: boolean): readonly string[] {
	if (desktop && String(format) === 'flac') return desktopExportFlacSampleFormats();
	if (!desktop && String(format) === 'flac') return Object.freeze(['int24']);
	if (!desktop && String(format) === 'wavpack') return Object.freeze(['float32']);
	const descriptor = getMediaExportFormat(String(format)) as Readonly<{ sampleFormats?: readonly string[] }>;
	return Object.freeze([...(descriptor.sampleFormats ?? [])]);
}

export function exportDialogCompressionLevels(format: unknown, desktop: boolean): readonly number[] {
	if (String(format) === 'flac') return Object.freeze(Array.from({ length: 9 }, (_, level) => level));
	if (String(format) !== 'wavpack') return Object.freeze([]);
	return desktop ? desktopExportWavPackCompressionLevels() : Object.freeze([2]);
}

/** Project the dialog's current mapping to the number of channels it will emit. */
export function exportDialogOutputChannelCount(
	settings: Readonly<Record<string, unknown>>,
	inputChannelCount: unknown = 2,
): number | null {
	const requestedInputCount = Number(inputChannelCount);
	const inputCount = Number.isSafeInteger(requestedInputCount)
		&& requestedInputCount >= 1 && requestedInputCount <= 32 ? requestedInputCount : 2;
	if (settings.binaural === true) return 2;
	const mapping = settings.channelMapping;
	if (mapping == null || mapping === 'preserve') return inputCount;
	if (mapping === 'mono') return 1;
	if (mapping === 'stereo') return 2;
	let value = mapping;
	if (mapping === 'custom') {
		try { value = JSON.parse(String(settings.channelMatrix ?? '')); }
		catch { return null; }
	}
	const channels = Array.isArray(value)
		? value
		: value && typeof value === 'object'
			? (value as Readonly<{ channels?: unknown }>).channels
			: null;
	return Array.isArray(channels) && channels.length >= 1 && channels.length <= 32
		? channels.length
		: null;
}

/** Normalize stale browser preset/input values before they reach a codec request. */
export function normalizeExportDialogAudioSettings(
	settings: Readonly<Record<string, unknown>>,
	desktop: boolean,
	inputChannelCount: unknown = 2,
): Readonly<Record<string, unknown>> {
	if (desktop) return settings;
	const format = String(settings.format ?? '');
	if (!BROWSER_CODEC_FORMATS.has(format)) return settings;
	const patch: Record<string, unknown> = {};
	setChanged(patch, settings, 'sampleRate', constrainExportDialogSampleRate(settings.sampleRate, format, false));
	let projected = settings;
	if (settings.channelMapping && typeof settings.channelMapping === 'object') {
		try {
			const channelMatrix = JSON.stringify(settings.channelMapping);
			if (channelMatrix) {
				patch.channelMapping = 'custom';
				patch.channelMatrix = channelMatrix;
				projected = { ...settings, ...patch };
			}
		} catch { /* A malformed preset remains blocked by the request parser. */ }
	}
	const outputChannels = exportDialogOutputChannelCount(projected, inputChannelCount);
	if (BROWSER_STEREO_FORMATS.has(format) && (
		(outputChannels !== null && outputChannels > 2)
		|| (settings.mode === 'stems' && projected.channelMapping === 'preserve')
	)) patch.channelMapping = 'stereo';
	if (Object.hasOwn(BROWSER_BIT_RATES, format)) {
		const options = exportDialogBitRateOptions(
			format, false, patch.sampleRate ?? settings.sampleRate,
			exportDialogOutputChannelCount({ ...projected, ...patch }, inputChannelCount),
		);
		const fallback = Number((getMediaExportFormat(format) as Readonly<{
			defaults?: Readonly<{ bitRate?: unknown }>;
		}>).defaults?.bitRate ?? options[0]?.value);
		setChanged(patch, settings, 'bitRate', closestOption(settings.bitRate, options, fallback));
	}
	if (format === 'ogg-vorbis') {
		setChanged(patch, settings, 'quality', closestOption(
			settings.quality, exportDialogVorbisQualityOptions(false), 5,
		));
	}
	if (format === 'flac' || format === 'wavpack') {
		const levels = exportDialogCompressionLevels(format, false)
			.map((level) => Object.freeze({ value: String(level), label: String(level) }));
		setChanged(patch, settings, 'compressionLevel', closestOption(
			settings.compressionLevel, levels, format === 'flac' ? 5 : 2,
		));
	}
	return Object.keys(patch).length > 0 ? Object.freeze({ ...settings, ...patch }) : settings;
}

/** Dedicated browser payloads currently do not write tags; AAC may retain them. */
export function exportDialogMetadataAvailable(format: unknown, desktop: boolean): boolean {
	return desktop || !BROWSER_DEDICATED_FORMATS.has(String(format));
}

export function exportDialogMetadata(
	format: unknown,
	desktop: boolean,
	metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return exportDialogMetadataAvailable(format, desktop) ? metadata : EMPTY_METADATA;
}

function exactSampleRates(format: unknown, desktop: boolean): readonly number[] {
	return desktop
		? desktopExportSampleRates(format)
		: BROWSER_EXACT_SAMPLE_RATES[String(format)] ?? [];
}

function closestOption(
	value: unknown,
	options: readonly DialogOption[],
	fallback: number,
): string {
	const requested = Number(value);
	const target = Number.isFinite(requested) ? requested : fallback;
	return options.reduce((nearest, option) => (
		Math.abs(Number(option.value) - target) < Math.abs(Number(nearest.value) - target)
			? option
			: nearest
	), options[0] ?? Object.freeze({ value: String(fallback), label: String(fallback) })).value;
}

function setChanged(
	patch: Record<string, unknown>,
	settings: Readonly<Record<string, unknown>>,
	key: string,
	value: unknown,
): void {
	if (settings[key] !== value) patch[key] = value;
}
