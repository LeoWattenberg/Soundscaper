/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audioWarpMinimumSourceSpanPerColumn,
	type AudioWarpRuntimeProject,
} from '../../audio-warp-runtime.ts';
import {
	validateWaveformPeakLevels,
	waveformPeakLevelForResolution,
} from '../../design-system-adapters/waveform-internals.ts';

export function usableWaveformPeakLevel(peaks: unknown, sourceSamplesPerPixel: number) {
	try {
		return waveformPeakLevelForResolution(peaks, sourceSamplesPerPixel);
	} catch {
		// A stale peak cache must not mask valid PCM or a newly fetched peak window.
		return null;
	}
}

export function coarsePeakPreviewWidth(peaks: unknown, sourceSamples: number, displayWidth: number): number | null {
	try {
		const finestBlockSize = validateWaveformPeakLevels(peaks).levels[0]?.blockSize;
		if (!finestBlockSize || !(sourceSamples > 0) || !(displayWidth > 0)) return null;
		const width = Math.min(displayWidth, sourceSamples / finestBlockSize);
		return width < displayWidth ? width * (1 - 1e-9) : null;
	} catch {
		return null;
	}
}
export function coarseWarpPeakPreviewWidth(
	peaks: unknown,
	project: AudioWarpRuntimeProject,
	clip: Parameters<typeof audioWarpMinimumSourceSpanPerColumn>[1] & Readonly<{ waveformStartFrame: number; waveformEndFrame: number }>,
	displayWidth: number,
): number | null {
	try {
		const finestBlockSize = validateWaveformPeakLevels(peaks).levels[0]?.blockSize;
		if (!finestBlockSize || !(displayWidth > 0)) return null;
		let columnCount = Math.max(1, Math.ceil(displayWidth));
		while (true) {
			const minimumSpan = audioWarpMinimumSourceSpanPerColumn(project, clip, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
				columnCount,
			});
			if (minimumSpan >= finestBlockSize) {
				return columnCount < displayWidth ? columnCount * (1 - 1e-9) : null;
			}
			if (columnCount === 1) return null;
			columnCount = Math.max(1, Math.floor(columnCount / 2));
		}
	} catch {
		return null;
	}
}
