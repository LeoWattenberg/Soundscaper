/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDeesser, createDeesserProcessor } from '../src/common/editor/first-party-effects/deesser/dsp.ts';
import { audioEffectLabel, audioEffectTypes, audioSelectionEffectTypes, createEffect } from '../src/common/editor/effects.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects-runtime.js';
import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';

const rate = 48_000;
const params = { frequency: 4000, threshold: -30, reduction: 12, attack: 0.001, release: 0.08 };
const tone = (hz: number, amplitude = 0.5, length = rate) => Float32Array.from(
	{ length }, (_, frame) => amplitude * Math.sin(2 * Math.PI * hz * frame / rate),
);
function rms(samples: Float32Array): number {
	return Math.sqrt(samples.subarray(4800).reduce((sum, value) => sum + value * value, 0) / (samples.length - 4800));
}

test('de-esser is named and reachable in the effects menu, selection and rack', () => {
	assert.equal(audioEffectLabel('deesser'), 'De-esser');
	assert.ok(audioEffectTypes().includes('deesser'));
	assert.ok(audioSelectionEffectTypes().includes('deesser'));
	assert.ok(EFFECT_MENU_GROUPS.some(([, types]) => types.includes('deesser')));
	assert.equal(createEffect('deesser').params.frequency, 6000);
});

test('sibilant energy is reduced while the voice fundamental stays intact', () => {
	const high = tone(10_000);
	const low = tone(200);
	assert.ok(rms(applyDeesser([high], rate, params)[0]) / rms(high) < 0.5);
	assert.ok(rms(applyDeesser([low], rate, params)[0]) / rms(low) > 0.98);
	const mixed = Float32Array.from(high, (value, frame) => value + low[frame]);
	const output = applyDeesser([mixed], rate, params)[0];
	const projection = (samples: Float32Array, hz: number) => {
		let sine = 0; let cosine = 0;
		for (let frame = 4800; frame < samples.length; frame += 1) {
			sine += samples[frame] * Math.sin(2 * Math.PI * hz * frame / rate);
			cosine += samples[frame] * Math.cos(2 * Math.PI * hz * frame / rate);
		}
		return Math.hypot(sine, cosine);
	};
	assert.ok(projection(output, 200) / projection(mixed, 200) > 0.98);
	assert.ok(projection(output, 10_000) / projection(mixed, 10_000) < 0.5);
});

test('silence, below-threshold audio and zero reduction pass through exactly', () => {
	for (const input of [new Float32Array(1000), tone(8000, 0.00001)]) {
		assert.deepEqual(applyDeesser([input], rate, params)[0], input);
	}
	const input = tone(9000);
	assert.deepEqual(applyDeesser([input], rate, { ...params, reduction: 0 })[0], input);
});

test('linked channels preserve their stereo ratio and streaming matches selection rendering', async () => {
	const left = tone(9000, 0.5, 8192);
	const channels = [left, Float32Array.from(left, value => value * 0.25)];
	const processor = createDeesserProcessor({ sampleRate: rate, channelCount: 2, params });
	const output = channels.map(channel => new Float32Array(channel.length));
	for (let offset = 0; offset < left.length; offset += 127) {
		const end = Math.min(left.length, offset + 127);
		processor.processBlock(channels.map(channel => channel.subarray(offset, end)),
			output.map(channel => channel.subarray(offset, end)), end - offset);
	}
	assert.deepEqual(output, applyDeesser(channels, rate, params));
	assert.deepEqual(output, await applyAudioSelectionEffectAsync('deesser', channels, rate, params));
	assert.deepEqual(output[1], Float32Array.from(output[0], value => value * 0.25));
	processor.reset();
	const reset = channels.map(channel => new Float32Array(channel.length));
	processor.processBlock(channels, reset, left.length);
	assert.deepEqual(reset, output);
});

test('supported sample rates remain finite with the cutoff clamped below Nyquist', () => {
	for (const sampleRate of [8000, 16000, 44100, 48000, 96000, 192000]) {
		const input = tone(7000, 0.9, 4096);
		const output = applyDeesser([input], sampleRate, { ...params, frequency: 16000 })[0];
		assert.ok(output.every(Number.isFinite));
		assert.equal(output.length, input.length);
	}
	assert.throws(() => applyDeesser([], rate, params), /channel/i);
	assert.throws(() => applyDeesser([tone(100), new Float32Array(1)], rate, params), /length/i);
	assert.throws(() => applyDeesser([tone(100)], 0, params), /sample rate/i);
});
