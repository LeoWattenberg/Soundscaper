/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';
import { noiseGateLatencyFrames, normalizeNoiseGateParams } from '../src/common/editor/first-party-effects/standard/noise-gate-definition.ts';

const sampleRate = 8000;
type Processor = ReturnType<typeof createNoiseGateProcessor>;
function render(processor: Processor, input: readonly Float32Array[], block = 128): Float32Array[] {
	const output = input.map(channel => new Float32Array(channel.length));
	for (let offset = 0; offset < input[0].length; offset += block) {
		const end = Math.min(input[0].length, offset + block);
		processor.processBlock(input.map(channel => channel.subarray(offset, end)),
			output.map(channel => channel.subarray(offset, end)), end - offset);
	}
	return output;
}

test('gate lookahead defaults to attack duration and declares exact sample-rate-dependent latency', () => {
	assert.equal(normalizeNoiseGateParams({}).lookahead, .01);
	assert.equal(normalizeNoiseGateParams({ attack: .04 }).lookahead, .04);
	assert.equal(noiseGateLatencyFrames({ attack: .04 }, sampleRate), 320);
	assert.equal(noiseGateLatencyFrames({ lookahead: .01001 }, sampleRate), 81);
	assert.equal(noiseGateLatencyFrames({ lookahead: .01 }, 96000), 960);
	assert.equal(noiseGateLatencyFrames({ lookahead: 0 }, sampleRate), 0);
	assert.throws(() => noiseGateLatencyFrames({ lookahead: -1 }, sampleRate), /lookahead/);
	assert.throws(() => noiseGateLatencyFrames({ lookahead: 2 }, sampleRate), /lookahead/);
	assert.throws(() => noiseGateLatencyFrames({}, NaN), /sample rate/);
});

test('lookahead opens before a transient and is fully open when the delayed transient arrives', () => {
	const input = new Float32Array(800).fill(.001);
	input[320] = .5;
	const params = { threshold: -40, attack: .01, hold: 0, release: .01, rangeDb: -100 };
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 1, params });
	const latency = noiseGateLatencyFrames(params, sampleRate);
	const output = render(processor, [input])[0];
	assert.equal(processor.latencyFrames, latency);
	assert.ok(output.subarray(0, latency).every(sample => sample === 0));
	assert.equal(output[320 + latency], .5, 'the initial consonant/transient keeps unity gain');
	assert.equal(output[319], 0);
	assert.ok(output[320] > 0 && output[360] > output[320], 'quiet audio before the transient receives the opening ramp');
	const causal = render(createNoiseGateProcessor({ sampleRate, channelCount: 1, params: { ...params, lookahead: 0 } }), [input])[0];
	assert.ok(causal[320] < .02, 'zero lookahead retains the causal onset option');
});

test('lookahead retains the complete hold after delayed audio falls below threshold', () => {
	const input = new Float32Array(800).fill(.001);
	input.fill(.2, 80, 160);
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 1,
		params: { attack: .01, lookahead: .02, hold: .005, release: .01, rangeDb: -100 } });
	const output = render(processor, [input])[0];
	const quietStart = 160 + processor.latencyFrames;
	for (let frame = quietStart; frame < quietStart + 40; frame += 1) {
		assert.equal(output[frame], input[160], `Hold frame ${frame - quietStart}`);
	}
	assert.ok(output[quietStart + 40] < input[160], 'release begins only after the complete hold');
});

test('lookahead stereo linking protects the neighboring onset and independent gates stay independent', () => {
	const quiet = new Float32Array(800).fill(.001);
	const loud = new Float32Array(800);
	loud[320] = .5;
	const params = { attack: .01, hold: 0, rangeDb: -100 };
	for (const stereoLink of ['linked', 'independent']) {
		const processor = createNoiseGateProcessor({ sampleRate, channelCount: 2, params: { ...params, stereoLink } });
		const output = render(processor, [quiet, loud]);
		assert.equal(output[1][320 + processor.latencyFrames], .5);
		assert.equal(output[0][320 + processor.latencyFrames], stereoLink === 'linked' ? quiet[320] : 0);
	}
});

test('lookahead buffers remain deterministic across blocks, reset, missing channels and finite sanitation', () => {
	const input = [Float32Array.from({ length: 1024 }, (_, frame) => .2 * Math.sin(frame * .09)), new Float32Array(1024)];
	input[0][17] = NaN;
	input[0][33] = Infinity;
	const params = { gateFrequency: 1000, lookahead: .02 };
	const expected = render(createNoiseGateProcessor({ sampleRate, channelCount: 2, params }), input, 1024);
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 2, params });
	assert.deepEqual(render(processor, input, 73), expected);
	processor.reset();
	assert.deepEqual(render(processor, input, 128), expected);
	assert.ok(expected.every(channel => channel.every(Number.isFinite)));
	assert.ok(expected[1].every(sample => sample === 0));
	processor.reset();
	const output = [new Float32Array(257), new Float32Array(257)];
	processor.processBlock([], output, 257);
	assert.ok(output.every(channel => channel.every(sample => sample === 0)));
});

test('lookahead updates change latency and clear the old timeline while rejected updates preserve audio', () => {
	const params = { rangeDb: 0, lookahead: .01 };
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 1, params });
	render(processor, [new Float32Array(40).fill(.5)]);
	assert.throws(() => processor.updateParams({ lookahead: 2 }), /lookahead/);
	assert.equal(processor.latencyFrames, 80);
	assert.equal(render(processor, [new Float32Array(41)])[0][40], .5);
	processor.updateParams({ lookahead: .02 });
	assert.equal(processor.latencyFrames, 160);
	assert.ok(render(processor, [new Float32Array(160).fill(.5)])[0].every(sample => sample === 0));
	assert.equal(render(processor, [new Float32Array(1)])[0][0], .5);
	processor.updateParams({ lookahead: 0 });
	assert.equal(processor.latencyFrames, 0);
	assert.deepEqual(render(processor, [new Float32Array([.25, -.5])])[0], new Float32Array([.25, -.5]));
});
