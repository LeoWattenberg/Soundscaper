/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { preparePffftSpectrogram } from '../src/common/editor/pffft-spectrogram.js';
import { drawAudacityClipSpectrogram } from '../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx';

function harness() {
	let paints = 0;
	let copies = 0;
	let allocations = 0;
	let bulkWrites = 0;
	let transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
	const surfaces: Array<{ width: number; height: number }> = [];
	const context = {
		canvas: {
			dataset: {} as Record<string, string>,
			ownerDocument: {
				createElement() {
					allocations += 1;
					const surface = { width: 0, height: 0, getContext: () => offscreen };
					surfaces.push(surface);
					return surface;
				},
			},
		},
		getTransform: () => ({ a: 2, d: 2 }),
		fillStyle: '',
		fillRect() {},
		drawImage() { copies += 1; },
	};
	const offscreen = {
		fillStyle: '',
		fillRect() { paints += 1; },
		setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
			transform = { a, b, c, d, e, f };
		},
		getTransform: () => transform,
		createImageData(width: number, height: number) {
			return { width, height, data: new Uint8ClampedArray(width * height * 4) };
		},
		putImageData() { bulkWrites += 1; },
		beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
	};
	return { context, surfaces, snapshot: () => ({ paints, copies, allocations, bulkWrites }) };
}

const OPTIONS = {
	width: 32, height: 16, backgroundColor: '#000', dividerColor: '#444',
	fftWindowSize: 64, windowType: 'hann', sampleRate: 48_000,
	scale: 'linear', minFreq: 0, maxFreq: 20_000, gainDb: 20, rangeDb: 80,
};

test('spectrogram redraw copies cached pixels and gain/geometry changes reuse FFT analysis', async () => {
	await preparePffftSpectrogram(64);
	const h = harness();
	let sampleReads = 0;
	const samples = { length: 1_024, sampleAt(index: number) {
		sampleReads += 1;
		return Math.sin(index / 8);
	} };
	const channels = [samples];
	drawAudacityClipSpectrogram(h.context, channels, OPTIONS);
	const first = h.snapshot();
	const firstReads = sampleReads;
	assert.equal(first.paints, 1, 'only the background uses a canvas rectangle');
	assert.equal(first.bulkWrites, 1, 'a cache miss uploads all spectral pixels together');
	assert.equal(first.copies, 1);
	assert.equal(first.allocations, 1);
	assert.equal(h.context.canvas.dataset.spectrogramRenderer, 'pffft-wasm');
	drawAudacityClipSpectrogram(h.context, channels, OPTIONS);
	assert.equal(h.snapshot().paints, first.paints, 'selection redraw does no color painting');
	assert.equal(h.snapshot().bulkWrites, first.bulkWrites, 'selection redraw does no bulk painting');
	assert.equal(h.snapshot().copies, 2);
	assert.equal(sampleReads, firstReads, 'selection redraw does no FFTs');
	drawAudacityClipSpectrogram(h.context, channels, { ...OPTIONS, gainDb: 40 });
	assert.ok(h.snapshot().paints > first.paints, 'gain changes raster intensity');
	assert.equal(sampleReads, firstReads, 'gain reuses FFT columns');
	assert.equal(h.surfaces[0]?.width, 0, 'the replaced raster releases its backing storage');
	drawAudacityClipSpectrogram(h.context, channels, { ...OPTIONS, height: 32 });
	assert.equal(sampleReads, firstReads, 'height changes reproject the cached analysis');
	drawAudacityClipSpectrogram(h.context, channels, { ...OPTIONS, fftWindowSize: 128 });
	assert.ok(sampleReads > firstReads, 'FFT window changes analyze again');
	const readsBeforeResize = sampleReads;
	drawAudacityClipSpectrogram(h.context, channels, { ...OPTIONS, width: 64 });
	assert.ok(sampleReads > readsBeforeResize, 'horizontal resolution changes sample positions');
});

test('streamed column changes, stereo ratio and device scale invalidate spectrogram pixels', () => {
	const h = harness();
	const columns = { pixelSkip: 4, channels: [
		Array.from({ length: 8 }, () => [0.01, 0.1]),
		Array.from({ length: 8 }, () => [0.1, 0.01]),
	] };
	drawAudacityClipSpectrogram(h.context, null, { ...OPTIONS, columns, channelHeightRatio: 0.5 });
	const first = h.snapshot();
	drawAudacityClipSpectrogram(h.context, null, { ...OPTIONS, columns, channelHeightRatio: 0.5 });
	assert.equal(h.snapshot().paints, first.paints);
	drawAudacityClipSpectrogram(h.context, null, { ...OPTIONS, columns, channelHeightRatio: 0.7 });
	assert.ok(h.snapshot().paints > first.paints);
	const resized = h.snapshot();
	h.context.getTransform = () => ({ a: 1, d: 1 });
	drawAudacityClipSpectrogram(h.context, null, { ...OPTIONS, columns, channelHeightRatio: 0.7 });
	assert.ok(h.snapshot().paints > resized.paints);
	assert.equal(h.surfaces.at(-1)?.width, OPTIONS.width);
	const beforeColumns = h.snapshot();
	drawAudacityClipSpectrogram(h.context, null, {
		...OPTIONS, columns: { ...columns, channels: columns.channels.map((channel) => channel.slice()) },
		channelHeightRatio: 0.7,
	});
	assert.ok(h.snapshot().paints > beforeColumns.paints);
});
