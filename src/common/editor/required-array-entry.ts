/* SPDX-License-Identifier: AGPL-3.0-only */

/** Read an array position whose surrounding domain validation requires it. */
export function requiredArrayEntry<T>(values: readonly T[], index: number, subject: string): T {
	const value = values[index];
	if (value === undefined) throw new RangeError(`The ${subject} is incomplete.`);
	return value;
}
