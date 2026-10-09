/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityClassicFilter } from '../src/common/editor/audacity-effects/realtime.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';

const RATE = 48_000;
const FREQUENCY = 23_999;
const FRAMES = RATE * 4;
const input = Float32Array.from({ length: FRAMES }, (_, frame) => .5 * Math.sin(2 * Math.PI * FREQUENCY * frame / RATE));

function toneAmplitude(samples: Float32Array): number {
	const start = RATE * 2;
	let real = 0, imaginary = 0;
	for (let frame = start; frame < samples.length; frame++) {
		const phase = 2 * Math.PI * FREQUENCY * frame / RATE;
		real += samples[frame]! * Math.cos(phase);
		imaginary -= samples[frame]! * Math.sin(phase);
	}
	return 2 * Math.hypot(real, imaginary) / (samples.length - start);
}

for (const direction of ['lowpass', 'highpass'] as const) {
	const params = { family: 'butterworth', direction, order: 1, cutoffHz: FREQUENCY };
	test(`Classic Filters selection ${direction} honors the authored supported near-Nyquist cutoff`, () => {
		const actual = toneAmplitude(applyAudacityClassicFilter([input], RATE, params)[0]!);
		assert.ok(Math.abs(actual - .5 / Math.sqrt(2)) < .0001,
			`The stated cutoff must be the -3 dB point; observed amplitude ${actual}.`);
	});
	test(`Classic Filters live ${direction} honors the same near-Nyquist cutoff`, () => {
		const processor = createAudacityLiveProcessor('audacity-classic-filters', RATE, params);
		const output = new Float32Array(FRAMES);
		for (let start = 0; start < FRAMES; start += 128) processor.process([input.subarray(start, start + 128)], [output.subarray(start, start + 128)]);
		const actual = toneAmplitude(output);
		assert.ok(Math.abs(actual - .5 / Math.sqrt(2)) < .0001,
			`The rack and Apply must share the exact authored -3 dB point; observed ${actual}.`);
	});
}
