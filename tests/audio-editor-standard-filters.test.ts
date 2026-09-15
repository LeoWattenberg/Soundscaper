/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	STANDARD_FILTER_EFFECT_DEFINITIONS,
	isStandardFilterEffect,
	type StandardFilterEffectType,
} from '../src/common/editor/first-party-effects/standard/filters-definition.ts';
import { createStandardFilterProcessor } from '../src/common/editor/first-party-effects/standard/filters-dsp.ts';

const SAMPLE_RATE = 48_000;
const TYPES: StandardFilterEffectType[] = ['highpass-filter', 'lowpass-filter', 'notch-filter', 'shelf-filter'];

function tone(frequency: number, frames = SAMPLE_RATE): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => Math.sin(2 * Math.PI * frequency * frame / SAMPLE_RATE));
}

function render(type: StandardFilterEffectType, params: Readonly<Record<string, unknown>>, input: Float32Array): Float32Array {
	const processor = createStandardFilterProcessor({ type, sampleRate: SAMPLE_RATE, channelCount: 1, params });
	const output = new Float32Array(input.length);
	processor.processBlock([input], [output], input.length);
	return output;
}

function rms(signal: Float32Array): number {
	let sum = 0;
	for (let index = signal.length / 2; index < signal.length; index++) sum += signal[index] ** 2;
	return Math.sqrt(sum / (signal.length / 2));
}

function response(type: StandardFilterEffectType, params: Readonly<Record<string, unknown>>, frequency: number): number {
	const input = tone(frequency);
	return rms(render(type, params, input)) / rms(input);
}

test('standard filter catalogues expose live controls and opt out of timeline automation', () => {
	for (const type of TYPES) {
		assert.equal(isStandardFilterEffect(type), true);
		const definition = STANDARD_FILTER_EFFECT_DEFINITIONS[type];
		for (const [, , metadata] of Object.values(definition.ranges)) {
			assert.equal(metadata.automatable, false);
			assert.match(metadata.automationBlockReason, /live controls.*timeline automation/);
		}
		for (const choice of Object.values(definition.choices)) {
			assert.equal(choice.automatable, false);
			assert.match(choice.automationBlockReason, /live controls.*timeline automation/);
		}
	}
	assert.equal(isStandardFilterEffect('highpass'), false);
	assert.equal(isStandardFilterEffect('constructor'), false);
	assert.equal(STANDARD_FILTER_EFFECT_DEFINITIONS['notch-filter'].defaults.frequency, 60);
});

test('highpass and lowpass cutoff stays at -3 dB for every Butterworth rolloff', () => {
	for (const type of ['highpass-filter', 'lowpass-filter'] as const) {
		for (const rolloff of [6, 12, 24, 36, 48]) {
			const amplitude = response(type, { frequency: 1000, rolloff }, 1000);
			assert.ok(Math.abs(amplitude - Math.SQRT1_2) < 0.00001, `${type} ${String(rolloff)}: ${String(amplitude)}`);
		}
	}
});

test('highpass and lowpass follow the requested Butterworth slope away from cutoff', () => {
	for (const type of ['highpass-filter', 'lowpass-filter'] as const) {
		for (const rolloff of [6, 12, 24, 36, 48]) {
			const frequency = type === 'highpass-filter' ? 250 : 4000;
			const ratio = Math.tan(Math.PI * frequency / SAMPLE_RATE) / Math.tan(Math.PI * 1000 / SAMPLE_RATE);
			const order = rolloff / 6;
			const expected = 1 / Math.sqrt(1 + (type === 'highpass-filter' ? 1 / ratio : ratio) ** (2 * order));
			assert.ok(Math.abs(response(type, { frequency: 1000, rolloff }, frequency) - expected) < 0.00001);
			assert.ok(response(type, { frequency: 1000, rolloff }, type === 'highpass-filter' ? 10_000 : 100) > 0.99);
		}
	}
});

test('notch rejects its center and Q narrows the rejected band', () => {
	assert.ok(response('notch-filter', { frequency: 1000, q: 10 }, 1000) < 0.000001);
	const narrow = response('notch-filter', { frequency: 1000, q: 30 }, 1300);
	const broad = response('notch-filter', { frequency: 1000, q: 0.5 }, 1300);
	assert.ok(narrow > 0.99);
	assert.ok(broad < 0.3);
});

