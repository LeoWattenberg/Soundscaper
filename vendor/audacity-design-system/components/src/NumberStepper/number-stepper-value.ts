/* SPDX-License-Identifier: MIT */

/** Step a complete numeric prefix, retaining its optional display unit. */
export function stepNumberStepperValue(value: string, delta: number, min?: number, max?: number): string {
	const trimmed = value.trim();
	const prefix = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(trimmed);
	const suffix = prefix ? trimmed.slice(prefix[0].length).trim() : trimmed;
	// Parse the prefix independently so malformed units cannot backtrack over it.
	const hasNumericPrefix = prefix !== null && !/[\n\r\u2028\u2029]/u.test(suffix);
	const parsed = hasNumericPrefix ? Number(prefix[0]) : 0;
	const numericValue = Number.isFinite(parsed) ? parsed : 0;
	const unit = hasNumericPrefix ? suffix : trimmed;
	const stepped = Math.max(min ?? Number.NEGATIVE_INFINITY,
		Math.min(max ?? Number.POSITIVE_INFINITY, numericValue + delta));
	return unit ? `${String(stepped)} ${unit}` : String(stepped);
}
