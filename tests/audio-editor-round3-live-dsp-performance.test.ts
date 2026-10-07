/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SampleQueue } from '../src/common/editor/audacity-effects/live-processor-base.js';
import { applyAudacityLegacyCompressor, applyAudacityLoudnessNormalization } from '../src/common/editor/audacity-effects/basic.js';
import { createTremoloProcessor } from '../src/common/editor/first-party-effects/standard/tremolo-dsp.ts';
import { createNoiseGateProcessor, createOfflineNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';
import { createVocoderProcessor } from '../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';
import { createStandardFilterProcessor } from '../src/common/editor/first-party-effects/standard/filters-dsp.ts';
import { round3Audio } from './helpers/round3-dsp-fixtures.ts';

test('live spectral queues copy private chunks without boxing one array entry per sample', (context) => {
	const queue = new SampleQueue();
	const input = round3Audio(4096);
	const before = input.slice();
	const original = input[Symbol.iterator].bind(input);
	let visits = 0;
	context.mock.method(input, Symbol.iterator, function* () { for (const value of original()) { visits++; yield value; } });
	queue.push(input);
	assert.equal(visits, 0);
	input.fill(0);
	const output = Float32Array.from({ length: before.length }, () => queue.shift());
	assert.deepEqual(output, before);
	assert.equal(queue.length, 0);
	assert.equal(queue.shift(71), 71);
});

test('spectral queues retain detached producer bytes, double precision and ordering through chunk retirement', () => {
	const queue = new SampleQueue();
	const input = Float32Array.of(-0, .37, -.71);
	queue.push(input);
	structuredClone(input, { transfer: [input.buffer] });
	queue.push(Float64Array.of(1 + Number.EPSILON, -0));
	queue.push([]);
	for (let index = 0; index < 97; index++) queue.push([index]);
	assert.equal(queue.length, 102);
	assert.deepEqual([queue.shift(), queue.shift(), queue.shift()], [-0, Math.fround(.37), Math.fround(-.71)]);
	assert.equal(queue.shift(), 1 + Number.EPSILON);
	assert.ok(Object.is(queue.shift(), -0));
	for (let index = 0; index < 97; index++) assert.equal(queue.shift(), index);
	assert.equal(queue.length, 0);
	queue.push([71]);
	assert.equal(queue.shift(), 71);
	assert.equal(queue.shift(13), 13);
});

test('Legacy peak detection omits the unused RMS history allocation', (context) => {
	const input = [round3Audio(3089)];
	const Original = Float64Array;
	const lengths: number[] = [];
	context.mock.property(globalThis, 'Float64Array', new Proxy(Original, {
		construct(target, args: [number]) { lengths.push(args[0]); return new target(...args); },
	}));
	applyAudacityLegacyCompressor(input, 8000, { usePeak: true });
	assert.deepEqual(lengths, [3089]);
});

test('linked loudness designs its weighting filter coefficients once for all channels', (context) => {
	const input = [round3Audio(3089), round3Audio(3089, 1), round3Audio(3089, 2)];
	const tangent = context.mock.method(Math, 'tan');
	applyAudacityLoudnessNormalization(input, 8000, { stereoIndependent: false });
	assert.equal(tangent.mock.callCount(), 2);
});

test('Tremolo advances its admitted phase without a floor per output frame', (context) => {
	const processor = createTremoloProcessor({ sampleRate: 8000, channelCount: 1, params: { frequency: 100 } });
	const input = [round3Audio(3089)];
	const output = [new Float32Array(3089)];
	const floor = context.mock.method(Math, 'floor');
	processor.processBlock(input, output, 3089);
	assert.equal(floor.mock.callCount(), 0);
});

test('first-order and neutral shelf filter design omit unused trigonometric evaluations', (context) => {
	const sine = context.mock.method(Math, 'sin');
	const cosine = context.mock.method(Math, 'cos');
	for (const type of ['lowpass-filter', 'highpass-filter', 'shelf-filter'] as const) {
		createStandardFilterProcessor({ type, sampleRate: 8000, channelCount: 1,
			params: { frequency: 997, rolloff: 6, gain: 0 } });
	}
	assert.equal(sine.mock.callCount(), 0);
	assert.equal(cosine.mock.callCount(), 0);
});

test('Noise Gate avoids unchanged release design and fixed attack-normalization exponentials', (context) => {
	const processor = createNoiseGateProcessor({ sampleRate: 8000, channelCount: 1, params: { lookahead: 0 } });
	const input = [round3Audio(3089)];
	const exp = context.mock.method(Math, 'exp');
	processor.updateParams({ threshold: '-40', lookahead: 0 });
	assert.equal(exp.mock.callCount(), 0);
	const original = Math.expm1;
	let denominators = 0;
	context.mock.method(Math, 'expm1', (value: number) => { if (value === -1) denominators++; return original(value); });
	processor.processBlock(input, [new Float32Array(3089)], 3089);
	assert.equal(denominators, 0);
	processor.updateParams({ release: .3 });
	assert.equal(exp.mock.callCount(), 1);
});

test('fixed full-band Noise Gate does not construct unusable crossover history', (context) => {
	const Original = Float64Array;
	let arrays = 0;
	context.mock.property(globalThis, 'Float64Array', new Proxy(Original, {
		construct(target, args: [number]) { arrays++; return new target(...args); },
	}));
	createOfflineNoiseGateProcessor({ sampleRate: 8000, channelCount: 3, params: { lookahead: 0 } });
	assert.equal(arrays, 4, 'gain/hold/attack history only');
});

test('Vocoder retains carrier/filter rotations on envelope-distance updates and prepares pole Q once', (context) => {
	const cosine = context.mock.method(Math, 'cos');
	const processor = createVocoderProcessor({ sampleRate: 8000, channelCount: 1, params: { bands: 12 } });
	assert.equal(cosine.mock.callCount(), 12 * 8);
	cosine.mock.resetCalls();
	processor.updateParams({ distance: 32 });
	assert.equal(cosine.mock.callCount(), 12 * 4);
});
