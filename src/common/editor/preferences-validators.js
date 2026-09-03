/* SPDX-License-Identifier: AGPL-3.0-only */

// Value validators shared by the editor preference schema. Each returns the
// accepted value or throws with the preference path in the message.

export function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

export function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

export function integer(value, minimum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) {
		throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`);
	}
	return number;
}

export function finiteInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

export function oneOf(value, allowed, name) {
	if (!allowed.has(value)) throw new RangeError(`${name} has an unsupported value: ${value}.`);
	return value;
}
