/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { createEffect, effectTailFrames, rackTailFrames } from '../src/common/editor/effects.js';

for (const [sampleRate, channelCount] of [[8000, 1], [48000, 2]] as const) {
	test(`Phaser reserves and completes its independent feedback release at ${String(sampleRate)} Hz`, () => {
		const params = { depth: 0, feedbackPercent: 100, dryWet: 255, outputGainDb: -30 };
		const processor = createAudacityLiveProcessor('audacity-phaser', sampleRate, params);
		const input = Float32Array.from({ length: sampleRate }, (_value, frame) => (
			.1 * Math.sin(2 * Math.PI * 40 * frame / sampleRate)
			* Math.min(1, frame / 128, (sampleRate - 1 - frame) / 128)
		));
		const output = Array.from({ length: channelCount }, () => new Float32Array(sampleRate));
		processor.process(Array.from({ length: channelCount }, () => input), output);
		assert.ok(output.every(channel => channel.some(sample => Math.abs(sample) > .02)),
			'The normal recording must first charge a healthy sounding feedback loop.');
		const first = Array.from({ length: channelCount }, () => new Float32Array(128));
		processor.process(Array.from({ length: channelCount }, () => new Float32Array(128)), first);
		assert.ok(first.every(channel => channel.some(sample => Math.abs(sample) > .001)),
			'Feedback retains audible state after the ordinary source edge fade.');
		const effect = createEffect('audacity-phaser', { params });
		const declared = effectTailFrames(effect, sampleRate);
		assert.ok(declared > 128, 'Include tails must reserve this delayed feedback state.');
		assert.equal(processor.tailFrames, declared);
		assert.equal(rackTailFrames([effect], sampleRate), declared);
		const release = Array.from({ length: channelCount }, () => new Float32Array(declared));
		processor.process(Array.from({ length: channelCount }, () => new Float32Array(declared)), release);
		assert.ok(release.every(channel => channel.subarray(-128).every(sample => (
			Number.isFinite(sample) && Math.abs(sample) < .0001
		))), 'The declared ending must complete the actual physical feedback release.');
	});
}

test('depth-zero Phaser follows the independently delayed feedback transfer', () => {
	for (const feedbackPercent of [-100, -50, 0, 50, 100]) {
		const params = { depth: 0, feedbackPercent, dryWet: 255, outputGainDb: 0 };
		const input = Float32Array.from({ length: 2048 }, (_value, frame) => (
			.1 * Math.sin(2 * Math.PI * 1200 * frame / 48000)
		));
		const output = new Float32Array(input.length);
		const processor = createAudacityLiveProcessor('audacity-phaser', 48000, params);
		processor.process([input], [output]);
		let expected = 0;
		for (let frame = 0; frame < input.length; frame++) {
			expected = input[frame]! + feedbackPercent / 101 * expected;
			assert.ok(Math.abs(output[frame]! - expected) < .000001,
				'Even depth-zero all-pass stages are identity; the feedback still delays one sample.');
		}
	}
});

test('dry-only, bypassed and neutral Phaser reserve no inaudible release', () => {
	for (const effect of [
		createEffect('audacity-phaser', { params: { dryWet: 0, feedbackPercent: 100 } }),
		createEffect('audacity-phaser', { params: { depth: 0, feedbackPercent: 0 } }),
		createEffect('audacity-phaser', { enabled: false, params: { feedbackPercent: 100 } }),
	]) assert.equal(effectTailFrames(effect, 48000), 0);
});

for (const params of [
	{ depth: 70, stages: 2, frequency: 1.5, feedbackPercent: 100, dryWet: 255, outputGainDb: -30 },
	{ depth: 255, stages: 24, frequency: 4, feedbackPercent: -100, dryWet: 255, outputGainDb: -30 },
	{ depth: 0, stages: 24, frequency: 4, feedbackPercent: -100, dryWet: 255, outputGainDb: 30 },
	{ depth: 0, stages: 2, frequency: .001, feedbackPercent: 100, dryWet: 1, outputGainDb: 30 },
] as const) {
	test(`Phaser completes physical release with depth ${String(params.depth)}, stages ${String(params.stages)} and feedback ${String(params.feedbackPercent)}`, () => {
		const sampleRate = 48_000;
		const processor = createAudacityLiveProcessor('audacity-phaser', sampleRate, params);
		const input = Float32Array.from({ length: sampleRate }, (_value, frame) => (
			.1 * Math.sin(2 * Math.PI * 1000 * frame / sampleRate)
			* Math.min(1, frame / 128, (sampleRate - 1 - frame) / 128)
		));
		processor.process([input, input], [new Float32Array(sampleRate), new Float32Array(sampleRate)]);
		const effect = createEffect('audacity-phaser', { params });
		const reserved = rackTailFrames([effect], sampleRate);
		if (params.depth !== 0) assert.equal(reserved, sampleRate * 10);
		else assert.ok(reserved > 128 && reserved < sampleRate * 10);
		const release = [new Float32Array(reserved), new Float32Array(reserved)];
		processor.process([new Float32Array(reserved), new Float32Array(reserved)], release);
		assert.ok(release.some(channel => channel.subarray(0, 128).some(sample => Math.abs(sample) > .0001)),
			'The stereo recording first leaves actual audible state.');
		assert.ok(release.every(channel => channel.subarray(-128).every(sample => (
			Number.isFinite(sample) && Math.abs(sample) < .0001
		))), 'Held modulation, feedback sign, stage count and wet gain preserve the physical ending.');
	});
}
