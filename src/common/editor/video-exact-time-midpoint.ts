/* SPDX-License-Identifier: AGPL-3.0-only */

interface ExactTime {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

/** Convert the midpoint of two exact source times into a usable browser timestamp. */
export function exactVideoMidpointSeconds(start: ExactTime, end: ExactTime, failure: string): number {
	const numerator = start.numerator * end.denominator + end.numerator * start.denominator;
	const denominator = 2n * start.denominator * end.denominator;
	const seconds = Number(numerator) / Number(denominator);
	if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError(failure);
	return seconds;
}
