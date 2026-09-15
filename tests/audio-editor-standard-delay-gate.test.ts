/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStandardDelayProcessor } from '../src/common/editor/first-party-effects/standard/delay-dsp.ts';
import { createNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';

const sampleRate = 8000;
type Processor = ReturnType<typeof createNoiseGateProcessor>;
function render(processor: Processor, input: Float32Array[], block = input[0].length): Float32Array[] {
	const output = input.map(channel => new Float32Array(channel.length));
	for (let offset = 0; offset < input[0].length; offset += block) {
		const end = Math.min(input[0].length, offset + block);
		processor.processBlock(input.map(channel => channel.subarray(offset, end)),
			output.map(channel => channel.subarray(offset, end)), end - offset);
	}
	return output;
}

test('finite delay echoes land at exact frames with per-echo gain and no feedback after the last echo', () => {
	const impulse = new Float32Array(500);
	impulse[0] = 1;
	const processor = createStandardDelayProcessor({ sampleRate, channelCount: 1,
		params: { time: .01, echoGain: -6, echoes: 3, mix: 1 } });
	const output = render(processor, [impulse])[0];
	assert.equal(output[0], 1);
	for (let echo = 1; echo <= 3; echo += 1) {
		assert.ok(Math.abs(output[80 * echo] - 10 ** (-6 * echo / 20)) < 1e-7);
	}
	assert.equal(output[320], 0);
	assert.equal(output.filter(sample => sample !== 0).length, 4);
});

test('bouncing delays shorten or lengthen successive echo intervals', () => {
	const impulse = new Float32Array(300);
	impulse[0] = 1;
	for (const [delayType, expected] of [
		['bouncing-ball', [0, 120, 200, 240]],
		['reverse-bouncing-ball', [0, 40, 120, 240]],
	] as const) {
		const processor = createStandardDelayProcessor({ sampleRate, channelCount: 1,
			params: { time: .015, echoes: 3, echoGain: 0, delayType } });
		const output = render(processor, [impulse])[0];
		assert.deepEqual(Array.from(output.keys()).filter(index => output[index] !== 0), expected);
	}
});

test('noise gate attenuates quiet material, opens for loud material, and links channels on request', () => {
	const quiet = new Float32Array(2400).fill(.001);
	const loud = new Float32Array(2400).fill(.2);
	const linked = createNoiseGateProcessor({ sampleRate, channelCount: 2,
		params: { threshold: -40, rangeDb: -24, attack: .001 } });
	const independent = createNoiseGateProcessor({ sampleRate, channelCount: 2,
		params: { threshold: -40, rangeDb: -24, stereoLink: 'independent' } });
	const together = render(linked, [quiet, loud]);
	const apart = render(independent, [quiet, loud]);
	assert.ok(Math.abs(together[0][2399] - .001) < 1e-7);
	assert.ok(Math.abs(together[1][2399] - .2) < 1e-7);
	assert.ok(Math.abs(apart[0][2399] - .001 * 10 ** (-24 / 20)) < 1e-7);
});

test('noise gate hold protects the gap before release, and a zero reduction reconstructs dry audio', () => {
	const input = new Float32Array(3200).fill(.0001);
	input.fill(.2, 0, 800);
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 1,
		params: { attack: .001, lookahead: 0, hold: .1, release: .01, rangeDb: -100 } });
	const output = render(processor, [input])[0];
	assert.ok(output[1500] > .00009);
	assert.ok(output[3000] < 1e-9);
	const transparent = createNoiseGateProcessor({ sampleRate, channelCount: 1,
		params: { rangeDb: 0, lookahead: 0, gateFrequency: 1000 } });
	assert.deepEqual(render(transparent, [input])[0], input);
});

test('frequency-selective gating retains bass while reducing high frequencies', () => {
	function amplitude(frequency: number): number {
		const input = Float32Array.from({ length: 8000 }, (_, frame) => .001 * Math.sin(2 * Math.PI * frequency * frame / sampleRate));
		const processor = createNoiseGateProcessor({ sampleRate, channelCount: 1,
			params: { gateFrequency: 1000, rangeDb: -100 } });
		const output = render(processor, [input])[0];
		return Math.sqrt(output.subarray(4000).reduce((sum, value) => sum + value * value, 0) / 4000);
	}
	assert.ok(amplitude(50) > amplitude(3000) * 10);
});

test('delay and gate preserve state across blocks, reset deterministically, and accept live controls', () => {
	const input = [Float32Array.from({ length: 3072 }, (_, frame) => .1 * Math.sin(frame * .09)), new Float32Array(3072)];
	for (const create of [createStandardDelayProcessor, createNoiseGateProcessor]) {
		const params = create === createNoiseGateProcessor ? { lookahead: 0 } : {};
		const first = create({ sampleRate, channelCount: 2, params });
		const expected = render(first, input);
		const chunked = create({ sampleRate, channelCount: 2, params });
		assert.deepEqual(render(chunked, input, 128), expected);
		chunked.reset();
		assert.deepEqual(render(chunked, input, 73), expected);
		chunked.updateParams(create === createStandardDelayProcessor ? { mix: 0 } : { rangeDb: 0 });
		assert.deepEqual(render(chunked, input), input);
	}
});

test('invalid parameters and unsafe delay memory configurations fail before processing', () => {
	assert.throws(() => createStandardDelayProcessor({ sampleRate, channelCount: 1, params: { echoes: 31 } }), /echoes/);
	assert.throws(() => createStandardDelayProcessor({ sampleRate: 384000, channelCount: 32,
		params: { time: 5, echoes: 30 } }), /memory/);
	assert.throws(() => createNoiseGateProcessor({ sampleRate, channelCount: 1, params: { gateFrequency: 4000 } }), /Nyquist/);
});
