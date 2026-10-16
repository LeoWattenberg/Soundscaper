/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { createEffect, effectTailFrames, rackTailFrames } from '../src/common/editor/effects.js';

const CASES = [
	{
		type: 'audacity-bass-treble', frequency: 40,
		params: { bassDb: 30, trebleDb: 0, volumeDb: -30 },
	},
	{
		type: 'audacity-wahwah', frequency: 60,
		params: { frequency: .1, phaseDegrees: 180, depthPercent: 0,
			resonance: 10, frequencyOffsetPercent: 0, outputGainDb: -24 },
	},
] as const;

for (const { type, frequency, params } of CASES) {
	for (const [sampleRate, channelCount] of [[48_000, 2], [96_000, 1]] as const) {
		test(`${type} reserves and completes its audible shelf/filter release at ${String(sampleRate)} Hz`, () => {
			const effect = createEffect(type, { params });
			const processor = createAudacityLiveProcessor(type, sampleRate, params);
			const recordingFrequency = type === 'audacity-wahwah' ? frequency * sampleRate / 48_000 : frequency;
			const input = Float32Array.from({ length: sampleRate }, (_value, frame) => (
				.5 * Math.sin(2 * Math.PI * recordingFrequency * frame / sampleRate)
				* Math.min(1, frame / 128, (sampleRate - 1 - frame) / 128)
			));
			processor.process(Array.from({ length: channelCount }, () => input),
				Array.from({ length: channelCount }, () => new Float32Array(sampleRate)));
			const firstRelease = Array.from({ length: channelCount }, () => new Float32Array(128));
			processor.process(Array.from({ length: channelCount }, () => new Float32Array(128)), firstRelease);
			assert.ok(firstRelease.every(channel => channel.some(sample => Math.abs(sample) > .1)),
				'An ordinary recording with its edge fade still leaves real audible filter state.');
			const declared = effectTailFrames(effect, sampleRate);
			assert.ok(declared > 128, 'Include tails must reserve the charged filter release.');
			assert.equal(processor.tailFrames, declared);
			assert.equal(rackTailFrames([effect], sampleRate), Math.min(declared, sampleRate * 10));
			const release = Array.from({ length: channelCount }, () => new Float32Array(declared + 128));
			processor.process(Array.from({ length: channelCount }, () => new Float32Array(declared + 128)), release);
			assert.ok(release.every(channel => channel.subarray(declared).every(sample => (
				Number.isFinite(sample) && Math.abs(sample) < .0001
			))), 'The reserved ending must contain a completed, finite release.');
		});
	}
}

test('neutral Bass and Treble and output-only gain keep the original duration', () => {
	for (const volumeDb of [-30, 0, 30]) {
		assert.equal(effectTailFrames(createEffect('audacity-bass-treble', {
			params: { bassDb: 0, trebleDb: 0, volumeDb },
		}), 48_000), 0);
	}
});

test('bypassing either Audacity filter keeps the original duration', () => {
	for (const { type, params } of CASES) {
		assert.equal(effectTailFrames(createEffect(type, { enabled: false, params }), 48_000), 0);
	}
});

test('the normal varying Wahwah LFO reserves the existing rack budget and releases real state', () => {
	const sampleRate = 48_000;
	const params = { frequency: 1.5, depthPercent: 70, resonance: 10, outputGainDb: -24 };
	const effect = createEffect('audacity-wahwah', { params });
	const processor = createAudacityLiveProcessor('audacity-wahwah', sampleRate, params);
	const input = Float32Array.from({ length: sampleRate }, (_value, frame) => (
		.5 * Math.sin(2 * Math.PI * 1000 * frame / sampleRate)
	));
	processor.process([input], [new Float32Array(sampleRate)]);
	const reserved = rackTailFrames([effect], sampleRate);
	assert.equal(reserved, sampleRate * 10);
	const release = new Float32Array(reserved);
	processor.process([new Float32Array(reserved)], [release]);
	assert.ok(release.subarray(0, 128).some(sample => Math.abs(sample) > .0001));
	assert.ok(release.subarray(-128).every(sample => Number.isFinite(sample) && Math.abs(sample) < .0001));
});

test('a Nyquist-only shelf and Wahwah’s identity frequency retain the original duration', () => {
	assert.equal(effectTailFrames(createEffect('audacity-bass-treble', {
		params: { trebleDb: 30 },
	}), 8000), 0);
	assert.equal(effectTailFrames(createEffect('audacity-wahwah', {
		params: { frequencyOffsetPercent: 100 },
	}), 48_000), 0);
});
