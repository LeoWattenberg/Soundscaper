/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStandardFilterProcessor } from '../src/common/editor/first-party-effects/standard/filters-dsp.ts';
import { createVocoderProcessor } from '../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';
import { BandCompressor } from '../src/common/editor/first-party-effects/dynamics/core.ts';
import { ComplementaryCrossover } from '../src/common/editor/complementary-crossover.ts';
import { ReverbLiveProcessor } from '../src/common/editor/audacity-effects/reverb-live-processor.ts';

const input = [Float32Array.from({ length: 513 }, (_, frame) => Math.sin(frame * .11) * .7)];

test('normalized identical standard-filter updates preserve history without coefficient design', (context) => {
	const processor = createStandardFilterProcessor({ type: 'lowpass-filter', sampleRate: 48000, channelCount: 1, params: { frequency: 997, rolloff: 24 } });
	processor.processBlock(input, [new Float32Array(513)], 513);
	const original = Math.cos;
	let calls = 0;
	context.mock.method(Math, 'cos', (value: number) => { calls++; return original(value); });
	processor.updateParams({ frequency: '997', rolloff: '24' });
	assert.equal(calls, 0);
	processor.updateParams({ frequency: 1001 });
	assert.ok(calls > 0);
});

test('vocoder biquad design shares each angular cosine', (context) => {
	const original = Math.cos;
	let calls = 0;
	context.mock.method(Math, 'cos', (value: number) => { calls++; return original(value); });
	createVocoderProcessor({ sampleRate: 48000, channelCount: 1, params: { bands: 12 } });
	// Seven biquads and one carrier rotation; pole Q is prepared outside the bank.
	assert.equal(calls, 12 * 8);
});

test('neutral band compression maintains detector history without logarithmic gain math', (context) => {
	const compressor = new BandCompressor(48000);
	compressor.configure(-24, 1, .01, .1);
	const original = Math.log10;
	let calls = 0;
	context.mock.method(Math, 'log10', (value: number) => { calls++; return original(value); });
	for (let frame = 0; frame < 2048; frame++) assert.equal(compressor.gain(.5), 1);
	assert.equal(calls, 0);
	compressor.configure(-24, 6, .01, .1);
	assert.ok(compressor.gain(.5) < 1);
	assert.equal(calls, 1);
});

test('unchanged crossover controls preserve smoothing without redesign', (context) => {
	const crossover = new ComplementaryCrossover(48000, 2, 1000);
	crossover.configure(1300);
	crossover.tick();
	const original = Math.tan;
	let calls = 0;
	context.mock.method(Math, 'tan', (value: number) => { calls++; return original(value); });
	crossover.configure(1300);
	assert.equal(calls, 0);
	assert.throws(() => crossover.configure(NaN), /finite/);
});

test('identical normalized Reverb updates avoid gain and tone redesign', (context) => {
	const processor = new ReverbLiveProcessor(48000);
	processor.process(input, [new Float32Array(513)]);
	const original = Math.exp;
	let calls = 0;
	context.mock.method(Math, 'exp', (value: number) => { calls++; return original(value); });
	processor.updateParams({ roomSize: processor.params.roomSize });
	assert.equal(calls, 0);
	processor.updateParams({ toneHigh: 23 });
	assert.ok(calls > 0);
});
