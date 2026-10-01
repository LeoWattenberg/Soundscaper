/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { copyUint8ArrayToArrayBuffer } from '../src/common/editor/storage/binary-copy.ts';

test('storage binary copy returns an independent exact ArrayBuffer for a view', () => {
	const source = new Uint8Array([1, 2, 3, 4]);
	const view = source.subarray(1, 3);
	const copied = copyUint8ArrayToArrayBuffer(view);

	assert.ok(copied instanceof ArrayBuffer);
	assert.equal(copied.byteLength, 2);
	assert.deepEqual([...new Uint8Array(copied)], [2, 3]);
	source[1] = 9;
	assert.deepEqual([...new Uint8Array(copied)], [2, 3]);
});
