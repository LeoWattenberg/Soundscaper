/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAudioChannels } from '../src/common/editor/analysis.js';
import { applyAudacityLoudnessNormalization } from '../src/common/editor/audacity-effects/basic.js';

const rate = 48_000;
const tone = (frequency: number, amplitude: number): Float32Array<ArrayBuffer> => Float32Array.from(
	{ length: rate }, (_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * frame / rate));
const settings = { targetLufs: -23, dualMono: false, stereoIndependent: false };

function maximumDifference(first: Float32Array, second: Float32Array): number {
	let maximum = 0;
	for (let frame = 0; frame < first.length; frame += 1) maximum = Math.max(maximum, Math.abs(first[frame] - second[frame]));
	return maximum;
}

test('linked 5.1 loudness normalization excludes LFE when choosing the programme gain', () => {
	const input = Array.from({ length: 6 }, () => new Float32Array(rate));
	input[0] = tone(1000, .1);
	const withoutLfe = applyAudacityLoudnessNormalization(input, rate, settings);
	input[3] = tone(100, .4);
	const withLfe = applyAudacityLoudnessNormalization(input, rate, settings);
	const difference = maximumDifference(withLfe[0], withoutLfe[0]);
	assert.equal(difference, 0, 'LFE must not change the audible programme gain');
	assert.ok(Math.abs(Number(analyzeAudioChannels(withLfe, rate).integratedLufs) + 23) < .05);
	assert.ok(withLfe[3].some((sample: number) => Math.abs(sample) > .1), 'Preserve and scale the LFE samples');
});

for (const count of [5, 6]) {
	test(`linked ${count}-channel loudness normalization applies surround weighting`, () => {
		const input = Array.from({ length: count }, () => new Float32Array(rate));
		input[count - 1] = tone(1000, .1);
		const output = applyAudacityLoudnessNormalization(input, rate, settings);
		const loudness = analyzeAudioChannels(output, rate).integratedLufs;
		assert.ok(Math.abs(Number(loudness) + 23) < .05, `Delivered ${String(loudness)} LUFS`);
	});
}

test('linked mono and stereo programme normalization keep their existing target', () => {
	for (const channels of [[tone(1000, .1)], [tone(1000, .1), tone(1500, .05)]]) {
		const output = applyAudacityLoudnessNormalization(channels, rate, settings);
		assert.ok(Math.abs(Number(analyzeAudioChannels(output, rate).integratedLufs) + 23) < .05);
	}
});

test('a 5.1 recording containing only LFE has no programme loudness to normalize', () => {
	const input = Array.from({ length: 6 }, () => new Float32Array(rate));
	input[3] = tone(100, .4);
	const output = applyAudacityLoudnessNormalization(input, rate, settings);
	for (const [channel, samples] of output.entries()) assert.equal(maximumDifference(samples, input[channel]), 0);
});
