/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect, effectTailFrames, rackTailFrames } from '../src/common/editor/effects.js';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import * as definitions from '../src/common/editor/first-party-effects/standard/filters-definition.ts';
import type { StandardFilterEffectType } from '../src/common/editor/first-party-effects/standard/filters-definition.ts';
import { createStandardFilterProcessor } from '../src/common/editor/first-party-effects/standard/filters-dsp.ts';

test('high Q notch release is included by effect tails and bounded by the existing rack cap', () => {
	const effect = createEffect('notch-filter', { params: { frequency: 60, q: 1000 } });
	assert.ok(effectTailFrames(effect, 48000) > 48000 * 10);
	assert.equal(rackTailFrames([effect], 48000), 48000 * 10);
});

test('filter release estimates track cutoff, Q, cascade order and shelf amplification', () => {
	const tail = definitions.standardFilterTailSeconds;
	assert.ok(tail('notch-filter', { frequency: 60, q: 1000 }) > tail('notch-filter', { frequency: 60, q: 1 }) * 100);
	assert.ok(tail('highpass-filter', { frequency: .1, rolloff: 48 }) > tail('highpass-filter', { frequency: 1000, rolloff: 48 }) * 1000);
	assert.ok(tail('lowpass-filter', { frequency: 1000, rolloff: 48 }) > tail('lowpass-filter', { frequency: 1000, rolloff: 6 }));
	assert.ok(tail('shelf-filter', { frequency: 1000, gain: 72 }) > tail('shelf-filter', { frequency: 1000, gain: 6 }));
	assert.equal(tail('shelf-filter', { gain: 0 }), 0);
	for (const sampleRate of [8000, 44100, 48000, 384000]) {
		for (const type of ['highpass-filter', 'lowpass-filter', 'notch-filter', 'shelf-filter'] as const) {
			const params = { frequency: type === 'shelf-filter' ? 10 : .1, rolloff: 48, q: 1000, gain: 72 };
			assert.ok(Number.isFinite(tail(type, params, sampleRate)));
			assert.ok(tail(type, params, sampleRate) > 0);
		}
	}
});

test('all filter release estimates cover charged mono/stereo histories below minus 80 dB', () => {
	const sampleRate = 48000;
	const cases: readonly [StandardFilterEffectType, Readonly<Record<string, unknown>>][] = [
		['highpass-filter', { frequency: 1000, rolloff: 6 }],
		['highpass-filter', { frequency: 1000, rolloff: 24 }],
		['highpass-filter', { frequency: 1000, rolloff: 48 }],
		['lowpass-filter', { frequency: 1000, rolloff: 12 }],
		['lowpass-filter', { frequency: 1000, rolloff: 36 }],
		['lowpass-filter', { frequency: 1000, rolloff: 48 }],
		['notch-filter', { frequency: 60, q: 1 }],
		['notch-filter', { frequency: 1000, q: .1 }],
		['notch-filter', { frequency: 1000, q: .5 }],
		['notch-filter', { frequency: 10000, q: 1000 }],
		['shelf-filter', { frequency: 1000, gain: 72, filterType: 'low' }],
		['shelf-filter', { frequency: 1000, gain: -72, filterType: 'low' }],
		['shelf-filter', { frequency: 1000, gain: 72, filterType: 'high' }],
		['shelf-filter', { frequency: 1000, gain: -72, filterType: 'high' }],
	];
	for (const [type, params] of cases) {
		const processor = createStandardFilterProcessor({ type, sampleRate, channelCount: 2, params });
		const input = Float32Array.from({ length: sampleRate }, (_, frame) => .2
			+ .4 * Math.sin(2 * Math.PI * Number(params.frequency) * frame / sampleRate)
			+ .3 * Math.sin(2 * Math.PI * 177 * frame / sampleRate));
		processor.processBlock([input, input.map((value) => -value)], [new Float32Array(input.length), new Float32Array(input.length)], input.length);
		const frames = Math.ceil(definitions.standardFilterTailSeconds(type, params, sampleRate) * sampleRate);
		const release = [new Float32Array(frames + 128), new Float32Array(frames + 128)];
		processor.processBlock([], release, frames + 128);
		for (const channel of release) {
			const residual = channel.subarray(frames);
			assert.ok(residual.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= .0001), `${type} release at ${String(frames)} frames`);
		}
	}
});

test('release estimation validates the same controls and Nyquist boundary as processing and preserves selection length', () => {
	for (const type of ['highpass-filter', 'lowpass-filter', 'notch-filter', 'shelf-filter'] as const) {
		for (const params of [{ frequency: 4000 }, { frequency: Number.NaN }]) {
			assert.throws(() => definitions.standardFilterTailSeconds(type, params, 8000), RangeError);
			assert.throws(() => createStandardFilterProcessor({ type, params, sampleRate: 8000, channelCount: 1 }), RangeError);
		}
		const input = new Float32Array([1, .5, 0, -.5, -1]);
		const output = applyStandardEffect(type, [input], 48000);
		assert.equal(output[0].length, input.length);
		assert.deepEqual(input, new Float32Array([1, .5, 0, -.5, -1]));
	}
	for (const sampleRate of [7999, 384001, Number.NaN]) assert.throws(() => definitions.standardFilterTailSeconds('notch-filter', {}, sampleRate), RangeError);
	assert.throws(() => definitions.standardFilterTailSeconds('notch-filter', { q: 1001 }), RangeError);
	assert.throws(() => definitions.standardFilterTailSeconds('lowpass-filter', { rolloff: 18 }), RangeError);
	assert.throws(() => definitions.standardFilterTailSeconds('shelf-filter', { filterType: 'band' }), RangeError);
});
