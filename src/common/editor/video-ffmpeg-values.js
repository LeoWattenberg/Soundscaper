/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Scalar admission for FFmpeg argument building.
 *
 * These validators are the last place a value is checked before it becomes a
 * command-line argument, so each one refuses rather than coerces: a silently
 * repaired dimension or colour would reach the encoder as something the plan
 * never said.
 */

export function mappedValue(mapping, key) {
	if (mapping instanceof Map) return mapping.get(key);
	if (mapping && typeof mapping === 'object' && Object.prototype.hasOwnProperty.call(mapping, key)) {
		return mapping[key];
	}
	return undefined;
}

export function ffmpegColor(value) {
	const color = nonEmptyString(value, 'video color').trim();
	if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return `0x${color.slice(1)}`;
	if (/^0x[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return color;
	if (/^[a-z][a-z0-9_-]*(?:@(?:0(?:\.\d+)?|1(?:\.0+)?))?$/i.test(color)) return color;
	throw new TypeError(`Unsupported FFmpeg video color: ${value}.`);
}

export function ffmpegNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite.`);
	return String(Object.is(number, -0) ? 0 : number);
}

export function nonEmptyString(value, name) {
	const text = String(value ?? '');
	if (!text) throw new TypeError(`${name} must not be empty.`);
	return text;
}

export function nonNegativeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

export function positiveSafeInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return number;
}

export function positiveEvenInteger(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 2 || number % 2 !== 0) {
		throw new RangeError(`${name} must be a positive even integer.`);
	}
	return number;
}

export function nonNegativeFiniteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

export function positiveFiniteNumber(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}
