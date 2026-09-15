/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStandardDelayProcessor } from '../src/common/editor/first-party-effects/standard/delay-dsp.ts';
import { STANDARD_DELAY_MEMORY_LIMIT_BYTES, standardDelayTailSeconds } from '../src/common/editor/first-party-effects/standard/delay-definition.ts';
import { createNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';
import { standardEffectStateBytes } from '../src/common/editor/first-party-effects/standard/selection-contract.ts';

const sampleRate = 8000;
type Processor = Pick<ReturnType<typeof createStandardDelayProcessor>, 'processBlock'>;
function render(processor: Processor, input: readonly Float32Array[]): Float32Array[] {
	const output = input.map(channel => new Float32Array(channel.length));
	processor.processBlock(input, output, input[0].length);
	return output;
}

function observedConstructor<Constructor extends Float32ArrayConstructor | Float64ArrayConstructor>(
	constructor: Constructor, sizes: number[]): Constructor {
	return new Proxy(constructor, {
		construct(target, argumentsList, newTarget) {
			const array = Reflect.construct(target, argumentsList, newTarget) as Float32Array | Float64Array;
			sizes.push(array.length);
			return array;
		},
	});
}
function observeTypedArrayAllocations(callback: () => void): { float32: number[]; float64: number[] } {
	const observed = { float32: [] as number[], float64: [] as number[] };
	const originalFloat32 = globalThis.Float32Array;
	const originalFloat64 = globalThis.Float64Array;
	globalThis.Float32Array = observedConstructor(originalFloat32, observed.float32);
	globalThis.Float64Array = observedConstructor(originalFloat64, observed.float64);
	try { callback(); }
	finally { globalThis.Float32Array = originalFloat32; globalThis.Float64Array = originalFloat64; }
	return observed;
}

test('small live time edits reuse default and near-limit delay history and tap buffers', () => {
	for (const [time, echoes] of [[.3, 5], [4.999, 30]]) {
		const processor = createStandardDelayProcessor({ sampleRate: 48000, channelCount: 2, params: { time, echoes } });
		const allocations = observeTypedArrayAllocations(() => {
			for (const nextTime of [time + .001, time, time + .001, time]) processor.updateParams({ time: nextTime });
		});
		assert.deepEqual(allocations, { float32: [], float64: [] });
		assert.ok(render(processor, [new Float32Array(128), new Float32Array(128)])
			.every(channel => channel.every(sample => sample === 0)));
	}
});

test('fresh delay memory estimates match reserved ring allocations without exceeding 64 MiB', () => {
	for (const [rate, channelCount, time, echoes] of [[8000, 2, .004, 1], [48000, 2, .3, 5],
		[48000, 2, 5, 30], [48000, 5, 2, 30]]) {
		const params = { time, echoes };
		const allocations = observeTypedArrayAllocations(() => {
			createStandardDelayProcessor({ sampleRate: rate, channelCount, params });
		});
		assert.equal(allocations.float32.length, channelCount);
		const capacity = allocations.float32[0];
		const required = Math.ceil(standardDelayTailSeconds(params) * rate) + 2;
		const maximum = Math.floor(STANDARD_DELAY_MEMORY_LIMIT_BYTES / (channelCount * Float32Array.BYTES_PER_ELEMENT));
		assert.ok(capacity >= required && capacity <= maximum);
		assert.ok((capacity & (capacity - 1)) === 0 || capacity === maximum, 'reserve grows geometrically and caps at the memory bound');
		assert.ok(allocations.float32.every(length => length === capacity));
		const allocatedBytes = allocations.float32.reduce((sum, length) => sum + length * Float32Array.BYTES_PER_ELEMENT, 0);
		assert.equal(standardEffectStateBytes('multi-tap-delay', params, rate, channelCount), allocatedBytes);
	}
});

test('shrinking and regrowing delay time retains older stereo history within the reserved capacity', () => {
	const processor = createStandardDelayProcessor({ sampleRate, channelCount: 2,
		params: { time: .012, echoes: 1, echoGain: 0 } });
	const input = [new Float32Array(64), new Float32Array(64)];
	input[0][0] = 1;
	input[1][0] = -.25;
	render(processor, input);
	processor.updateParams({ time: .001 });
	render(processor, [new Float32Array(16), new Float32Array(16)]);
	processor.updateParams({ time: .012 });
	const output = render(processor, [new Float32Array(64), new Float32Array(64)]);
	assert.equal(output[0][16], 1);
	assert.equal(output[1][16], -.25);
	assert.ok(output.every(channel => channel.filter(sample => sample !== 0).length === 1));
});

test('growing a wrapped ring preserves both chronological pieces of stereo history', () => {
	const processor = createStandardDelayProcessor({ sampleRate, channelCount: 2,
		params: { time: .004, echoes: 1, echoGain: 0 } });
	const input = [new Float32Array(260), new Float32Array(260)];
	input[0][196] = .375;
	input[1][196] = .625;
	input[0][245] = 1;
	input[1][245] = -.25;
	input[0][258] = -.5;
	input[1][258] = .75;
	render(processor, input);
	processor.updateParams({ time: .008 });
	const output = render(processor, [new Float32Array(80), new Float32Array(80)]);
	assert.equal(output[0][0], .375);
	assert.equal(output[1][0], .625);
	assert.equal(output[0][49], 1);
	assert.equal(output[1][49], -.25);
	assert.equal(output[0][62], -.5);
	assert.equal(output[1][62], .75);
	assert.ok(output.every(channel => channel.filter(sample => sample !== 0).length === 3));
});

test('a rejected delay growth allocates no buffers and preserves configured taps and stereo history', () => {
	const rate = 48000;
	const processor = createStandardDelayProcessor({ sampleRate: rate, channelCount: 3,
		params: { time: .004, echoes: 1, echoGain: 0 } });
	const input = [new Float32Array(20), new Float32Array(20), new Float32Array(20)];
	input[0][0] = 1;
	input[1][0] = -.25;
	render(processor, input);
	const allocations = observeTypedArrayAllocations(() => {
		assert.throws(() => processor.updateParams({ time: 5, echoes: 30 }), /processor memory limit/);
	});
	assert.deepEqual(allocations, { float32: [], float64: [] });
	const output = render(processor, [new Float32Array(220), new Float32Array(220), new Float32Array(220)]);
	assert.equal(output[0][172], 1);
	assert.equal(output[1][172], -.25);
	assert.ok(output[2].every(sample => sample === 0));
});

test('zero-time finite delay sums current-frame echoes without feedback or channel leakage', () => {
	const input = [new Float32Array([.125, -.25, 0, .5]), new Float32Array([-.5, 0, .25, -.125])];
	for (const delayType of ['regular', 'bouncing-ball', 'reverse-bouncing-ball']) {
		const processor = createStandardDelayProcessor({ sampleRate, channelCount: 2,
			params: { time: 0, echoes: 3, echoGain: 0, mix: .5, delayType } });
		for (const block of [input, input]) {
			const output = render(processor, block);
			for (let channel = 0; channel < output.length; channel += 1) {
				assert.deepEqual(output[channel], input[channel].map(sample => sample * 2.5));
			}
		}
		assert.ok(render(processor, input.map(() => new Float32Array(4)))
			.every(channel => channel.every(sample => sample === 0)));
	}
});

test('growing and shrinking a live stereo delay preserves the retained history in both channels', () => {
	for (const [before, after, expectedFrame] of [[.004, .008, 44], [.008, .004, 12]]) {
		const processor = createStandardDelayProcessor({ sampleRate, channelCount: 2,
			params: { time: before, echoes: 1, echoGain: 0 } });
		const input = [new Float32Array(20), new Float32Array(20)];
		input[0][0] = 1;
		input[1][0] = -.25;
		render(processor, input);
		processor.updateParams({ time: after });
		const output = render(processor, [new Float32Array(80), new Float32Array(80)]);
		assert.equal(output[0][expectedFrame], 1);
		assert.equal(output[1][expectedFrame], -.25);
		assert.equal(output[0].filter(sample => sample !== 0).length, 1);
		assert.equal(output[1].filter(sample => sample !== 0).length, 1);
	}
});

test('a rejected live delay update leaves its parameters and queued echoes intact', () => {
	const processor = createStandardDelayProcessor({ sampleRate, channelCount: 2,
		params: { time: .004, echoes: 1, echoGain: 0 } });
	const input = [new Float32Array(20), new Float32Array(20)];
	input[0][0] = 1;
	render(processor, input);
	assert.throws(() => processor.updateParams({ time: 6, echoes: 30 }), /time/);
	const output = render(processor, [new Float32Array(80), new Float32Array(80)]);
	assert.equal(output[0][12], 1);
	assert.ok(output[1].every(sample => sample === 0));
});

test('a gate holds for the complete configured count of samples after the last threshold crossing', () => {
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 1,
		params: { attack: .001, lookahead: 0, hold: .001, release: .01, rangeDb: -100 } });
	render(processor, [new Float32Array(800).fill(.2)]);
	const quiet = new Float32Array(16).fill(.001);
	const output = render(processor, [quiet])[0];
	for (let frame = 0; frame < 8; frame += 1) assert.equal(output[frame], quiet[frame], `Hold frame ${frame}`);
	assert.ok(output[8] < quiet[8]);
});

