/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

type HashInput = string | ArrayBuffer | ArrayBufferView;

/** Browser-safe build seam for the narrow Node createHash usage in sandboxed preloads. */
export function createHash(algorithm: string): Readonly<{
	update(value: HashInput): ReturnType<typeof createHash>;
	digest(encoding: 'hex'): string;
}> {
	if (algorithm !== 'sha256') throw new TypeError('The sandbox preload supports only SHA-256');
	const chunks: Uint8Array[] = [];
	const hash = {
		update(value: HashInput) {
			chunks.push(bytes(value));
			return hash;
		},
		digest(encoding: 'hex') {
			if (encoding !== 'hex') throw new TypeError('The sandbox preload supports only hexadecimal digests');
			const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
			const input = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				input.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return bytesToHex(sha256(input));
		},
	};
	return hash;
}

function bytes(value: HashInput): Uint8Array {
	if (typeof value === 'string') return new TextEncoder().encode(value);
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	}
	throw new TypeError('The sandbox SHA-256 input is invalid');
}
