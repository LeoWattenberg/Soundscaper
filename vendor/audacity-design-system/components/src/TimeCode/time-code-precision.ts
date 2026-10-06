/* SPDX-License-Identifier: AGPL-3.0-only */

/** Floor a time in display units without losing an integer to division noise. */
export function timeCodeWholeUnits(seconds: number, rate: number): number {
	const scaled = seconds * rate;
	return Math.floor(scaled + Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4);
}
