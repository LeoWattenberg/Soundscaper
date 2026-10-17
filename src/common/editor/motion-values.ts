/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainRecord } from './closed-domain-value.ts';
import { normalizeRational, type Rational } from './timeline-time.ts';

export function motionRecord(value: unknown, fields: readonly string[], name: string, required: readonly string[] = fields): Readonly<Record<string, unknown>> {
	return readClosedDomainRecord(value, name, fields, required);
}
export function motionArray(value: unknown, maximum: number, name: string, minimum = 0): readonly unknown[] {
	return readClosedDomainArray(value, name, minimum, maximum);
}
export function motionNumber(value: unknown, name: string, minimum = -1e12, maximum = 1e12): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite range.`);
	}
	return Object.is(value, -0) ? 0 : value;
}
export function motionInteger(value: unknown, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
	const number = motionNumber(value, name, minimum, maximum);
	if (!Number.isSafeInteger(number)) throw new TypeError(`${name} must be an integer.`);
	return number;
}
export function motionString(value: unknown, name: string, maximum = 512, allowEmpty = false): string {
	if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.length === 0)
		|| value.normalize('NFC') !== value || [...value].some((character) => /\p{Cc}/u.test(character) && !['\t', '\n', '\r'].includes(character))) {
		throw new TypeError(`${name} must be bounded canonical text.`);
	}
	return value;
}
export function motionId(value: unknown, name = 'motion identity'): string {
	const id = motionString(value, name, 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) throw new TypeError(`${name} must be a stable identity.`);
	return id;
}
export function motionBoolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}
export function motionEnum<const Options extends readonly string[]>(value: unknown, options: Options, name: string): Options[number] {
	if (typeof value !== 'string' || !options.includes(value)) throw new RangeError(`${name} is unsupported.`);
	return value as Options[number];
}
export function motionRational(value: unknown, name: string, positive = false): Rational {
	const record = motionRecord(value, ['num', 'den'], name);
	const result = normalizeRational({
		num: motionInteger(record.num, `${name}.num`, -Number.MAX_SAFE_INTEGER),
		den: motionInteger(record.den, `${name}.den`, 1),
	});
	if (positive && result.num <= 0) throw new RangeError(`${name} must be positive.`);
	return Object.freeze(result);
}
export function motionDigest(value: unknown, name = 'motion digest'): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${name} must be SHA-256.`);
	return value;
}
export function freezeMotionValue<T>(value: T): Readonly<T> {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const item of Object.values(value)) freezeMotionValue(item);
		Object.freeze(value);
	}
	return value;
}
export function uniqueMotionIds<T extends { readonly id: string }>(values: readonly T[], name: string): ReadonlyMap<string, T> {
	const result = new Map<string, T>();
	for (const value of values) {
		if (result.has(value.id)) throw new RangeError(`${name} has duplicate identity ${value.id}.`);
		result.set(value.id, value);
	}
	return result;
}
