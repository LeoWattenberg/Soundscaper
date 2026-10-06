/* SPDX-License-Identifier: AGPL-3.0-only */

/** Inclusive frequency bounds, using the original multiply/divide order. */
export function spectralBinInterval(sampleRate: number, windowSize: number,
	minimumFrequency: number, maximumFrequency: number): readonly [number, number] {
	const count = windowSize / 2 + 1;
	let first = 0;
	let end = count;
	while (first < end) {
		const middle = (first + end) >>> 1;
		if (middle * sampleRate / windowSize < minimumFrequency) first = middle + 1;
		else end = middle;
	}
	const start = first;
	end = count;
	while (first < end) {
		const middle = (first + end) >>> 1;
		if (middle * sampleRate / windowSize <= maximumFrequency) first = middle + 1;
		else end = middle;
	}
	return [start, end];
}
