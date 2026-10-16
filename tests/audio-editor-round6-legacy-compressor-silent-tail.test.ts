/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityLegacyCompressor } from '../src/common/editor/audacity-effects/basic.js';

function recording(frequency: number): Float32Array<ArrayBuffer> {
	const samples = new Float32Array(72_000);
	for (let frame = 0; frame < 48_000; frame++) samples[frame] = .8 * Math.sin(2 * Math.PI * frequency * frame / 48_000);
	return samples;
}

for (const frequency of [330, 660, 440]) {
	test(`Legacy Compressor preserves a finite silent tail after an ordinary ${frequency} Hz tone`, () => {
		const input = recording(frequency);
		const output: Float32Array = applyAudacityLegacyCompressor([input], 48_000)[0];
		assert.equal(output.length, input.length);
		assert.equal(output.findIndex(sample => !Number.isFinite(sample)), -1);
		assert.equal(output.subarray(48_000).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0), 0);
		assert.ok(output.subarray(0, 48_000).some(sample => Math.abs(sample) > .5));
	});
}

test('Legacy Compressor retains its ordinary peak-detector silent-tail behavior', () => {
	const output: Float32Array = applyAudacityLegacyCompressor([recording(330)], 48_000, { usePeak: true })[0];
	assert.equal(output.findIndex(sample => !Number.isFinite(sample)), -1);
	assert.equal(output.subarray(48_000).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0), 0);
});

test('Legacy Compressor leaves an entirely silent selection finite and unchanged', () => {
	const output: Float32Array = applyAudacityLegacyCompressor([new Float32Array(72_000)], 48_000)[0];
	assert.equal(output.findIndex(sample => !Number.isFinite(sample)), -1);
	assert.equal(output.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0), 0);
});
