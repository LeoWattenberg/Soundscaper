/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray as array,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from '../../common/editor/closed-domain-value.ts';

export { readClosedDomainRecord as record, array };

export function field(value: ClosedDomainRecord, key: string): unknown {
	return readClosedDomainField(value, key, 'Lightscaper');
}

export function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} requires a stable identifier.`);
	}
	return value;
}

export function text(value: unknown, name: string, maximum = 16_384, minimum = 0, multiline = false): string {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum
		|| /[\p{Cc}\p{Cf}]/u.test(multiline ? value.replace(/[\r\n\t]/gu, '') : value)) throw new TypeError(`${name} requires bounded safe text.`);
	return value;
}

export function name(value: unknown, label: string): string {
	const result = text(value, label, 256, 1);
	if (!result.trim()) throw new TypeError(`${label} requires a nonempty name.`);
	return result;
}

export function number(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${label} must be between ${String(minimum)} and ${String(maximum)}.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

export function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	const result = number(value, minimum, maximum, label);
	if (!Number.isSafeInteger(result)) throw new RangeError(`${label} requires a safe integer.`);
	return result;
}

export function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${label} requires a boolean.`);
	return value;
}

export function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, label: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${label} is unsupported.`);
	return value;
}

export function uniqueIds(value: unknown, label: string, maximum: number): readonly string[] {
	const result = array(value, label, 0, maximum).map((candidate) => id(candidate, label));
	unique(result, label);
	return Object.freeze(result.sort(compareText));
}

export function unique(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) throw new RangeError(`${label} contains duplicate IDs.`);
}

export function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function utcTimestamp(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
		|| !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
		throw new RangeError(`${label} requires a UTC timestamp.`);
	}
	return value;
}

export function localTimestamp(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(value)) {
		throw new RangeError(`${label} requires a local capture timestamp.`);
	}
	const parsed = new Date(`${value}Z`);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)) {
		throw new RangeError(`${label} is an invalid capture timestamp.`);
	}
	return value.length === 19 ? `${value}.000` : `${value.slice(0, 20)}${value.slice(20).padEnd(3, '0')}`;
}

export function requireSchema(value: ClosedDomainRecord): void {
	if (field(value, 'schemaFamily') !== 'lightscaper') throw new RangeError('Unsupported Lightscaper schema family.');
	if (field(value, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future Lightscaper schema version.');
}
