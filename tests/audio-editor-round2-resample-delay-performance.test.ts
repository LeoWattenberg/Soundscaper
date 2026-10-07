/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { createStandardDelayProcessor } from '../src/common/editor/first-party-effects/standard/delay-dsp.ts';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';

interface SincResampler {
	push(channels: readonly Float32Array[]): Float32Array[];
	finish(): Float32Array[];
}

test('sinc resampling consumes an initial chunk without cloning its full PCM', (context) => {
	const Original = Float32Array;
	const input = [Float32Array.from({ length: 1024 }, (_, frame) => Math.sin(frame * .11))];
	let largeInputCopies = 0;
	const Tracked = new Proxy(Original, { construct(target, args: [number]) {
		if (args[0] === 1024) largeInputCopies++;
		return new target(...args);
	} });
	context.mock.property(globalThis, 'Float32Array', Tracked);
	const resampler = createStreamingWindowedSincResampler(48000, 16000, 1) as SincResampler;
	const first = resampler.push(input);
	assert.equal(largeInputCopies, 0);
	assert.equal(first[0]!.length, 334);
});

test('sinc exact-fit output retains its array without a redundant channel mapping allocation', () => {
	const resampler = createStreamingWindowedSincResampler(48000, 44100, 2) as SincResampler;
	const input = [new Float32Array(1024), new Float32Array(1024)];
	resampler.push(input);
	let mappedArrays = 0;
	const original = Array.prototype.map;
	Array.prototype.map = function<T, U>(this: T[], callback: (value: T, index: number, array: T[]) => U, thisArg?: unknown): U[] {
		mappedArrays++;
		return Reflect.apply(original, this, [callback, thisArg]) as U[];
	};
	let result: Float32Array[];
	try { result = resampler.finish(); }
	finally { Array.prototype.map = original; }
	assert.equal(mappedArrays, 1, 'only pruning maps channel history; returning output allocates no mapped array');
	assert.notEqual(result[0]!.buffer, input[0]!.buffer);
});

test('integer delay taps calculate each read position once across channels without interpolation floors', (context) => {
	const processor = createStandardDelayProcessor({ sampleRate: 48000, channelCount: 2, params: { echoes: 3, time: .01 } });
	const original = Math.floor;
	let floors = 0;
	context.mock.method(Math, 'floor', (value: number) => { floors++; return original(value); });
	const input = [new Float32Array(1024), new Float32Array(1024)];
	processor.processBlock(input, input.map(channel => new Float32Array(channel.length)), 1024);
	assert.equal(floors, 0);
});

test('sinc retained history is private before input returns for small and large feeds', () => {
	for (const firstLength of [1, 16, 1024]) for (const rates of [[48000, 16000], [48000, 44100], [8000, 48000]]) {
		const first = Float32Array.from({ length: firstLength }, (_, frame) => Math.sin(frame * .11));
		const a = createStreamingWindowedSincResampler(rates[0], rates[1], 1) as SincResampler;
		const b = createStreamingWindowedSincResampler(rates[0], rates[1], 1) as SincResampler;
		const block = a.push([first]);
		assert.deepEqual(block, b.push([first.slice()]));
		const transferred = structuredClone(block, { transfer: block.map(channel => channel.buffer) });
		assert.equal(block[0]!.byteLength, 0);
		assert.equal(first.byteLength, firstLength * 4);
		assert.ok(transferred[0]!.every(Number.isFinite));
		first.fill(NaN);
		const next = Float32Array.from({ length: 173 }, (_, frame) => Math.cos(frame * .17));
		assert.deepEqual(a.push([next]), b.push([next]));
		next.fill(NaN);
		assert.deepEqual(a.finish(), b.finish());
		assert.equal(a.finish()[0]!.length, 0);
		assert.throws(() => a.push([new Float32Array(1)]), /finished/);
	}
});

test('pitched delay retains zero-fraction interpolation when native finite overflow generates NaN', async () => {
	const staffPadRuntime = await loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
	const processor = createStandardDelayProcessor({ sampleRate: 8000, channelCount: 1, staffPadRuntime,
		params: { time: .001, echoes: 1, pitchShift: 2, mix: 1 } });
	const output = new Float32Array(80 * 127);
	try {
		for (let index = 0; index < 80; index++) {
			const input = Float32Array.from({ length: 127 }, (_, frame) => (index < 30 ? 1 : 3.4028234663852886e38) * Math.sin((index * 127 + frame) * .313));
			assert.ok(input.every(Number.isFinite));
			processor.processBlock([input], [output.subarray(index * 127, (index + 1) * 127)], 127);
		}
		assert.ok(Number.isFinite(output[4871]));
		assert.ok(Number.isNaN(output[4872]));
	} finally { processor.dispose(); }
});
