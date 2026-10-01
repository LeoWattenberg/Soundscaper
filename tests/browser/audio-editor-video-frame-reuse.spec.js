/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { expect, test } from './audio-editor-test-fixtures.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';

const ROOT = '/__video-frame-reuse__';
const syntheticRouteTest = test.extend({ browserCoverage: false });

syntheticRouteTest('reuses decoded video frames while refreshing animated effects and paused seeks', async ({ browserName, page }) => {
	test.skip(browserName !== 'chromium', 'Frame identity and upload counts are qualified with the Chromium decoder.');
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL('../../src/common/editor/ui/video-preview-compositor.js', import.meta.url))],
		bundle: true, write: false, format: 'esm', target: 'es2022',
	});
	await page.route(`**${ROOT}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/compositor.js')) {
			await route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text });
		} else if (path.endsWith('/movie.webm')) {
			await route.fulfill({ contentType: 'video/webm', body: videoPreviewBenchmarkMedia.file.buffer });
		} else {
			await route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><title>Video frame reuse</title>',
			});
		}
	});
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async (root) => {
		const { createVideoPreviewCompositor } = await import(`${root}/compositor.js`);
		const video = document.createElement('video');
		video.muted = true;
		video.playsInline = true;
		video.style.visibility = 'hidden';
		document.body.append(video);
		const loaded = new Promise((resolve, reject) => {
			video.addEventListener('loadeddata', resolve, { once: true });
			video.addEventListener('error', () => reject(video.error), { once: true });
		});
		video.src = `${root}/movie.webm`;
		await loaded;
		const canvas = document.createElement('canvas');
		canvas.width = 160;
		canvas.height = 90;
		document.body.append(canvas);
		const compositor = createVideoPreviewCompositor(canvas);
		const gl = compositor.gl;
		let uploads = 0;
		let draws = 0;
		const nativeImage = gl.texImage2D.bind(gl);
		const nativeSubImage = gl.texSubImage2D.bind(gl);
		const nativeDraw = gl.drawArrays.bind(gl);
		gl.texImage2D = (...args) => {
			if (args.at(-1) === video) uploads += 1;
			nativeImage(...args);
		};
		gl.texSubImage2D = (...args) => {
			if (args.at(-1) === video) uploads += 1;
			nativeSubImage(...args);
		};
		gl.drawArrays = (...args) => { draws += 1; nativeDraw(...args); };
		const effects = [{ id: 'reuse-color', type: 'color-adjust', enabled: true, params: { brightness: 0.2 } }];
		const layer = { entries: [{ clipId: 'reuse-clip', video, effects, opacity: 1 }] };
		const options = { outputWidth: 160, outputHeight: 90, outputColorModel: 'rgba' };
		const render = () => compositor.render([layer], options);
		try {
			render();
			const firstDraws = draws;
			for (let repeat = 0; repeat < 12; repeat += 1) render();
			const pausedUploads = uploads;
			const repeatedDraws = (draws - firstDraws) / 12;
			const layered = [
				{ entries: [{ clipId: 'reuse-bottom', video, opacity: 1, effects: [{
					...effects[0], id: 'bottom-color', params: { brightness: -0.1 },
				}] }] },
				{ entries: [{ clipId: 'reuse-top', video, opacity: 0.5, effects: [{
					...effects[0], id: 'top-color', params: { brightness: 0.15 },
				}] }] },
			];
			const renderLayered = () => {
				const before = draws;
				compositor.render(layered, options);
				const pixels = new Uint8Array(160 * 90 * 4);
				gl.readPixels(0, 0, 160, 90, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				return { pixels, draws: draws - before };
			};
			const equalPixels = (left, right) => left.every((value, index) => value === right[index]);
			const firstLayered = renderLayered();
			const repeatedLayered = renderLayered();
			layered[1].entries[0].effects = [{
				...layered[1].entries[0].effects[0], params: { brightness: 0.4 },
			}];
			const changedLayered = renderLayered();
			const repeatedChangedLayered = renderLayered();
			layered[1].entries[0].opacity = 0.25;
			const opacityLayered = renderLayered();
			layered[1].entries[0].renderDescription = {
				crop: {
					normalized: { left: 0, top: 0, right: 0, bottom: 0 },
					sourcePixels: { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight },
				},
				sourceDisplayToCanvas: [160 / video.videoWidth, 0, 0, 90 / video.videoHeight, 8, 0],
				opacityStart: 0.25, opacityEnd: 0.25, blendMode: 'normal', compositingOrder: 1,
			};
			const transformedLayered = renderLayered();
			const layeredCache = {
				repeatedDraws: repeatedLayered.draws,
				repeatedPixelsEqual: equalPixels(firstLayered.pixels, repeatedLayered.pixels),
				changedEffectDraws: changedLayered.draws,
				changedEffectPixelsDiffer: !equalPixels(repeatedLayered.pixels, changedLayered.pixels),
				changedEffectRepeatDraws: repeatedChangedLayered.draws,
				changedEffectRepeatPixelsEqual: equalPixels(changedLayered.pixels, repeatedChangedLayered.pixels),
				opacityDraws: opacityLayered.draws,
				opacityPixelsDiffer: !equalPixels(repeatedChangedLayered.pixels, opacityLayered.pixels),
				transformDraws: transformedLayered.draws,
				transformPixelsDiffer: !equalPixels(opacityLayered.pixels, transformedLayered.pixels),
			};
			const beforeAnimation = draws;
			// Effects resolve their animation before the compositor receives them.
			layer.entries[0].effects = [{ ...effects[0], params: { brightness: 0.4 } }];
			render();
			const animatedDraws = draws - beforeAnimation;
			const animationUploads = uploads;
			const beforeSeek = uploads;
			const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
			video.currentTime = 1;
			await seeked;
			render();
			const seekUploads = uploads - beforeSeek;
			await video.play();
			let renders = 0;
			const beforePlayback = uploads;
			await new Promise((resolve) => {
				const refresh = () => {
					render();
					render();
					renders += 2;
					if (renders === 120) resolve();
					else requestAnimationFrame(refresh);
				};
				requestAnimationFrame(refresh);
			});
			video.pause();
			return {
				pausedUploads, firstDraws, repeatedDraws, animatedDraws,
				animationUploads, seekUploads, renders, playbackUploads: uploads - beforePlayback,
				layeredCache,
			};
		} finally {
			compositor.dispose();
			video.pause();
			video.removeAttribute('src');
			video.load();
			video.remove();
		}
	}, ROOT);
	expect(result.pausedUploads).toBe(1);
	expect(result.animationUploads).toBe(1);
	expect(result.repeatedDraws).toBeLessThan(result.firstDraws);
	expect(result.layeredCache).toEqual({
		repeatedDraws: 3, repeatedPixelsEqual: true,
		changedEffectDraws: 6, changedEffectPixelsDiffer: true,
		changedEffectRepeatDraws: 3, changedEffectRepeatPixelsEqual: true,
		opacityDraws: 3, opacityPixelsDiffer: true,
		transformDraws: 3, transformPixelsDiffer: true,
	});
	expect(result.animatedDraws).toBeGreaterThan(result.repeatedDraws);
	expect(result.seekUploads).toBe(1);
	expect(result.playbackUploads).toBeGreaterThan(5);
	expect(result.playbackUploads).toBeLessThan(result.renders);
});
