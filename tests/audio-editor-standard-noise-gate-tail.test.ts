/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect, effectTailFrames } from '../src/common/editor/effects.js';
import { resolveRenderTailSeconds } from '../src/common/editor/engine/rendering-range.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { createNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';
import { standardNoiseGateTailSeconds } from '../src/common/editor/first-party-effects/standard/noise-gate-definition.ts';

test('gate release contract follows its exact crossover poles and reduction range', () => {
	const fullReduction = standardNoiseGateTailSeconds({ gateFrequency: 100, rangeDb: -100 });
	assert.ok(fullReduction > standardNoiseGateTailSeconds({ gateFrequency: 100, rangeDb: -.1 }));
	assert.ok(standardNoiseGateTailSeconds({ gateFrequency: 20 }) > fullReduction);
	assert.equal(fullReduction, standardNoiseGateTailSeconds({ gateFrequency: 100, rangeDb: -100, release: 4, hold: 2 }));
	assert.throws(() => standardNoiseGateTailSeconds({ gateFrequency: 4000, rangeDb: 0 }, 8000), /Nyquist/);
	assert.throws(() => standardNoiseGateTailSeconds({ gateFrequency: 0 }, NaN), /sample rate/);
	assert.equal(standardNoiseGateTailSeconds({ gateFrequency: 0, rangeDb: -100 }), 0);
});

test('frequency-selective gate tails retain genuine silent crossover release below -80 dB', () => {
	for (const [sampleRate, gateFrequency, frequency] of [[48000, 100, 50], [48000, 20, 5], [8000, 3999, 1000], [8000, 2000, 500]]) {
		const params = { threshold: -6, rangeDb: -100, gateFrequency, lookahead: 0 };
		const tailFrames = effectTailFrames(createEffect('noise-gate', { params }), sampleRate);
		assert.ok(tailFrames > 0, 'a closed gate retains its crossover filter history after the source stops');
		const frames = sampleRate + tailFrames + 128;
		const input = Float32Array.from({ length: frames }, (_, frame) => frame < sampleRate
			? .4 * Math.sin(2 * Math.PI * frequency * frame / sampleRate) : 0);
		const output = [new Float32Array(frames), new Float32Array(frames)];
		createNoiseGateProcessor({ sampleRate, channelCount: 2, params }).processBlock([input], output, frames);
		assert.ok(Math.abs(output[0][sampleRate]) > .001, 'the source end would truncate a real waveform without a tail');
		assert.ok(output[0].subarray(sampleRate + tailFrames).every(sample => Number.isFinite(sample) && Math.abs(sample) < .0001));
		assert.ok(output[1].every(sample => sample === 0), 'the silent neighboring channel stays silent');
	}
});

test('gate rack tails preserve the render cap while broadband and transparent gates remain tail-free', () => {
	const sampleRate = 48000;
	const params = { gateFrequency: .1, rangeDb: -100 };
	const effect = createEffect('noise-gate', { params });
	assert.ok(effectTailFrames(effect, sampleRate) > sampleRate * 10);
	const project: EngineProject = { sampleRate, tracks: [{ id: 'track-1', type: 'audio', effects: [effect] }] };
	assert.equal(resolveRenderTailSeconds(project, true), 10);
	assert.equal(resolveRenderTailSeconds(project, false), 0);
	assert.equal(effectTailFrames(createEffect('noise-gate', { params: { gateFrequency: 0 } }), sampleRate), 0);
	assert.equal(effectTailFrames(createEffect('noise-gate', { params: { gateFrequency: 100, rangeDb: 0 } }), sampleRate), 0);
	assert.equal(effectTailFrames(createEffect('noise-gate', { enabled: false, params }), sampleRate), 0);
});

test('noise gate selection keeps its fixed frame count despite an automatic rack release tail', () => {
	const sampleRate = 48000;
	const params = { gateFrequency: 100, rangeDb: -100 };
	const input = [Float32Array.from({ length: 257 }, (_, frame) => .4 * Math.sin(2 * Math.PI * 50 * frame / sampleRate))];
	assert.ok(effectTailFrames(createEffect('noise-gate', { params }), sampleRate) > input[0].length);
	const output = applyStandardEffect('noise-gate', input, sampleRate, params);
	assert.equal(output.length, input.length);
	assert.equal(output[0].length, input[0].length);
});