test('shelves apply the requested gain on the chosen side of their midpoint', () => {
	for (const filterType of ['low', 'high']) {
		for (const gain of [-12, 12]) {
			const params = { frequency: 1000, gain, filterType };
			const expected = 10 ** (gain / 20);
			const selectedSide = response('shelf-filter', params, filterType === 'low' ? 50 : 15_000);
			const otherSide = response('shelf-filter', params, filterType === 'low' ? 15_000 : 50);
			assert.ok(Math.abs(selectedSide - expected) < 0.001);
			assert.ok(Math.abs(otherSide - 1) < 0.001);
			assert.ok(Math.abs(response('shelf-filter', params, 1000) - 10 ** (gain / 40)) < 0.00001);
		}
	}
	assert.deepEqual(render('shelf-filter', { gain: 0 }, tone(1000)), tone(1000));
});

test('all filters preserve stereo independence, silence and exact block partition parity', () => {
	const input = tone(731, 8192);
	input[0] += 1;
	for (const type of TYPES) {
		const params = { ...STANDARD_FILTER_EFFECT_DEFINITIONS[type].defaults };
		const expected = render(type, params, input);
		const processor = createStandardFilterProcessor({ type, sampleRate: SAMPLE_RATE, channelCount: 2, params });
		const output = new Float32Array(input.length);
		const silentOutput = new Float32Array(input.length);
		const silence = new Float32Array(input.length);
		let offset = 0;
		while (offset < input.length) {
			const end = Math.min(input.length, offset + (offset % 131 + 1));
			processor.processBlock([input.subarray(offset, end), silence.subarray(offset, end)],
				[output.subarray(offset, end), silentOutput.subarray(offset, end)], end - offset);
			offset = end;
		}
		assert.deepEqual(output, expected, type);
		assert.deepEqual(silentOutput, silence, type);
		processor.reset();
		processor.processBlock([input, silence], [output, silentOutput], input.length);
		assert.deepEqual(output, expected, type);
	}
});

test('filters accept live coefficient and topology changes and reset to reproducible state', () => {
	const input = tone(1000, 1024);
	for (const type of TYPES) {
		const processor = createStandardFilterProcessor({ type, sampleRate: SAMPLE_RATE, channelCount: 1, params: {} });
		const output = new Float32Array(input.length);
		processor.processBlock([input], [output], input.length);
		const params = type === 'shelf-filter' ? { frequency: 1200, gain: 18, filterType: 'high' }
			: type === 'notch-filter' ? { frequency: 1200, q: 30 } : { frequency: 1200, rolloff: 48 };
		processor.updateParams(params);
		processor.processBlock([input], [output], input.length);
		assert.ok(output.every(Number.isFinite));
		processor.reset();
		processor.processBlock([input], [output], input.length);
		assert.deepEqual(output, render(type, params, input));
		assert.throws(() => { processor.updateParams({ frequency: SAMPLE_RATE / 2 }); }, RangeError);
		processor.reset();
		processor.processBlock([input], [output], input.length);
		assert.deepEqual(output, render(type, params, input), 'failed updates leave the prior valid coefficients intact');
	}
});

test('live frequency changes retain filter history and in-place blocks match separate buffers', () => {
	for (const type of TYPES) {
		const options = { type, sampleRate: SAMPLE_RATE, channelCount: 1, params: {} };
		const reference = createStandardFilterProcessor(options);
		const changing = createStandardFilterProcessor(options);
		const impulse = Float32Array.of(1);
		const output = new Float32Array(1);
		for (const processor of [reference, changing]) processor.processBlock([impulse], [output], 1);
		reference.processBlock([Float32Array.of(0)], [output], 1);
		const retainedHistory = output[0];
		assert.notEqual(retainedHistory, 0);
		changing.updateParams({ frequency: 1200 });
		changing.processBlock([Float32Array.of(0)], [output], 1);
		assert.equal(output[0], retainedHistory, type);
		const inPlace = tone(731, 4096);
		const expected = render(type, {}, inPlace);
		const processor = createStandardFilterProcessor(options);
		processor.processBlock([inPlace], [inPlace], inPlace.length);
		assert.deepEqual(inPlace, expected, type);
	}
});

test('filters continue decaying from an empty input bus and zero missing stereo channels', () => {
	for (const type of TYPES) {
		const processor = createStandardFilterProcessor({ type, sampleRate: SAMPLE_RATE, channelCount: 2, params: {} });
		const output = [new Float32Array(128), new Float32Array(128)];
		const impulse = new Float32Array(128);
		impulse[127] = 1;
		processor.processBlock([impulse], output, 128);
		assert.deepEqual(output[1], new Float32Array(128));
		processor.processBlock([], output, 128);
		assert.ok(output[0].some((value) => value !== 0), type);
		assert.ok(output[0].every(Number.isFinite), type);
		assert.deepEqual(output[1], new Float32Array(128));
		const firstTail = rms(output[0]);
		for (let block = 0; block < 400; block++) processor.processBlock([], output, 128);
		assert.ok(rms(output[0]) < firstTail * 0.001, type);
	}
});

