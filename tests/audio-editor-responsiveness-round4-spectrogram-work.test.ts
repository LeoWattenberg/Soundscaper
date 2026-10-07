/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { paintSpectrogram, pffftSpectrogramBandEnergies, preparePffftSpectrogram } from '../src/common/editor/pffft-spectrogram.js';

test('spectrogram band geometry is prepared once rather than per column or sample', async () => {
	await preparePffftSpectrogram(256);
	const input = Float32Array.from({ length: 4097 }, (_, frame) => Math.sin(frame * .071));
	const options = { fftWindowSize: 256, frequencyBands: 31, pixelSkip: 1 };
	pffftSpectrogramBandEnergies(input, 64, options);
	const original = Math.floor; let count = 0;
	Math.floor = (value: number): number => { count++; return original(value); };
	try { pffftSpectrogramBandEnergies(input, 64, options); } finally { Math.floor = original; }
	assert.ok(count <= 135, `64 column offsets, 62 band bounds and fixed geometry; got ${String(count)}`);
});

test('spectrogram projected accessors retain negative and trailing context reads', async () => {
	await preparePffftSpectrogram(64);
	const frames: number[] = [];
	const columns: unknown = pffftSpectrogramBandEnergies({ length: 7, sampleAt(frame: number) { frames.push(frame); return Math.sin(frame); } }, 7, { fftWindowSize: 64, frequencyBands: 7 });
	assert.ok(Array.isArray(columns));
	assert.equal(frames.length, 7 * 64);
	assert.equal(Math.min(...frames), -32);
	assert.equal(Math.max(...frames), 37);
});

test('spectrogram inverse scale endpoints are transformed only once per row plan', () => {
	const original = Math.log10; let count = 0;
	Math.log10 = (value: number): number => { count++; return original(value); };
	try {
		paintSpectrogram({ fillStyle: '', fillRect() {} }, [[.1, .2, .3, .4]], 0, 0, 1, 181,
			{ scale: 'mel', minFreq: 11.7, maxFreq: 3991, sampleRate: 8000 });
	} finally { Math.log10 = original; }
	assert.equal(count, 2 + 180 * 32);
});
