/* SPDX-License-Identifier: AGPL-3.0-only */

export const SOUND_VISUALIZER_SPECTRUM_SIZE = 1_024;
const MAXIMUM_SPECTRUM_WINDOWS = 9;

/** Evenly spaced FFT starts; a short view retains its original zero-padded FFT. */
export function soundVisualizerSpectrumWindowStarts(frameCount: number): readonly number[] {
	const count = Math.min(MAXIMUM_SPECTRUM_WINDOWS,
		Math.max(1, Math.ceil(frameCount / SOUND_VISUALIZER_SPECTRUM_SIZE)));
	const lastStart = Math.max(0, frameCount - SOUND_VISUALIZER_SPECTRUM_SIZE);
	return Array.from({ length: count }, (_, index) => count === 1
		? 0 : Math.round(index * lastStart / (count - 1)));
}
