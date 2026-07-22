import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	pffftSpectrogramBandEnergies,
	pffftSpectrogramRevision,
	preparePffftSpectrogram,
} from '../src/common/editor/pffft-spectrogram.js';
import { isPffftReady } from '../src/common/editor/pffft.js';

test('PFFFT spectrogram analysis returns bounded finite frequency bands', async () => {
	assert.equal(isPffftReady(), false);
	assert.equal(pffftSpectrogramRevision(), 0);
	await preparePffftSpectrogram(64);
	assert.equal(isPffftReady(), true);
	assert.equal(pffftSpectrogramRevision(), 1);
	await preparePffftSpectrogram(64);
	assert.equal(pffftSpectrogramRevision(), 1);
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
