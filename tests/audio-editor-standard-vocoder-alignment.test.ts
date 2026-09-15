/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createVocoderProcessor } from '../src/common/editor/first-party-effects/standard/vocoder-dsp.ts';
import { evaluateNyquist, loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';

function sine(sampleRate: number, frequency: number, frames: number, amplitude = .8): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * frame / sampleRate));
}
function render(sampleRate: number, input: Float32Array[], params: Record<string, unknown> = {}): Float32Array {
	const output = input.map(channel => new Float32Array(channel.length));
	createVocoderProcessor({ sampleRate, channelCount: input.length, params }).processBlock(input, output, input[0].length);
	return output[output.length - 1];
}
function amplitude(samples: Float32Array, sampleRate: number, frequency: number): number {
	let real = 0;
	let imaginary = 0;
	const offset = Math.floor(samples.length / 2);
	for (let frame = offset; frame < samples.length; frame += 1) {
		const phase = 2 * Math.PI * frequency * frame / sampleRate;
		real += samples[frame] * Math.cos(phase);
		imaginary += samples[frame] * Math.sin(phase);
	}
	return 2 * Math.hypot(real, imaginary) / (samples.length - offset);
}
function bandCenter(sampleRate: number, bands: number, band: number): number {
	return 20 * (sampleRate / 2.205 / 20) ** ((band + .5) / bands);
}

test('mono vocoder uses the actual logarithmic band-center sine carrier', () => {
	const sampleRate = 48000;
	for (const bands of [10, 40, 240]) {
		const frequency = bandCenter(sampleRate, bands, Math.floor(bands * .55));
		const output = render(sampleRate, [sine(sampleRate, frequency, sampleRate)], { bands });
		const center = amplitude(output, sampleRate, frequency);
		const oldHarmonic = amplitude(output, sampleRate, 110 * Math.round(frequency / 110));
		assert.ok(center > .2, `center carrier is audible with ${bands} bands: ${center}`);
		assert.ok(center > oldHarmonic * 4, `band center dominates the former 110 Hz harmonic with ${bands} bands`);
	}
});

test('vocoder bands cover sample-rate-dependent frequencies above 16 kHz', () => {
	const sampleRate = 96000;
	const bands = 40;
	const frequency = bandCenter(sampleRate, bands, bands - 2);
	assert.ok(frequency > 30000);
	const input = sine(sampleRate, frequency, sampleRate / 2);
	const output = render(sampleRate, [input, input], { bands });
	assert.ok(amplitude(output, sampleRate, frequency) > .2, 'high-rate carrier band is retained');
});

test('vocoder bounded causal peak normalization provides comparable steady-state levels', () => {
	const sampleRate = 8000;
	const frequency = bandCenter(sampleRate, 40, 24);
	const loud = render(sampleRate, [sine(sampleRate, frequency, sampleRate * 2)]);
	const quiet = render(sampleRate, [sine(sampleRate, frequency, sampleRate * 2, .02)]);
	const loudAmplitude = amplitude(loud, sampleRate, frequency);
	const quietAmplitude = amplitude(quiet, sampleRate, frequency);
	assert.ok(quietAmplitude > loudAmplitude * .8, 'normalization compensates for a quieter modulator');
	assert.ok(quietAmplitude < loudAmplitude * 1.2);
	for (const output of [loud, quiet]) assert.ok(output.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
	const transient = new Float32Array(sampleRate);
	transient[100] = 1;
	const output = render(sampleRate, [transient], { noiseLevel: 100, radarLevel: 100 });
	assert.ok(output.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1), 'a first transient cannot exceed normalized unity');
});

test('vocoder carrier spectrum and envelope modulation remain close to bundled Nyquist functionality', async () => {
	const sampleRate = 8000;
	const frames = sampleRate * 2;
	const source = await readFile(new URL('../src/common/editor/nyquist/plugins/vocoder.ny', import.meta.url), 'utf8');
	// The JavaScript loader supports byte views, although its inferred default
	// argument type is URL. Keep the adapter specific to the supported input.
	const loadBytes = loadNyquistWasm as unknown as (source: Uint8Array) => ReturnType<typeof loadNyquistWasm>;
	const runtime = await loadBytes(await readFile(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const controls = { DST: 20, MST: 0, BANDS: 40, 'TRACK-VL': 100, 'NOISE-VL': 0, 'RADAR-VL': 0, 'RADAR-F': 30 };
	const frequency = bandCenter(sampleRate, 40, 30);
	for (const stereo of [false, true]) {
		const modulator = sine(sampleRate, frequency, frames);
		for (let frame = 0; frame < frames; frame += 1) modulator[frame] *= .6 + .4 * Math.sin(2 * Math.PI * 100 * frame / sampleRate);
		const input = stereo ? [modulator, sine(sampleRate, frequency, frames)] : [modulator];
		const reference = await evaluateNyquist({ source, sampleRate, channels: input, controls, maxOutputFrames: frames }, runtime);
		assert.equal(reference.type, 'audio');
		if (reference.type !== 'audio') throw new Error('Expected Nyquist audio.');
		assert.ok(reference.channels);
		const expected = reference.channels[reference.channels.length - 1];
		const actual = render(sampleRate, input);
		const expectedCenter = amplitude(expected, sampleRate, frequency);
		const actualCenter = amplitude(actual, sampleRate, frequency);
		assert.ok(actualCenter / expectedCenter > .6 && actualCenter / expectedCenter < 1.4, `comparable steady carrier level: ${actualCenter / expectedCenter}`);
		const expectedSideband = amplitude(expected, sampleRate, frequency + 100) / expectedCenter;
		const actualSideband = amplitude(actual, sampleRate, frequency + 100) / actualCenter;
		assert.ok(Math.abs(actualSideband - expectedSideband) < .02, `envelope ripple matches the reference: ${actualSideband} vs ${expectedSideband}`);
	}
});
