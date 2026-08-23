/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';

const RATE_FIELDS = Object.freeze(['num', 'den']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;

export function exactRenderRational(value: unknown, name: string) {
	const record = readClosedDomainRecord(value, name, RATE_FIELDS);
	const num = exactRenderInteger(exactRenderField(record, 'num', name), `${name}.num`, 1);
	const den = exactRenderInteger(exactRenderField(record, 'den', name), `${name}.den`, 1);
	if (gcd(num, den) !== 1) throw new RangeError(`${name} must be reduced.`);
	return Object.freeze({ num, den });
}

export function exactRenderField(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

export function exactRenderInteger(value: unknown, name: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`${name} must be a bounded safe integer.`);
	}
	return Number(value);
}

export function exactRenderStableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) {
		throw new TypeError(`${name} must be a canonical stable ID.`);
	}
	return value;
}

export function exactRenderNullableText(value: unknown, name: string): string | null {
	return value === null ? null : exactRenderText(value, name);
}

export function exactRenderText(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError(`${name} must be bounded nonempty text.`);
	}
	return value;
}

export function exactRenderCeilingRatio(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}

export function exactRenderRequired<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new RangeError('Unified render node normalization is incomplete.');
	return value;
}

export function deepFreezeExactRenderValue<Value>(value: Value): Value {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value as Record<string, unknown>)) deepFreezeExactRenderValue(nested);
	return Object.freeze(value);
}

function gcd(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}
