/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The validation rules every quality collector measures a record against, in one
 * place. A milestone that tightens what counts as a record, a bounded string, or
 * a countable integer tightens it for every milestone at once; a private copy of
 * these rules would let one collector keep accepting what another already
 * refuses, which prevents inconsistent or flattering diagnostic records.
 *
 * Nothing here knows what is being measured. Callers name the path so the
 * refusal says which member of which record was wrong.
 */

/** Own plain data only: an array, a class instance, or a prototype is not a record. */
export function isRecord(value) {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function requireRecord(value, path) {
	if (!isRecord(value)) throw new Error(`${path} must be a plain record.`);
	return value;
}

/** Exactly the named fields: a missing member and an unexpected one are the same refusal. */
export function exactRecord(value, fields, path) {
	const record = requireRecord(value, path);
	const actual = Object.keys(record).sort();
	const expected = [...fields].sort();
	if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
		throw new Error(`${path} must contain the exact fields.`);
	}
	return record;
}

export function boundedString(value, minimum, maximum, path) {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
		throw new Error(`${path} must be a bounded string.`);
	}
	return value;
}

export function positiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${path} must be a positive safe integer.`);
	}
	return value;
}

export function nonNegativeInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${path} must be a non-negative safe integer.`);
	}
	return value;
}

/** Freeze the whole validated shape, so a later stage cannot edit the recorded result. */
export function deepFreeze(value) {
	if (value === null || typeof value !== 'object') return value;
	for (const key of Object.keys(value)) deepFreeze(value[key]);
	return Object.freeze(value);
}
