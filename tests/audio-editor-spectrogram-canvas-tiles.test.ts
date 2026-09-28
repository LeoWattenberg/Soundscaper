/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

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
			channels: [Array.from({ length: 8 }, () => new Array(16).fill(0.5))],
		},
		fftWindowSize: 64,
		sampleRate: 48_000,
		gainDb: 20,
		rangeDb: 80,
	});

	assert.equal(canvas.dataset.spectrogramRenderer, 'pffft-wasm');
	assert.ok(rectangles.some((rectangle) => rectangle.x === 28
		&& rectangle.width === 4 && rectangle.color !== '#000'));
});
