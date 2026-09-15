/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect, effectTailFrames, rackTailFrames } from '../src/common/editor/effects.js';
import { resolveRenderTailSeconds } from '../src/common/editor/engine/rendering-range.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { standardVocoderTailSeconds } from '../src/common/editor/first-party-effects/standard/modulation-definition.ts';
import { createVocoderProcessor } from '../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';
import { estimateAudioSelectionEffectOutputFrames } from '../src/common/editor/selection-effects.js';

const sampleRate = 8000;
function rms(samples: Float32Array, from: number, to: number): number {
	let sum = 0;
	for (let frame = from; frame < to; frame += 1) sum += samples[frame] ** 2;
	return Math.sqrt(sum / (to - from));
}

test('vocoder release estimate follows filter bandwidth, envelope smoothing and output gain', () => {
	const normal = standardVocoderTailSeconds({}, sampleRate);
	const narrow = standardVocoderTailSeconds({ bands: 240 }, sampleRate);
	assert.ok(narrow > normal, 'narrow filters have slower ringing decay');
	assert.ok(standardVocoderTailSeconds({ bands: 240, distance: 120 }, sampleRate) > narrow, 'slow envelope poles extend release');
	assert.ok(standardVocoderTailSeconds({ distance: 1 }, sampleRate) < normal);
	assert.ok(standardVocoderTailSeconds({ outputGain: 24 }, sampleRate) > normal);
	assert.ok(standardVocoderTailSeconds({ outputGain: -24 }, sampleRate) < normal);
	assert.ok(standardVocoderTailSeconds({ noiseLevel: 100, radarLevel: 100 }, sampleRate) > normal);
	assert.equal(standardVocoderTailSeconds({ carrierLevel: 0, noiseLevel: 0, radarLevel: 0 }, sampleRate), 0);
	assert.ok(standardVocoderTailSeconds({ carrierLevel: 0, noiseLevel: 100 }, sampleRate) > 0);
	assert.ok(standardVocoderTailSeconds({ carrierLevel: 0, radarLevel: 100 }, sampleRate) > 0);
	assert.throws(() => standardVocoderTailSeconds({}, Number.NaN), /sample rate/);
	assert.throws(() => standardVocoderTailSeconds({}, 7999), /sample rate/);
	assert.throws(() => standardVocoderTailSeconds({ bands: 241 }, sampleRate), /bands/);
	for (const rate of [8000, 44100, 48000, 96000, 384000]) {
		assert.ok(Number.isFinite(standardVocoderTailSeconds({ bands: 240, distance: 120, outputGain: 24 }, rate)));
	}
});

test('vocoder tail estimates include actual silent release through high-band and slow-envelope settings', () => {
	for (const { params, channelCount, frequency } of [
		{ params: {}, channelCount: 1, frequency: 110 },
		{ params: { bands: 240 }, channelCount: 1, frequency: 110 },
		{ params: { bands: 240, distance: 120, outputGain: 24, noiseLevel: 100, radarLevel: 100 }, channelCount: 2, frequency: 20 },
	]) {
		const effect = createEffect('vocoder', { params });
		const tailFrames = effectTailFrames(effect, sampleRate);
		assert.equal(tailFrames, Math.ceil(standardVocoderTailSeconds(params, sampleRate) * sampleRate));
		assert.ok(tailFrames > 0, 'automatic tails must not cut the vocoder at the source end');
		const frames = sampleRate + tailFrames + Math.round(sampleRate * .2);
		const input = Array.from({ length: channelCount }, () => new Float32Array(frames));
		for (let frame = 0; frame < sampleRate; frame += 1) {
			for (const channel of input) channel[frame] = .8 * Math.sin(2 * Math.PI * frequency * frame / sampleRate);
		}
		const output = input.map(() => new Float32Array(frames));
		createVocoderProcessor({ sampleRate, channelCount, params }).processBlock(input, output, frames);
		const vocoded = output[channelCount - 1];
		assert.ok(rms(vocoded, sampleRate, sampleRate + 800) > .001, 'release is audible after the source stops');
		assert.ok(vocoded.subarray(sampleRate + tailFrames).every(sample => Number.isFinite(sample) && Math.abs(sample) < .0001),
			'the conservative estimate extends beyond the audible release');
	}
});

test('vocoder renderer uses automatic release tails while preserving the 10-second cap and opt-out', () => {
	const normal = createEffect('vocoder');
	const slow = createEffect('vocoder', { params: { bands: 240, distance: 120, outputGain: 24 } });
	for (const effect of [normal, slow]) {
		const project: EngineProject = { sampleRate, tracks: [{ id: 'track-1', type: 'audio', effects: [effect] }] };
		const expected = Math.min(10, effectTailFrames(effect, sampleRate) / sampleRate);
		assert.ok(expected > 0);
		assert.equal(resolveRenderTailSeconds(project, true), expected);
		assert.equal(rackTailFrames([effect], sampleRate), Math.round(expected * sampleRate));
		assert.equal(resolveRenderTailSeconds(project, false), 0);
		assert.equal(resolveRenderTailSeconds(project, 20), 10);
	}
	assert.ok(effectTailFrames(slow, sampleRate) > 10 * sampleRate);
	assert.equal(effectTailFrames(createEffect('vocoder', { enabled: false }), sampleRate), 0);
	assert.equal(effectTailFrames(createEffect('vocoder', { params: { carrierLevel: 0, noiseLevel: 0, radarLevel: 0 } }), sampleRate), 0);
});

test('vocoder selection processing retains fixed frame count despite its reported rack tail', () => {
	const input = [Float32Array.from({ length: 256 }, (_, frame) => .8 * Math.sin(2 * Math.PI * 110 * frame / sampleRate))];
	const params = { bands: 240, distance: 120 };
	assert.ok(effectTailFrames(createEffect('vocoder', { params }), sampleRate) > input[0].length);
	assert.equal(estimateAudioSelectionEffectOutputFrames('vocoder', input[0].length, params), input[0].length);
	const processed = applyStandardEffect('vocoder', input, sampleRate, params);
	assert.equal(processed.length, input.length);
	assert.equal(processed[0].length, input[0].length);
});
