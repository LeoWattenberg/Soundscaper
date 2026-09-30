/* SPDX-License-Identifier: AGPL-3.0-only */

/** The finest block used until a full-source analysis reports its geometry. */
export const DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE = 256;

/** Resolve the finest available full-source frequency-analysis block. */
export function frequencyWaveformFinestBlockSize(analysis: unknown): number {
	try {
		const levels = dataProperty(analysis, 'levels');
		const firstLevel = Array.isArray(levels) ? dataProperty(levels, '0') : null;
		const blockSize = firstLevel && typeof firstLevel === 'object'
			? Number(dataProperty(firstLevel, 'blockSize'))
			: Number.NaN;
		return Number.isSafeInteger(blockSize) && blockSize > 0
			? blockSize
			: DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE;
	} catch {
		return DEFAULT_FREQUENCY_WAVEFORM_FINEST_BLOCK_SIZE;
	}
}

function dataProperty(value: unknown, key: PropertyKey): unknown {
	if (value === null || typeof value !== 'object') return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
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
