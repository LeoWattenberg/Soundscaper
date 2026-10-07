/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreamingLinearResampler } from '../src/common/editor/resample.js';
import { createStandardDelayProcessor } from '../src/common/editor/first-party-effects/standard/delay-dsp.ts';

interface LinearResampler {
	push(channels: readonly Float32Array[]): Float32Array[];
	finish(): Float32Array[];
}

test('linear resampling interpolates borrowed chunks without concatenating them', (context) => {
	const Original = Float32Array;
	const input = [Float32Array.from({ length: 1024 }, (_, frame) => Math.sin(frame * .11))];
	let largeInputCopies = 0;
	const Tracked = new Proxy(Original, { construct(target, args: [number]) {
		if (args[0] === 1024 || args[0] === 1025) largeInputCopies++;
		return new target(...args);
	} });
	context.mock.property(globalThis, 'Float32Array', Tracked);
	const resampler = createStreamingLinearResampler(48000, 16000, 1) as LinearResampler;
	const first = resampler.push(input);
	resampler.push(input);
	assert.equal(largeInputCopies, 0);
	assert.equal(first[0]!.length, 341);
});

test('linear resampler output trimming retains owned allocation instead of copying PCM', (context) => {
	const original = Float32Array.prototype.slice;
	let copiedOutputFrames = 0;
	context.mock.method(Float32Array.prototype, 'slice', function (this: Float32Array, start?: number, end?: number) {
		if (start === 0 && end !== undefined && end > 2) copiedOutputFrames += end;
		return original.call(this, start, end);
	});
	const resampler = createStreamingLinearResampler(48000, 44100, 2) as LinearResampler;
	const input = [new Float32Array(1024), new Float32Array(1024)];
	const result = resampler.push(input);
	assert.equal(copiedOutputFrames, 0);
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

test('linear output views may be transferred and borrowed input may change after push', () => {
	const first = Float32Array.of(1, 2, 3, 4);
	const resampler = createStreamingLinearResampler(4, 6, 1) as LinearResampler;
	const block = resampler.push([first]);
	const transferred = structuredClone(block, { transfer: block.map(channel => channel.buffer) });
	assert.equal(block[0]!.byteLength, 0);
	assert.equal(first.byteLength, 16);
	assert.equal(transferred[0]![0], 1);
	first.fill(NaN);
	const next = resampler.push([Float32Array.of(5, 6, 7, 8)]);
	assert.equal(next[0]![0], Math.fround(4 + (5 - 4) * (10 / 3 - 3)));
	assert.ok(next[0]!.every(Number.isFinite));
	assert.ok(resampler.finish()[0]!.every(Number.isFinite));
});
