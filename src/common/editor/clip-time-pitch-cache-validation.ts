/* SPDX-License-Identifier: AGPL-3.0-only */

export function nonEmptyString(value: unknown, name: string): string {
	const result = String(value ?? '').trim();
	if (!result) throw new TypeError(`${name} must be a non-empty string.`);
	return result;
}

export function positiveFinite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) {
		throw new RangeError(`${name} must be finite and positive.`);
	}
	return number;
}

export function finiteRange(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${String(minimum)} and ${String(maximum)}.`);
	}
	return number;
}

export function positiveInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return number;
}

export function nonNegativeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

export function integerRange(
	value: unknown,
	minimum: number,
	maximum: number,
	name: string,
): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`);
	}
	return number;
}
