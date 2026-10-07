/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { fitPixelSizeV1, resizeRgba8NearestV1, resizeRgba8NearestAsyncV1 } from '../src/common/editor/imaging/pixel-frame-resize-v1.ts';

const pixels = () => Uint8Array.from([1, 11, 21, 31, 2, 12, 22, 32, 3, 13, 23, 33, 4, 14, 24, 34, 5, 15, 25, 35, 6, 16, 26, 36]);
const labels = (value: Uint8Array) => Array.from(value).filter((_sample, index) => index % 4 === 0);

test('the shared nearest-neighbour kernel follows independent rectangular up/downsample goldens', () => {
	const input = pixels(), before = input.slice();
	assert.deepEqual(labels(resizeRgba8NearestV1(input, 2, 3, 4, 6)), [1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4, 5, 5, 6, 6, 5, 5, 6, 6]);
	assert.deepEqual(labels(resizeRgba8NearestV1(input, 2, 3, 1, 2)), [1, 3]);
	assert.deepEqual(input, before);
	const same = resizeRgba8NearestV1(input, 2, 3, 2, 3);
	assert.deepEqual(same, input); assert.notEqual(same.buffer, input.buffer);
	assert.deepEqual(Array.from(same.subarray(0, 4)), [1, 11, 21, 31], 'every channel, including straight alpha, survives');
});

test('shared fit geometry preserves the existing rounded aspect ratio and never upscales', () => {
	assert.deepEqual(fitPixelSizeV1(3, 2, 2, 2), { width: 2, height: 1 });
	assert.deepEqual(fitPixelSizeV1(2, 3, 2, 2), { width: 1, height: 2 });
	assert.deepEqual(fitPixelSizeV1(2, 3, 512, 512), { width: 2, height: 3 });
	assert.deepEqual(fitPixelSizeV1(1, 65_536, 512, 512), { width: 1, height: 512 });
	assert.throws(() => fitPixelSizeV1(0, 1, 1, 1), RangeError);
});

test('intrinsic samples are read without slice, constructor, subarray or iterator accessors', () => {
	const input = pixels(); let invoked = 0;
	for (const key of ['slice', 'constructor', 'subarray', Symbol.iterator]) Object.defineProperty(input, key, { get() { invoked += 1; throw new Error('accessor ran'); } });
	assert.deepEqual(labels(resizeRgba8NearestV1(input, 2, 3, 1, 2)), [1, 3]);
	assert.equal(invoked, 0);
	Object.defineProperty(input, 'byteLength', { get() { invoked += 1; throw new Error('geometry ran'); } });
	assert.throws(() => resizeRgba8NearestV1(input, 2, 3, 1, 2), TypeError);
	assert.equal(invoked, 0);
});

test('invalid geometry and non-intrinsic, shared, resized or detached storage refuse before output', () => {
	assert.throws(() => resizeRgba8NearestV1(pixels(), 2, 3, 8192, 8192), RangeError);
	assert.throws(() => resizeRgba8NearestV1(pixels(), 2, 4, 1, 1), RangeError);
	class Samples extends Uint8Array {}
	assert.throws(() => resizeRgba8NearestV1(new Samples(4), 1, 1, 1, 1), TypeError);
	assert.throws(() => resizeRgba8NearestV1(new Uint8Array(new SharedArrayBuffer(4)), 1, 1, 1, 1), TypeError);
	const resizable = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer;
	assert.throws(() => resizeRgba8NearestV1(new Uint8Array(resizable), 1, 1, 1, 1), TypeError);
	const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	assert.throws(() => resizeRgba8NearestV1(detached, 1, 1, 1, 1), RangeError);
});

test('the asynchronous kernel has the same samples and yields an actual timer task even for a tiny frame', async () => {
	let timerRan = false; const timer = setTimeout(() => { timerRan = true; }, 0);
	try { assert.deepEqual(await resizeRgba8NearestAsyncV1(pixels(), 2, 3, 1, 2), resizeRgba8NearestV1(pixels(), 2, 3, 1, 2)); }
	finally { clearTimeout(timer); }
	assert.equal(timerRan, true);
});

test('task cancellation interrupts a row batch and preserves its caller-owned source', async () => {
	const controller = new AbortController(), reason = new Error('cancelled between rows');
	const input = new Uint8Array(64 * 128 * 4).fill(71), before = input.slice();
	const timer = setTimeout(() => { controller.abort(reason); }, 0);
	try { await assert.rejects(resizeRgba8NearestAsyncV1(input, 64, 128, 32, 64, controller.signal), error => error === reason); }
	finally { clearTimeout(timer); }
	assert.deepEqual(input, before);
	assert.throws(() => resizeRgba8NearestV1(input, 64, 128, 32, 64, controller.signal), error => error === reason);
});
