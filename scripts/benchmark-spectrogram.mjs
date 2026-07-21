#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { performance } from 'node:perf_hooks';
import {
	javascriptSpectrogramBandEnergies,
	pffftSpectrogramBandEnergies,
	preparePffftSpectrogram,
} from '../src/lib/tools/audio-editor/pffft-spectrogram.js';

const samples = Float32Array.from({ length: 4096 }, (_, index) =>
	Math.sin(2 * Math.PI * index / 37) * 0.7 + Math.sin(2 * Math.PI * index / 113) * 0.3);
const options = { fftWindowSize: 64, frequencyBands: 16, pixelSkip: 4 };
const width = 1024;
const iterations = 25;

await preparePffftSpectrogram(options.fftWindowSize);
javascriptSpectrogramBandEnergies(samples, width, options);
pffftSpectrogramBandEnergies(samples, width, options);

const javascriptMilliseconds = benchmark(() => javascriptSpectrogramBandEnergies(samples, width, options));
const pffftMilliseconds = benchmark(() => pffftSpectrogramBandEnergies(samples, width, options));
const speedup = javascriptMilliseconds / pffftMilliseconds;

console.log(`JavaScript recursive FFT: ${javascriptMilliseconds.toFixed(2)} ms/analysis`);
console.log(`PFFFT WebAssembly:       ${pffftMilliseconds.toFixed(2)} ms/analysis`);
console.log(`Speedup:                 ${speedup.toFixed(2)}x`);
if (!(speedup > 1)) {
	console.error('PFFFT did not beat the JavaScript baseline.');
	process.exitCode = 1;
}

function benchmark(callback) {
	const start = performance.now();
	for (let iteration = 0; iteration < iterations; iteration += 1) callback();
	return (performance.now() - start) / iterations;
}
