/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Bounded, digest-verified cube LUT parsing and deterministic trilinear
 * sampling for the managed-SDR color authority. Persisted grades reference a
 * LUT by digest and geometry; only a body parsed here — and matching that
 * reference exactly — may be applied.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

type RgbTripletV1 = readonly [number, number, number];

export const VIDEO_COLOR_LIMITS_V1 = Object.freeze({
	maximumCubeLutBytes: 16 * 1024 * 1024,
	maximumCubeLutSize: 64,
});

export interface VideoCubeLutReferenceV1 {
	readonly storageKey: string;
	readonly sha256: string;
	readonly byteLength: number;
	readonly size: number;
	readonly domainMin: RgbTripletV1;
	readonly domainMax: RgbTripletV1;
}

export interface ParsedCubeLutV1 {
	readonly title: string | null;
	readonly size: number;
	readonly domainMin: RgbTripletV1;
	readonly domainMax: RgbTripletV1;
	readonly values: readonly number[];
	readonly byteLength: number;
	readonly sha256: string;
}

const UTF8 = new TextEncoder();
const PARSED_CUBE_LUTS = new WeakSet<object>();

export function parseCubeLutV1(value: string): ParsedCubeLutV1 {
	if (typeof value !== 'string') throw new TypeError('A cube LUT body must be text.');
	const bytes = UTF8.encode(value);
	if (bytes.byteLength < 1 || bytes.byteLength > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes) {
		throw new RangeError('The cube LUT body exceeds its byte bound.');
	}
	let title: string | null = null;
	let size: number | null = null;
	let domainMin: RgbTripletV1 = Object.freeze([0, 0, 0]);
	let domainMax: RgbTripletV1 = Object.freeze([1, 1, 1]);
	const values: number[] = [];
	for (const rawLine of value.split(/\r?\n/u)) {
		const line = rawLine.replace(/\s*#.*$/u, '').trim();
		if (!line) continue;
		if (/^TITLE\s/u.test(line)) {
			const match = /^TITLE\s+"([^"\r\n]{1,512})"$/u.exec(line);
			if (!match) throw new TypeError('The cube LUT title is invalid.');
			title = match[1]!;
			continue;
		}
		if (/^LUT_3D_SIZE\s/u.test(line)) {
			if (size !== null) throw new TypeError('The cube LUT declares its size more than once.');
			size = boundedInteger(token(line, 'LUT_3D_SIZE'), 2, VIDEO_COLOR_LIMITS_V1.maximumCubeLutSize, 'cube LUT size');
			continue;
		}
		if (/^DOMAIN_MIN\s/u.test(line)) {
			domainMin = numericLine(line, 'DOMAIN_MIN', 'cube LUT domain minimum');
			continue;
		}
		if (/^DOMAIN_MAX\s/u.test(line)) {
			domainMax = numericLine(line, 'DOMAIN_MAX', 'cube LUT domain maximum');
			continue;
		}
		if (/^[A-Z_]/u.test(line)) throw new RangeError('The cube LUT contains an unsupported directive.');
		values.push(...numericLine(line, null, 'cube LUT entry'));
	}
	if (size === null) throw new TypeError('The cube LUT requires LUT_3D_SIZE.');
	if (domainMin.some((channel, index) => channel >= domainMax[index]!)) {
		throw new RangeError('The cube LUT domain minimum must precede its maximum.');
	}
	const expected = size ** 3 * 3;
	if (values.length !== expected) {
		throw new RangeError(`The cube LUT entry count must be exactly ${String(expected)} scalars.`);
	}
	const parsed = Object.freeze({
		title,
		size,
		domainMin,
		domainMax,
		values: Object.freeze(values),
		byteLength: bytes.byteLength,
		sha256: bytesToHex(sha256(bytes)),
	});
	PARSED_CUBE_LUTS.add(parsed);
	return parsed;
}

