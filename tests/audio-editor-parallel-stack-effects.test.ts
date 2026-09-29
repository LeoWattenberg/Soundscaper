/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DynamicsProcessor } from '../src/common/editor/dynamics-worklet.js';
import { compileParallelStackEffect, createParallelStackEffect } from '../src/common/editor/engine/parallel-stack-effects.ts';

const effectCases: readonly [string, Record<string, unknown>][] = [
	['bitcrusher', { dither: 'triangular', downsampling: 3.5 }],
	['highpass-filter', { rolloff: 48 }], ['lowpass-filter', {}], ['notch-filter', {}], ['shelf-filter', {}],
	['tremolo', {}], ['vocoder', {}], ['noise-gate', {}],
	['multi-tap-delay', { time: .001, echoes: 3 }], ['deesser', {}], ['multiband-compressor', {}],
];

for (const [type, params] of effectCases) test(`${type} restores exact cold state after warmup and preserves 128/256-frame samples`, () => {
	const descriptor = compileParallelStackEffect({ id: 'effect', type, params }, 48000, 2);
	const reference = createParallelStackEffect(descriptor, 48000, 2);
	const parallel = createParallelStackEffect(descriptor, 48000, 2);
	const dirty = [new Float32Array(256).fill(.7), new Float32Array(256).fill(-.3)];
	const warmOutput = dirty.map(() => new Float32Array(256));
	parallel.processBlock(dirty, warmOutput, 256);
	for (const channel of dirty) channel.fill(0);
	for (let block = 0; block < 4; block++) parallel.processBlock(dirty, warmOutput, 256);
	parallel.reset();
	const input = [new Float32Array(1024), new Float32Array(1024)];
	for (let frame = 0; frame < 1024; frame++) {
		input[0]![frame] = Math.sin(frame * .14) * .8;
		input[1]![frame] = Math.sin(frame * .25) * .7;
	}
	const expected = input.map(() => new Float32Array(1024));
	const actual = input.map(() => new Float32Array(1024));
	for (let offset = 0; offset < 1024; offset += 128) reference.processBlock(input.map((c) => c.subarray(offset, offset + 128)),
		expected.map((c) => c.subarray(offset, offset + 128)), 128);
	for (let offset = 0; offset < 1024; offset += 256) parallel.processBlock(input.map((c) => c.subarray(offset, offset + 256)),
		actual.map((c) => c.subarray(offset, offset + 256)), 256);
	assert.deepEqual(actual, expected);
});

for (const type of ['limiter', 'gate']) test(`${type} sidechain is sample-identical to the production AudioWorklet`, () => {
	const runtimeGlobal = globalThis as typeof globalThis & { sampleRate?: number };
	const previous = runtimeGlobal.sampleRate;
	try {
		runtimeGlobal.sampleRate = 44100;
		const params = { lookahead: .003, ceiling: -6, release: .002, attack: .001, hold: .002, rangeDb: -60, threshold: -12 };
		const reference = new DynamicsProcessor({ processorOptions: { type, params } });
		const parallel = createParallelStackEffect(compileParallelStackEffect({ id: 'fx', type, params }, 44100, 2), 44100, 2);
		const dirty = [new Float32Array(256).fill(.9), new Float32Array(256).fill(-.8)];
		const warmOutput = dirty.map(() => new Float32Array(256));
		parallel.processBlock(dirty, warmOutput, 256, dirty);
		for (const channel of dirty) channel.fill(0);
		for (let block = 0; block < 4; block++) parallel.processBlock(dirty, warmOutput, 256, dirty);
		parallel.reset();
		const input = [new Float32Array(1024), new Float32Array(1024)];
		const detector = [new Float32Array(1024), new Float32Array(1024)];
		for (let frame = 0; frame < 1024; frame++) for (let channel = 0; channel < 2; channel++) {
			input[channel]![frame] = Math.sin(frame * .17 + channel) * .9;
			detector[channel]![frame] = frame > 400 && frame < 600 ? .001 : Math.sin(frame * .02) * .8;
		}
		const expected = input.map(() => new Float32Array(1024));
		const actual = input.map(() => new Float32Array(1024));
		for (let offset = 0; offset < 1024; offset += 128) reference.process([
			input.map((c) => c.subarray(offset, offset + 128)), detector.map((c) => c.subarray(offset, offset + 128)),
		], [expected.map((c) => c.subarray(offset, offset + 128))]);
		for (let offset = 0; offset < 1024; offset += 256) parallel.processBlock(input.map((c) => c.subarray(offset, offset + 256)),
			actual.map((c) => c.subarray(offset, offset + 256)), 256, detector.map((c) => c.subarray(offset, offset + 256)));
		assert.deepEqual(actual, expected);
	} finally {
		if (previous === undefined) delete runtimeGlobal.sampleRate;
		else runtimeGlobal.sampleRate = previous;
	}
});

