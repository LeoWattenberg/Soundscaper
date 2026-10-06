/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from './audio-editor-test-fixtures.js';

test('retained summary selection layers preserve pixels and read only fractional edge columns', async ({ page }) => {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL('../../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx', import.meta.url))],
		bundle: true, write: false, format: 'iife', globalName: 'waveformCanvas', target: 'es2022', external: ['./pffft.js'],
		loader: { '.css': 'empty' },
	});
	await page.addScriptTag({ content: bundled.outputFiles[0].text });
	const result = await page.evaluate(() => {
		const failures = [];
		const palette = { '--clip-blue-waveform': 'rgba(20,70,120,0.8)', '--clip-blue-time-selection-waveform': 'rgba(70,120,20,0.7)',
			'--clip-blue-waveform-rms': 'rgba(150,90,30,0.6)', '--clip-blue-time-selection-waveform-rms': 'rgba(90,30,150,0.5)',
			'--clip-blue-divider': 'rgba(10,20,30,0.35)', '--clip-blue-time-selection-body': 'rgba(220,230,240,0.15)' };
		const style = { colorScheme: 'light', getPropertyValue: property => palette[property] || '' };
		let comparisons = 0;
		for (const density of [1, 1.25, 1.5, 2]) for (const width of [120, 120.25]) {
			Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: density });
			for (const halfWave of [false, true]) for (const showRms of [false, true]) for (const waveformRulerFormat of ['linear-db', 'logarithmic-db']) {
				const channels = Array.from({ length: 2 }, (_, channel) => ({
					minimum: Float32Array.from({ length: 120 }, (_, index) => -0.1 - (index % 17) / 30),
					maximum: Float32Array.from({ length: 120 }, (_, index) => 0.1 + (index % 13 + channel) / 25),
					rms: Float32Array.from({ length: 120 }, (_, index) => 0.1 + (index % 11) / 35),
				}));
				const rendering = { mode: 'summary', pixelWidth: width, channels };
				const clip = { id: 'clip', sourceId: 'source', start: 0, duration: width, audacityWaveform: rendering };
				const canvases = [document.createElement('canvas'), document.createElement('canvas')];
				const options = { displayMode: 'waveform', pixelsPerSecond: 1, style, bounds: { width, height: 80 },
					showRms, halfWave, waveformRulerFormat, verticalZoom: 0, channelHeightRatio: 0.7 };
				for (const [startTime, endTime] of [[0, width], [0, 0], [1.3, 87.4], [3, 19], [0.25, 0.5], [0, width], [119.25, width], [75, 75]]) {
					for (let index = 0; index < canvases.length; index++) globalThis.waveformCanvas.drawAudacityClipCanvas(canvases[index], clip,
						{ ...options, timeSelection: { startTime, endTime }, cacheSelectionLayers: index === 1 });
					const pixels = canvases.map(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
					const mismatch = pixels[0].findIndex((value, index) => value !== pixels[1][index]);
					if (mismatch !== -1) failures.push({ density, width, halfWave, showRms, waveformRulerFormat, startTime, endTime, mismatch });
					comparisons++;
				}
			}
		}
		Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
		let reads = 0;
		const values = new Proxy(new Float32Array(1_000).fill(0.5), { get(target, key) {
			if (typeof key === 'string' && /^\d+$/u.test(key)) reads++;
			return Reflect.get(target, key, target);
		} });
		const canvas = document.createElement('canvas');
		const clip = { id: 'counted', sourceId: 'source', start: 0, duration: 1_000,
			audacityWaveform: { mode: 'summary', pixelWidth: 1_000, channels: [{ minimum: values, maximum: values }] } };
		const options = { displayMode: 'waveform', pixelsPerSecond: 1, style, bounds: { width: 1_000, height: 80 },
			showRms: false, halfWave: false, waveformRulerFormat: 'linear-db', verticalZoom: 0 };
		const fullCanvas = document.createElement('canvas');
		globalThis.waveformCanvas.drawAudacityClipCanvas(fullCanvas, clip, { ...options, timeSelection: { startTime: 0, endTime: 1_000 } });
		const coldFullSelectionReads = reads;
		reads = 0;
		globalThis.waveformCanvas.drawAudacityClipCanvas(fullCanvas, clip, { ...options, timeSelection: { startTime: 0, endTime: 1_000 } });
		const hotFullSelectionReads = reads;
		globalThis.waveformCanvas.drawAudacityClipCanvas(canvas, clip, { ...options, timeSelection: { startTime: 1, endTime: 900 } });
		reads = 0;
		globalThis.waveformCanvas.drawAudacityClipCanvas(canvas, clip, { ...options, timeSelection: { startTime: 2.25, endTime: 899.75 } });
		return { failures, comparisons, hotReads: reads, coldFullSelectionReads, hotFullSelectionReads };
	});
	expect(result.failures).toEqual([]); expect(result.comparisons).toBe(512); expect(result.hotReads).toBe(4);
	expect(result.coldFullSelectionReads).toBe(2_000); expect(result.hotFullSelectionReads).toBe(0);
});
