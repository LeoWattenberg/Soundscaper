/* SPDX-License-Identifier: AGPL-3.0-only */

export const LEGACY_WAVEFORM_PEAK_CACHE_PREFIX = 'audio-editor-peaks-v1:';
export const WAVEFORM_PEAK_CACHE_PREFIX = 'audio-editor-peaks-v2:';
export const FREQUENCY_WAVEFORM_CACHE_PREFIX = 'audio-editor-frequency-waveform-v1:';

/** Every source-owned analysis namespace that storage cleanup must remove. */
export const SOURCE_ANALYSIS_CACHE_PREFIXES = Object.freeze([
	LEGACY_WAVEFORM_PEAK_CACHE_PREFIX,
	WAVEFORM_PEAK_CACHE_PREFIX,
	FREQUENCY_WAVEFORM_CACHE_PREFIX,
] as const);

export function legacyPeakCacheKey(sourceId: unknown): string {
	return `${LEGACY_WAVEFORM_PEAK_CACHE_PREFIX}${String(sourceId)}`;
}

export function peakCacheKey(sourceId: unknown): string {
	return `${WAVEFORM_PEAK_CACHE_PREFIX}${String(sourceId)}`;
}

export function frequencyWaveformCacheKey(sourceId: unknown): string {
	return `${FREQUENCY_WAVEFORM_CACHE_PREFIX}${String(sourceId)}`;
}
