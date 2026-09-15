/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { STANDARD_MODULATION_EFFECT_DEFINITIONS, isStandardModulationEffect, normalizeStandardModulationParams } from '../src/common/editor/first-party-effects/standard/modulation-definition.ts';
import { createTremoloProcessor } from '../src/common/editor/first-party-effects/standard/tremolo-dsp.ts';
import { createVocoderProcessor } from '../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';

const rate = 48000;
type Processor = ReturnType<typeof createTremoloProcessor>;
function sine(frequency: number, frames = rate, amplitude = 0.8): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * frame / rate));
}
function render(processor: Processor, input: readonly Float32Array[], block = input[0].length): Float32Array[] {
	const output = input.map(() => new Float32Array(input[0].length));
	for (let offset = 0; offset < input[0].length; offset += block) {
		const end = Math.min(input[0].length, offset + block);
		processor.processBlock(input.map(channel => channel.subarray(offset, end)), output.map(channel => channel.subarray(offset, end)), end - offset);
	}
	return output;
}
function rms(samples: Float32Array, offset = rate / 2): number {
	let sum = 0;
	for (let frame = offset; frame < samples.length; frame += 1) sum += samples[frame] ** 2;
	return Math.sqrt(sum / (samples.length - offset));
}
function spectralAmplitude(samples: Float32Array, frequency: number): number {
	let real = 0;
	let imaginary = 0;
	const offset = rate / 2;
	for (let frame = offset; frame < samples.length; frame += 1) {
		const phase = 2 * Math.PI * frequency * frame / rate;
		real += samples[frame] * Math.cos(phase);
		imaginary += samples[frame] * Math.sin(phase);
	}
	return 2 * Math.hypot(real, imaginary) / (samples.length - offset);
}

test('modulation definitions validate live controls and bound realtime topology', () => {
	assert.equal(isStandardModulationEffect('tremolo'), true);
	assert.equal(isStandardModulationEffect('vocoder'), true);
	assert.equal(isStandardModulationEffect('nyquist:vocoder'), false);
	for (const definition of Object.values(STANDARD_MODULATION_EFFECT_DEFINITIONS)) {
		for (const [, , metadata] of Object.values(definition.ranges)) {
			assert.equal(metadata.automatable, false);
			assert.match(metadata.automationBlockReason, /live controls/);
		}
	}
	assert.throws(() => normalizeStandardModulationParams('tremolo', { waveform: 'random' }), /waveform/);
	assert.throws(() => normalizeStandardModulationParams('tremolo', { frequency: Number.NaN }), /frequency/);
	assert.throws(() => normalizeStandardModulationParams('vocoder', { bands: 241 }), /bands/);
	assert.throws(() => normalizeStandardModulationParams('vocoder', { bands: 10.5 }), /integer/);
	assert.throws(() => normalizeStandardModulationParams('vocoder', { outputMode: 'silent' }), /outputMode/);
});

test('tremolo produces the selected waveform, starting phase and exact modulation depth', () => {
	const input = [new Float32Array(480).fill(1)];
	for (const waveform of ['sine', 'triangle', 'sawtooth', 'inverse-sawtooth', 'square']) {
		const output = render(createTremoloProcessor({ sampleRate: rate, channelCount: 1, params: { frequency: 100, depth: 80, waveform } }), input)[0];
		assert.ok(Math.abs(Math.min(...output) - 0.2) < 0.005, waveform);
		assert.ok(Math.abs(Math.max(...output) - 1) < 0.005, waveform);
	}
	const phased = render(createTremoloProcessor({ sampleRate: rate, channelCount: 1, params: { phase: 180, depth: 100 } }), input)[0];
	assert.equal(phased[0], 1);
	assert.deepEqual(render(createTremoloProcessor({ sampleRate: rate, channelCount: 1, params: { depth: 0 } }), input), input);
});

test('tremolo remains linked across stereo, exact across partitions and deterministic after reset', () => {
	const input = [sine(600, 5177), sine(900, 5177)];
	const options = { sampleRate: rate, channelCount: 2, params: { waveform: 'triangle', phase: -70, depth: 100, frequency: 7 } };
	const processor = createTremoloProcessor(options);
	const full = render(processor, input);
	assert.deepEqual(render(createTremoloProcessor(options), input, 127), full);
	processor.reset();
	assert.deepEqual(render(processor, input, 19), full);
	processor.updateParams({ depth: 0 });
	assert.deepEqual(render(processor, input, 128), input);
	processor.updateParams({ depth: 100, phase: 180 });
	assert.equal(render(processor, [new Float32Array(1).fill(0.5), new Float32Array(1).fill(-0.5)])[0][0], 0.5);
});

