/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pure option projection shared by the browser and desktop export dialog. */

import {
	desktopExportBitRates,
	desktopExportMaximumSampleRate,
	desktopExportSampleRates,
	desktopExportVorbisQualities,
} from './desktop-export-codec-model.ts';

interface DialogOption {
	readonly value: string;
	readonly label: string;
}

const BROWSER_BIT_RATES: Readonly<Record<string, readonly number[]>> = Object.freeze({
	mp3: Object.freeze([128, 192, 256, 320]),
	opus: Object.freeze([64, 96, 128, 160, 192, 256, 320]),
	mp2: Object.freeze([128, 160, 192, 224, 256, 320, 384]),
	'aac-m4a': Object.freeze([96, 128, 160, 192, 256, 320]),
});
const COMMON_SAMPLE_RATES = Object.freeze([
	8_000, 16_000, 22_050, 32_000, 44_100, 48_000, 88_200, 96_000, 192_000, 384_000,
]);

export function exportDialogBitRateOptions(
	format: unknown,
	desktop: boolean,
	sampleRate?: unknown,
	channelCount?: unknown,
): readonly DialogOption[] {
	const rates = desktop
		? desktopExportBitRates(format, sampleRate, channelCount)
		: BROWSER_BIT_RATES[String(format)] ?? [];
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
	const qualities = desktop ? desktopExportVorbisQualities() : Array.from({ length: 12 }, (_, index) => index - 1);
	return Object.freeze(qualities.map((quality) => Object.freeze({
		value: String(quality), label: String(quality),
	})));
}

export function exportDialogMaximumAudioSampleRate(format: unknown, desktop: boolean): number {
	return desktop ? desktopExportMaximumSampleRate(format) : 384_000;
}

export function constrainExportDialogSampleRate(value: unknown, format: unknown, desktop: boolean): string {
	const requested = Number(value) || 48_000;
	if (!desktop) return String(Math.min(requested, exportDialogMaximumAudioSampleRate(format, false)));
	const maximum = exportDialogMaximumAudioSampleRate(format, true);
	const exactRates = desktopExportSampleRates(format);
	const candidates = exactRates.length > 0 ? exactRates : [Math.min(requested, maximum)];
	return String(candidates.reduce((nearest, candidate) => (
		Math.abs(candidate - requested) < Math.abs(nearest - requested) ? candidate : nearest
	), candidates[0] ?? maximum));
}

export function exportDialogSampleRateSuggestions(
	maximumSampleRate: number,
	projectSampleRate: unknown,
	format?: unknown,
	desktop = false,
): readonly number[] {
	const exactDesktopRates = desktop ? desktopExportSampleRates(format) : [];
	const candidates = exactDesktopRates.length > 0
		? [...exactDesktopRates]
		: [...COMMON_SAMPLE_RATES, Number(projectSampleRate)];
	return Object.freeze(candidates.filter((value, index) => (
		Number.isSafeInteger(value) && value > 0 && value <= maximumSampleRate
		&& candidates.indexOf(value) === index
	)));
}
