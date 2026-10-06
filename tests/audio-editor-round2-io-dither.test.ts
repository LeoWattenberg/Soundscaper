/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSeededRandom, pcmDitherNoise } from '../src/common/editor/pcm-dither.js';

test('high-pass triangular export dither retains TPDF power and linearizes quiet quantization', () => {
	const random = createSeededRandom(20261006);
	const state = new Float64Array(1);
	const samples = 200_000;
	let power = 0;
	let previous = 0;
	let correlation = 0;
	let changedSilence = 0;
	let quarterLsbOutput = 0;
	for (let index = 0; index < samples; index += 1) {
		const noise = pcmDitherNoise('triangular-highpass', random, 0, state) as number;
		power += noise * noise;
		correlation += noise * previous;
		previous = noise;
		if (Math.round(noise) !== 0) changedSilence += 1;
		quarterLsbOutput += Math.round(0.25 + noise);
	}
	assert.ok(Math.abs(power / samples - 1 / 6) < 0.004, `power ${String(power / samples)} LSB²`);
	assert.ok(Math.abs(correlation / power + 0.5) < 0.02, 'the same power is shifted away from DC');
	assert.ok(Math.abs(changedSilence / samples - 0.25) < 0.015, 'the output has the triangular probability distribution');
	assert.ok(Math.abs(quarterLsbOutput / samples - 0.25) < 0.01, 'sub-LSB signal level is retained on average');
});
