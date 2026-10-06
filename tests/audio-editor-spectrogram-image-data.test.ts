/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { paintSpectrogram } from '../src/common/editor/pffft-spectrogram.js';
import { paintSpectrogramImageData } from '../src/common/editor/ui/timeline/spectrogram-image-data.ts';

const columns = [[0, 0.0001, 0.01, 1], [1, 0.01, 0.0001, 0], [0.1, 0.2, 0.3, 0.4]];

function harness(scaleX = 1, scaleY = scaleX) {
	const pixels = new Uint8ClampedArray(64 * 64 * 4);
	let writes = 0;
	let allocations = 0;
	const context = {
		getTransform: () => ({ a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 }),
		createImageData(width: number, height: number) {
			allocations += 1;
			return { width, height, data: new Uint8ClampedArray(width * height * 4) };
		},
		putImageData(image: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number) {
			writes += 1;
			for (let row = 0; row < image.height; row += 1) {
				pixels.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4),
					((y + row) * 64 + x) * 4);
			}
		},
	};
	return { context, pixels, counts: () => ({ writes, allocations }) };
}

for (const scale of ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period']) {
	test(`bulk spectral raster matches rectangle colors at every pixel for ${scale}`, () => {
		for (const density of [1, 2, 3]) {
			for (const gain of [{ gainDb: 20, rangeDb: 80 }, { intensityMultiplier: 1.5 }]) {
				const h = harness(density);
				const options = { scale, pixelSkip: 4, sampleRate: 48_000, minFreq: 100, maxFreq: 18_000, ...gain };
				const expected = new Uint8ClampedArray(h.pixels.length);
				const reference = {
					fillStyle: '',
					fillRect(x: number, y: number, width: number, height: number) {
						const hex = Number.parseInt(this.fillStyle.slice(1), 16);
						for (let row = y * density; row < (y + height) * density; row += 1) {
							for (let column = x * density; column < (x + width) * density; column += 1) {
								expected.set([hex >>> 16, (hex >>> 8) & 255, hex & 255, 255], (row * 64 + column) * 4);
							}
						}
					},
				};
				paintSpectrogram(reference, columns, 2, 3, 10, 17, options);
				assert.equal(paintSpectrogramImageData(h.context, columns, 2, 3, 10, 17, options), true);
				assert.deepEqual(h.pixels, expected, `density ${density}, ${JSON.stringify(gain)}`);
				assert.deepEqual(h.counts(), { writes: 1, allocations: 1 });
			}
		}
	});
}

test('bulk spectral raster leaves unpainted trailing columns untouched', () => {
	const h = harness();
	assert.equal(paintSpectrogramImageData(h.context, [columns[0]!], 0, 0, 10, 7, { pixelSkip: 4 }), true);
	for (let row = 0; row < 7; row += 1) {
		assert.equal(h.pixels[(row * 64 + 3) * 4 + 3], 255);
		assert.equal(h.pixels[(row * 64 + 4) * 4 + 3], 0);
	}
});

test('bulk spectral raster declines fractional and rotated geometry without touching pixels', () => {
	for (const density of [1.25, 1.5]) {
		const h = harness(density);
		assert.equal(paintSpectrogramImageData(h.context, columns, 0, 0, 10, 17), false);
		assert.deepEqual(h.counts(), { writes: 0, allocations: 0 });
	}
	for (const geometry of [[0.5, 0, 10, 17], [0, 0.7, 10, 17], [0, 0, 10.2, 17], [0, 0, 10, 17.2]]) {
		const h = harness();
		const [x, y, width, height] = geometry;
		assert.equal(paintSpectrogramImageData(h.context, columns, x!, y!, width!, height!, { pixelSkip: 4 }), false);
		assert.deepEqual(h.counts(), { writes: 0, allocations: 0 });
	}
	const h = harness();
	h.context.getTransform = () => ({ a: 1, b: 0.2, c: 0, d: 1, e: 0, f: 0 });
	assert.equal(paintSpectrogramImageData(h.context, columns, 0, 0, 10, 17), false);
	assert.deepEqual(h.counts(), { writes: 0, allocations: 0 });
});

test('bulk spectral raster accepts half CSS pixels aligned to double-density backing pixels', () => {
	const h = harness(2);
	assert.equal(paintSpectrogramImageData(h.context, columns, 0.5, 0.5, 10.5, 17.5, { pixelSkip: 4 }), true);
	assert.equal(h.pixels[(1 * 64 + 1) * 4 + 3], 255);
	assert.equal(h.pixels[(35 * 64 + 21) * 4 + 3], 255);
	assert.equal(h.pixels[(36 * 64 + 21) * 4 + 3], 0);
});

test('bulk spectral raster declines contexts without ImageData support', () => {
	assert.equal(paintSpectrogramImageData({}, columns, 0, 0, 10, 17), false);
});

test('fractional density bulk paints only when every frequency span and column is physically aligned', () => {
	const h = harness(1.25);
	assert.equal(paintSpectrogramImageData(h.context, columns.slice(0, 2), 0, 0, 8, 16,
		{ pixelSkip: 4, minFreq: 12_000, maxFreq: 12_001, sampleRate: 48_000 }), true);
	assert.deepEqual(h.counts(), { allocations: 1, writes: 1 });
	const unaligned = harness(1.25);
	assert.equal(paintSpectrogramImageData(unaligned.context, columns.slice(0, 2), 0, 0, 8, 16,
		{ pixelSkip: 4, minFreq: 0, maxFreq: 24_000, sampleRate: 48_000 }), false);
	assert.deepEqual(unaligned.counts(), { allocations: 0, writes: 0 });
});
