/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect, audioEffectParamRange } from '../src/common/editor/effects.js';
import { createStandardFilterProcessor } from '../src/common/editor/first-party-effects/standard/filters-dsp.ts';
import { nativeEffectParamRange } from '../src/common/editor/ui/inspector/native-effect-param-range.ts';

const TYPES = ['highpass-filter', 'lowpass-filter', 'notch-filter'] as const;

test('standard filter cutoff editors follow the project sample rate up to its Nyquist limit', () => {
	for (const type of TYPES) {
		for (const sampleRate of [8000, 44100, 48000, 96000, 192000, 384000]) {
			assert.deepEqual(nativeEffectParamRange(type, 'frequency', audioEffectParamRange(type, 'frequency'), sampleRate, .1),
				[.1, sampleRate / 2 - .1], `${type} at ${String(sampleRate)} Hz`);
		}
	}
});

test('standard filters accept high sample rate cutoffs above 24 kHz and reject the corresponding Nyquist boundary', () => {
	for (const type of TYPES) {
		for (const sampleRate of [96000, 192000, 384000]) {
			const frequency = sampleRate / 2 - 1;
			const effect = createEffect(type, { params: { frequency } });
			assert.equal(effect.params.frequency, frequency);
			const processor = createStandardFilterProcessor({ type, sampleRate, channelCount: 1, params: effect.params });
			const input = new Float32Array(128);
			input[0] = 1;
			const output = new Float32Array(128);
			processor.processBlock([input], [output], input.length);
			assert.ok(output.every(Number.isFinite));
			assert.throws(() => processor.updateParams({ frequency: sampleRate / 2 }), /Nyquist/);
			assert.throws(() => createStandardFilterProcessor({ type, sampleRate: 48000, channelCount: 1, params: effect.params }), /Nyquist/);
		}
	}
});
