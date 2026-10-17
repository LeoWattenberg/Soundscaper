/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';

export interface ScapeDigestWriter {
	update(bytes: Uint8Array): unknown;
	digest(): Uint8Array;
}

export function scapeBytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new Blob([exactArrayBuffer(bytes)]).stream();
}

export function digestScapeBytes(bytes: Uint8Array): string {
	return scapeHex(sha256(bytes));
}

export function createScapeDigest(): ScapeDigestWriter {
	return sha256.create();
}

export function scapeHex(bytes: Uint8Array): string {
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}
