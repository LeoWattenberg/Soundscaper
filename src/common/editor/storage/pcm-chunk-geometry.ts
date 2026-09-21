/* SPDX-License-Identifier: AGPL-3.0-only */

import { WAVPACK_PCM_MAXIMUM_FRAMES } from '../wavpack/index.js';

/** Admit the one PCM source-chunk frame bound shared by repository read/write paths. */
export function normalizePcmChunkFrames(value: unknown): number {
	const frames = Number(value);
	if (!Number.isSafeInteger(frames) || frames < 1 || frames > WAVPACK_PCM_MAXIMUM_FRAMES) {
		throw new RangeError(
			`PCM chunk size must be an integer between 1 and ${WAVPACK_PCM_MAXIMUM_FRAMES} frames.`,
		);
	}
	return frames;
}
