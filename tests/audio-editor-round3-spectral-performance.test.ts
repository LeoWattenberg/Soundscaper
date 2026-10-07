/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityClickRemoval, applyAudacityPaulstretch, applyAudacityNoiseReduction, captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { applySpectralGain, applySpectralReplacement } from '../src/common/editor/spectral-edit.js';
import { initializePffft } from '../src/common/editor/pffft.js';
import { round3Audio } from './helpers/round3-dsp-fixtures.ts';

await initializePffft();

test('Click Removal reuses one owned window and one three-array detector workspace', (context) => {
	const input = [round3Audio(20113), round3Audio(20113, 1)];
	const Float32 = Float32Array;
	const Float64 = Float64Array;
	let windows = 0;
	let detectorArrays = 0;
	context.mock.property(globalThis, 'Float32Array', new Proxy(Float32, {
		construct(target, args: [number]) { if (args[0] === 8192) windows++; return new target(...args); },
	}));
	context.mock.property(globalThis, 'Float64Array', new Proxy(Float64, {
		construct(target, args: [number]) { detectorArrays++; return new target(...args); },
	}));
	const output = applyAudacityClickRemoval(input, 8000);
	assert.equal(windows, 1);
	assert.equal(detectorArrays, 3);
	assert.notEqual(output[0], input[0]);
});

test('Paulstretch shares overlap weights and bounds accumulation to its FFT window', (context) => {
	const input = [round3Audio(3089), round3Audio(3089, 1), round3Audio(3089, 2)];
	const outputFrames = Math.ceil(input[0]!.length * 2.3);
	const Original = Float64Array;
	const lengths: number[] = [];
	context.mock.property(globalThis, 'Float64Array', new Proxy(Original, {
		construct(target, args: [number]) { lengths.push(args[0]); return new target(...args); },
	}));
	applyAudacityPaulstretch(input, 8000, { stretchFactor: 2.3, timeResolution: .032 }, { seed: 71 });
	assert.equal(lengths.filter(length => length === outputFrames).length, 1, 'one shared normalization, no full-length accumulation per channel');
});

test('Noise Reduction residue reuses rounded output instead of allocating another PCM result', (context) => {
	const input = [round3Audio(5099), round3Audio(5099, 1)];
	const profile = captureAudacityNoiseProfile([round3Audio(4097)], 8000);
	const Original = Float32Array;
	let pcmOutputs = 0;
	context.mock.property(globalThis, 'Float32Array', new Proxy(Original, {
		construct(target, args: [number]) { if (args[0] === 5099) pcmOutputs++; return new target(...args); },
	}));
	const output = applyAudacityNoiseReduction(input, 8000, { output: 'residue' }, profile);
	assert.equal(pcmOutputs, 2);
	assert.notEqual(output[0], input[0]);
});

test('Noise Reduction stores frame gains in one backing array rather than one allocation per FFT window', (context) => {
	const input = [round3Audio(5099), round3Audio(5099, 1)];
	const profile = captureAudacityNoiseProfile([round3Audio(4097)], 8000);
	const Original = Float32Array;
	let spectrumSizedArrays = 0;
	context.mock.property(globalThis, 'Float32Array', new Proxy(Original, {
		construct(target, args: [number]) { if (args[0] === 1025) spectrumSizedArrays++; return new target(...args); },
	}));
	applyAudacityNoiseReduction(input, 8000, {}, profile);
	assert.equal(spectrumSizedArrays, 10, 'five detector power slots per channel; frame gains need no individual buffers');
});

test('spectral gain and replacement share channel-independent normalization and sequential FFT scratch', (context) => {
	const input = [round3Audio(3089), round3Audio(3089, 1), round3Audio(3089, 2)];
	const options = { sampleRate: 8000, startFrame: 17, endFrame: 3088, windowSize: 256, gainDb: -7, maximumFrequency: 2301 };
	const Original = Float64Array;
	let lengths: number[] = [];
	context.mock.property(globalThis, 'Float64Array', new Proxy(Original, {
		construct(target, args: [number]) { lengths.push(args[0]); return new target(...args); },
	}));
	applySpectralGain(input, options);
	assert.equal(lengths.filter(length => length === 3071).length, 2);
	assert.equal(lengths.filter(length => length === 256).length, 3, 'window plus one real/imaginary pair');
	lengths = [];
	applySpectralReplacement(input, input, options);
	assert.equal(lengths.filter(length => length === 3071).length, 2);
	assert.equal(lengths.filter(length => length === 256).length, 5, 'window plus two real/imaginary pairs');
});
