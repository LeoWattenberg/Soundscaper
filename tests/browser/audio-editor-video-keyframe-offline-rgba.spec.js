/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROUTE_ROOT = '/__video-keyframe-offline-rgba__';

test('renders one exact keyed RGBA frame through the real compositor with top-down orientation', async ({
	browserName,
	page,
}) => {
	test.skip(browserName !== 'chromium', 'The dormant offline renderer uses the maintained Chromium WebGL path.');
	await installModuleRoutes(page);
	await page.goto(`${ROUTE_ROOT}/index.html`);
	const result = await page.evaluate(async (root) => {
		const [{ resolveRuntimeProjectProjection }, frameSourceModule, rendererModule] = await Promise.all([
			import(`${root}/src/common/editor/runtime-clip-projection.ts`),
			import(`${root}/src/common/editor/video-keyframe-export-frame-source.ts`),
			import(`${root}/src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts`),
		]);
		const project = resolveRuntimeProjectProjection(createProject());
		const frameSource = frameSourceModule.createVideoKeyframeExportFrameSource({
			project,
			canvas: { width: 64, height: 64, frameRate: 2 },
		});
		const source = createSourceCanvas();
		let presentCalls = 0;
		let disposeCalls = 0;
		const presentation = Object.freeze({
			sourceId: 'source-1',
			identity: 'sha256:offline-rgba-source-1',
			drawable: source,
			decodedWidth: 32,
			decodedHeight: 16,
			// Non-square display aperture proves decode and display geometry stay separate.
			displayWidth: 24,
			displayHeight: 16,
			present: () => { presentCalls += 1; },
			dispose: () => { disposeCalls += 1; },
		});
		const outputCanvas = document.createElement('canvas');
		document.body.append(outputCanvas);
		const renderer = rendererModule.createVideoKeyframeOfflineRgbaRenderer({
			frameSource,
			canvas: outputCanvas,
			resolveSource: () => presentation,
		});
		const first = new Uint8Array(renderer.byteLength);
		const second = first;
		await renderer.produce(frameSource.frame(0), first, { signal: new AbortController().signal });
		const firstPixels = landmarks(first, renderer.width);
		await renderer.produce(frameSource.frame(1), second, { signal: new AbortController().signal });
		const secondPixels = landmarks(second, renderer.width);
		await renderer.dispose();
		return {
			root,
			firstPixels,
			secondPixels,
			presentCalls,
			disposeCalls,
			reusedBuffer: first === second,
			canvas: { width: outputCanvas.width, height: outputCanvas.height },
		};

		function createProject() {
			return {
				schemaVersion: 9,
				sampleRate: 64,
				primarySequenceId: 'sequence-1',
				sequences: [{ id: 'sequence-1', type: 'video', rate: { num: 2, den: 1 }, trackIds: ['track-1'] }],
				sources: [{
					id: 'source-1', kind: 'video', sampleRate: 64,
					frameRate: { num: 2, den: 1 }, sourceFrameCount: 2,
					width: 24, height: 16,
				}],
				clips: [{
					id: 'clip-1', kind: 'video', sourceId: 'source-1', sequenceId: 'sequence-1',
					sequenceStartFrame: 0, sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
					videoComposition: {
						schemaVersion: 1,
						crop: { left: 0, top: 0, right: 0, bottom: 0 },
						transform: {
							anchorX: 0.5, anchorY: 0.5, positionX: 0.5, positionY: 0.5,
							scaleX: 1, scaleY: 1, rotationDegrees: 0,
							flipHorizontal: false, flipVertical: false,
						},
						opacity: 1, blendMode: 'normal', compositingOrder: 0,
					},
					videoEffects: [{
						id: 'vignette-1', type: 'vignette', enabled: true, params: { amount: 0.7 },
					}],
					videoKeyframes: {
						schemaVersion: 1,
						timeDomain: {
							authoredDuration: { num: 2, den: 1 },
							viewStart: { num: 0, den: 1 },
							viewDuration: { num: 2, den: 1 },
						},
						curves: [{
							target: { kind: 'composition', parameterId: 'opacity' },
							curve: {
								anchors: [
									{ position: { num: 0, den: 1 }, value: 1 },
									{ position: { num: 2, den: 1 }, value: 0.5 },
								],
								segments: [{ kind: 'linear' }],
							},
						}],
					},
				}],
				tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
				projectBin: { clips: [] },
			};
		}

		function createSourceCanvas() {
			const canvas = document.createElement('canvas');
			canvas.width = 32;
			canvas.height = 16;
			const context = canvas.getContext('2d', { alpha: false });
			context.fillStyle = '#ff0000';
			context.fillRect(0, 0, 32, 8);
			context.fillStyle = '#0000ff';
			context.fillRect(0, 8, 32, 8);
			context.fillStyle = '#00ff00';
			context.fillRect(0, 0, 8, 16);
			return canvas;
		}

		function landmarks(bytes, width) {
			const at = (x, y) => [...bytes.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
			return {
				top: at(32, 20),
				bottom: at(32, 43),
			};
		}
	}, ROUTE_ROOT);

	expect(result.reusedBuffer).toBe(true);
	expect(result.presentCalls).toBe(2);
	expect(result.disposeCalls).toBe(1);
	expect(result.canvas).toEqual({ width: 64, height: 64 });
	// The top half remains red and the bottom remains blue after WebGL readback row inversion.
	expect(result.firstPixels.top[0]).toBeGreaterThan(result.firstPixels.top[2] * 2);
	expect(result.firstPixels.bottom[2]).toBeGreaterThan(result.firstPixels.bottom[0] * 2);
	// The exact second keyframe sample lowers alpha/color energy without changing orientation.
	expect(result.secondPixels.top[0]).toBeLessThan(result.firstPixels.top[0]);
	expect(result.secondPixels.bottom[2]).toBeLessThan(result.firstPixels.bottom[2]);
});

test.beforeEach(async ({ page }) => {
	await page.route(`**${ROUTE_ROOT}/index.html`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: '<!doctype html><meta charset="utf-8"><title>offline RGBA renderer</title>',
		});
	});
});

