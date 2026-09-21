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
