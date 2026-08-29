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
