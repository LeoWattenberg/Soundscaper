/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact bounded text admission shared by project-feature playback projections. */
export function projectFeatureBoundedString(
	value: unknown,
	name: string,
	maximumLength: number,
): string {
	if (typeof value !== 'string' || !value || value.length > maximumLength) {
		throw new TypeError(`${name} must be a non-empty bounded string.`);
	}
	return value;
}

/** Admit an optional test limit without allowing it to raise the production ceiling. */
export function projectFeatureLowerOnlyLimit(
	value: unknown,
	production: number,
	name: string,
): number {
	if (value === undefined) return production;
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	if (Number(value) > production) throw new RangeError(`${name} cannot raise the production limit.`);
	return Number(value);
}
