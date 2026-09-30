/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const COMPARISON_UTF8 = new TextEncoder();
type ComparisonDigest = ReturnType<typeof sha256.create>;

/** Hash one CAS value without expanding binary payloads into JSON arrays. */
export function canonicalKeyValueComparison(value: unknown): string {
	const digest = sha256.create();
	hashComparisonValue(digest, value, new Set(), false);
	return bytesToHex(digest.digest());
}

function hashComparisonValue(
	digest: ComparisonDigest,
	value: unknown,
	ancestors: Set<object>,
	arrayEntry: boolean,
): void {
	if (value === null || (arrayEntry && isJsonOmission(value))) {
		writeComparisonText(digest, 'null', '');
		return;
	}
	if (isJsonOmission(value)) throw new TypeError('Key/value CAS requires canonical JSON data.');
	if (typeof value === 'string' || typeof value === 'boolean') {
		writeComparisonText(digest, typeof value, String(value));
		return;
	}
	if (typeof value === 'number') {
		writeComparisonText(digest, 'number', Number.isFinite(value) ? JSON.stringify(value) : 'null');
		return;
	}
	if (typeof value === 'bigint') throw new TypeError('Key/value CAS requires canonical JSON data.');
	const object = value as object;
	if (ancestors.has(object)) throw new TypeError('Key/value CAS data cannot be cyclic.');
	if (object instanceof ArrayBuffer || ArrayBuffer.isView(object)) {
		const bytes = object instanceof ArrayBuffer
			? new Uint8Array(object)
			: new Uint8Array(object.buffer, object.byteOffset, object.byteLength);
		writeComparisonText(digest, 'binary-type', object.constructor.name);
		writeComparisonBytes(digest, bytes);
		return;
	}
	const toJSON = (object as { readonly toJSON?: unknown }).toJSON;
	if (typeof toJSON === 'function') {
		hashComparisonValue(digest, toJSON.call(object), ancestors, arrayEntry);
		return;
	}
	ancestors.add(object);
	try {
		if (Array.isArray(object)) {
			writeComparisonText(digest, 'array-length', String(object.length));
			for (const entry of object) hashComparisonValue(digest, entry, ancestors, true);
			return;
		}
		const record = object as Record<string, unknown>;
		const keys = Object.keys(record).filter((key) => !isJsonOmission(record[key]));
		writeComparisonText(digest, 'object-length', String(keys.length));
		for (const key of keys) {
			writeComparisonText(digest, 'key', key);
			hashComparisonValue(digest, record[key], ancestors, false);
		}
	} finally {
		ancestors.delete(object);
	}
}

function isJsonOmission(value: unknown): boolean {
	return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

function writeComparisonText(digest: ComparisonDigest, type: string, value: string): void {
	const bytes = COMPARISON_UTF8.encode(value);
	digest.update(COMPARISON_UTF8.encode(`${type}:${String(bytes.byteLength)}:`));
	digest.update(bytes);
}

function writeComparisonBytes(digest: ComparisonDigest, value: Uint8Array): void {
	digest.update(COMPARISON_UTF8.encode(`binary:${String(value.byteLength)}:`));
	digest.update(value);
}
