/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect, effectTailFrames } from '../src/common/editor/effects.js';
import { createDeesserProcessor } from '../src/common/editor/first-party-effects/deesser/dsp.ts';
import { createMultibandCompressorProcessor } from '../src/common/editor/first-party-effects/multiband-compressor/dsp.ts';

const RATE = 48_000;
const configurations = [
	{ type: 'deesser', frequency: 1000, params: { frequency: 1000, threshold: -60, reduction: 24,
		attack: .0001, release: 1 }, create: createDeesserProcessor },
	{ type: 'multiband-compressor', frequency: 40, params: { lowCrossover: 40, highCrossover: 2500,
		lowRatio: 1, midRatio: 1, highRatio: 1, lowGain: 12, midGain: -12, highGain: 0 },
		create: createMultibandCompressorProcessor },
] as const;

for (const configuration of configurations) {
	for (const channelCount of [1, 2]) {
		test(`${configuration.type} reserves its audible ${channelCount}-channel crossover release`, () => {
			const processor = configuration.create({ sampleRate: RATE, channelCount, params: configuration.params });
			const input = Array.from({ length: channelCount }, (_, channel) => Float32Array.from({ length: RATE },
				(_, frame) => .5 / (channel + 1) * Math.sin(2 * Math.PI * configuration.frequency * frame / RATE)));
			processor.processBlock(input, input.map(() => new Float32Array(RATE)), RATE);
			const ending = input.map(() => new Float32Array(128));
			processor.processBlock(ending, ending, 128);
			assert.ok(ending[0]!.some(sample => Math.abs(sample) > .01), 'The ordinary recording charges an audible crossover release.');
			const declared = effectTailFrames(createEffect(configuration.type, { params: configuration.params }), RATE);
			assert.ok(declared > 0, `Include tails must reserve the physical crossover release, received ${declared}.`);
			processor.reset();
			processor.processBlock(input, input.map(() => new Float32Array(RATE)), RATE);
			const silence = input.map(() => new Float32Array(declared));
			processor.processBlock(silence, silence, declared);
			const settled = input.map(() => new Float32Array(128));
			processor.processBlock(settled, settled, 128);
			assert.ok(settled.every(channel => channel.every(sample => Math.abs(sample) < .0001)),
				'The retained release must settle below -80 dBFS.');
		});
	}
}

for (const sampleRate of [8_000, 192_000]) {
	test(`band dynamics retain releases at the ordinary ${sampleRate} Hz source clock`, () => {
		for (const configuration of configurations) {
			const frequency = sampleRate === 8_000 ? 3999 : 1000;
			const params = { ...configuration.params, ...(configuration.type === 'deesser'
				? { frequency }
				: { highCrossover: sampleRate === 8_000 ? 3999 : 2500 }) };
			const processor = configuration.create({ sampleRate, channelCount: 1, params });
			const input = Float32Array.from({ length: sampleRate }, (_, frame) =>
				.5 * Math.sin(2 * Math.PI * (configuration.type === 'deesser' ? frequency : 40) * frame / sampleRate));
			processor.processBlock([input], [new Float32Array(sampleRate)], sampleRate);
			const declared = effectTailFrames(createEffect(configuration.type, { params }), sampleRate);
			assert.ok(declared > 128, 'The genuine crossover release must survive Include tails.');
			const silence = new Float32Array(declared);
			const output = new Float32Array(declared);
			processor.processBlock([silence], [output], declared);
			assert.ok(output.subarray(-128).every(sample => Math.abs(sample) < .0001));
		}
	});
}

test('neutral band dynamics retain the exact dry duration', () => {
	assert.equal(effectTailFrames(createEffect('deesser', { params: { reduction: 0 } }), RATE), 0);
	assert.equal(effectTailFrames(createEffect('multiband-compressor',
		{ params: { lowRatio: 1, midRatio: 1, highRatio: 1 } }), RATE), 0);
	for (const configuration of configurations) {
		const effect = createEffect(configuration.type, { params: configuration.params });
		assert.equal(effectTailFrames({ ...effect, enabled: false }, RATE), 0);
	}
});
