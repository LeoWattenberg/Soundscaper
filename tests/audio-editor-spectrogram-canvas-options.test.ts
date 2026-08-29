/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSpectrogramCanvasOptions,
	spectrogramCanvasDrawKey,
	type SpectrogramCanvasOptions,
} from '../src/common/editor/ui/timeline/spectrogram-canvas-options.ts';

test('spectrogram canvas options preserve the complete per-track render contract', () => {
	assert.deepEqual(createSpectrogramCanvasOptions({
		scale: 'log',
		minimumFrequency: 125,
		maximumFrequency: 18_000,
		windowSize: 8_192,
		windowType: 'blackman',
		gain: -6,
		range: 96,
	}, 96_000), {
		scale: 'logarithmic',
		minFreq: 125,
		maxFreq: 18_000,
		fftWindowSize: 8_192,
		windowType: 'blackman',
		gainDb: -6,
		rangeDb: 96,
		sampleRate: 96_000,
	});
});

test('spectrogram canvas options use project defaults without losing a zero minimum frequency', () => {
	assert.deepEqual(createSpectrogramCanvasOptions(undefined, 48_000), {
		scale: 'mel',
		minFreq: 0,
		maxFreq: 20_000,
		fftWindowSize: 2_048,
		windowType: 'hann',
		gainDb: 20,
		rangeDb: 80,
		sampleRate: 48_000,
	});
	assert.equal(createSpectrogramCanvasOptions({ minimumFrequency: 0 }, 44_100).minFreq, 0);
});

test('spectrogram canvas draw keys change for every raster-affecting option', () => {
	const options = createSpectrogramCanvasOptions(undefined, 48_000);
	const variants: readonly SpectrogramCanvasOptions[] = [
		{ ...options, scale: 'linear' },
		{ ...options, minFreq: 10 },
		{ ...options, maxFreq: 18_000 },
		{ ...options, fftWindowSize: 4_096 },
		{ ...options, windowType: 'hamming' },
		{ ...options, gainDb: 10 },
		{ ...options, rangeDb: 96 },
		{ ...options, sampleRate: 44_100 },
	];
	const key = spectrogramCanvasDrawKey(options);
	for (const variant of variants) assert.notEqual(spectrogramCanvasDrawKey(variant), key);
});