test('nonfinite input cannot poison delay history or gate state in subsequent blocks', () => {
	for (const create of [createStandardDelayProcessor, createNoiseGateProcessor]) {
		const params = create === createStandardDelayProcessor ? { time: .004, echoes: 1 }
			: { gateFrequency: 1000, attack: .001 };
		const processor = create({ sampleRate, channelCount: 2, params });
		const invalid = [new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, 0]), new Float32Array([0, Number.NEGATIVE_INFINITY, Number.NaN])];
		const first = render(processor, invalid);
		assert.ok(first.every(channel => channel.every(sample => sample === 0)));
		const silence = render(processor, [new Float32Array(80), new Float32Array(80)]);
		assert.ok(silence.every(channel => channel.every(sample => sample === 0)));
		const valid = render(processor, [new Float32Array(800).fill(.2), new Float32Array(800).fill(-.2)]);
		assert.ok(valid.every(channel => channel.every(Number.isFinite)));
	}
});

test('silent and partially disconnected buses produce finite independent delay and gate output', () => {
	for (const create of [createStandardDelayProcessor, createNoiseGateProcessor]) {
		const processor = create({ sampleRate, channelCount: 2 });
		const output = [new Float32Array(128).fill(123), new Float32Array(128).fill(123)];
		processor.processBlock([], output, 128);
		assert.ok(output.every(channel => channel.every(sample => sample === 0)));
		processor.processBlock([new Float32Array(128).fill(.2)], output, 128);
		assert.ok(output[0].every(Number.isFinite));
		assert.ok(output[1].every(sample => sample === 0));
	}
});
