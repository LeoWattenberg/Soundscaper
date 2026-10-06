/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

// Exercise each browser's actual rasterizer: a recording context cannot detect
// the transparency seams caused by adjacent subpixel fillRect calls.
test('summary and RMS columns stay opaque at fractional clip widths and display scales', async ({ page }) => {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL('../../src/common/editor/audacity-waveform-renderer.js', import.meta.url))],
		bundle: true, write: false, format: 'iife', globalName: 'waveformRenderer', target: 'es2022',
	});
	await page.addScriptTag({ content: bundled.outputFiles[0].text });
	const results = await page.evaluate(() => {
		const results = [];
		for (const width of [163, 163.5, 163.984, 480.25]) {
			for (const ratio of [1, 1.25, 1.5, 2]) {
				const canvas = document.createElement('canvas');
				canvas.width = Math.round(width * ratio);
				canvas.height = 100;
				const context = canvas.getContext('2d');
				const pixelRatioX = canvas.width / width;
				context.scale(pixelRatioX, 1);
				// Distinct opaque peak/RMS colors expose compositing errors in either pass.
				globalThis.waveformRenderer.drawAudacityWaveformChannel(context, {
					mode: 'summary', pixelWidth: Math.ceil(width),
					channels: [{ minimum: [-1], maximum: [1], rms: [0.5] }],
				}, { width, centerY: 50, maxAmplitude: 40, pixelRatioX,
					sampleColor: '#102030', rmsColor: '#607080', showRms: true });
				for (const [y, expected] of [[20, [16, 32, 48, 255]], [50, [96, 112, 128, 255]]]) {
					const row = context.getImageData(0, y, canvas.width, 1).data;
					let mismatches = 0;
					for (let x = 0; x < canvas.width; x++) {
						if (expected.some((value, index) => row[x * 4 + index] !== value)) mismatches++;
					}
					results.push({ width, ratio, y, mismatches });
				}
			}
		}
		return results;
	});
	for (const result of results) expect(result.mismatches, JSON.stringify(result)).toBe(0);
});

for (const product of ['soundscaper', 'framescaper']) test.describe(`${product} waveform opacity`, () => {
	registerAudioEditorHooks();
	test('keeps waveform interiors opaque while scrolling fractional-width clips', async ({ page }, testInfo) => {
		const editor = await bootEditor(page, `${product === 'soundscaper' ? '' : '/framescaper'}/embed/en/`);
		const tone = createWavFixture({ name: 'fractional-width.wav', frequency: 220, duration: 8.004, channelCount: 1 });
		await importFiles(editor, [tone]);
		const waveform = clipByName(editor, tone.name).locator('canvas.clip-body__waveform');
		await expect(waveform).toHaveAttribute('data-waveform-renderer', 'audacity');
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		const timeline = editor.locator('[data-timeline]');
		for (const left of [0, 127, 349, 0]) {
			await timeline.evaluate((element, left) => { element.scrollLeft = left; }, left);
			await expect.poll(() => waveform.evaluate((canvas) => {
				const y = Math.floor(canvas.height / 2);
				const pixels = canvas.getContext('2d').getImageData(0, y, canvas.width, 1).data;
				let translucent = 0;
				for (let x = 2; x < canvas.width - 2; x++) if (pixels[x * 4 + 3] !== 255) translucent++;
				return translucent;
			})).toBe(0);
		}
		await page.screenshot({ path: testInfo.outputPath('waveform-without-gradient.png') });
	});
});

