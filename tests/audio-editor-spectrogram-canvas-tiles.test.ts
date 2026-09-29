/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { preparePffftSpectrogram } from '../src/common/editor/pffft-spectrogram.js';
import { drawAudacityClipSpectrogram } from '../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx';

test('spectrogram canvas paints compact streamed columns through the right edge', () => {
	const rectangles: Array<{ x: number; width: number; color: string }> = [];
	const canvas = { dataset: {} as Record<string, string> };
	const context = {
		canvas,
		fillStyle: '',
		fillRect(x: number, _y: number, width: number) {
			rectangles.push({ x, width, color: this.fillStyle });
		},
	};
	drawAudacityClipSpectrogram(context, null, {
		width: 32,
		height: 16,
		backgroundColor: '#000',
		columns: {
			width: 32,
			pixelSkip: 4,
			channels: [Array.from({ length: 8 }, () => new Array(16).fill(0.001))],
		},
		fftWindowSize: 64,
		sampleRate: 48_000,
		gainDb: 20,
		rangeDb: 80,
	});

	assert.equal(canvas.dataset.spectrogramRenderer, 'pffft-wasm');
	const rightEdge = rectangles.filter((rectangle) => rectangle.x === 28 && rectangle.width === 4);
	assert.ok(rightEdge.length > 0);
	assert.deepEqual([...new Set(rightEdge.map(({ color }) => color))], ['#c32884']);
});

test('direct spectrogram renders FFT detail across more than 200 visible frequency bands', async () => {
	await preparePffftSpectrogram(2_048);
	const samples = Float32Array.from({ length: 8_192 }, (_, frame) => (
		Math.sin(2 * Math.PI * 440 * frame / 48_000)
	));
	const rows: number[] = [];
	const canvas = { dataset: {} as Record<string, string> };
	const context = {
		canvas,
		fillStyle: '',
		fillRect(x: number, y: number, width: number) {
			if (x === 4 && width === 1) rows.push(y);
		},
	};
	drawAudacityClipSpectrogram(context, [samples], {
		width: 8,
		height: 256,
		backgroundColor: '#000',
		fftWindowSize: 2_048,
		windowType: 'hann',
		sampleRate: 48_000,
		minFreq: 0,
		maxFreq: 20_000,
		scale: 'linear',
		gainDb: 20,
		rangeDb: 80,
	});

	assert.equal(canvas.dataset.spectrogramRenderer, 'pffft-wasm');
	assert.ok(rows.length > 200, `expected fine frequency detail, got ${rows.length} rows`);
});
