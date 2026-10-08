/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWindowedSincChannelSampler } from '../../../windowed-sinc-kernel.ts';

/** Preserve a native source's bandwidth when the joined clip crosses sample clocks. */
export function createPasteNativeSourceSampler(input: Float32Array, options: Readonly<{
	sourceStart: number;
	sourceDuration: number;
	framesPerOutput: number;
	convertNativeClock: boolean;
	reversed: boolean;
}>): (offset: number) => number {
	const { sourceStart, sourceDuration, framesPerOutput, convertNativeClock, reversed } = options;
	if (!convertNativeClock || framesPerOutput === 1) return offset => input[sourceStart
		+ (reversed ? sourceDuration - 1 - Math.floor(offset) : Math.floor(offset))]!;
	const channels = [input.subarray(sourceStart, sourceStart + sourceDuration)];
	const output = [new Float32Array(1)];
	const sample = createWindowedSincChannelSampler(24, Math.min(1, 1 / framesPerOutput) * 0.94);
	return offset => {
		sample(channels, 0, sourceDuration, reversed ? sourceDuration - 1 - offset : offset, output, 0);
		return output[0]![0]!;
	};
}
