/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact scalar custody identity shared by retained media and managed color.
 * Body parsing, hashing and pixel sampling stay with their render owner. */
import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord, type ClosedDomainRecord } from './closed-domain-value.ts';

type RgbTripletV1 = readonly [number, number, number];

export const VIDEO_COLOR_LIMITS_V1 = Object.freeze({
	maximumCubeLutBytes: 16 * 1024 * 1024,
	maximumCubeLutSize: 65,
});

export interface VideoCubeLutReferenceV1 {
	readonly storageKey: string;
	readonly sha256: string;
	readonly byteLength: number;
	readonly size: number;
	readonly domainMin: RgbTripletV1;
	readonly domainMax: RgbTripletV1;
}

const LUT_FIELDS = Object.freeze([
	'storageKey', 'sha256', 'byteLength', 'size', 'domainMin', 'domainMax',
]);
const SHA256 = /^[a-f0-9]{64}$/u;

export function normalizeVideoCubeLutReferenceV1(value: unknown): VideoCubeLutReferenceV1 {
	const record = readClosedDomainRecord(value, 'video cube LUT reference', LUT_FIELDS);
	const digest = sha(field(record, 'sha256', 'video cube LUT reference'), 'cube LUT digest');
	const storageKey = field(record, 'storageKey', 'video cube LUT reference');
	if (storageKey !== `lut-sha256:${digest}`) throw new TypeError('The cube LUT storage key must bind its SHA-256.');
	const result = Object.freeze({
		storageKey,
		sha256: digest,
		byteLength: boundedInteger(field(record, 'byteLength', 'video cube LUT reference'), 1, VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes, 'cube LUT bytes'),
		size: boundedInteger(field(record, 'size', 'video cube LUT reference'), 2, VIDEO_COLOR_LIMITS_V1.maximumCubeLutSize, 'cube LUT size'),
		domainMin: triplet(field(record, 'domainMin', 'video cube LUT reference'), -65_536, 65_536, 'cube LUT domain minimum'),
		domainMax: triplet(field(record, 'domainMax', 'video cube LUT reference'), -65_536, 65_536, 'cube LUT domain maximum'),
	});
	if (result.domainMin.some((channel, index) => channel >= result.domainMax[index]!)) {
		throw new RangeError('The cube LUT reference domain minimum must precede its maximum.');
	}
	return result;
}

function triplet(value: unknown, minimum: number, maximum: number, name: string): RgbTripletV1 {
	const array = readClosedDomainArray(value, name, 3, 3);
	return Object.freeze(array.map((item, index) => bounded(
		item, minimum, maximum, `${name}[${String(index)}]`,
	)) as unknown as [number, number, number]);
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function sha(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase SHA-256.`);
	return value;
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a finite number other than negative zero.`);
	}
	return value;
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	const result = finite(value, name);
	if (result < minimum || result > maximum) throw new RangeError(`${name} is outside its bound.`);
	return result;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
	if (!Number.isSafeInteger(number) || Number(number) < minimum || Number(number) > maximum) {
		throw new RangeError(`${name} is outside its integer bound.`);
	}
	return Number(number);
}
