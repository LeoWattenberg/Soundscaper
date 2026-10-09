/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBitcrusherProcessor } from '../src/common/editor/first-party-effects/bitcrusher/dsp.js';

function render(downsampling: number, block = 128): Float32Array {
	const input = Float32Array.from({ length: 256 }, (_, frame) => frame / 512);
	const output = new Float32Array(input.length);
	const processor = createBitcrusherProcessor({ channelCount: 1,
		params: { downsampling, bitDepth: 16, interpolation: 'sample-hold', dither: 'none', mix: 100 } });
	for (let offset = 0; offset < input.length; offset += block) {
		const end = Math.min(input.length, offset + block);
		processor.processBlock([input.subarray(offset, end)], [output.subarray(offset, end)], end - offset);
	}
	return output;
}

for (const downsampling of [6, 7, 10]) {
	test(`Bitcrusher captures every authored ${downsampling}-frame hold boundary`, () => {
		const output = render(downsampling);
		for (let frame = 0; frame < output.length; frame += 1) {
			const capturedFrame = Math.floor(frame / downsampling) * downsampling;
			const expected = capturedFrame / 512 + 1 / 65_536;
			assert.equal(output[frame], expected, `capture at frame ${frame}`);
		}
	});
}

test('exact binary hold intervals and block continuity retain their authored grid', () => {
	const output = render(8, 19);
	assert.deepEqual(output, render(8, 256));
	for (let frame = 0; frame < output.length; frame += 1) {
		assert.equal(output[frame], Math.floor(frame / 8) * 8 / 512 + 1 / 65_536);
	}
});

test('an ordinary fractional hold places captures at each next whole sample', () => {
	const output = render(2.5, 19);
	assert.deepEqual(output, render(2.5, 256));
	for (let capture = 1; capture < 100; capture += 1) {
		const frame = Math.ceil(capture * 2.5);
		assert.notEqual(output[frame], output[frame - 1]);
	}
});
