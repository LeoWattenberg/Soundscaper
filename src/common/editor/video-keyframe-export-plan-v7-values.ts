/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Value admission for the V7 keyed export document.
 *
 * The plan module owns what the document means; this owns what a field is
 * allowed to be. They were one file until the delivery-quality field pushed it
 * past the maintainability ceiling, and the seam is the natural one: nothing
 * here knows a canvas from a codec.
 */

import {
	AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE,
	AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE,
} from './project-v10-foundation-validation.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const VIDEO_MIME = /^video\/[a-z0-9][a-z0-9.+-]{0,126}$/u;
const NO_OPTIONAL_FIELDS: ReadonlySet<string> = new Set();

export function videoMime(value: unknown): string {
	const result = boundedString(value, 'video MIME type', 128);
	if (!VIDEO_MIME.test(result)) throw new TypeError('Video MIME type must be canonical.');
	return result;
}

export function canonicalColor(value: unknown): string {
	if (value !== '#000000') {
		throw new TypeError('Video keyframe export backgroundColor must match the opaque-black compositor.');
	}
	return '#000000';
}

export function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('Video source contentSha256 must be a lowercase SHA-256 digest.');
	}
	return value;
}

export function audioFileName(value: unknown): string {
	const result = boundedString(value, 'audioFileName', 255);
	if (!result.toLowerCase().endsWith('.wav') || result.includes('/') || result.includes('\\')) {
		throw new TypeError('audioFileName must be a local WAV file name.');
	}
	return result;
}

export function nullableId(value: unknown, name: string): string | null {
	return value === null ? null : id(value, name);
}

export function id(value: unknown, name: string): string {
	return boundedString(value, name, 1_024);
}

export function boundedString(value: unknown, name: string, maximum = 1_024): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${name} must be a bounded non-empty string.`);
	}
	return value;
}

export function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}

export function nonNegativeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

export function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

export function projectSampleRate(value: unknown): number {
	const result = positiveInteger(value, 'sampleRate');
	if (result < AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE
		|| result > AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE) {
		throw new RangeError(
			`Video keyframe export sample rate must be ${String(AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE)} through ${String(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE)}.`,
		);
	}
	return result;
}

export function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

export function closedRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
	exactOrder: boolean,
	optionalFields: ReadonlySet<string> = NO_OPTIONAL_FIELDS,
): Readonly<Record<string, unknown>> {
	const result = record(value, name);
	const keys = Reflect.ownKeys(result);
	if (exactOrder) {
		if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
			throw new TypeError(`${name} is not in canonical field order.`);
		}
	} else {
		for (const key of keys) {
			if (typeof key !== 'string' || !fields.includes(key)) throw new TypeError(`${name} has an unsupported field.`);
		}
		for (const field of fields) {
			if (!optionalFields.has(field) && !Object.hasOwn(result, field)) {
				throw new TypeError(`${name}.${field} is required.`);
			}
		}
	}
	for (const key of keys) {
		if (typeof key !== 'string') throw new TypeError(`${name} has a non-string field.`);
		const descriptor = Object.getOwnPropertyDescriptor(result, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
	}
	return result;
}

export function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
		throw new RangeError(`${name} must be a bounded ordinary array.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') {
		throw new TypeError(`${name} must be a canonical dense array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		if (keys[index] !== String(index)) throw new TypeError(`${name} must be a canonical dense array.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain own data entries.`);
		}
		result.push(descriptor.value);
	}
	return result;
}

export function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

export function optionalData(value: object, key: string, fallback: unknown, name: string): unknown {
	return Object.hasOwn(value, key) ? data(value, key, name) : fallback;
}

export function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
