/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotCanonicalRgba8V1 } from '../src/common/editor/imaging/pixel-frame-canonical-rgba8-v1.ts';

test('canonical RGBA snapshot preserves visible straight-alpha channels and zeros hidden transparent RGB', () => {
	const source = Uint8Array.of(233, 144, 55, 0, 31, 61, 91, 127), before = source.slice();
	const copy = snapshotCanonicalRgba8V1(source, 2, 1);
	assert.deepEqual(copy, Uint8Array.of(0, 0, 0, 0, 31, 61, 91, 127));
	assert.deepEqual(source, before); assert.notEqual(copy.buffer, source.buffer);
});

test('canonical copy reads native bytes without overridden methods or sample iterators', () => {
	const source = Uint8Array.of(3, 5, 7, 255); let invoked = 0;
	for (const key of ['slice', 'constructor', Symbol.iterator]) Object.defineProperty(source, key, { get() { invoked++; throw new Error('accessor ran'); } });
	assert.deepEqual(snapshotCanonicalRgba8V1(source, 1, 1), Uint8Array.of(3, 5, 7, 255)); assert.equal(invoked, 0);
	Object.defineProperty(source, 'byteLength', { get() { invoked++; throw new Error('geometry ran'); } });
	assert.throws(() => snapshotCanonicalRgba8V1(source, 1, 1), TypeError); assert.equal(invoked, 0);
});

test('canonical copy refuses wrong extent, non-intrinsic storage and unsupported sample buffers', () => {
	assert.throws(() => snapshotCanonicalRgba8V1(new Uint8Array(4), 2, 1), RangeError);
	class Samples extends Uint8Array {}
	assert.throws(() => snapshotCanonicalRgba8V1(new Samples(4), 1, 1), TypeError);
	assert.throws(() => snapshotCanonicalRgba8V1(new Uint16Array(4), 1, 1), TypeError);
	assert.throws(() => snapshotCanonicalRgba8V1(new Uint8Array(new SharedArrayBuffer(4)), 1, 1), TypeError);
});
