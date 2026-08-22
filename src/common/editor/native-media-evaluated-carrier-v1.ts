/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact cadence carried by the evaluated-RGBA staging format for selected V20. */

import type { NativeMediaPlanEnvelopeV1 } from './native-media-plan-envelope.ts';

const UINT32_MAXIMUM = 0xffff_ffffn;

export interface NativeMediaEvaluatedCarrierCadenceV1 {
	readonly num: number;
	readonly den: number;
}

export function nativeMediaEvaluatedCarrierCadenceV1(
	envelope: NativeMediaPlanEnvelopeV1,
): NativeMediaEvaluatedCarrierCadenceV1 {
	if (envelope.planVersion !== 7 && envelope.planVersion !== 8) {
		throw new RangeError(
			`Native render plan V${String(envelope.planVersion)} has no durable evaluated RGBA carrier.`,
		);
	}
	const rate = envelope.summary.frameRate;
	const exact = rate.kind === 'rational'
		? Object.freeze({ numerator: BigInt(rate.num), denominator: BigInt(rate.den) })
		: exactPositiveDecimal(rate.value);
	if (exact.numerator > UINT32_MAXIMUM || exact.denominator > UINT32_MAXIMUM) {
		throw new RangeError(
			`The exact V${String(envelope.planVersion)} cadence exceeds the evaluated RGBA carrier time-base domain.`,
		);
	}
	return Object.freeze({
		num: Number(exact.numerator),
		den: Number(exact.denominator),
	});
}

function exactPositiveDecimal(value: number): Readonly<{ numerator: bigint; denominator: bigint }> {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError('An evaluated RGBA carrier cadence must be positive and finite.');
	}
	const token = String(value).toLowerCase();
	const [mantissa, exponentToken = '0'] = token.split('e');
	const exponent = Number(exponentToken);
	if (!Number.isSafeInteger(exponent)) throw new RangeError('The V8 cadence exponent is invalid.');
	const [whole, fraction = ''] = mantissa!.split('.');
	let numerator = BigInt(`${whole!}${fraction}`);
	let denominator = 10n ** BigInt(fraction.length);
	if (exponent > 0) numerator *= 10n ** BigInt(exponent);
	else if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
	const divisor = greatestCommonDivisor(numerator, denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}
