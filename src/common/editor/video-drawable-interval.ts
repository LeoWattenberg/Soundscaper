/* SPDX-License-Identifier: AGPL-3.0-only */

type DrawableInterval = Readonly<{
	readonly drawableSourceStartTime?: unknown;
	readonly drawableSourceEndTime?: unknown;
}>;

/** Choose a browser seek inside a drawable frame's half-open exact-time interval. */
export function drawableVideoIntervalInteriorSeconds(
	descriptor: DrawableInterval,
	options: Readonly<{ allowArrayRationals?: boolean }> = {},
): number | null {
	const allowArrayRationals = options.allowArrayRationals === true;
	const start = optionalExactSeconds(descriptor.drawableSourceStartTime, allowArrayRationals);
	const end = optionalExactSeconds(descriptor.drawableSourceEndTime, allowArrayRationals);
	if (start === null || end === null || !(start < end)) return null;
	const midpoint = (start + end) / 2;
	return midpoint >= start && midpoint < end ? midpoint : start;
}

function optionalExactSeconds(value: unknown, allowArrayRationals: boolean): number | null {
	if (!value || typeof value !== 'object' || (!allowArrayRationals && Array.isArray(value))) return null;
	const rational = value as Readonly<{ numerator?: unknown; denominator?: unknown }>;
	if (typeof rational.numerator !== 'bigint' || typeof rational.denominator !== 'bigint'
		|| rational.denominator <= 0n) return null;
	const result = Number(rational.numerator) / Number(rational.denominator);
	return Number.isFinite(result) ? result : null;
}
