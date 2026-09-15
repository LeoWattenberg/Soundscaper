/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { effectParameterInventory } from '../src/common/editor/effect-parameter-descriptors.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { standardDelayLatencyFrames } from '../src/common/editor/first-party-effects/standard/delay-definition.ts';
import { nativeEffectParamRange } from '../src/common/editor/ui/inspector/native-effect-param-range.ts';

const TRACK = { kind: 'track', id: 'track-1' } as const;

function descriptor(type: string, parameterId: string, sampleRate: number, params: Readonly<Record<string, unknown>> = {}) {
	const result = effectParameterInventory(TRACK, createEffect(type, { params }), { sampleRate }).descriptors.find(
		({ address }) => address.kind === 'effect' && address.parameterId === parameterId,
	);
	assert.ok(result);
	return result;
}

test('standard cutoff descriptors and their editors agree on the sample rate dependent Nyquist limit', () => {
	for (const type of ['highpass-filter', 'lowpass-filter', 'notch-filter']) {
		for (const sampleRate of [8000, 44100, 48000, 96000, 192000, 384000]) {
			const cutoff = descriptor(type, 'frequency', sampleRate);
			assert.equal(cutoff.maximum, sampleRate / 2 - .1);
			assert.deepEqual(nativeEffectParamRange(type, 'frequency', [cutoff.minimum, cutoff.maximum], sampleRate, .1),
				[cutoff.minimum, cutoff.maximum]);
		}
	}
	assert.equal(descriptor('shelf-filter', 'frequency', 8000).maximum, 3999);
	assert.equal(descriptor('shelf-filter', 'frequency', 48000).maximum, 10000);
	assert.equal(descriptor('noise-gate', 'gateFrequency', 8000).maximum, 3999);
	assert.equal(descriptor('noise-gate', 'gateFrequency', 48000).maximum, 10000);
	assert.equal(descriptor('tremolo', 'frequency', 8000).maximum, 1000);
});

test('noise gate descriptors expose lookahead latency and require a graph rebuild when lookahead changes', () => {
	for (const sampleRate of [8000, 44100, 48000, 192000]) {
		const lookahead = descriptor('noise-gate', 'lookahead', sampleRate, { lookahead: .0123 });
		assert.equal(lookahead.latencyFrames, Math.ceil(sampleRate * .0123));
		assert.equal(lookahead.automatable, false);
		assert.match(lookahead.automationBlockReason ?? '', /latency.*graph rebuild/);
		assert.equal(descriptor('noise-gate', 'threshold', sampleRate, { lookahead: .0123 }).latencyFrames,
			lookahead.latencyFrames);
		assert.equal(descriptor('noise-gate', 'attack', sampleRate, { lookahead: .0123 }).latencyFrames,
			lookahead.latencyFrames);
		assert.equal(descriptor('noise-gate', 'lookahead', sampleRate, { lookahead: 0 }).latencyFrames, 0);
	}
});

test('pitched delay descriptors expose the streaming algorithm latency and rebuild for pitch, echoes, or mix changes', () => {
	for (const sampleRate of [8000, 44100, 48000, 192000]) {
		const params = { pitchShift: 1, echoes: 3, mix: 1 };
		const latency = standardDelayLatencyFrames(params, sampleRate);
		assert.ok(latency > 0);
		for (const parameterId of ['pitchShift', 'echoes', 'mix']) {
			const value = descriptor('multi-tap-delay', parameterId, sampleRate, params);
			assert.equal(value.latencyFrames, latency);
			assert.equal(value.automatable, false);
			assert.match(value.automationBlockReason ?? '', /latency.*graph rebuild/);
		}
		assert.equal(descriptor('multi-tap-delay', 'time', sampleRate, params).latencyFrames, latency);
		assert.equal(descriptor('multi-tap-delay', 'pitchShift', sampleRate, { ...params, mix: 0 }).latencyFrames, 0);
		assert.equal(descriptor('multi-tap-delay', 'pitchShift', sampleRate, { pitchShift: 0 }).latencyFrames, 0);
	}
});
