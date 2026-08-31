/* SPDX-License-Identifier: AGPL-3.0-only */

/** Normalize the power-of-two denominator accepted by Audacity's native project schema. */
export function nativeAup4TimeSignatureDenominator(value: unknown): number {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 && number <= 0x4000_0000
		&& Number.isInteger(Math.log2(number))
		? number
		: 4;
}