test('batched sample stems match individual round-cap compositing at every admitted scale', async ({ page }) => {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL('../../src/common/editor/audacity-waveform-renderer.js', import.meta.url))],
		bundle: true, write: false, format: 'iife', globalName: 'waveformRenderer', target: 'es2022',
	});
	await page.addScriptTag({ content: bundled.outputFiles[0].text });
	const mismatches = await page.evaluate(() => {
		const mismatches = [];
		for (const ratio of [0.25, 0.5, 1, 1.25, 1.5, 2]) for (const width of [163, 163.5, 480, 480.25]) {
			for (const offset of [0, 0.375]) for (const halfWave of [false, true]) for (const amplitudeScale of ['linear', 'db']) {
				const paint = (batchSampleStems) => {
					const canvas = document.createElement('canvas');
					canvas.width = Math.round(width * ratio); canvas.height = Math.round(100 * ratio);
					const context = canvas.getContext('2d');
					context.scale(canvas.width / width, ratio);
					context.translate(offset, offset);
					globalThis.waveformRenderer.drawAudacityWaveformChannel(context, {
						mode: 'stem', pixelWidth: width, pixelsPerSample: 4.05,
						channels: [{ firstSampleX: -0.375, samples: Float32Array.from({ length: 130 }, (_, index) => Math.sin(index) * 0.8) }],
					}, { width, centerY: 50, maxAmplitude: 40, pixelRatioX: canvas.width / width,
						halfWave, amplitudeScale, batchSampleStems, centerLineColor: 'rgba(0,255,0,0.3)',
						sampleColor: x => x < width / 2 ? 'rgba(30,60,90,0.4)' : 'rgba(60,90,120,0.6)',
						envelopeGain: x => 0.2 + Math.max(0, Math.min(1, x / width)) * 0.8 });
					return context.getImageData(0, 0, canvas.width, canvas.height).data;
				};
				const individual = paint(false); const batched = paint(true);
				let changed = 0;
				for (let index = 0; index < individual.length; index++) if (individual[index] !== batched[index]) changed++;
				if (changed) mismatches.push({ ratio, width, offset, halfWave, amplitudeScale, changed });
			}
		}
		return mismatches;
	});
	expect(mismatches).toEqual([]);
});

test('native stem capability proof preserves owner pixels and caches exact batching admission', async ({ page, browserName }) => {
	const bundled = await build({
		stdin: { contents: "export { drawAudacityWaveformChannel } from './audacity-waveform-renderer.js'; export { canBatchRoundCapStems } from './waveform-stem-batch-capability.ts';",
			resolveDir: fileURLToPath(new URL('../../src/common/editor/', import.meta.url)) },
		bundle: true, write: false, format: 'iife', globalName: 'nativeWaveform', target: 'es2022',
	});
	await page.addScriptTag({ content: bundled.outputFiles[0].text });
	const result = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 4_000; canvas.height = 100;
		const context = canvas.getContext('2d');
		context.fillStyle = 'rgba(18,52,86,0.5)'; context.fillRect(1, 2, 7, 9);
		const before = context.getImageData(0, 0, canvas.width, canvas.height).data;
		const surfaces = [];
		const createElement = document.createElement.bind(document);
		document.createElement = (name, ...args) => {
			const element = createElement(name, ...args);
			if (name === 'canvas') surfaces.push(element);
			return element;
		};
		let supported; let coldAllocations; let warmAllocations;
		try {
			supported = globalThis.nativeWaveform.canBatchRoundCapStems(context);
			coldAllocations = surfaces.length;
			globalThis.nativeWaveform.canBatchRoundCapStems(context);
			warmAllocations = surfaces.length;
		} finally { document.createElement = createElement; }
		const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
		const ownerUnchanged = before.every((value, index) => value === after[index]);
		let strokes = 0;
		const stroke = context.stroke.bind(context);
		context.stroke = (...args) => { strokes++; return stroke(...args); };
		const rendering = { mode: 'stem', pixelWidth: 4_000, pixelsPerSample: 4,
			channels: [{ firstSampleX: 0, samples: new Float32Array(1_000).fill(0.5) }] };
		const paint = (batchSampleStems, sampleColor = '#123456') => {
			context.clearRect(0, 0, canvas.width, canvas.height); strokes = 0;
			globalThis.nativeWaveform.drawAudacityWaveformChannel(context, rendering,
				{ width: 4_000, centerY: 50, maxAmplitude: 40, centerLineColor: '#777', batchSampleStems, sampleColor });
			return strokes;
		};
		return { supported, coldAllocations, warmAllocations, ownerUnchanged,
			released: surfaces.every(surface => surface.width === 0 && surface.height === 0),
			individualStrokes: paint(false), batchedStrokes: paint(true),
			selectedStrokes: paint(true, x => x < 2_000 ? '#123456' : '#654321') };
	});
	expect(result.coldAllocations).toBe(2);
	expect(result.warmAllocations).toBe(2);
	expect(result.ownerUnchanged).toBe(true);
	expect(result.released).toBe(true);
	expect(result.individualStrokes).toBe(1_001);
	expect(result.batchedStrokes).toBe(result.supported ? 2 : 1_001);
	expect(result.selectedStrokes).toBe(result.supported ? 3 : 1_001);
	if (browserName === 'chromium' || browserName === 'firefox') expect(result.supported).toBe(true);
});
