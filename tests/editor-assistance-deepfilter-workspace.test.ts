/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	analyzeAssistanceDeepFilterChannelV1,
	ASSISTANCE_DEEPFILTER_BINS,
	ASSISTANCE_DEEPFILTER_ERB_BANDS,
	ASSISTANCE_DEEPFILTER_ORDER,
	synthesizeAssistanceDeepFilterChannelV1,
} from '../src/common/editor/assistance/deepfilternet3-signal-v1.ts';

test('DeepFilter FFT convolution workspaces are bounded per analysis and synthesis call', (context) => {
	const allocations: number[] = [];
	const NativeFloat64Array = Float64Array;
	context.mock.method(globalThis, 'Float64Array', new Proxy(NativeFloat64Array, {
		construct(target, argumentsList: unknown[]) {
			if (typeof argumentsList[0] === 'number') allocations.push(argumentsList[0]);
			return Reflect.construct(target, argumentsList);
		},
	}));
	const input = Float32Array.from({ length: 9_600 }, (_, frame) => Math.sin(frame * 0.13) * 0.25);
	const analysis = analyzeAssistanceDeepFilterChannelV1(input);
	assert.equal(allocations.filter((length) => length === 2_048).length, 2);
	allocations.length = 0;
	const mask = new Float32Array(analysis.frameCount * ASSISTANCE_DEEPFILTER_ERB_BANDS).fill(1);
	const coefficients = new Float32Array(ASSISTANCE_DEEPFILTER_ORDER * analysis.frameCount * ASSISTANCE_DEEPFILTER_BINS * 2);
	const output = synthesizeAssistanceDeepFilterChannelV1(analysis, mask, coefficients);
	assert.equal(output.length, input.length);
	assert.ok(output.every(Number.isFinite));
	assert.equal(allocations.filter((length) => length === 2_048).length, 2);
});

test('DeepFilter analysis workspaces are isolated across reentrant cancellation callbacks', () => {
	const input = Float32Array.from({ length: 2_000 }, (_, frame) => Math.sin(frame * 0.17));
	const expected = analyzeAssistanceDeepFilterChannelV1(input);
	let nested = false;
	const signal = { throwIfAborted() {
		if (nested) return;
		nested = true;
		analyzeAssistanceDeepFilterChannelV1(Float32Array.from({ length: 3_000 }, (_, frame) => Math.cos(frame * 0.31)));
	} } as AbortSignal;
	const actual = analyzeAssistanceDeepFilterChannelV1(input, signal);
	assert.deepEqual(actual, expected);
});

test('DeepFilter identity masks and centered filter coefficients retain multi-frame PCM', () => {
	const input = Float32Array.from({ length: 9_600 }, (_, frame) => Math.sin(frame * 0.13) * 0.25);
	const analysis = analyzeAssistanceDeepFilterChannelV1(input);
	const mask = new Float32Array(analysis.frameCount * ASSISTANCE_DEEPFILTER_ERB_BANDS).fill(1);
	const coefficients = new Float32Array(ASSISTANCE_DEEPFILTER_ORDER * analysis.frameCount * ASSISTANCE_DEEPFILTER_BINS * 2);
	for (let frame = 0; frame < analysis.frameCount; frame += 1) {
		for (let bin = 0; bin < ASSISTANCE_DEEPFILTER_BINS; bin += 1) {
			coefficients[((2 * analysis.frameCount + frame) * ASSISTANCE_DEEPFILTER_BINS + bin) * 2] = 1;
		}
	}
	const output = synthesizeAssistanceDeepFilterChannelV1(analysis, mask, coefficients);
	for (let frame = 0; frame < output.length; frame += 1) assert.ok(Math.abs(output[frame]! - input[frame]!) < 1e-6);
});
