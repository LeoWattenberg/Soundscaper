/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { expect, test } from './audio-editor-test-fixtures.js';

const ROOT = '/__spectrogram-image-data__';
const syntheticRouteTest = test.extend({ browserCoverage: false });
let bundle;

syntheticRouteTest('bulk spectrogram pixels match rectangles across scales, stereo geometry and display densities', async ({ page }) => {
	await openPainterHarness(page);
	const result = await page.evaluate(async (root) => {
		const { paintSpectrogram, paintSpectrogramImageData, audioEditorStereoChannelGeometry } = await import(`${root}/painter.js`);
		const scales = ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period'];
		const shapes = [
			{ width: 48, height: 100, x: 2, y: 3 },
			{ width: 48.25, height: 100, x: 2, y: 3 },
			{ width: 48, height: 100.25, x: 2, y: 3 },
			{ width: 48.25, height: 100.25, x: 2, y: 3 },
			{ width: 48.5, height: 100.5, x: 0.5, y: 0.5 },
			{ width: 48.5, height: 100, x: 0.5, y: 0.5 },
		];
		const failures = [];
		let comparisons = 0;
		let bulkChannels = 0;
		let fallbackChannels = 0;
		for (const scale of scales) {
			for (const channelRatio of [null, 0.5, 0.7]) {
				for (const density of [1, 1.25, 1.5, 2, 3]) {
					for (const [shapeIndex, shape] of shapes.entries()) {
						const { width, height, x, y } = shape;
						const pixelSkip = [1, 3, 7][shapeIndex % 3];
						const options = {
							scale, pixelSkip, frequencyBands: 128, fftWindowSize: 1_024,
							minFreq: shapeIndex % 2 ? 800 : 0, maxFreq: 18_000, sampleRate: 48_000,
							...(shapeIndex % 2 ? { gainDb: 20, rangeDb: 80 } : {}),
						};
						const geometry = channelRatio === null ? [{ top: 0, height }]
							: audioEditorStereoChannelGeometry(height, channelRatio);
						const canvases = [document.createElement('canvas'), document.createElement('canvas')];
						for (const canvas of canvases) {
							canvas.width = Math.ceil((x + width + 3) * density);
							canvas.height = Math.ceil((y + height + 3) * density);
						}
						const contexts = canvases.map((canvas) => canvas.getContext('2d', { alpha: false }));
						for (const context of contexts) {
							context.fillStyle = '#132639';
							context.fillRect(0, 0, context.canvas.width, context.canvas.height);
							context.setTransform(density, 0, 0, density, 0, 0);
						}
						let puts = 0;
						let fills = 0;
						const originalPut = contexts[1].putImageData.bind(contexts[1]);
						const originalFill = contexts[1].fillRect.bind(contexts[1]);
						contexts[1].putImageData = (...args) => { puts += 1; originalPut(...args); };
						contexts[1].fillRect = (...args) => { fills += 1; originalFill(...args); };
						const label = JSON.stringify({ scale, channelRatio, density, ...shape });
						for (const [channel, region] of geometry.entries()) {
							const columns = Array.from({ length: Math.ceil(width / pixelSkip) }, (_, column) => (
								Float32Array.from({ length: 128 }, (_, band) => {
									if ((band + column + channel) % 19 === 0) return 0;
									return 10 ** (-5 + ((band * 13 + column * 7 + channel * 31) % 101) / 20);
								})
							));
							paintSpectrogram(contexts[0], columns, x, y + region.top, width, region.height, options);
							const beforePuts = puts;
							const beforeFills = fills;
							const painted = paintSpectrogramImageData(contexts[1], columns,
								x, y + region.top, width, region.height, options);
							const aligned = Number.isInteger(density) && [
								x * density, (y + region.top) * density, width * density, region.height * density,
							].every(Number.isInteger);
							if (painted !== aligned) failures.push(`${label}: channel ${channel} bulk=${painted}, aligned=${aligned}`);
							if (painted) {
								bulkChannels += 1;
								if (puts - beforePuts !== 1 || fills !== beforeFills) failures.push(`${label}: bulk used rectangle writes`);
							} else {
								fallbackChannels += 1;
								if (puts !== beforePuts || fills !== beforeFills) failures.push(`${label}: declined bulk changed canvas`);
								paintSpectrogram(contexts[1], columns, x, y + region.top, width, region.height, options);
							}
						}
						if (channelRatio !== null) {
							for (const context of contexts) {
								context.strokeStyle = '#90a4b8';
								context.lineWidth = 1;
								context.beginPath();
								context.moveTo(x, y + geometry[1].top);
								context.lineTo(x + width, y + geometry[1].top);
								context.stroke();
							}
						}
						const pixels = contexts.map((context) => context.getImageData(0, 0,
							context.canvas.width, context.canvas.height).data);
						const mismatch = pixels[0].findIndex((value, index) => value !== pixels[1][index]);
						if (mismatch >= 0) failures.push(`${label}: byte ${mismatch}, expected ${pixels[0][mismatch]}, actual ${pixels[1][mismatch]}`);
						comparisons += 1;
					}
				}
			}
		}
		return { failures, comparisons, bulkChannels, fallbackChannels };
	}, ROOT);
	expect(result.failures).toEqual([]);
	expect(result.comparisons).toBe(540);
	expect(result.bulkChannels).toBeGreaterThan(0);
	expect(result.fallbackChannels).toBeGreaterThan(0);
});