test('rejects allocations from pitched delay and malformed parameter state before worker DSP starts', () => {
	assert.throws(() => compileParallelStackEffect({ type: 'multi-tap-delay', params: { pitchShift: 1 } }, 48000, 2), /pitched/iu);
	assert.throws(() => compileParallelStackEffect({ type: 'limiter', params: { lookahead: Infinity } }, 48000, 2), /bounded/iu);
	assert.throws(() => compileParallelStackEffect({ type: 'bitcrusher', params: { nested: {} } }, 48000, 2), /bounded/iu);
});

test('parametric EQ uses the exact precompiled WASM processor with 128/256-frame parity', async () => {
	const { readFile } = await import('node:fs/promises');
	const { ParametricEqWorkletProcessor } = await import('../src/common/editor/parametric-eq/worklet.js');
	const module = await WebAssembly.compile(await readFile(new URL('../src/common/editor/parametric-eq/parametric-eq.wasm', import.meta.url)));
	const params = { outputGain: 2, bands: [
		{ id: 'cut', enabled: true, type: 'highpass', frequency: 60, gain: 0, q: 1, slope: 48 },
		{ id: 'presence', enabled: true, type: 'peaking', frequency: 2000, gain: 4, q: .7, slope: 12 },
	] };
	const descriptor = compileParallelStackEffect({ id: 'equalizer', type: 'eq', params }, 48000, 2);
	assert.ok(descriptor.stateBytes > 1048576);
	assert.throws(() => createParallelStackEffect(descriptor, 48000, 2), /precompiled/iu);
	const parallel = createParallelStackEffect(descriptor, 48000, 2, { parametricEqWasmModule: structuredClone(module) });
	const dirty = [new Float32Array(256).fill(.9), new Float32Array(256).fill(-.8)];
	const warmOutput = dirty.map(() => new Float32Array(256));
	parallel.processBlock(dirty, warmOutput, 256);
	for (const channel of dirty) channel.fill(0);
	for (let block = 0; block < 4; block++) parallel.processBlock(dirty, warmOutput, 256);
	parallel.reset();
	const reference = new ParametricEqWorkletProcessor({ processorOptions: {
		wasmModule: module, sampleRate: 48000, effectId: 'equalizer', channelCount: 2, params,
	} });
	const input = [new Float32Array(1024), new Float32Array(1024)];
	for (let f = 0; f < 1024; f++) { input[0]![f] = Math.sin(f * .17) * .6; input[1]![f] = Math.sin(f * .11) * .2; }
	const expected = input.map(() => new Float32Array(1024));
	const actual = input.map(() => new Float32Array(1024));
	for (let offset = 0; offset < 1024; offset += 128) reference.process(
		[input.map((c) => c.subarray(offset, offset + 128))], [expected.map((c) => c.subarray(offset, offset + 128))]);
	for (let offset = 0; offset < 1024; offset += 256) parallel.processBlock(input.map((c) => c.subarray(offset, offset + 256)),
		actual.map((c) => c.subarray(offset, offset + 256)), 256);
	assert.deepEqual(actual, expected);
});
