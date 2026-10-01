/* SPDX-License-Identifier: AGPL-3.0-only */

export function addArchiveSafeIntegers(...values: readonly number[]): number {
	let sum = 0;
	for (const value of values) {
		if (!Number.isSafeInteger(value) || value < 0 || sum > Number.MAX_SAFE_INTEGER - value) {
			throw new RangeError('Archive size exceeds JavaScript\'s safe-integer range.');
		}
		sum += value;
	}
	return sum;
}