export function requireCubeLutBody(
	reference: VideoCubeLutReferenceV1,
	value: ParsedCubeLutV1 | undefined,
): ParsedCubeLutV1 {
	if (!value || typeof value !== 'object' || !PARSED_CUBE_LUTS.has(value)) {
		throw new TypeError('A grade with a LUT requires its verified transient cube LUT body.');
	}
	if (value.sha256 !== reference.sha256 || value.byteLength !== reference.byteLength
		|| value.size !== reference.size
		|| JSON.stringify(value.domainMin) !== JSON.stringify(reference.domainMin)
		|| JSON.stringify(value.domainMax) !== JSON.stringify(reference.domainMax)) {
		throw new RangeError('The transient cube LUT body does not match the persisted LUT digest and geometry.');
	}
	return value;
}

export function sampleCubeLut(lut: ParsedCubeLutV1, input: readonly number[]): number[] {
	const axis = input.map((channel, index) => {
		const minimum = lut.domainMin[index]!;
		const maximum = lut.domainMax[index]!;
		const position = clampUnit((channel - minimum) / (maximum - minimum)) * (lut.size - 1);
		const low = Math.floor(position);
		return Object.freeze({ low, high: Math.min(lut.size - 1, low + 1), mix: position - low });
	});
	const output = [0, 0, 0];
	for (let channel = 0; channel < 3; channel += 1) {
		const c000 = lutValue(lut, axis[0]!.low, axis[1]!.low, axis[2]!.low, channel);
		const c001 = lutValue(lut, axis[0]!.low, axis[1]!.low, axis[2]!.high, channel);
		const c010 = lutValue(lut, axis[0]!.low, axis[1]!.high, axis[2]!.low, channel);
		const c011 = lutValue(lut, axis[0]!.low, axis[1]!.high, axis[2]!.high, channel);
		const c100 = lutValue(lut, axis[0]!.high, axis[1]!.low, axis[2]!.low, channel);
		const c101 = lutValue(lut, axis[0]!.high, axis[1]!.low, axis[2]!.high, channel);
		const c110 = lutValue(lut, axis[0]!.high, axis[1]!.high, axis[2]!.low, channel);
		const c111 = lutValue(lut, axis[0]!.high, axis[1]!.high, axis[2]!.high, channel);
		const z00 = mix(c000, c001, axis[2]!.mix);
		const z01 = mix(c010, c011, axis[2]!.mix);
		const z10 = mix(c100, c101, axis[2]!.mix);
		const z11 = mix(c110, c111, axis[2]!.mix);
		output[channel] = mix(
			mix(z00, z01, axis[1]!.mix),
			mix(z10, z11, axis[1]!.mix),
			axis[0]!.mix,
		);
	}
	return output;
}

function lutValue(
	lut: ParsedCubeLutV1,
	red: number,
	green: number,
	blue: number,
	channel: number,
): number {
	return lut.values[((red * lut.size + green) * lut.size + blue) * 3 + channel]!;
}

function mix(left: number, right: number, amount: number): number {
	return left + (right - left) * amount;
}

function numericLine(line: string, directive: string | null, name: string): RgbTripletV1 {
	const payload = directive === null ? line : line.slice(directive.length).trim();
	const parts = payload.split(/\s+/u);
	if (parts.length !== 3) throw new TypeError(`${name} requires exactly three scalars.`);
	return Object.freeze(parts.map((part, index) => finite(Number(part), `${name}[${String(index)}]`)) as [number, number, number]);
}

function token(line: string, directive: string): string {
	const parts = line.slice(directive.length).trim().split(/\s+/u);
	if (parts.length !== 1) throw new TypeError(`${directive} requires exactly one value.`);
	return parts[0]!;
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a finite number other than negative zero.`);
	}
	return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
	if (!Number.isSafeInteger(number) || Number(number) < minimum || Number(number) > maximum) {
		throw new RangeError(`${name} is outside its integer bound.`);
	}
	return Number(number);
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value));
}
