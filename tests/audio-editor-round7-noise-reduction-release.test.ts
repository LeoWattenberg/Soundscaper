/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { audacityLiveEffectLatencyFrames } from '../src/common/editor/audacity-effects/live-capabilities.js';
import { captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { createEffect, effectTailFrames } from '../src/common/editor/effects.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();
const RATE = 48_000;
const FRAMES = RATE;
const RECORDING = Float32Array.from({ length: FRAMES }, (_, frame) => (
	.2 * Math.sin(2 * Math.PI * 1000 * frame / RATE) * Math.min(1, frame / 240, (FRAMES - frame) / 240)
));
const PROFILE = captureAudacityNoiseProfile([RECORDING], RATE);

function peak(samples: Float32Array): number {
	return samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
}

function render(reductionDb: number, output: 'reduce' | 'residue' = 'reduce') {
	const params = { reductionDb, sensitivity: 6, frequencySmoothingBands: 3, output };
	const effect = createEffect('audacity-noise-reduction', { params });
	const latency = audacityLiveEffectLatencyFrames(effect.type, RATE, params);
	const processor = createAudacityLiveProcessor(effect.type, RATE, params, { noiseProfile: PROFILE });
	const input = new Float32Array(FRAMES + latency + 4096);
	input.set(RECORDING);
	const result = new Float32Array(input.length);
	for (let start = 0; start < input.length; start += 128) {
		processor.process([input.subarray(start, start + 128)], [result.subarray(start, start + 128)]);
	}
	return { effect, source: result.subarray(latency, latency + FRAMES), tail: result.subarray(latency + FRAMES) };
}

for (const output of ['reduce', 'residue'] as const) {
	test(`Noise Reduction ${output} declares the physical overlap/add release of a normal recording`, () => {
		const { effect, source, tail } = render(24, output);
		assert.ok(peak(source.subarray(40_000, 47_000)) > .01, 'The processed recording must remain audible.');
		assert.ok(peak(tail.subarray(0, 128)) > .01, 'Spectral filtering creates a real release after the source fade.');
		assert.equal(peak(tail.subarray(2047)), 0, 'One complete FFT window bounds all physical release samples.');
		const declared = effectTailFrames(effect, RATE);
		assert.ok(declared >= 2047, `The rack declares ${declared} frames for its audible overlap/add release.`);
		assert.ok(declared <= 2048, 'The release remains bounded by the spectral window, rather than its buffered latency.');
		assert.ok(peak(tail.subarray(declared - 128)) < .0001, 'The admitted ending must be quiet.');
	});
}

test('zero reduction and an explicitly bypassed rack keep the healthy original duration', () => {
	const { effect, source, tail } = render(0);
	assert.ok(peak(source) > .19);
	assert.deepEqual(source, RECORDING);
	assert.equal(peak(tail), 0);
	assert.equal(effectTailFrames(effect, RATE), 0);
	const wet = createEffect('audacity-noise-reduction', { params: { reductionDb: 24 }, enabled: false });
	assert.equal(effectTailFrames(wet, RATE), 0);
});
