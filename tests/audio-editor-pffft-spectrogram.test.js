import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	paintSpectrogram,
	pffftSpectrogramBandEnergies,
	pffftSpectrogramCacheSnapshot,
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

test('PFFFT spectrogram scratch buffers do not leak energy between edge columns or calls', async () => {
	await preparePffftSpectrogram(64);
	const samples = Float32Array.from({ length: 70 }, (_, index) => index < 8 ? 1 : 0);
	const options = { fftWindowSize: 64, frequencyBands: 16, pixelSkip: 1 };
	const first = pffftSpectrogramBandEnergies(samples, 70, options);
	const second = pffftSpectrogramBandEnergies(samples, 70, options);

	assert.deepEqual(second, first);
	assert.ok(first.at(-1).every((energy) => Number.isFinite(energy)));
});

test('PFFFT spectrogram analysis honors the selected window function', async () => {
	await preparePffftSpectrogram(256);
	const samples = Float32Array.from({ length: 512 }, (_, index) => (
		Math.sin(2 * Math.PI * (index + 0.25) / 17)
	));
	const common = { fftWindowSize: 256, frequencyBands: 32, pixelSkip: 8 };
	const hann = pffftSpectrogramBandEnergies(samples, 32, { ...common, windowType: 'hann' });
	const hamming = pffftSpectrogramBandEnergies(samples, 32, { ...common, windowType: 'hamming' });
	const blackman = pffftSpectrogramBandEnergies(samples, 32, { ...common, windowType: 'blackman' });

	assert.notDeepEqual(hann, hamming);
	assert.notDeepEqual(hann, blackman);
	assert.notDeepEqual(hamming, blackman);
});

test('PFFFT spectrogram reuses one FFT scratch-buffer pair per window size', async () => {
	await preparePffftSpectrogram(128);
	const samples = Float32Array.from({ length: 256 }, (_, index) => Math.sin(2 * Math.PI * index / 16));
	const options = { fftWindowSize: 128, frequencyBands: 16, pixelSkip: 2 };
	const before = pffftSpectrogramCacheSnapshot();
	pffftSpectrogramBandEnergies(samples, 32, options);
	const afterFirst = pffftSpectrogramCacheSnapshot();
	pffftSpectrogramBandEnergies(samples, 32, options);
	const afterSecond = pffftSpectrogramCacheSnapshot();

	assert.equal(afterFirst.scratchAllocations, before.scratchAllocations + 1);
	assert.equal(afterSecond.scratchAllocations, afterFirst.scratchAllocations);
});

test('spectrogram painting groups contiguous rows by band without changing their colors', () => {
	const rectangles = [];
	const context = {
		fillStyle: '',
		fillRect(x, y, width, height) {
			rectangles.push({ x, y, width, height, color: this.fillStyle });
		},
	};
	const columns = [
		[0.01, 0.04, 0.09, 0.16],
		[0.16, 0.09, 0.04, 0.01],
		[0.02, 0.03, 0.04, 0.05],
	];
	const options = {
		frequencyBands: 4,
		intensityMultiplier: 1.5,
		maxFreq: 100,
		minFreq: 10,
		pixelSkip: 4,
		scale: 'linear',
	};
	paintSpectrogram(context, columns, 2, 3, 10, 17, options);

	assert.ok(rectangles.length <= columns.length * options.frequencyBands);
	assert.equal(rectangles.reduce((area, rectangle) => area + rectangle.width * rectangle.height, 0), 170);
	for (const [column, pixelX] of [0, 4, 8].entries()) {
		for (const pixelY of [0, 8, 16]) {
			const rectangle = rectangles.find((candidate) => (
				2 + pixelX >= candidate.x
				&& 2 + pixelX < candidate.x + candidate.width
				&& 3 + pixelY >= candidate.y
				&& 3 + pixelY < candidate.y + candidate.height
			));
			assert.ok(rectangle, `missing paint at column ${column}, row ${pixelY}`);
			assert.equal(rectangle.color, referenceSpectrogramColor(columns[column], pixelY, 17, options));
		}
	}
});