syntheticRouteTest('cold cached spectrogram painting preserves stereo divider and fractional backing pixels', async ({ page }) => {
	await openPainterHarness(page);
	const result = await page.evaluate(async (root) => {
		const { drawAudacityClipSpectrogram, releaseSpectrogramCanvas, paintSpectrogram,
			audioEditorStereoChannelGeometry } = await import(`${root}/painter.js`);
		const failures = [];
		let bulkWrites = 0;
		let fractionalFallbacks = 0;
		for (const density of [1, 1.25, 1.5, 2, 3]) {
			for (const channelRatio of [null, 0.5, 0.7]) {
				for (const fractional of [false, true]) {
					const width = fractional ? 48.25 : 48;
					const height = fractional ? 100.25 : 100;
					const channelCount = channelRatio === null ? 1 : 2;
					const columns = Array.from({ length: channelCount }, (_, channel) => (
						Array.from({ length: Math.ceil(width) }, (_, column) => (
							Float32Array.from({ length: 256 }, (_, band) => ((column * 13 + band * 7 + channel * 19) % 101) / 100)
						))
					));
					const options = {
						width, height, channelHeightRatio: channelRatio, columns: { channels: columns, pixelSkip: 1 },
						backgroundColor: '#14283c', dividerColor: '#90a4b8', fftWindowSize: 1_024,
						scale: 'bark', minFreq: 500, maxFreq: 18_000, windowType: 'hann',
						gainDb: 20, rangeDb: 80, sampleRate: 48_000,
					};
					const canvases = [document.createElement('canvas'), document.createElement('canvas')];
					for (const canvas of canvases) {
						canvas.width = Math.ceil(width * density);
						canvas.height = Math.ceil(height * density);
					}
					const contexts = canvases.map((canvas) => canvas.getContext('2d', { alpha: false }));
					for (const context of contexts) context.setTransform(density, 0, 0, density, 0, 0);
					const reference = document.createElement('canvas');
					reference.width = canvases[0].width;
					reference.height = canvases[0].height;
					const target = reference.getContext('2d', { alpha: false });
					target.setTransform(reference.width / width, 0, 0, reference.height / height, 0, 0);
					target.fillStyle = options.backgroundColor;
					target.fillRect(0, 0, width, height);
					const geometry = channelCount === 1 ? [{ top: 0, height }]
						: audioEditorStereoChannelGeometry(height, channelRatio);
					for (const [channel, region] of geometry.entries()) {
						paintSpectrogram(target, columns[channel], 0, region.top, width, region.height, options);
					}
					if (channelCount > 1) {
						target.strokeStyle = options.dividerColor;
						target.lineWidth = 1;
						target.beginPath();
						target.moveTo(0, geometry[1].top);
						target.lineTo(width, geometry[1].top);
						target.stroke();
					}
					contexts[0].drawImage(reference, 0, 0, width, height);
					let writes = 0;
					const nativePut = CanvasRenderingContext2D.prototype.putImageData;
					CanvasRenderingContext2D.prototype.putImageData = function (...args) {
						writes += 1;
						return nativePut.apply(this, args);
					};
					try { drawAudacityClipSpectrogram(contexts[1], [], options); }
					finally { CanvasRenderingContext2D.prototype.putImageData = nativePut; }
					const expectedWrites = !fractional && Number.isInteger(density) ? channelCount : 0;
					if (writes !== expectedWrites) failures.push(`density ${density}, ratio ${channelRatio}, fractional ${fractional}: ${writes} bulk writes`);
					bulkWrites += writes;
					if (expectedWrites === 0) fractionalFallbacks += 1;
					const pixels = contexts.map((context) => context.getImageData(0, 0,
						context.canvas.width, context.canvas.height).data);
					const mismatch = pixels[0].findIndex((value, index) => value !== pixels[1][index]);
					if (mismatch >= 0) failures.push(`density ${density}, ratio ${channelRatio}, fractional ${fractional}: byte ${mismatch}`);
					releaseSpectrogramCanvas(canvases[1]);
				}
			}
		}
		return { failures, bulkWrites, fractionalFallbacks };
	}, ROOT);
	expect(result.failures).toEqual([]);
	expect(result.bulkWrites).toBe(15);
	expect(result.fractionalFallbacks).toBe(21);
});

