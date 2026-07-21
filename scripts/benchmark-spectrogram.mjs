#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { performance } from 'node:perf_hooks';
import { fft as pffft, initializePffft, pffftSimdSize } from '../src/lib/tools/audio-editor/pffft.js';
import { pffftSpectrogramBandEnergies } from '../src/lib/tools/audio-editor/pffft-spectrogram.js';

const workloads = [
	{ name: 'Live partitioned convolution', size: 256, transforms: 4_096, inverse: true },
	{ name: 'Spectral overlap-add', size: 2_048, transforms: 512, inverse: true },
	{ name: 'Offline EQ convolution', size: 16_384, transforms: 64, inverse: true },
];

await initializePffft();
console.log(`PFFFT SIMD width: ${pffftSimdSize()}`);
let failed = !benchmarkSpectrogram();
for (const workload of workloads) {
	const input = Float64Array.from({ length: workload.size }, (_, index) =>
		Math.sin(2 * Math.PI * index / 37) * 0.7 + Math.sin(2 * Math.PI * index / 113) * 0.3);
	const pffftReal = new Float64Array(workload.size);
	const pffftImaginary = new Float64Array(workload.size);
	const javascriptReal = new Float64Array(workload.size);
	const javascriptImaginary = new Float64Array(workload.size);
	const runPffft = () => {
		pffftReal.set(input);
		pffftImaginary.fill(0);
		pffft(pffftReal, pffftImaginary, false);
		if (workload.inverse) pffft(pffftReal, pffftImaginary, true);
	};
	const runJavascript = () => {
		javascriptReal.set(input);
		javascriptImaginary.fill(0);
		javascriptFft(javascriptReal, javascriptImaginary, false);
		if (workload.inverse) javascriptFft(javascriptReal, javascriptImaginary, true);
	};
	runPffft();
	runJavascript();
	const pffftMilliseconds = benchmark(runPffft, workload.transforms);
	const javascriptMilliseconds = benchmark(runJavascript, workload.transforms);
	const speedup = javascriptMilliseconds / pffftMilliseconds;
	console.log(`${workload.name} (${workload.size}): JS ${javascriptMilliseconds.toFixed(3)} ms, PFFFT ${pffftMilliseconds.toFixed(3)} ms, ${speedup.toFixed(2)}x`);
	if (!(speedup > 1)) failed = true;
}
if (failed) {
	console.error('PFFFT did not beat the JavaScript baseline for every production workload.');
	process.exitCode = 1;
}

function benchmark(callback, iterations) {
	const start = performance.now();
	for (let iteration = 0; iteration < iterations; iteration += 1) callback();
	return (performance.now() - start) / iterations;
}

function benchmarkSpectrogram() {
	const samples = Float32Array.from({ length: 4_096 }, (_, index) =>
		Math.sin(2 * Math.PI * index / 37) * 0.7 + Math.sin(2 * Math.PI * index / 113) * 0.3);
	const width = 1_024;
	const options = { fftWindowSize: 64, frequencyBands: 16, pixelSkip: 4 };
	const runPffft = () => pffftSpectrogramBandEnergies(samples, width, options);
	const runJavascript = () => javascriptSpectrogramBandEnergies(samples, width, options);
	runPffft();
	runJavascript();
	const pffftMilliseconds = benchmark(runPffft, 25);
	const javascriptMilliseconds = benchmark(runJavascript, 25);
	const speedup = javascriptMilliseconds / pffftMilliseconds;
	console.log(`Spectrogram analysis (64): JS ${javascriptMilliseconds.toFixed(3)} ms, PFFFT ${pffftMilliseconds.toFixed(3)} ms, ${speedup.toFixed(2)}x`);
	return speedup > 1;
}

function javascriptSpectrogramBandEnergies(waveformData, width, options) {
	const samplesPerPixel = waveformData.length / width;
	const columns = [];
	for (let pixel = 0; pixel < width; pixel += options.pixelSkip) {
		const sampleIndex = Math.floor(pixel * samplesPerPixel);
		const window = Array.from({ length: options.fftWindowSize }, (_, index) =>
			(Number(waveformData[sampleIndex + index]) || 0)
			* (0.54 - 0.46 * Math.cos(2 * Math.PI * index / (options.fftWindowSize - 1))));
		const { real, imaginary } = recursiveFft(window);
		const binsPerBand = Math.floor(options.fftWindowSize / 2 / options.frequencyBands);
		const bands = new Array(options.frequencyBands).fill(0);
		for (let band = 0; band < bands.length; band += 1) {
			for (let bin = band * binsPerBand; bin < (band + 1) * binsPerBand; bin += 1) {
				bands[band] += Math.hypot(real[bin], imaginary[bin]) / binsPerBand;
			}
		}
		columns.push(bands);
	}
	return columns;
}

function recursiveFft(samples) {
	const size = samples.length;
	if (size <= 1) return { real: [...samples], imaginary: new Array(size).fill(0) };
	const even = recursiveFft(samples.filter((_, index) => index % 2 === 0));
	const odd = recursiveFft(samples.filter((_, index) => index % 2 === 1));
	const real = new Array(size);
	const imaginary = new Array(size);
	for (let index = 0; index < size / 2; index += 1) {
		const angle = -2 * Math.PI * index / size;
		const twiddleReal = Math.cos(angle) * odd.real[index] - Math.sin(angle) * odd.imaginary[index];
		const twiddleImaginary = Math.cos(angle) * odd.imaginary[index] + Math.sin(angle) * odd.real[index];
		real[index] = even.real[index] + twiddleReal;
		imaginary[index] = even.imaginary[index] + twiddleImaginary;
		real[index + size / 2] = even.real[index] - twiddleReal;
		imaginary[index + size / 2] = even.imaginary[index] - twiddleImaginary;
	}
	return { real, imaginary };
}

function javascriptFft(real, imaginary, inverse) {
	const size = real.length;
	for (let index = 1, reversed = 0; index < size; index += 1) {
		let bit = size >> 1;
		for (; reversed & bit; bit >>= 1) reversed ^= bit;
		reversed ^= bit;
		if (index < reversed) {
			let temporary = real[index]; real[index] = real[reversed]; real[reversed] = temporary;
			temporary = imaginary[index]; imaginary[index] = imaginary[reversed]; imaginary[reversed] = temporary;
		}
	}
	for (let length = 2; length <= size; length *= 2) {
		const angle = (inverse ? 2 : -2) * Math.PI / length;
		const stepReal = Math.cos(angle);
		const stepImaginary = Math.sin(angle);
		for (let start = 0; start < size; start += length) {
			let twiddleReal = 1;
			let twiddleImaginary = 0;
			for (let offset = 0; offset < length / 2; offset += 1) {
				const even = start + offset;
				const odd = even + length / 2;
				const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
				const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
				real[odd] = real[even] - oddReal;
				imaginary[odd] = imaginary[even] - oddImaginary;
				real[even] += oddReal;
				imaginary[even] += oddImaginary;
				const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
				twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
				twiddleReal = nextReal;
			}
		}
	}
	if (inverse) for (let index = 0; index < size; index += 1) {
		real[index] /= size;
		imaginary[index] /= size;
	}
}
