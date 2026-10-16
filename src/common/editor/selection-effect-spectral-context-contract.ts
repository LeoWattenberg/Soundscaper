/* SPDX-License-Identifier: AGPL-3.0-only */

/** Additional peak retained by the shared spectral replacement compositor. */
export function selectionEffectSpectralScratchBytes(
	frames: number,
	channels: number,
	windowSize?: number | null,
): number {
	if (windowSize == null) return 0;
	if (!Number.isSafeInteger(frames) || frames < 1 || !Number.isSafeInteger(channels) || channels < 1 || channels > 32) {
		throw new RangeError('Spectral replacement requires positive frame and channel counts.');
	}
	if (!Number.isInteger(windowSize) || windowSize < 32 || windowSize > 16384 || (windowSize & (windowSize - 1)) !== 0) {
		throw new RangeError('spectralWindowSize must be a power of two between 32 and 16384.');
	}
	const bytes = frames * channels * Float32Array.BYTES_PER_ELEMENT
		+ frames * Float64Array.BYTES_PER_ELEMENT * 2
		+ windowSize * Float64Array.BYTES_PER_ELEMENT * 5;
	if (!Number.isSafeInteger(bytes)) throw new RangeError('The spectral replacement byte estimate is too large.');
	return bytes;
}
