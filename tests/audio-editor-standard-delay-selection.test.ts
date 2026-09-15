/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';
import { applyAudioSelectionEffectAsync, estimateAudioSelectionEffectOutputFrames, estimateAudioSelectionEffectPeakBytes } from '../src/common/editor/selection-effects.js';
import { normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { delayEchoOffsetFrames } from '../src/common/editor/first-party-effects/standard/delay-selection-contract.ts';
import { applyAudacityEffectAsync } from '../src/common/editor/audacity-effects/index.js';

const sampleRate = 8000;
const staffPadRuntime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
const input = [Float32Array.from({ length: 3200 }, (_, frame) => .2 * Math.sin(2 * Math.PI * 200 * frame / sampleRate))];

test('delay selection preserves validated speed and duration controls while retiring grain quality', () => {
	const normalized = normalizeAudioSelectionEffectParams('multi-tap-delay', { pitchMode: 'speed', duration: 'extend', pitchQuality: 'fast' }) as Record<string, unknown>;
	assert.equal(normalized.pitchMode, 'speed');
	assert.equal(normalized.duration, 'extend');
	assert.equal('pitchQuality' in normalized, false);
	assert.throws(() => normalizeAudioSelectionEffectParams('multi-tap-delay', { pitchMode: 'moving-heads' }), /pitchMode/);
	assert.throws(() => normalizeAudioSelectionEffectParams('multi-tap-delay', { duration: 'unknown' }), /duration/);
});

test('delay speed echoes use the same changed-speed result as the existing effect', async () => {
	for (const pitchShift of [-2, 2]) {
		const params = { pitchShift, time: .01, echoes: 1, echoGain: 0, pitchMode: 'speed', duration: 'extend' };
		const output = await applyAudioSelectionEffectAsync('multi-tap-delay', input, sampleRate, params, { staffPadRuntime });
		const expectedEcho = await applyAudacityEffectAsync('audacity-change-speed-pitch', input, sampleRate,
			{ speedPercent: (2 ** (pitchShift / 12) - 1) * 100 }, { staffPadRuntime });
		const start = delayEchoOffsetFrames(params, sampleRate, 1);
		assert.equal(output[0].length, estimateAudioSelectionEffectOutputFrames('multi-tap-delay', input[0].length, params, { sampleRate }));
		assert.ok(Math.abs(output[0].length - Math.max(input[0].length, start + expectedEcho[0].length)) <= 1);
		for (let frame = 0; frame < output[0].length; frame++) {
			const expected = (input[0][frame] ?? 0) + (frame >= start ? expectedEcho[0][frame - start] ?? 0 : 0);
			assert.ok(Math.abs(output[0][frame] - expected) < 1e-6, `echo frame ${frame}`);
		}
	}
});

test('delay extends ordinary echoes on request and keeps the old duration by default', async () => {
	const impulse = [new Float32Array(80)];
	impulse[0][0] = 1;
	const params = { time: .02, echoes: 3, echoGain: 0 };
	const kept = await applyAudioSelectionEffectAsync('multi-tap-delay', impulse, sampleRate, params);
	const extended = await applyAudioSelectionEffectAsync('multi-tap-delay', impulse, sampleRate, { ...params, duration: 'extend' });
	assert.equal(kept[0].length, 80);
	assert.equal(extended[0].length, 560);
	assert.deepEqual(Array.from({ length: extended[0].length }, (_, frame) => frame).filter(frame => extended[0][frame] !== 0), [0, 160, 320, 480]);
});

test('slow successive speed echoes are included in admission and unsafe selections reject before rendering', async () => {
	const params = { pitchShift: -2, echoes: 30, time: 0, pitchMode: 'speed', duration: 'extend' };
	const frames = 320000;
	const expected = estimateAudioSelectionEffectOutputFrames('multi-tap-delay', frames, params, { sampleRate });
	assert.ok(Math.abs(expected / frames - 32) < .001);
	assert.ok(estimateAudioSelectionEffectPeakBytes('multi-tap-delay', frames, params, { sampleRate, channelCount: 4 }) > 512 * 1024 ** 2);
	await assert.rejects(applyAudioSelectionEffectAsync('multi-tap-delay', Array.from({ length: 4 }, () => new Float32Array(frames)), sampleRate, params), /memory limit/);
	await assert.rejects(applyAudioSelectionEffectAsync('multi-tap-delay', input, sampleRate,
		{ ...params, echoes: 1 }, { spectralSelection: {}, staffPadRuntime }), /must keep/);
});

test('speed selection validates channel and native sample-rate limits before rendering', async () => {
	const params = { pitchShift: 2, echoes: 1, time: 0, pitchMode: 'speed', duration: 'keep' };
	for (const channelCount of [0, 1.5, 33, NaN]) {
		assert.throws(() => estimateAudioSelectionEffectPeakBytes('multi-tap-delay', 128, params,
			{ sampleRate, channelCount }), /channelCount/);
	}
	for (const rate of [0, 7999, 192001, NaN, 8000.5]) {
		assert.throws(() => estimateAudioSelectionEffectPeakBytes('multi-tap-delay', 128, params,
			{ sampleRate: rate, channelCount: 2 }), /sampleRate/);
	}
	assert.ok(estimateAudioSelectionEffectPeakBytes('multi-tap-delay', 128, params,
		{ sampleRate: 192000, channelCount: 32 }) < 512 * 1024 ** 2);
	const context = {
		get staffPadRuntime(): typeof staffPadRuntime { throw new Error('Runtime must not be accessed for invalid selection geometry.'); },
	};
	await assert.rejects(applyAudioSelectionEffectAsync('multi-tap-delay',
		Array.from({ length: 33 }, () => new Float32Array(128)), sampleRate, params, context), /channelCount/);
	for (const rate of [192001, 8000.5]) {
		await assert.rejects(applyAudioSelectionEffectAsync('multi-tap-delay', input, rate, params, context), /sampleRate/);
	}
});
