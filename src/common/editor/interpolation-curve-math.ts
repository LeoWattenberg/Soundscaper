/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeRational,
	type Rational,
} from './timeline-time.ts';

export interface ExactInterpolationFraction {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

const MAXIMUM_DENOMINATOR = 1_000_000n;
export const ZERO_FRACTION = Object.freeze({ numerator: 0n, denominator: 1n });
const ONE_FRACTION = Object.freeze({ numerator: 1n, denominator: 1n });

export function exactFraction(value: Rational): ExactInterpolationFraction {
	return normalizeFraction(BigInt(value.num), BigInt(value.den));
}

export function publicFraction(value: ExactInterpolationFraction): Rational {
	const num = Number(value.numerator);
	const den = Number(value.denominator);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
		throw new RangeError('The interpolation position is outside the safe rational domain.');
	}
	const normalized = normalizeRational({ num, den });
	if (compareFractions(exactFraction(normalized), value) !== 0) {
		throw new RangeError('The interpolation position is outside the shared rational domain.');
	}
	return normalized;
}

export function integerFraction(value: number): ExactInterpolationFraction {
	return Object.freeze({ numerator: BigInt(value), denominator: 1n });
}

export function numberFraction(value: number): ExactInterpolationFraction {
	if (Number.isSafeInteger(value)) return integerFraction(value);
	const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(String(value));
	if (!match) throw new RangeError('A finite interpolation value could not be represented exactly.');
	const decimals = match[3] ?? '';
	const exponent = Number(match[4] ?? 0) - decimals.length;
	let numerator = BigInt(`${match[1] ?? ''}${match[2] ?? ''}${decimals}`);
	let denominator = 1n;
	if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
	else denominator = 10n ** BigInt(-exponent);
	return normalizeFraction(numerator, denominator);
}

