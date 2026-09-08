/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMultibandCompressor, createMultibandCompressorProcessor } from '../src/common/editor/first-party-effects/multiband-compressor/dsp.ts';
import { audioEffectLabel, audioEffectTypes, createEffect } from '../src/common/editor/effects.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects-runtime.js';
import { estimateAudioSelectionEffectPeakBytes, estimateAudioSelectionEffectOutputFrames } from '../src/common/editor/selection-effects.js';
import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

const rate = 48000;
const neutral = { lowRatio: 1, midRatio: 1, highRatio: 1 };
const tone = (hz: number, length = rate) => Float32Array.from({ length }, (_, frame) => 0.5 * Math.sin(2 * Math.PI * hz * frame / rate));
const rms = (audio: Float32Array) => Math.sqrt(audio.subarray(4800).reduce((sum, value) => sum + value ** 2, 0) / (audio.length - 4800));

test('both dynamics effects expose menu, rack, selection, and bounded memory contracts', () => {
	assert.equal(audioEffectLabel('multiband-compressor'), 'Multiband compressor');
	for (const type of ['deesser', 'multiband-compressor']) {
		assert.ok(audioEffectTypes().includes(type));
		assert.ok(EFFECT_MENU_GROUPS.some(([, types]) => types.includes(type)));
		assert.equal(estimateAudioSelectionEffectOutputFrames(type, 48000), 48000);
		assert.ok(estimateAudioSelectionEffectPeakBytes(type, 48000, {}, { channelCount: 2 }) >= 48000 * 2 * 4 * 2);
		assert.throws(() => createEffect(type, { params: { attack: NaN } }), /attack/);
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/first-party-effects/dynamics/definition.ts'), 'editor-effect-contracts');
});

test('unity settings reconstruct the dry signal exactly at every crossover', () => {
	for (const lowCrossover of [40, 250, 2000]) {
		for (const highCrossover of [2500, 4000, 16000]) {
			const input = Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index * 0.1) * Math.cos(index * 1.7));
			assert.deepEqual(applyMultibandCompressor([input], rate, { ...neutral, lowCrossover, highCrossover })[0], input);
		}
	}
});

test('each threshold controls its own frequency region', () => {
	for (const [band, hz, other] of [['low', 50, 12000], ['mid', 1000, 50], ['high', 12000, 50]] as const) {
		const params = { ...neutral, [`${band}Ratio`]: 10, [`${band}Threshold`]: -36 };
		const selected = tone(hz);
		const unselected = tone(other);
		assert.ok(rms(applyMultibandCompressor([selected], rate, params)[0]) / rms(selected) < 0.55, band);
		assert.ok(rms(applyMultibandCompressor([unselected], rate, params)[0]) / rms(unselected) > 0.9, band);
	}
});

test('streaming, reset and destructive processing agree while channels remain linked', async () => {
	const left = tone(9000, 8192);
	const channels = [left, Float32Array.from(left, value => value * 0.25)];
	const params = { lowThreshold: -36, midThreshold: -30, highThreshold: -24 };
	const processor = createMultibandCompressorProcessor({ sampleRate: rate, channelCount: 2, params });
	const output = channels.map(channel => new Float32Array(channel.length));
	for (let offset = 0; offset < left.length; offset += 128) {
		processor.processBlock(channels.map(channel => channel.subarray(offset, offset + 128)),
			output.map(channel => channel.subarray(offset, offset + 128)), 128);
	}
	assert.deepEqual(output, await applyAudioSelectionEffectAsync('multiband-compressor', channels, rate, params));
	assert.deepEqual(output[1], Float32Array.from(output[0], value => value * 0.25));
	processor.reset();
	const reset = channels.map(channel => new Float32Array(channel.length));
	processor.processBlock(channels, reset, left.length);
	assert.deepEqual(reset, output);
	assert.throws(() => processor.updateParams({ highRatio: Infinity }), /highRatio/);
	processor.updateParams({ highGain: 12, lowCrossover: 2000, highCrossover: 16000 });
	processor.processBlock(channels, reset, left.length);
	assert.ok(reset.every(channel => channel.every(Number.isFinite)));
});

test('silence is silent and supported sample rates remain stable', () => {
	for (const sampleRate of [8000, 16000, 44100, 48000, 96000, 192000]) {
		const silent = new Float32Array(1024);
		assert.deepEqual(applyMultibandCompressor([silent], sampleRate)[0], silent);
		assert.ok(applyMultibandCompressor([tone(12000, 4096)], sampleRate, { highCrossover: 16000 })[0].every(Number.isFinite));
	}
});
