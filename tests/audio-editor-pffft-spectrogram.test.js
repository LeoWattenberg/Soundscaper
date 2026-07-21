import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	javascriptSpectrogramBandEnergies,
	pffftSpectrogramBandEnergies,
	preparePffftSpectrogram,
} from '../src/lib/tools/audio-editor/pffft-spectrogram.js';

test('PFFFT spectrogram analysis returns bounded finite frequency bands', async () => {
	await preparePffftSpectrogram(64);
	const samples = Float32Array.from({ length: 512 }, (_, index) => Math.sin(2 * Math.PI * index / 8));
	const columns = pffftSpectrogramBandEnergies(samples, 128, {
		fftWindowSize: 64,
		frequencyBands: 16,
		pixelSkip: 4,
	});
	assert.equal(columns.length, 32);
	assert.ok(columns.every((column) => column.length === 16));
	assert.ok(columns.flat().every((value) => Number.isFinite(value) && value >= 0));
	assert.ok(columns[0][4] > columns[0][0], 'the 1/8-rate tone is stronger in its expected band than at DC');
});

test('JavaScript benchmark baseline and PFFFT use matching output geometry', async () => {
	await preparePffftSpectrogram(64);
	const samples = Float32Array.from({ length: 1024 }, (_, index) => Math.sin(index / 9) * 0.75);
	const options = { fftWindowSize: 64, frequencyBands: 16, pixelSkip: 4 };
	const baseline = javascriptSpectrogramBandEnergies(samples, 256, options);
	const pffft = pffftSpectrogramBandEnergies(samples, 256, options);
	assert.equal(pffft.length, baseline.length);
	assert.deepEqual(pffft.map((column) => column.length), baseline.map((column) => column.length));
});
