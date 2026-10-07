/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { LiveProcessor } from '../src/common/editor/audacity-effects/live-processor-base.js';
import { EQ_PARTITION_SIZE } from '../src/common/editor/audacity-effects/live-capabilities.js';
import { createBitcrusherProcessor } from '../src/common/editor/first-party-effects/bitcrusher/dsp.js';
import { initializePffft } from '../src/common/editor/pffft.js';
import { round3Audio } from './helpers/round3-dsp-fixtures.ts';

await initializePffft();

test('partitioned equalization transforms directly into owned spectral history and never clears fully overwritten input', (context) => {
	const processor = createAudacityLiveProcessor('audacity-filter-curve-eq', 8000, { filterLength: 513 });
	assert.ok(processor instanceof LiveProcessor);
	const input = [round3Audio(12817), round3Audio(12817, 1)];
	const output = input.map(channel => new Float32Array(channel.length));
	const set = context.mock.method(Float64Array.prototype, 'set');
	const fill = context.mock.method(Float64Array.prototype, 'fill');
	for (let start = 0; start < input[0]!.length; start += 127) {
		processor.process(input.map(channel => channel.subarray(start, start + 127)), output.map(channel => channel.subarray(start, start + 127)));
	}
	assert.equal(set.mock.calls.filter(call => call.this instanceof Float64Array && (call.arguments[0] as ArrayLike<number>).length === EQ_PARTITION_SIZE * 2).length, 0);
	assert.equal(fill.mock.calls.filter(call => call.this instanceof Float64Array && call.this.length === EQ_PARTITION_SIZE).length, 0);
});

test('Bitcrusher reconstruction selection preserves RNG alignment across mode changes and reset', () => {
	const input = [round3Audio(3089), round3Audio(3089, 1)];
	const processor = createBitcrusherProcessor({ sampleRate: 8000, channelCount: 2, seed: 37,
		params: { interpolation: 'cubic', dither: 'shaped', downsampling: 3.7 } });
	const before = input.map(channel => channel.slice());
	const first = input.map(channel => new Float32Array(channel.length));
	processor.processBlock(input, first, 3089);
	processor.reset();
	const partitioned = input.map(channel => new Float32Array(channel.length));
	for (let start = 0; start < 3089; start += 127) {
		const count = Math.min(127, 3089 - start);
		processor.processBlock(input.map(channel => channel.subarray(start, start + count)), partitioned.map(channel => channel.subarray(start, start + count)), count);
	}
	assert.deepEqual(partitioned, first);
	assert.deepEqual(input, before);
});

test('Bitcrusher sample-hold and smooth reconstruction skip unused interpolation positions', (context) => {
	const input = [round3Audio(3089)];
	const minimum = context.mock.method(Math, 'min');
	for (const interpolation of ['sample-hold', 'smooth']) {
		const processor = createBitcrusherProcessor({ sampleRate: 8000, channelCount: 1,
			params: { interpolation, downsampling: 3.7 } });
		processor.processBlock(input, [new Float32Array(3089)], 3089);
	}
	assert.equal(minimum.mock.callCount(), 0);
});
