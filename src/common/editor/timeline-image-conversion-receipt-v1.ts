/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_RECEIPT_BYTES,
	FramescaperImageFramePackV1Error,
} from './timeline-image-frame-pack-v1-layout.ts';

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });

type JsonPrimitive = null | boolean | number | string;
export type FramescaperImageReceiptJsonV1 = JsonPrimitive
	| readonly FramescaperImageReceiptJsonV1[]
	| Readonly<{ [key: string]: FramescaperImageReceiptJsonV1 }>;

export function encodeFramescaperImageConversionReceiptV1(value: unknown): Uint8Array {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new FramescaperImageFramePackV1Error('The image conversion receipt must be an object.');
	}
	let encoded: Uint8Array;
	try {
		encoded = UTF8.encode(canonicalJson(value, new Set<object>()));
	} catch (cause) {
		throw new FramescaperImageFramePackV1Error('The image conversion receipt is not canonical JSON data.', { cause });
	}
	if (encoded.byteLength < 2 || encoded.byteLength > FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_RECEIPT_BYTES) {
		throw new FramescaperImageFramePackV1Error('The image conversion receipt exceeds its byte domain.');
	}
	return encoded;
}

export function decodeFramescaperImageConversionReceiptV1(
	bytes: Uint8Array,
): Readonly<Record<string, unknown>> {
	let text: string;
	let parsed: unknown;
	try {
		text = UTF8_FATAL.decode(bytes);
		parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
			|| canonicalJson(parsed, new Set<object>()) !== text) throw new TypeError('noncanonical');
	} catch (cause) {
		throw new FramescaperImageFramePackV1Error('The image conversion receipt JSON is invalid or noncanonical.', { cause });
	}
	return deepFreeze(parsed as Record<string, unknown>);
}

function canonicalJson(value: unknown, seen: Set<object>): string {
	if (value === null || typeof value === 'boolean') return String(value);
	if (typeof value === 'string') {
		if (value.normalize('NFC') !== value) throw new TypeError('Receipt strings must be NFC.');
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError('Receipt numbers must be safe integers.');
		return String(value);
	}
	if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError('Receipt values must be acyclic JSON.');
	seen.add(value);
	try {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('Receipt symbols are unsupported.');
		if (Array.isArray(value)) return canonicalArray(value, descriptors, seen);
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Receipt objects must be ordinary records.');
		const keys = Object.keys(descriptors).sort(compareText);
		return `{${keys.map((key) => {
			const descriptor = descriptors[key]!;
			if (!descriptor.enumerable || !data(descriptor) || key.normalize('NFC') !== key) {
				throw new TypeError('Receipt fields must be enumerable NFC data.');
			}
			return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, seen)}`;
		}).join(',')}}`;
	} finally {
		seen.delete(value);
	}
}

function canonicalArray(
	value: unknown[],
	descriptors: Record<string, PropertyDescriptor>,
	seen: Set<object>,
): string {
	if (Object.getPrototypeOf(value) !== Array.prototype
		|| Object.keys(descriptors).some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key))) {
		throw new TypeError('Receipt arrays must be ordinary dense arrays.');
	}
	const entries: string[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (!data(descriptor) || !descriptor.enumerable) throw new TypeError('Receipt arrays must be dense data.');
		entries.push(canonicalJson(descriptor.value, seen));
	}
	return `[${entries.join(',')}]`;
}

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function data(value: PropertyDescriptor | undefined): value is PropertyDescriptor & { value: unknown } {
	return Boolean(value && Object.hasOwn(value, 'value'));
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