test('mono vocoder generates an audible carrier and silent modulation remains silent', () => {
	for (const bands of [10, 40, 64, 240]) {
		const processed = render(createVocoderProcessor({ sampleRate: rate, channelCount: 1, params: { bands } }), [sine(1000)])[0];
		assert.ok(rms(processed) > 0.04, `Mono output RMS ${rms(processed)}`);
		assert.ok(rms(processed) < 0.9);
		assert.ok(processed.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
	}
	const silent = render(createVocoderProcessor({ sampleRate: rate, channelCount: 1, params: { noiseLevel: 100, radarLevel: 100 } }), [new Float32Array(4096)])[0];
	assert.ok(silent.every(sample => sample === 0));
	const noCarrier = render(createVocoderProcessor({ sampleRate: rate, channelCount: 1, params: { carrierLevel: 0 } }), [sine(1000)])[0];
	assert.ok(noCarrier.every(sample => sample === 0));
});

test('stereo vocoder transfers modulator bands onto the actual right-channel carrier', () => {
	const modulator = sine(1000);
	const carrier = Float32Array.from(sine(1000), sample => sample * 0.5);
	for (let frame = 0; frame < carrier.length; frame += 1) carrier[frame] += 0.4 * Math.sin(2 * Math.PI * 5000 * frame / rate);
	const both = render(createVocoderProcessor({ sampleRate: rate, channelCount: 2 }), [modulator, carrier]);
	assert.deepEqual(both[0], modulator);
	assert.ok(spectralAmplitude(both[1], 1000) > 0.08);
	assert.ok(spectralAmplitude(both[1], 1000) > spectralAmplitude(both[1], 5000) * 20);
	const right = render(createVocoderProcessor({ sampleRate: rate, channelCount: 2, params: { outputMode: 'right-only' } }), [modulator, carrier]);
	assert.deepEqual(right[0], right[1]);
	assert.deepEqual(right[1], both[1]);
	const silentCarrier = render(createVocoderProcessor({ sampleRate: rate, channelCount: 2 }), [modulator, new Float32Array(rate)]);
	assert.ok(silentCarrier[1].every(sample => sample === 0));
});

test('surround vocoder processes the first stereo pair and preserves all additional channels', () => {
	const input = [sine(1000, 4113), sine(1000, 4113, 0.4), sine(330, 4113), sine(2200, 4113)];
	input[2][37] = Number.NaN;
	input[3][201] = Number.POSITIVE_INFINITY;
	for (const outputMode of ['both-channels', 'right-only']) {
		const params = { outputMode };
		const stereo = render(createVocoderProcessor({ sampleRate: rate, channelCount: 2, params }), input.slice(0, 2), 127);
		const surround = render(createVocoderProcessor({ sampleRate: rate, channelCount: 4, params }), input, 127);
		assert.deepEqual(surround.slice(0, 2), stereo);
		for (let channel = 2; channel < input.length; channel += 1) {
			const expected = Float32Array.from(input[channel], sample => Number.isFinite(sample) ? sample : 0);
			assert.deepEqual(surround[channel], expected);
		}
		assert.ok(surround.every(channel => channel.every(Number.isFinite)));
	}
});

test('vocoder noise and radar carriers are deterministic across arbitrary blocks and reset', () => {
	const input = [sine(800, 7891)];
	const options = { sampleRate: rate, channelCount: 1, params: { carrierLevel: 0, noiseLevel: 60, radarLevel: 50, bands: 240 } };
	const processor = createVocoderProcessor(options);
	const full = render(processor, input);
	assert.ok(full[0].some(sample => sample !== 0));
	assert.deepEqual(render(createVocoderProcessor(options), input, 113), full);
	processor.reset();
	assert.deepEqual(render(processor, input, 128), full);
	processor.updateParams({ outputGain: -6 });
	processor.reset();
	const quieter = render(processor, input, 128)[0];
	const scale = 10 ** (-6 / 20);
	for (let frame = 0; frame < quieter.length; frame += 1) assert.ok(Math.abs(quieter[frame] - full[0][frame] * scale) < 1e-7);
	processor.updateParams({ bands: 10, distance: 120, carrierLevel: 100 });
	assert.ok(render(processor, input)[0].every(Number.isFinite));
});

test('modulation processors reject invalid geometry and replace nonfinite samples with silence', () => {
	for (const create of [createTremoloProcessor, createVocoderProcessor]) {
		assert.throws(() => create({ sampleRate: 1, channelCount: 1 }), /sample rate/);
		assert.throws(() => create({ sampleRate: rate, channelCount: 0 }), /channel count/);
		const output = render(create({ sampleRate: rate, channelCount: 1 }), [new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, 0])])[0];
		assert.ok(output.every(sample => sample === 0));
	}
});