export function addFractions(
	left: ExactInterpolationFraction,
	right: ExactInterpolationFraction,
): ExactInterpolationFraction {
	return normalizeFraction(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

export function subtractFractions(
	left: ExactInterpolationFraction,
	right: ExactInterpolationFraction,
): ExactInterpolationFraction {
	return normalizeFraction(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

export function multiplyFractions(
	left: ExactInterpolationFraction,
	right: ExactInterpolationFraction,
): ExactInterpolationFraction {
	return normalizeFraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divideFractions(
	left: ExactInterpolationFraction,
	right: ExactInterpolationFraction,
): ExactInterpolationFraction {
	if (right.numerator === 0n) throw new RangeError('Cannot divide by zero.');
	return normalizeFraction(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function compareFractions(
	left: ExactInterpolationFraction,
	right: ExactInterpolationFraction,
): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function fractionNumber(value: ExactInterpolationFraction): number {
	return Number(value.numerator) / Number(value.denominator);
}

export function interpolateFraction(
	start: ExactInterpolationFraction,
	end: ExactInterpolationFraction,
	amount: ExactInterpolationFraction,
): ExactInterpolationFraction {
	return addFractions(
		multiplyFractions(start, subtractFractions(ONE_FRACTION, amount)),
		multiplyFractions(end, amount),
	);
}

export function cubicFraction(
	start: ExactInterpolationFraction,
	control1: ExactInterpolationFraction,
	control2: ExactInterpolationFraction,
	end: ExactInterpolationFraction,
	amount: ExactInterpolationFraction,
): ExactInterpolationFraction {
	const first = interpolateFraction(start, control1, amount);
	const second = interpolateFraction(control1, control2, amount);
	const third = interpolateFraction(control2, end, amount);
	return interpolateFraction(
		interpolateFraction(first, second, amount),
		interpolateFraction(second, third, amount),
		amount,
	);
}

/** Recover the nearest existing-domain rational from a binary solver result. */
export function approximateBoundedFraction(value: number): ExactInterpolationFraction | null {
	const source = numberFraction(value);
	try { return exactFraction(publicFraction(source)); } catch (error) {
		if (!(error instanceof RangeError)) throw error;
	}
	if (source.numerator < 0n) return null;
	let numerator = source.numerator;
	let denominator = source.denominator;
	let previousNumerator = 0n;
	let previousDenominator = 1n;
	let currentNumerator = 1n;
	let currentDenominator = 0n;
	while (denominator !== 0n) {
		const quotient = numerator / denominator;
		const nextDenominator = previousDenominator + quotient * currentDenominator;
		if (nextDenominator > MAXIMUM_DENOMINATOR) break;
		[previousNumerator, currentNumerator] = [currentNumerator, previousNumerator + quotient * currentNumerator];
		[previousDenominator, currentDenominator] = [currentDenominator, nextDenominator];
		[numerator, denominator] = [denominator, numerator - quotient * denominator];
	}
	const multiplier = currentDenominator === 0n
		? 0n : (MAXIMUM_DENOMINATOR - previousDenominator) / currentDenominator;
	const candidates = [
		normalizeFraction(
			previousNumerator + multiplier * currentNumerator,
			previousDenominator + multiplier * currentDenominator,
		),
		normalizeFraction(currentNumerator, currentDenominator),
	];
	let closest: ExactInterpolationFraction | null = null;
	for (const candidate of candidates) {
		try { publicFraction(candidate); } catch (error) {
			if (error instanceof RangeError) continue;
			throw error;
		}
		if (closest === null || compareDistances(source, candidate, closest) < 0) closest = candidate;
	}
	return closest;
}

/** Preserve legacy finite arithmetic, using a convex fallback only on overflow. */
export function stableInterpolate(start: number, end: number, amount: number): number {
	const legacy = start + (end - start) * amount;
	if (Number.isFinite(legacy)) return legacy;
	const convex = start * (1 - amount) + end * amount;
	if (Number.isFinite(convex)) return convex;
	return convex < 0 ? Math.min(start, end) : Math.max(start, end);
}

export function stableCubic(
	start: number,
	control1: number,
	control2: number,
	end: number,
	amount: number,
): number {
	const first = stableInterpolate(start, control1, amount);
	const second = stableInterpolate(control1, control2, amount);
	const third = stableInterpolate(control2, end, amount);
	return stableInterpolate(
		stableInterpolate(first, second, amount),
		stableInterpolate(second, third, amount),
		amount,
	);
}

/** Classify the quadratic derivative, not merely the control-polygon ordering. */
export function cubicValueDirection(
	start: number,
	control1: number,
	control2: number,
	end: number,
): -1 | 0 | 1 | null {
	if (start === end) return start === control1 && control1 === control2 ? 0 : null;
	const direction = start < end ? 1 : -1;
	const values = [start, control1, control2, end].map(exactFiniteDoubleFraction);
	const directedDifference = (left: number, right: number): ExactInterpolationFraction => (
		direction === 1
			? subtractFractions(nonNullableFraction(values[right]), nonNullableFraction(values[left]))
			: subtractFractions(nonNullableFraction(values[left]), nonNullableFraction(values[right]))
	);
	const first = directedDifference(0, 1);
	const middle = directedDifference(1, 2);
	const last = directedDifference(2, 3);
	if (compareFractions(first, ZERO_FRACTION) < 0
		|| compareFractions(last, ZERO_FRACTION) < 0) return null;
	if (compareFractions(middle, ZERO_FRACTION) >= 0
		|| compareFractions(
			multiplyFractions(middle, middle),
			multiplyFractions(first, last),
		) <= 0) return direction;
	return null;
}

function exactFiniteDoubleFraction(value: number): ExactInterpolationFraction {
	if (!Number.isFinite(value)) throw new RangeError('An interpolation value must be finite.');
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, value, false);
	const high = view.getUint32(0, false);
	const low = view.getUint32(4, false);
	const negative = (high >>> 31) === 1;
	const exponent = (high >>> 20) & 0x7ff;
	const fraction = (BigInt(high & 0x000f_ffff) << 32n) | BigInt(low);
	if (exponent === 0 && fraction === 0n) return ZERO_FRACTION;
	let numerator = exponent === 0 ? fraction : (1n << 52n) | fraction;
	const power = exponent === 0 ? -1_074 : exponent - 1_023 - 52;
	let denominator = 1n;
	if (power >= 0) numerator <<= BigInt(power);
	else denominator <<= BigInt(-power);
	return normalizeFraction(negative ? -numerator : numerator, denominator);
}

function nonNullableFraction(
	value: ExactInterpolationFraction | undefined,
): ExactInterpolationFraction {
	if (value === undefined) throw new RangeError('Expected a cubic interpolation value.');
	return value;
}

function normalizeFraction(numerator: bigint, denominator: bigint): ExactInterpolationFraction {
	if (denominator === 0n) throw new RangeError('An interpolation position denominator cannot be zero.');
	if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
	const divisor = gcd(absolute(numerator), denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function compareDistances(
	source: ExactInterpolationFraction,
	left: ExactInterpolationFraction,
	right: ExactInterpolationFraction,
): -1 | 0 | 1 {
	return compareFractions(absoluteFraction(subtractFractions(source, left)),
		absoluteFraction(subtractFractions(source, right)));
}

function absoluteFraction(value: ExactInterpolationFraction): ExactInterpolationFraction {
	return value.numerator < 0n ? normalizeFraction(-value.numerator, value.denominator) : value;
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) { const remainder = left % right; left = right; right = remainder; }
	return left || 1n;
}

function absolute(value: bigint): bigint { return value < 0n ? -value : value; }
