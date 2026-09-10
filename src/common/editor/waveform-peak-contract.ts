/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The stored pyramid format, stamped by the analysis code and required by the
 * renderer. Bump it whenever the stored values change so a cached pyramid from
 * an earlier build is recomputed rather than drawn.
 */
export const WAVEFORM_PEAKS_VERSION = 5;

export const WAVEFORM_PEAK_BLOCK_SIZES: readonly number[] = Object.freeze([
	8, 16, 32, 64, 256, 1_024, 4_096, 16_384, 65_536,
]);
export const WAVEFORM_PEAK_FLOAT32_VALUES_PER_BUCKET = 3;

export const WAVEFORM_PEAK_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** Coarsen long-source previews; close zoom reads PCM from the chunk provider. */
export function waveformPeakBlockSizes(frameCount: number, channelCount: number): readonly number[] {
	if (!Number.isSafeInteger(frameCount) || frameCount < 0
		|| !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 1_024) {
		throw new RangeError('Invalid waveform source dimensions.');
	}
	let scale = 1;
	const bytesPerBucket = channelCount * WAVEFORM_PEAK_FLOAT32_VALUES_PER_BUCKET * Float32Array.BYTES_PER_ELEMENT;
	while (WAVEFORM_PEAK_BLOCK_SIZES.reduce((total, size) => total + Math.ceil(frameCount / (size * scale)) * bytesPerBucket, 0)
		> WAVEFORM_PEAK_MAX_SOURCE_BYTES) scale *= 2;
	const sizes = WAVEFORM_PEAK_BLOCK_SIZES.map((size) => size * scale);
	if (!sizes.every(Number.isSafeInteger)) throw new RangeError('The waveform source exceeds the supported frame range.');
	return sizes;
}