test('nonfinite PCM is silence and cannot poison filter history or adjacent stereo channels', () => {
	const input = tone(731, 1024);
	for (const [index, value] of [[0, NaN], [35, Infinity], [127, -Infinity], [512, NaN]]) input[index] = value;
	const sanitized = Float32Array.from(input, (sample) => Number.isFinite(sample) ? sample : 0);
	const cleanChannel = tone(1749, 1024);
	for (const type of TYPES) {
		const processor = createStandardFilterProcessor({ type, sampleRate: SAMPLE_RATE, channelCount: 2, params: {} });
		const output = [new Float32Array(input.length), new Float32Array(input.length)];
		for (let offset = 0; offset < input.length; offset += 128) {
			const end = offset + 128;
			processor.processBlock([input.subarray(offset, end), cleanChannel.subarray(offset, end)],
				output.map((channel) => channel.subarray(offset, end)), end - offset);
		}
		assert.ok(output.every((channel) => channel.every(Number.isFinite)), type);
		assert.deepEqual(output[0], render(type, {}, sanitized), `${type}: corrupted samples behave exactly as silence`);
		assert.deepEqual(output[1], render(type, {}, cleanChannel), `${type}: the neighboring channel is unaffected`);
	}
	assert.ok(Number.isNaN(input[0]));
	assert.equal(input[35], Infinity);
	assert.equal(input[127], -Infinity);
});

test('filter parameter extremes stay finite in mono and stereo at common audio sample rates', () => {
	for (const sampleRate of [8000, 44_100, 48_000, 96_000]) {
		for (const type of TYPES) {
			const definition = STANDARD_FILTER_EFFECT_DEFINITIONS[type];
			for (const upper of [false, true]) {
				const params: Record<string, unknown> = { ...definition.defaults };
				for (const [key, [minimum, maximum]] of Object.entries(definition.ranges)) {
					params[key] = upper ? (key === 'frequency' ? Math.min(maximum, sampleRate / 2 * 0.999) : maximum) : minimum;
				}
				params.rolloff = 48;
				for (const channelCount of [1, 2]) {
					const processor = createStandardFilterProcessor({ type, sampleRate, channelCount, params });
					const input = Array.from({ length: channelCount }, () => Float32Array.from({ length: 8192 }, (_, i) => i === 0 ? 1 : 0));
					const output = Array.from({ length: channelCount }, () => new Float32Array(8192));
					processor.processBlock(input, output, 8192);
					assert.ok(output.every((channel) => channel.every(Number.isFinite)), `${type} ${String(sampleRate)}`);
				}
			}
		}
	}
});

test('filters reject invalid topology, parameters and blocks before touching output', () => {
	for (const sampleRate of [0, -1, 7999, 384_001, NaN, Infinity]) {
		assert.throws(() => createStandardFilterProcessor({ type: 'lowpass-filter', sampleRate, channelCount: 1, params: {} }), RangeError);
	}
	for (const channelCount of [0, -1, 1.5, 33, NaN]) {
		assert.throws(() => createStandardFilterProcessor({ type: 'lowpass-filter', sampleRate: SAMPLE_RATE, channelCount, params: {} }), RangeError);
	}
	for (const type of TYPES) {
		for (const frequency of [-1, NaN, Infinity, SAMPLE_RATE / 2]) {
			assert.throws(() => createStandardFilterProcessor({ type, sampleRate: SAMPLE_RATE, channelCount: 1, params: { frequency } }), RangeError);
		}
	}
	for (const params of [{ rolloff: 18 }, { rolloff: 'none' }]) {
		assert.throws(() => createStandardFilterProcessor({ type: 'lowpass-filter', sampleRate: SAMPLE_RATE, channelCount: 1, params }), RangeError);
	}
	assert.throws(() => createStandardFilterProcessor({ type: 'notch-filter', sampleRate: SAMPLE_RATE, channelCount: 1, params: { q: 0 } }), RangeError);
	assert.throws(() => createStandardFilterProcessor({ type: 'shelf-filter', sampleRate: SAMPLE_RATE, channelCount: 1, params: { filterType: 'band' } }), RangeError);
	const processor = createStandardFilterProcessor({ type: 'lowpass-filter', sampleRate: SAMPLE_RATE, channelCount: 1, params: {} });
	const output = new Float32Array(8).fill(123);
	for (const frames of [-1, 0.5, 9]) {
		assert.throws(() => { processor.processBlock([new Float32Array(8)], [output], frames); }, RangeError);
	}
	assert.throws(() => { processor.processBlock([new Float32Array(8), new Float32Array(8)], [output], 8); }, RangeError);
	assert.deepEqual(output, new Float32Array(8).fill(123));
});
