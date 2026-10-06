/* SPDX-License-Identifier: MIT */

/** Step a complete numeric prefix, retaining its optional display unit. */
export function stepNumberStepperValue(value: string, delta: number, min?: number, max?: number): string {
	const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*$/u.exec(value);
	const parsed = match ? Number(match[1]) : 0;
	const numericValue = Number.isFinite(parsed) ? parsed : 0;
	const unit = match ? match[2] : value.trim();
	const stepped = Math.max(min ?? Number.NEGATIVE_INFINITY,
		Math.min(max ?? Number.POSITIVE_INFINITY, numericValue + delta));
	return unit ? `${String(stepped)} ${unit}` : String(stepped);
}
