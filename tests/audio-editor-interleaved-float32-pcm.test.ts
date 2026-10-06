/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { writeInterleavedFloat32Pcm } from
	'../src/common/editor/interleaved-float32-pcm.ts';

test('mapped WAV PCM writes frame-major little-endian bytes at an exact destination frame', () => {
	const backing = new Uint8Array(44);
	backing.fill(0x7f);
	const destination = backing.subarray(4, 40);
	writeInterleavedFloat32Pcm(destination, [
		new Float32Array([0.25, -0.5]),
		new Float32Array([1, -1]),
	], { destinationFrameOffset: 1, nonFinite: 'zero' });
	const view = new DataView(backing.buffer);
	assert.equal(view.getFloat32(12, true), 0.25);
	assert.equal(view.getFloat32(16, true), 1);
	assert.equal(view.getFloat32(20, true), -0.5);
	assert.equal(view.getFloat32(24, true), -1);
	assert.deepEqual([...backing.subarray(0, 12)], new Array(12).fill(0x7f));
	assert.deepEqual([...backing.subarray(28)], new Array(16).fill(0x7f));
});

test('the three sanitized WAV paths zero nonfinite samples while desktop streaming preserves them', () => {
	const channels = [new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])];
	const sanitized = new Uint8Array(12);
	const preserved = new Uint8Array(12);
	writeInterleavedFloat32Pcm(sanitized, channels, { nonFinite: 'zero' });
	writeInterleavedFloat32Pcm(preserved, channels, { nonFinite: 'preserve' });
	const safe = new DataView(sanitized.buffer);
	const raw = new DataView(preserved.buffer);
	for (let frame = 0; frame < 3; frame += 1) {
		assert.equal(safe.getFloat32(frame * 4, true), 0);
		assert.equal(Number.isFinite(raw.getFloat32(frame * 4, true)), false);
	}
});

test('PCM interleaving rejects missing channels and short channel buffers before writing', () => {
	const destination = new Uint8Array(16).fill(0x7f);
	assert.throws(
		() => writeInterleavedFloat32Pcm(destination, [], { frameCount: 1, nonFinite: 'zero' }),
		/at least one channel/iu,
	);
	assert.throws(
		() => writeInterleavedFloat32Pcm(destination, [Float32Array.of(1, 2), Float32Array.of(3)], {
			frameCount: 2, nonFinite: 'preserve',
		}),
		/channel.*frames/iu,
	);
	assert.deepEqual([...destination], new Array(16).fill(0x7f));
});

test('PCM interleaving rejects invalid frame geometry and destination overflow before writing', () => {
	const destination = new Uint8Array(8).fill(0x7f);
	for (const options of [
		{ frameCount: -1, nonFinite: 'zero' as const },
		{ frameCount: 1.5, nonFinite: 'zero' as const },
		{ destinationFrameOffset: -1, nonFinite: 'zero' as const },
		{ destinationFrameOffset: 0.5, nonFinite: 'zero' as const },
		{ destinationFrameOffset: 2, nonFinite: 'zero' as const },
	]) {
		assert.throws(() => writeInterleavedFloat32Pcm(destination, [Float32Array.of(1)], options));
		assert.deepEqual([...destination], new Array(8).fill(0x7f));
	}
});

test('PCM interleaving rejects an unknown nonfinite-sample policy before writing', () => {
	const destination = new Uint8Array(4).fill(0x7f);
	assert.throws(() => writeInterleavedFloat32Pcm(destination, [Float32Array.of(1)], {
		nonFinite: 'clip' as never,
	}), /nonfinite/iu);
	assert.deepEqual([...destination], [0x7f, 0x7f, 0x7f, 0x7f]);
});

test('zero-frame PCM writes leave even a non-frame-aligned destination untouched', () => {
	const destination = new Uint8Array(3).fill(0x7f);
	writeInterleavedFloat32Pcm(destination, [new Float32Array()], {
		frameCount: 0,
		destinationFrameOffset: 0,
		nonFinite: 'zero',
	});
	assert.deepEqual([...destination], [0x7f, 0x7f, 0x7f]);
});

test('aligned little-endian PCM interleaving avoids per-sample byte-view writes', (t) => {
	if (new Uint8Array(Uint32Array.of(1).buffer)[0] !== 1) return t.skip('Requires a little-endian host.');
	const writes = t.mock.method(DataView.prototype, 'setFloat32');
	const backing = new Uint8Array(29).fill(0x7f);
	const destination = backing.subarray(4, 25);
	writeInterleavedFloat32Pcm(destination, [
		Float32Array.of(-0, Number.NaN, 0.5),
		Float32Array.of(Number.POSITIVE_INFINITY, -0.25, 1),
	], { destinationFrameOffset: 1, frameCount: 1, nonFinite: 'zero' });
	assert.equal(writes.mock.callCount(), 0);
	assert.equal(Object.is(new DataView(backing.buffer).getFloat32(12, true), -0), true);
	assert.equal(new DataView(backing.buffer).getFloat32(16, true), 0);
	assert.deepEqual([...backing.subarray(0, 12)], new Array(12).fill(0x7f));
	assert.deepEqual([...backing.subarray(20)], new Array(9).fill(0x7f));
});

test('unaligned PCM destinations preserve sample values and byte guards', () => {
	for (const nonFinite of ['zero', 'preserve'] as const) {
		const backing = new Uint8Array(23).fill(0x7f);
		writeInterleavedFloat32Pcm(backing.subarray(1, 22), [
			Float32Array.of(-0, Number.NaN, Number.NEGATIVE_INFINITY),
		], { destinationFrameOffset: 1, nonFinite });
		const view = new DataView(backing.buffer);
		assert.equal(Object.is(view.getFloat32(5, true), -0), true);
		assert.equal(Number.isNaN(view.getFloat32(9, true)), nonFinite === 'preserve');
		assert.equal(view.getFloat32(13, true), nonFinite === 'preserve' ? Number.NEGATIVE_INFINITY : 0);
		assert.deepEqual([...backing.subarray(0, 5)], new Array(5).fill(0x7f));
		assert.deepEqual([...backing.subarray(17)], new Array(6).fill(0x7f));
	}
});
