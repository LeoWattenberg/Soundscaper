/* SPDX-License-Identifier: AGPL-3.0-only */

export type WaveformAmplitudeScale = 'linear' | 'db';

/** Audacity's default logarithmic waveform range runs from -60 dB to 0 dB. */
export const WAVEFORM_DB_RANGE = 60;

/** Map an audio amplitude to a signed display amplitude after clip/envelope gain. */
export function scaleWaveformAmplitude(sample: number, scale: WaveformAmplitudeScale = 'linear'): number {
	if (!Number.isFinite(sample)) return 0;
	if (scale === 'linear') return sample;
	const magnitude = Math.abs(sample);
	if (magnitude === 0) return 0;
	const display = Math.max(0, (WAVEFORM_DB_RANGE + 20 * Math.log10(magnitude)) / WAVEFORM_DB_RANGE);
	// Keep over-unity samples outside the full-scale boundary for canvas clipping.
	return display === 0 ? 0 : Math.sign(sample) * display;
}

/** Recover a signed audio amplitude from a waveform drawing/editing position. */
export function unscaleWaveformAmplitude(value: number, scale: WaveformAmplitudeScale = 'linear'): number {
	if (!Number.isFinite(value)) return 0;
	if (scale === 'linear') return value;
	if (value === 0) return 0;
	return Math.sign(value) * 10 ** ((Math.abs(value) - 1) * WAVEFORM_DB_RANGE / 20);
}