syntheticRouteTest('reports warmed isolated spectrogram painter timings with identical pixels', async ({ page }, testInfo) => {
	await openPainterHarness(page);
	const result = await page.evaluate(async (root) => {
		const { paintSpectrogram, paintSpectrogramImageData } = await import(`${root}/painter.js`);
		const width = 1_024;
		const height = 256;
		const columns = Array.from({ length: width }, (_, column) => (
			Float32Array.from({ length: 256 }, (_, band) => ((band * 17 + column * 23) % 257) / 256)
		));
		const options = { scale: 'linear', minFreq: 0, maxFreq: 24_000, sampleRate: 48_000, gainDb: 20, rangeDb: 80 };
		const contexts = Array.from({ length: 2 }, () => {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			return canvas.getContext('2d', { alpha: false });
		});
		const painters = [
			() => paintSpectrogram(contexts[0], columns, 0, 0, width, height, options),
			() => paintSpectrogramImageData(contexts[1], columns, 0, 0, width, height, options),
		];
		const samples = [[], []];
		for (let trial = 0; trial < 7; trial += 1) {
			for (const index of trial % 2 ? [1, 0] : [0, 1]) {
				const start = performance.now();
				painters[index]();
				const elapsed = performance.now() - start;
				if (trial > 1) samples[index].push(elapsed);
			}
		}
		const pixels = contexts.map((context) => context.getImageData(0, 0, width, height).data);
		const mismatch = pixels[0].findIndex((value, index) => value !== pixels[1][index]);
		return { width, height, rectangleMilliseconds: samples[0], imageDataMilliseconds: samples[1], mismatch };
	}, ROOT);
	expect(result.mismatch).toBe(-1);
	await testInfo.attach('isolated-spectrogram-painter-timings.json', {
		body: JSON.stringify(result, null, 2), contentType: 'application/json',
	});
	console.log(`SOUNDSCAPER_SPECTROGRAM_PAINTER_TIMINGS ${JSON.stringify(result)}`);
});

async function openPainterHarness(page) {
	bundle ||= build({
		stdin: {
			contents: [
				"export { paintSpectrogram } from '../../src/common/editor/pffft-spectrogram.js';",
				"export { paintSpectrogramImageData } from '../../src/common/editor/ui/timeline/spectrogram-image-data.ts';",
				"export { audioEditorStereoChannelGeometry } from '../../src/common/editor/ui/timeline/stereo-channel-height-runtime.ts';",
				"export { drawAudacityClipSpectrogram, releaseSpectrogramCanvas } from '../../src/common/editor/ui/timeline/spectrogram-canvas-renderer.js';",
			].join('\n'),
			resolveDir: fileURLToPath(new URL('.', import.meta.url)),
		},
		// The fixtures supply analyzed columns; this harness does not initialize FFT or WASM.
		external: ['./pffft.js'],
		bundle: true, write: false, format: 'esm', target: 'es2022',
	});
	const bundled = await bundle;
	await page.route(`**${ROOT}/**`, async (route) => {
		if (new URL(route.request().url()).pathname.endsWith('/painter.js')) {
			await route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text });
		} else {
			await route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><title>Spectrogram pixel parity</title>',
			});
		}
	});
	await page.goto(`${ROOT}/index.html`);
}
