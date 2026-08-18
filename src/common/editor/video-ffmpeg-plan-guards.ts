/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, type ClosedDomainRecord } from './closed-domain-value.ts';
import { nearlyEqualVideoFfmpegScalar } from './video-ffmpeg-scale-admission.ts';

export type DataRecord = Record<string, unknown>;

/**
 * The numeric and record guards the FFmpeg description adapter reads its plan
 * through.
 *
 * Split out when the adapter passed its size limit, along the seam that was
 * already there: none of these knows what a render description is. They decide
 * what counts as a number, a token, or a record, and refuse everything else.
 */

export function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

export function canonicalFinite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
	if (Object.is(value, -0)) throw new RangeError(`${name} must not be negative zero.`);
	return value;
}

export function unitNumber(value: unknown, name: string): number {
	const number = canonicalFinite(value, name);
	if (number < 0 || number > 1) throw new RangeError(`${name} must be from zero through one.`);
	return number;
}

export function nonNegativeNumber(value: unknown, name: string): number {
	const number = canonicalFinite(value, name);
	if (number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

export function positiveNumber(value: unknown, name: string): number {
	const number = canonicalFinite(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

export function positiveSafeInteger(value: unknown, name: string): number {
	const number = canonicalFinite(value, name);
	if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

export function nonNegativeSafeInteger(value: unknown, name: string): number {
	const number = canonicalFinite(value, name);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

export function nearPositiveSafeInteger(value: number, name: string): number {
	const rounded = Math.round(value);
	if (!Number.isSafeInteger(rounded) || rounded < 1 || !nearlyEqualVideoFfmpegScalar(value, rounded)) {
		throw new RangeError(`${name} must resolve to a positive safe integer.`);
	}
	return rounded;
}

export function boundedSafeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
	const number = canonicalFinite(value, name);
	if (!Number.isSafeInteger(number)) throw new TypeError(`${name} must be a safe integer.`);
	if (number < minimum || number > maximum) throw new RangeError(`${name} is outside its range.`);
	return number;
}

export function assertNearly(actual: number, expected: number, name: string): void {
	if (!nearlyEqualVideoFfmpegScalar(actual, expected)) throw new RangeError(`${name} disagrees with the normalized aperture.`);
}


export function numberToken(value: number): string {
	if (!Number.isFinite(value)) throw new RangeError('An FFmpeg render scalar must be finite.');
	return String(Object.is(value, -0) ? 0 : value);
}

export function planNumber(value: unknown, version: number): unknown {
	if (version >= 6) return value;
	const number = Number(value);
	return Object.is(number, -0) ? 0 : number;
}

export function nonEmptyString(value: unknown, name: string): string {
	const text = String(value ?? '');
	if (!text) throw new TypeError(`${name} must not be empty.`);
	return text;
}

export function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}
