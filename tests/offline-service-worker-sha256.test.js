/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createRuntimeSha256 } from '../scripts/lib/offline-service-worker.mjs';

const BOUNDARY_LENGTHS = Object.freeze([0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129]);
const CHUNK_SIZES = Object.freeze([1, 7, 31, 64, 65]);

test('runtime SHA-256 matches Node across padding and block boundaries', () => {
	for (const byteLength of BOUNDARY_LENGTHS) {
		const bytes = Uint8Array.from(
			{ length: byteLength },
			(_, index) => (index * 131 + byteLength * 17) & 0xff,
		);
		const expected = createHash('sha256').update(bytes).digest('hex');
		for (const chunkSize of CHUNK_SIZES) {
			const digest = createRuntimeSha256();
			if (bytes.byteLength === 0) digest.update(bytes);
			for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
				digest.update(bytes.subarray(offset, offset + chunkSize));
			}
			assert.equal(
				digest.digestHex(),
				expected,
				`${String(byteLength)} bytes in ${String(chunkSize)}-byte chunks`,
			);
		}
	}
});
