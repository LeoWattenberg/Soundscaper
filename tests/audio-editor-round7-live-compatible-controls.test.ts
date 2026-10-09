/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { createEffect } from '../src/common/editor/effects.js';
import { nativeRackEffectCommit, supportsLiveRackEffectGesture } from '../src/common/editor/ui/inspector/live-rack-effect-gesture.ts';

const RATE = 48_000;
const TYPES = ['audacity-bass-treble', 'audacity-phaser', 'audacity-wahwah',
	'audacity-distortion', 'audacity-classic-filters', 'audacity-noise-reduction', 'audacity-auto-duck'] as const;
const PROFILE = { type: 'audacity-noise-profile', version: 1, sampleRate: RATE,
	windowSize: 2048, stepsPerWindow: 4, meanPowers: new Float32Array(1025) };
interface LiveProcessor {
	process(input: Float32Array[], output: Float32Array[], control?: Float32Array[]): boolean;
	updateParams(params: Readonly<Record<string, unknown>>): void;
	reset(): void;
}
function tone(frames: number, offset = 0): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => .6 * Math.sin(2 * Math.PI * 1000 * (offset + frame) / RATE));
}

for (const type of TYPES) {
	test(`${type} ordinary rack controls admit a compatible live edit`, async () => {
		const effect = createEffect(type);
		assert.equal(supportsLiveRackEffectGesture(effect, {}), true);
		assert.equal(supportsLiveRackEffectGesture({ ...effect, enabled: false }, {}), false);
		assert.equal(supportsLiveRackEffectGesture({ ...effect, bypassed: true }, {}), false);
		const calls: unknown[] = [];
		const commit = nativeRackEffectCommit(effect, {}, () => { calls.push('begin'); }, params => { calls.push(params); });
		assert.ok(commit);
		await commit();
		assert.deepEqual(calls, ['begin', effect.params]);
	});

	test(`${type} retains its entire running history when republishing the current control value`, () => {
		const params = type === 'audacity-noise-reduction' ? { reductionDb: 0 }
			: type === 'audacity-distortion' ? { dcBlock: true }
			: type === 'audacity-bass-treble' ? { bassDb: 12 } : {};
		const changed = createAudacityLiveProcessor(type, RATE, params, { noiseProfile: PROFILE }) as LiveProcessor;
		const reference = createAudacityLiveProcessor(type, RATE, params, { noiseProfile: PROFILE }) as LiveProcessor;
		const frames = type === 'audacity-auto-duck' ? 65_536 : 12_288;
		for (const processor of [changed, reference]) processor.process([tone(frames)], [new Float32Array(frames)], [tone(frames)]);
		changed.updateParams({});
		const actual = new Float32Array(1024), expected = new Float32Array(1024);
		changed.process([tone(1024, frames)], [actual], [tone(1024, frames)]);
		reference.process([tone(1024, frames)], [expected], [tone(1024, frames)]);
		assert.ok(expected.some(sample => Math.abs(sample) > .001), 'The reference must still contain audible material.');
		assert.ok(actual.every((sample, index) => Object.is(sample, expected[index])),
			'Every pending audio sample and filter history must retain its clock.');
	});
}

test('Noise Reduction retains queued audio when Sensitivity changes with zero reduction', () => {
	const processor = createAudacityLiveProcessor('audacity-noise-reduction', RATE,
		{ reductionDb: 0 }, { noiseProfile: PROFILE }) as LiveProcessor;
	processor.process([tone(12_288)], [new Float32Array(12_288)]);
	processor.updateParams({ sensitivity: 7 });
	const actual = new Float32Array(1024);
	processor.process([tone(1024, 12_288)], [actual]);
	assert.ok(Math.sqrt(actual.reduce((sum, sample) => sum + sample ** 2, 0) / actual.length) > .4);
	processor.reset();
	processor.process([tone(1024)], [actual]);
	assert.ok(actual.every(sample => sample === 0), 'An explicit transport reset still clears pending audio.');
});

for (const type of ['audacity-phaser', 'audacity-wahwah'] as const) {
	test(`${type} keeps the current modulation phase when its live frequency changes`, () => {
		const processor = createAudacityLiveProcessor(type, RATE, { frequency: 1, phaseDegrees: 0 });
		processor.process([tone(4800)], [new Float32Array(4800)]);
		processor.updateParams({ frequency: 2 });
		processor.process([tone(600, 4800)], [new Float32Array(600)]);
		processor.updateParams({ frequency: .5 });
		processor.process([tone(600, 5400)], [new Float32Array(600)]);
		processor.updateParams({ frequency: .5 });
		processor.updateParams({ frequency: 1.5 });
		processor.process([tone(1, 6000)], [new Float32Array(1)]);
		const phase = (4800 * 1 + 600 * 2 + 600 * .5 + 1.5) * 2 * Math.PI / RATE;
		const state = processor.states[0];
		if (type === 'audacity-phaser') {
			const shaped = Math.expm1((1 + Math.cos(phase)) / 2 * 4) / Math.expm1(4);
			assert.ok(Math.abs(state.gain - (1 - shaped / 255 * processor.params.depth)) < 1e-12);
		} else {
			const center = ((1 + Math.cos(phase)) / 2 * processor.depth * (1 - processor.offset) + processor.offset);
			assert.ok(Math.abs(state.a1 + 2 * Math.cos(Math.PI * Math.exp((center - 1) * 6))) < 1e-12);
		}
	});
}
