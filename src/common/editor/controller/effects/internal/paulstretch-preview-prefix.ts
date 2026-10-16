/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep every complete FFT input window contributing to the audition, while
 * retaining Paulstretch's minimum input and moving its endpoint fade beyond it.
 */
export function paulstretchPreviewInputFrames(params: Readonly<Record<string, unknown>>,
	sampleRate: number, auditionFrames: number): number {
	const stretchFactor = Number(params.stretchFactor);
	const requestedHop = sampleRate * Number(params.timeResolution) / 2;
	const hop = Math.max(128, 2 ** Math.floor(Math.log2(requestedHop) + .5));
	const lastWindowStart = Math.floor((auditionFrames - 1) / hop) * hop;
	const windowInput = Math.ceil((lastWindowStart + hop) / stretchFactor) + hop;
	const fadeSafeInput = Math.ceil((auditionFrames + 100) / stretchFactor);
	return Math.max(2 * hop + 1, windowInput, fadeSafeInput);
}
