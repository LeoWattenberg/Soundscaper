/* SPDX-License-Identifier: AGPL-3.0-only */

/** Compares strings by UTF-16 code unit without consulting host locale data. */
export function compareCodeUnits(left: string, right: string): -1 | 0 | 1 {
	return left < right ? -1 : left > right ? 1 : 0;
}
