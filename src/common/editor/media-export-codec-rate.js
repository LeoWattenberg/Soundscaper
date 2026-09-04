/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How MP3 and Opus spend their bits, as Audacity offers it.
 *
 * These two formats carry more per-format detail than the shared registry
 * holds for anything else: MP3 has four strategies and a named table of
 * presets and qualities behind them, and Opus has its own VBR mode. They live
 * here so the registry stays a registry, and so every encoder — the bundled
 * payloads, the desktop provider and FFmpeg — reads one strategy from one
 * place.
 */

import { BIT_RATES, allowedNumber, integerInRange } from './media-export-values.js';

/** Audacity's four MP3 bit-rate strategies, in its own option order. */
export const MP3_BIT_RATE_MODES = Object.freeze(['preset', 'variable', 'average', 'constant']);
/** Audacity's named presets, from Excessive through Medium. */
export const MP3_PRESETS = Object.freeze(['excessive', 'extreme', 'standard', 'medium']);
export const MP3_MAXIMUM_VBR_QUALITY = 9;
/** Audacity's Opus VBR Mode: Off, On and Constrained, in its own option order. */
export const OPUS_VBR_MODES = Object.freeze(['off', 'on', 'constrained']);

/**
 * Project normalized Opus settings onto the codec request. The payload takes the
 * VBR mode as its index in Audacity's own option order.
 * @returns {Readonly<Record<string, number>>}
 */
export function opusCodecRateSettings(settings) {
	const mode = OPUS_VBR_MODES.indexOf(String(settings.vbrMode ?? 'on'));
	return Object.freeze({
		bitrateKbps: Number(settings.bitRate),
		vbrMode: mode < 0 ? OPUS_VBR_MODES.indexOf('on') : mode,
	});
}

/**
 * Project normalized MP3 settings onto the single strategy key that a codec
 * request carries. Every encoder — the bundled LAME payload, the desktop
 * provider and FFmpeg — names its strategy this way.
 * @returns {Readonly<Record<string, number>>}
 */
export function mp3CodecRateSettings(settings) {
	const mode = String(settings.bitRateMode ?? 'constant');
	if (mode === 'preset') return Object.freeze({ preset: Number(settings.bitRatePreset) });
	if (mode === 'variable') return Object.freeze({ vbrQuality: Number(settings.vbrQuality) });
	if (mode === 'average') return Object.freeze({ averageBitrateKbps: Number(settings.averageBitRate) });
	return Object.freeze({ bitrateKbps: Number(settings.bitRate) });
}

/**
 * MP3 carries Audacity's four bit-rate strategies. Every strategy keeps its own
 * value so that switching modes restores what that mode last used, exactly as
 * Audacity's export options do.
 */
export function normalizeMp3RateSettings(settings, descriptor, options) {
	const mode = String(options.bitRateMode ?? inferredMp3BitRateMode(options, descriptor));
	if (!MP3_BIT_RATE_MODES.includes(mode)) {
		throw new RangeError(`MP3 bit rate mode ${mode} is unsupported.`);
	}
	settings.bitRateMode = mode;
	settings.bitRatePreset = integerInRange(
		options.bitRatePreset ?? descriptor.defaults.bitRatePreset, 0, MP3_PRESETS.length - 1,
		'MP3 preset',
	);
	settings.vbrQuality = integerInRange(
		options.vbrQuality ?? descriptor.defaults.vbrQuality, 0, MP3_MAXIMUM_VBR_QUALITY,
		'MP3 variable quality',
	);
	settings.bitRate = allowedNumber(
		options.bitRate ?? descriptor.defaults.bitRate, BIT_RATES.mp3, 'MP3 bitrate',
	);
	settings.averageBitRate = allowedNumber(
		options.averageBitRate ?? descriptor.defaults.averageBitRate, BIT_RATES.mp3,
		'MP3 average bitrate',
	);
}

/**
 * A caller that names one strategy's value and no mode means that strategy: an
 * explicit `bitRate` is a constant-rate request, as it was before the other
 * three modes existed. Only a request that names no value at all takes the
 * dialog's Preset default.
 */
function inferredMp3BitRateMode(options, descriptor) {
	if (options.bitRate != null) return 'constant';
	if (options.averageBitRate != null) return 'average';
	if (options.vbrQuality != null) return 'variable';
	return descriptor.defaults.bitRateMode;
}

/**
 * Mirror LAME's own preset table so FFmpeg and the bundled encoder agree:
 * Excessive is constant 320 kbps, and Extreme, Standard and Medium are the
 * variable qualities V0, V2 and V4.
 */
const MP3_PRESET_FFMPEG_ARGUMENTS = Object.freeze([
	Object.freeze(['-b:a', '320k']), Object.freeze(['-q:a', '0']),
	Object.freeze(['-q:a', '2']), Object.freeze(['-q:a', '4']),
]);

export function mp3FfmpegRateArguments(settings) {
	if (settings.bitRateMode === 'preset') return [...MP3_PRESET_FFMPEG_ARGUMENTS[settings.bitRatePreset]];
	if (settings.bitRateMode === 'variable') return ['-q:a', String(settings.vbrQuality)];
	if (settings.bitRateMode === 'average') return ['-b:a', `${settings.averageBitRate}k`, '-abr', '1'];
	return ['-b:a', `${settings.bitRate}k`];
}

