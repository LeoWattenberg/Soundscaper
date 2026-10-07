/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityNormalize, applyAudacityLegacyCompressor, applyAudacityRepeat } from '../src/common/editor/audacity-effects/basic.js';
import { applyAudacityPhaser } from '../src/common/editor/audacity-effects/realtime.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { makeDistortionTable } from '../src/common/editor/audacity-effects/distortion-table.js';

const distortion = { thresholdDb: -6, noiseFloorDb: -70, parameter1: 57, parameter2: 43, repeats: 2 };

for (const [mode, method, expected] of [
	['medium-overdrive', 'log', 2],
	['hard-overdrive', 'log', 1026],
	['even-harmonics', 'tanh', 2050],
] as const) test(`Distortion ${mode} calculates its invariant ${method} once`, (context) => {
	const original = Math[method];
	let calls = 0;
	context.mock.method(Math, method, (value: number) => { calls++; return original(value); });
	makeDistortionTable({ ...distortion, mode });
	assert.equal(calls, expected);
});

test('Normalize measures DC and peak in one input pass and DC-only skips peak measurement', (context) => {
	for (const applyGain of [true, false]) {
		const input = Float32Array.of(-0.7, 0.2, 0.8, -0.3);
		let reads = 0;
		const iterator = input[Symbol.iterator].bind(input);
		context.mock.method(input, Symbol.iterator, function* () {
			for (const sample of iterator()) { reads++; yield sample; }
		});
		const actual = applyAudacityNormalize([input], 48000, { removeDc: true, applyGain });
		assert.equal(reads, input.length);
		assert.notEqual(actual[0], input);
		assert.deepEqual(input, Float32Array.of(-0.7, 0.2, 0.8, -0.3));
	}
});

test('Legacy compressor normalizes owned output without allocating replacement channels', (context) => {
	const input = [Float32Array.from({ length: 2049 }, (_, frame) => .4 * Math.sin(frame * .17))];
	const Original = Float32Array;
	let allocations = 0;
	const Tracked = new Proxy(Original, { construct(target, args: [number]) { allocations++; return new target(...args); } });
	context.mock.property(globalThis, 'Float32Array', Tracked);
	const result = applyAudacityLegacyCompressor(input, 48000, { normalize: true });
	assert.equal(allocations, 1);
	assert.equal(result[0].length, input[0]!.length);
});

test('Repeat copies a growing output prefix instead of one set per repetition', (context) => {
	const input = Float32Array.of(-0, .2, -.7, .9);
	const original = Float32Array.prototype.set;
	let copies = 0;
	context.mock.method(Float32Array.prototype, 'set', function (this: Float32Array, values: ArrayLike<number>, offset?: number) {
		copies++; original.call(this, values, offset);
	});
	const result = applyAudacityRepeat([input], 48000, { count: 127 })[0];
	assert.equal(copies, 8);
	assert.deepEqual(result, Float32Array.from({ length: 512 }, (_, frame) => input[frame % 4]!));
});

test('offline and realtime Phaser reuse the fixed LFO shape denominator', (context) => {
	const original = Math.expm1;
	let denominatorCalls = 0;
	context.mock.method(Math, 'expm1', (value: number) => { if (value === 4) denominatorCalls++; return original(value); });
	const input = [Float32Array.from({ length: 1024 }, (_, frame) => Math.sin(frame * .1))];
	applyAudacityPhaser(input, 48000, {});
	const processor = createAudacityLiveProcessor('audacity-phaser', 48000);
	processor.process(input, input.map(channel => new Float32Array(channel.length)));
	assert.ok(denominatorCalls <= 2, `fixed denominator was evaluated ${denominatorCalls} times`);
});

test('live Distortion retains its table on a DC or mix-only update', (context) => {
	const processor = createAudacityLiveProcessor('audacity-distortion', 48000, { mode: 'medium-overdrive' });
	const original = Math.exp;
	let exponentials = 0;
	context.mock.method(Math, 'exp', (value: number) => { exponentials++; return original(value); });
	processor.updateParams({ dcBlock: true, parameter2: 31 });
	assert.equal(exponentials, 0);
	processor.updateParams({ parameter1: 31 });
	assert.ok(exponentials > 1000);
});
