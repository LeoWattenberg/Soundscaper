/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { standardVocoderBandGeometry } from '../src/common/editor/first-party-effects/standard/modulation-definition.ts';
import { createVocoderProcessor } from '../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';

const rate = 48_000;
const modulator = Float32Array.from({ length: rate }, (_, frame) =>
	.15 * [355, 1_300, 5_850].reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * frame / rate), 0));

function carrier(bands: number): Float32Array {
	const { firstFrequency, ratio } = standardVocoderBandGeometry(rate, bands);
	return Float32Array.from({ length: rate }, (_, frame) => {
		let sample = 0;
		for (let band = 0; band < bands; band += 1) sample += .5 / bands * Math.sin(2 * Math.PI * firstFrequency * ratio ** band * frame / rate);
		return sample;
	});
}

function render(input: readonly Float32Array[], bands: number, block = 128): Float32Array[] {
	const processor = createVocoderProcessor({ sampleRate: rate, channelCount: input.length,
		params: { bands, outputMode: 'right-only' } });
	const output = input.map(() => new Float32Array(input[0].length));
	for (let offset = 0; offset < input[0].length; offset += block) {
		const end = Math.min(input[0].length, offset + block);
		processor.processBlock(input.map(channel => channel.subarray(offset, end)),
			output.map(channel => channel.subarray(offset, end)), end - offset);
	}
	return output;
}

for (const bands of [10, 40]) {
	test(`mono Vocoder uses the complete ${bands}-tone carrier in every synthesis band`, () => {
		const mono = render([modulator], bands)[0];
		const stereo = render([modulator, carrier(bands)], bands)[1];
		let maximumDifference = 0;
		for (let frame = rate / 4; frame < rate; frame += 1) {
			maximumDifference = Math.max(maximumDifference, Math.abs(mono[frame] - stereo[frame]));
		}
		assert.ok(maximumDifference < .00003, `Equivalent full carrier differs by ${maximumDifference}`);
	});
}

test('a generated mono carrier remains continuous across render blocks', () => {
	assert.deepEqual(render([modulator], 10, 113), render([modulator], 10, rate));
});

test('an explicit stereo carrier retains its output routing and silent-modulator behavior', () => {
	const stereo = render([modulator, carrier(10)], 10);
	assert.deepEqual(stereo[0], stereo[1]);
	assert.ok(stereo[1].some(sample => Math.abs(sample) > .2));
	assert.ok(render([new Float32Array(rate), carrier(10)], 10)[1].every(sample => sample === 0));
});
