/* SPDX-License-Identifier: AGPL-3.0-only */

/** The finest block used until a full-source analysis reports its geometry. */
export const DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE = 256;

/** Resolve the finest available full-source frequency-analysis block. */
export function frequencyWaveformFinestBlockSize(analysis: unknown): number {
	const levels = (analysis as Readonly<{ levels?: unknown }> | null)?.levels;
	const firstLevel = Array.isArray(levels) ? levels[0] : null;
	const blockSize = firstLevel && typeof firstLevel === 'object'
		? Number((firstLevel as Readonly<{ blockSize?: unknown }>).blockSize)
		: Number.NaN;
	return Number.isSafeInteger(blockSize) && blockSize > 0
		? blockSize
		: DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE;
}

/** Whether a viewport can display finer detail than the full analysis contains. */
export function frequencyWaveformNeedsWindow(
	sourceFramesPerPixel: number,
	analysis: unknown,
): boolean {
	return Number.isFinite(sourceFramesPerPixel)
		&& sourceFramesPerPixel > 0
		&& sourceFramesPerPixel < frequencyWaveformFinestBlockSize(analysis);
}