async function installModuleRoutes(page) {
	const modules = await transpileEditorModules();
	await page.route(`**${ROUTE_ROOT}/src/common/editor/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		const body = modules.get(pathname);
		if (body === undefined) {
			await route.fulfill({ status: 404, body: `Unknown module ${pathname}` });
			return;
		}
		await route.fulfill({ status: 200, contentType: 'text/javascript', body });
	});
}

async function transpileEditorModules() {
	const sourceRoot = new URL('../../src/common/editor/', import.meta.url);
	const entryPoints = [
		new URL('runtime-clip-projection.ts', sourceRoot),
		new URL('video-keyframe-export-frame-source.ts', sourceRoot),
		new URL('ui/video-keyframe-offline-rgba-renderer.ts', sourceRoot),
	];
	const discovered = new Map();
	const pending = [...entryPoints];
	while (pending.length > 0) {
		const url = pending.pop();
		if (discovered.has(url.href)) continue;
		const filename = fileURLToPath(url);
		const source = await readFile(url, 'utf8');
		const transformed = await transform(source, {
			sourcefile: filename,
			loader: filename.endsWith('.ts') ? 'ts' : 'js',
			format: 'esm',
			target: 'es2022',
			sourcemap: 'inline',
		});
		discovered.set(url.href, transformed.code);
		for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/gu)) {
			const dependency = new URL(match[2], url);
			if (dependency.pathname.endsWith('.js')) {
				const typed = new URL(dependency.href.replace(/\.js$/u, '.ts'));
				try {
					await readFile(typed, 'utf8');
					pending.push(typed);
					continue;
				} catch { /* The JavaScript source owns this import. */ }
			}
			pending.push(dependency);
		}
	}
	const routes = new Map();
	for (const [href, code] of discovered) {
		const relative = new URL(href).pathname.slice(sourceRoot.pathname.length);
		const route = `${ROUTE_ROOT}/src/common/editor/${relative}`;
		routes.set(route, code);
		if (route.endsWith('.ts')) routes.set(route.replace(/\.ts$/u, '.js'), code);
	}
	return routes;
}
