/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';

const sampleRate = 8000;
type Processor = ReturnType<typeof createNoiseGateProcessor>;
const params = { attack: .1, lookahead: 0, hold: .05, release: .1,
	threshold: -40, rangeDb: -24, stereoLink: 'independent' };

function render(processor: Processor, input: readonly Float32Array[], block = 128): Float32Array[] {
	const output = input.map(channel => new Float32Array(channel.length));
	for (let offset = 0; offset < input[0].length; offset += block) {
		const end = Math.min(offset + block, input[0].length);
		processor.processBlock(input.map(channel => channel.subarray(offset, end)),
			output.map(channel => channel.subarray(offset, end)), end - offset);
	}
	return output;
}

function constant(frames: number, ...values: number[]): Float32Array[] {
	return values.map(value => new Float32Array(frames).fill(value));
}

function sameSamples(actual: Float32Array, expected: Float32Array, message: string): void {
	assert.equal(actual.length, expected.length);
	for (let frame = 0; frame < actual.length; frame += 1) {
		assert.equal(actual[frame], expected[frame], `${message}, frame ${frame}`);
	}
}

for (const loudChannel of [0, 1]) {
	test(`relinking the gate shares the open channel ${loudChannel} hold and release`, () => {
		const processor = createNoiseGateProcessor({ sampleRate, channelCount: 2, params });
		const values = loudChannel === 0 ? [.5, .0001] : [.0001, .5];
		const warm = render(processor, constant(1600, ...values));
		assert.equal(warm[loudChannel][1599], .5);
		assert.ok(warm[1 - loudChannel][1599] < .00001, 'the independent channel must start attenuated');
		processor.updateParams({ stereoLink: 'linked' });
		const after = render(processor, constant(1600, .0001, .0001));
		sameSamples(after[1], after[0], 'linked channels must share attenuation from the first rendered sample');
		assert.equal(after[0][399], Math.fround(.0001), 'joining channels must retain the sounding hold');
		assert.ok(after[0][1599] < .00004, 'the shared envelope must still release after the hold');
	});
}

test('relinking retains an in-progress attack without restarting it', () => {
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 2, params });
	const reference = createNoiseGateProcessor({ sampleRate, channelCount: 1, params });
	render(processor, constant(320, .0001, .5));
	render(reference, constant(320, .5));
	processor.updateParams({ stereoLink: 'linked' });
	const actual = render(processor, constant(480, .5, .5));
	const expected = render(reference, constant(480, .5))[0];
	sameSamples(actual[0], expected, 'the quieter channel must join the current attack');
	sameSamples(actual[1], expected, 'the sounding channel must retain its current attack');
	assert.equal(actual[0][479], .5, 'the existing attack must finish at its authored duration');
});

test('relinking shares the envelope through the ordinary default lookahead buffer', () => {
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 2,
		params: { ...params, lookahead: .01 } });
	render(processor, constant(1600, .5, .0001));
	processor.updateParams({ stereoLink: 'linked' });
	const after = render(processor, constant(128, .0001, .0001));
	assert.equal(after[0][0], .5, 'the charged audio preview must survive the link change');
	assert.equal(after[1][0], Math.fround(.0001), 'the quiet preview must receive the same open gain');
	sameSamples(after[1].subarray(processor.latencyFrames), after[0].subarray(processor.latencyFrames),
		'the buffered channels must share attenuation');
});

test('linking preserves the maximum remaining hold even when another channel has higher gain', () => {
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 2,
		params: { ...params, attack: .001, release: 4, hold: .1 } });
	render(processor, constant(1000, .5, .0001));
	render(processor, constant(810, .0001, .0001));
	render(processor, constant(1, .0001, .5));
	processor.updateParams({ stereoLink: 'linked' });
	const after = render(processor, constant(400, .0001, .0001));
	sameSamples(after[1], after[0], 'all channels must join the shared hold');
	assert.equal(after[0][7], Math.fround(.0001), 'the newly triggered hold must keep the linked gate opening');
	assert.equal(after[0][399], Math.fround(.0001));
});

test('unlinking resumes separate detectors and relinking is independent of block geometry', () => {
	const oneBlock = createNoiseGateProcessor({ sampleRate, channelCount: 2, params });
	const chunked = createNoiseGateProcessor({ sampleRate, channelCount: 2, params });
	for (const processor of [oneBlock, chunked]) {
		render(processor, constant(1600, .5, .0001));
		processor.updateParams({ stereoLink: 'linked' });
	}
	const input = constant(2000, .0001, .0001);
	assert.deepEqual(render(chunked, input, 73), render(oneBlock, input, 2000));
	chunked.updateParams({ stereoLink: 'independent' });
	const separate = render(chunked, constant(2400, .5, .0001));
	assert.equal(separate[0][2399], .5);
	assert.ok(separate[1][2399] < .00001);
	chunked.updateParams({ stereoLink: 'linked' });
	chunked.reset();
	const fresh = createNoiseGateProcessor({ sampleRate, channelCount: 2,
		params: { ...params, stereoLink: 'linked' } });
	assert.deepEqual(render(chunked, constant(1600, .5, .0001)), render(fresh, constant(1600, .5, .0001)));
});
