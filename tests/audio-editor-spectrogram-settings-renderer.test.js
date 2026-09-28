/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	pffftSpectrogramBandEnergies,
	preparePffftSpectrogram,
	renderPffftSpectrogram,
} from '../src/common/editor/pffft-spectrogram.js';
import { createSpectrogramCanvasOptions } from '../src/common/editor/ui/timeline/spectrogram-canvas-options.ts';

const SAMPLE_RATE = 48_000;
const WIDTH = 8;
const HEIGHT = 96;
const SETTINGS = Object.freeze({
	scale: 'linear',
	minimumFrequency: 0,
	maximumFrequency: 20_000,
	windowSize: 1_024,
	windowType: 'hann',
	gain: 10,
	range: 80,
});

function mixedTone() {
	return Float32Array.from({ length: 8_192 }, (_, frame) => (
		0.35 * Math.sin(2 * Math.PI * frame / 53.7)
		+ 0.15 * Math.sin(2 * Math.PI * frame / 14.3)
		+ 0.07 * Math.sin(2 * Math.PI * frame / 5.4)
	));
}

function rasterFor(samples, settings) {
	const pixels = Array(WIDTH * HEIGHT).fill(null);
	const context = {
		fillStyle: '',
		fillRect(x, y, width, height) {
			for (let row = y; row < y + height; row += 1) {
				for (let column = x; column < x + width; column += 1) {
					pixels[row * WIDTH + column] = this.fillStyle;
				}
			}
		},
	};
	const options = createSpectrogramCanvasOptions(settings, SAMPLE_RATE);
	assert.equal(renderPffftSpectrogram(context, samples, 0, 0, WIDTH, HEIGHT, {
		...options,
		frequencyBands: 16,
		pixelSkip: 1,
	}), true);
	assert.ok(pixels.every((pixel) => typeof pixel === 'string'), 'the renderer must fill every pixel');
	return pixels;
}

function bandsFor(samples, settings) {
	const options = createSpectrogramCanvasOptions(settings, SAMPLE_RATE);
	const columns = pffftSpectrogramBandEnergies(samples, WIDTH, {
		...options,
		frequencyBands: 16,
		pixelSkip: 1,
	});
	assert.ok(columns, 'PFFFT should be ready before analyzing');
	return columns;
}

test('PFFFT spectrogram settings alter the painted frequency and intensity raster', async () => {
	await preparePffftSpectrogram(SETTINGS.windowSize);
	const samples = mixedTone();
	const baseline = rasterFor(samples, SETTINGS);
	assert.ok(new Set(baseline).size > 8, 'the source needs varied spectral color');
	for (const [setting, value] of Object.entries({
		scale: 'logarithmic',
		minimumFrequency: 1_000,
		maximumFrequency: 8_000,
		gain: 40,
		range: 40,
	})) {
		const variant = rasterFor(samples, { ...SETTINGS, [setting]: value });
		const changedPixels = variant.filter((color, index) => color !== baseline[index]).length;
		assert.ok(changedPixels > 10, `${setting} changed only ${changedPixels} pixels`);
	}
});

test('PFFFT spectrogram FFT size and window type alter analyzed band energies', async () => {
	await preparePffftSpectrogram(SETTINGS.windowSize);
	const samples = mixedTone();
	const baseline = bandsFor(samples, SETTINGS);
	assert.ok(Math.max(...baseline.flat()) > 0.01, 'the source needs spectral energy');
	for (const [setting, value] of Object.entries({
		windowSize: 2_048,
		windowType: 'blackman',
	})) {
		const variant = bandsFor(samples, { ...SETTINGS, [setting]: value });
		const maximumDifference = Math.max(...baseline.flatMap((bands, column) => (
			bands.map((energy, band) => Math.abs(energy - variant[column][band]))
		)));
		assert.ok(maximumDifference > 0.001,
			`${setting} changed band energy by only ${maximumDifference}`);
	}
});