test('spectrogram painting aligns logarithmic crop rows with the full FFT Nyquist range', () => {
	const rectangles = [];
	const context = {
		fillStyle: '',
		fillRect(x, y, width, height) {
			rectangles.push({ x, y, width, height, color: this.fillStyle });
		},
	};
	const energies = [0.0001, 0.0016, 0.0256, 0.4096];
	const options = {
		frequencyBands: energies.length,
		intensityMultiplier: 1,
		maxFreq: 100,
		minFreq: 0,
		sampleRate: 400,
		pixelSkip: 1,
		scale: 'logarithmic',
	};
	paintSpectrogram(context, [energies], 0, 0, 1, 9, options);

	for (let pixelY = 0; pixelY < 9; pixelY += 1) {
		const rectangle = rectangles.find((candidate) => (
			pixelY >= candidate.y && pixelY < candidate.y + candidate.height
		));
		assert.ok(rectangle, `missing logarithmic row ${pixelY}`);
		assert.equal(rectangle.color, referenceSpectrogramColor(energies, pixelY, 9, options));
	}
});

test('spectrogram dB gain and range deterministically control raster intensity', () => {
	const paint = (gainDb, rangeDb) => {
		const colors = [];
		paintSpectrogram({
			fillStyle: '',
			fillRect(_x, _y, _width, _height) { colors.push(this.fillStyle); },
		}, [[0.0001, 0.01, 1]], 0, 0, 1, 4, {
			frequencyBands: 3,
			gainDb,
			maxFreq: 3,
			minFreq: 0,
			nyquistFrequency: 3,
			pixelSkip: 1,
			rangeDb,
			scale: 'linear',
		});
		return colors;
	};

	assert.deepEqual(paint(0, 80), [
		referenceSpectrogramDbColor(1, 0, 80),
		referenceSpectrogramDbColor(0.01, 0, 80),
		referenceSpectrogramDbColor(0.0001, 0, 80),
	]);
	assert.notDeepEqual(paint(20, 80), paint(0, 80));
	assert.notDeepEqual(paint(0, 40), paint(0, 80));
});

function referenceSpectrogramColor(energies, pixelY, height, options) {
	const normalized = 1 - pixelY / height;
	const nyquistFrequency = options.nyquistFrequency
		?? (Number.isFinite(options.sampleRate) ? options.sampleRate / 2 : options.maxFreq);
	const frequency = options.scale === 'logarithmic'
		? Math.expm1(
			Math.log1p(options.minFreq)
			+ normalized * (Math.log1p(options.maxFreq) - Math.log1p(options.minFreq)),
		)
		: options.minFreq + normalized * (options.maxFreq - options.minFreq);
	const band = Math.max(0, Math.min(energies.length - 1,
		Math.floor(frequency / nyquistFrequency * energies.length)));
	const maximum = Math.max(...energies, 1e-4);
	const intensity = Math.min(1, Math.sqrt(energies[band] / maximum) * options.intensityMultiplier);
	const red = Math.round(255 * Math.min(1, intensity * 1.7));
	const green = Math.round(255 * Math.max(0, Math.min(1, intensity * 1.7 - 0.45)));
	const blue = Math.round(255 * Math.max(0.02, 1 - intensity * 1.35));
	return `rgb(${red}, ${green}, ${blue})`;
}

function referenceSpectrogramDbColor(energy, gainDb, rangeDb) {
	const decibels = 20 * Math.log10(Math.max(Number.MIN_VALUE, energy));
	const intensity = Math.max(0, Math.min(1, (decibels + gainDb + rangeDb) / rangeDb));
	const red = Math.round(255 * Math.min(1, intensity * 1.7));
	const green = Math.round(255 * Math.max(0, Math.min(1, intensity * 1.7 - 0.45)));
	const blue = Math.round(255 * Math.max(0.02, 1 - intensity * 1.35));
	return `rgb(${red}, ${green}, ${blue})`;
}
