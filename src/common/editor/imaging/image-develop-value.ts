/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, type ClosedDomainRecord } from '../closed-domain-value.ts';
export { readClosedDomainRecord as record, readClosedDomainArray as array } from '../closed-domain-value.ts';

export function field(value: ClosedDomainRecord, key: string): unknown {
	return readClosedDomainField(value, key, 'image Develop');
}
export function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} requires a stable identifier.`);
	return value;
}
export function number(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${label} must be between ${String(minimum)} and ${String(maximum)}.`);
	}
	return Object.is(value, -0) ? 0 : value;
}
export function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${label} requires a boolean.`);
	return value;
}
export function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, label: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${label} is unsupported.`);
	return value;
}
export function unique(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) throw new RangeError(`${label} contains duplicate IDs.`);
}
export function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
