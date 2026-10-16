/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ComplementaryCrossover } from '../src/common/editor/complementary-crossover.ts';
import { applyMultibandCompressor } from '../src/common/editor/first-party-effects/multiband-compressor/dsp.ts';

function rms(samples: Float32Array): number {
	return Math.sqrt(samples.reduce((power, value) => power + value * value, 0) / samples.length);
}

for (const [sampleRate, cutoff] of [[8_000, 3_800], [16_000, 7_600], [32_000, 15_200], [48_000, 6_000]] as const) {
	test(`Multiband's authored ${String(cutoff)} Hz crossover retains its response at ${String(sampleRate)} Hz`, () => {
		const input = Float32Array.from({ length: sampleRate }, (_, frame) => .4 * Math.sin(2 * Math.PI * cutoff * frame / sampleRate));
		const output = applyMultibandCompressor([input], sampleRate, {
			highCrossover: cutoff, lowRatio: 1, midRatio: 1, highRatio: 1, lowGain: -12, midGain: -12,
		})[0]!;
		const actual = rms(output.subarray(sampleRate / 4)) / rms(input.subarray(sampleRate / 4));
		const expected = Math.sqrt((1 + 10 ** (-12 / 10)) / 2);
		assert.ok(Math.abs(actual - expected) < 1e-6, `the ${String(cutoff)} Hz setting delivers gain ${String(actual)} instead of ${String(expected)}`);
	});
}

test('a live valid crossover change converges to its authored half-power frequency', () => {
	const sampleRate = 8_000;
	const frequency = 3_800;
	const processor = new ComplementaryCrossover(sampleRate, 1, 1_000);
	processor.configure(frequency);
	const input = Float32Array.from({ length: sampleRate }, (_, frame) => .4 * Math.sin(2 * Math.PI * frequency * frame / sampleRate));
	const output = new Float32Array(input.length);
	for (let frame = 0; frame < input.length; frame++) {
		processor.tick(); output[frame] = processor.low(input[frame]!, 0);
	}
	const actual = rms(output.subarray(sampleRate / 2)) / rms(input.subarray(sampleRate / 2));
	assert.ok(Math.abs(actual - Math.SQRT1_2) < 1e-6, `the live cutoff's half-power gain is ${String(actual)}`);
});

test('unsupported above-Nyquist crossover settings retain the existing finite safety fallback', () => {
	const sampleRate = 8_000;
	const processor = new ComplementaryCrossover(sampleRate, 1, 16_000);
	const expected = new ComplementaryCrossover(sampleRate, 1, sampleRate * .45);
	for (let frame = 0; frame < sampleRate; frame++) {
		const input = .4 * Math.sin(frame * .37);
		const actual = processor.low(input, 0);
		assert.ok(Number.isFinite(actual));
		assert.equal(actual, expected.low(input, 0));
	}
});
