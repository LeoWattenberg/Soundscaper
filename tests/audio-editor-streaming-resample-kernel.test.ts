/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { createWindowedSincChannelSampler } from '../src/common/editor/windowed-sinc-kernel.ts';

interface Resampler {
	push(channels: readonly Float32Array[]): readonly Float32Array[];
	finish(requestedFrames?: number | null): readonly Float32Array[];
}

function render(source: readonly Float32Array[], inputRate = 48_000, outputRate = 44_100): number[][] {
	const resampler = createStreamingWindowedSincResampler(inputRate, outputRate, source.length) as Resampler;
	const output = source.map(() => [] as number[]);
	function append(channels: readonly Float32Array[]): void {
		channels.forEach((channel, index) => output[index]!.push(...channel));
	}
	for (let offset = 0; offset < source[0]!.length; offset += 31) {
		append(resampler.push(source.map((channel) => channel.subarray(offset, offset + 31))));
	}
	append(resampler.finish());
	return output;
}

test('surround resampling computes one sinc kernel per output frame', (context) => {
	let sineCalls = 0;
	let cosineCalls = 0;
	const originalSin = Math.sin;
	const originalCos = Math.cos;
	context.mock.method(Math, 'sin', (value: number) => { sineCalls++; return originalSin(value); });
	context.mock.method(Math, 'cos', (value: number) => { cosineCalls++; return originalCos(value); });
	const signal = Float32Array.from({ length: 257 }, (_, index) => index % 17 / 17 - 0.5);
	render([signal]);
	const monoSineCalls = sineCalls;
	const monoCosineCalls = cosineCalls;
	sineCalls = 0;
	cosineCalls = 0;
	render(Array.from({ length: 8 }, () => signal));
	assert.ok(monoSineCalls > 0);
	assert.ok(monoCosineCalls > 0);
	assert.equal(sineCalls, monoSineCalls, 'sinc evaluation must not grow with channel count');
	assert.equal(cosineCalls, monoCosineCalls, 'window evaluation must not grow with channel count');
});

test('shared kernels preserve every channel at stream boundaries and different rate ratios', () => {
	const channels = Array.from({ length: 8 }, (_, channel) => Float32Array.from(
		{ length: 257 }, (_, index) => Math.sin(index * (channel + 1) * 0.17) + channel / 16,
	));
	for (const [inputRate, outputRate] of [[48_000, 44_100], [8_000, 48_000], [96_000, 8_000]]) {
		const expected = channels.map((channel) => render([channel], inputRate, outputRate)[0]);
		assert.deepEqual(render(channels, inputRate, outputRate), expected);
	}
});

test('shared convolution retains the established windowed-sinc PCM at edges and fractional positions', () => {
	const radius = 24;
	const cutoff = 0.94 * 44_100 / 48_000;
	const sample = createWindowedSincChannelSampler(radius, cutoff);
	const channels = Array.from({ length: 8 }, (_, channel) => Float32Array.from(
		{ length: 131 }, (_, frame) => Math.sin(frame * 0.37 + channel) * 0.7,
	));
	for (const bufferStart of [0, 17]) {
		const buffered = channels.map((channel) => channel.subarray(bufferStart));
		for (const position of [bufferStart + 0.25, 41, 62.73, 129.8, 130]) {
			const output = channels.map(() => new Float32Array(1));
			sample(buffered, bufferStart, 131, position, output, 0);
			channels.forEach((channel, channelIndex) => {
				let weighted = 0;
				let weightSum = 0;
				for (let frame = Math.floor(position) - radius + 1; frame <= Math.floor(position) + radius; frame++) {
					if (frame < bufferStart || frame >= channel.length) continue;
					const distance = position - frame;
					const normalized = Math.abs(distance) / radius;
					if (normalized >= 1) continue;
					const argument = Math.PI * distance * cutoff;
					const weight = cutoff * (argument === 0 ? 1 : Math.sin(argument) / argument)
						* (0.5 + 0.5 * Math.cos(Math.PI * normalized));
					weighted += channel[frame]! * weight;
					weightSum += weight;
				}
				assert.equal(output[channelIndex]![0], Math.fround(weighted / weightSum));
			});
		}
	}
});
