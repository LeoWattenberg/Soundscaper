/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeRational, type Rational } from './timeline-time.ts';

/** Recover the nearest bounded rational from a lossy external floating-point field. */
export function approximatePositiveRational(value: number, maximumDenominator = 1_000_000): Rational {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError('value must be positive and finite.');
	if (!Number.isSafeInteger(maximumDenominator) || maximumDenominator <= 0) {
		throw new RangeError('maximumDenominator must be a positive safe integer.');
	}
	let remainder = value;
	let previousNumerator = 0;
	let numerator = 1;
	let previousDenominator = 1;
	let denominator = 0;
	for (let iteration = 0; iteration < 64; iteration += 1) {
		const coefficient = Math.floor(remainder);
		const nextNumerator = coefficient * numerator + previousNumerator;
		const nextDenominator = coefficient * denominator + previousDenominator;
		if (!Number.isSafeInteger(nextNumerator) || nextDenominator > maximumDenominator) {
			const scale = Math.floor((maximumDenominator - previousDenominator) / denominator);
			const bounded = scale > 0
				? { num: scale * numerator + previousNumerator, den: scale * denominator + previousDenominator }
				: { num: numerator, den: denominator };
			return nearest(value, bounded, { num: numerator, den: denominator }, maximumDenominator);
		}
		previousNumerator = numerator;
		numerator = nextNumerator;
		previousDenominator = denominator;
		denominator = nextDenominator;
		const fraction = remainder - coefficient;
		if (fraction === 0) return normalized(numerator, denominator, maximumDenominator);
		remainder = 1 / fraction;
	}
	return normalized(numerator, denominator, maximumDenominator);
}

function nearest(value: number, left: Rational, right: Rational, maximumDenominator: number): Rational {
	const leftError = Math.abs(value - left.num / left.den);
	const rightError = Math.abs(value - right.num / right.den);
	const selected = leftError < rightError || (leftError === rightError && left.den < right.den) ? left : right;
	return normalized(selected.num, selected.den, maximumDenominator);
}

function normalized(num: number, den: number, maximumDenominator: number): Rational {
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0) {
		throw new RangeError('The bounded rational exceeds the safe integer domain.');
	}
	// A value under half of 1/maximumDenominator rounds to the nearest bounded
	// rational of zero, which callers go on to divide by. The nearest bounded
	// rational that this function may return is the smallest positive one.
	if (num === 0) return normalizeRational({ num: 1, den: maximumDenominator }, { maximumDenominator });
	return normalizeRational({ num, den }, { maximumDenominator });
}
