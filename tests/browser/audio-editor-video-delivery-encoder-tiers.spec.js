/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The same plan, encoded by both tiers, compared as delivered pictures.
 *
 * Byte equality is not the claim and cannot be: two encoders compress
 * differently by definition. What must hold is that the delivery is the same
 * one — the same container, the same frame count, the same exact rational rate,
 * and the same picture within a decode threshold — so that which encoder ran is
 * a performance fact rather than a change to what the plan meant.
 *
 * The rate is checked from FFmpeg's own reading of the finished file rather
 * than from the plan that produced it, because the elementary-stream boundary
 * carries no timing of its own and an approximate rate is the one thing this
 * tier may not trade for speed.
 */

import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = '/__video-delivery-encoder-tiers__';
const PACKAGE_FILES = [
	'index.js', 'classes.js', 'const.js', 'errors.js', 'types.js', 'utils.js', 'worker.js',
];
const NOBLE_HASH_FILES = ['sha2.js', '_md.js', '_u64.js', 'utils.js'];
const ENTRY_MODULES = [
	'runtime-clip-projection.ts',
	'video-keyframe-export-frame-source.ts',
	'ui/video-keyframe-offline-rgba-renderer.ts',
	'video-keyframe-video-encoder.ts',
	'video-delivery-encoder-tier.ts',
];
/** 29.97, stated as the rational a decimal would quietly round away. */
const FRAME_RATE = { num: 30_000, den: 1_001 };
const FRAME_COUNT = 10;
const CANVAS = { width: 64, height: 64 };

test('both encode tiers deliver the same plan, and each says which one ran', async ({
	browserName,
	page,
}) => {
	test.skip(browserName !== 'chromium', 'Only Chromium ships a WebCodecs H.264 encoder with shared memory.');
	test.skip(
		process.platform === 'win32',
		'Windows headless Chromium crashes its GPU process during the production WebGL readback witness.',
	);
	test.setTimeout(120_000);
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async ([root, rate, frameCount, canvasSize]) => {
		if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') {
			throw new Error('The encoder tier witness requires cross-origin isolation.');
		}
		const [projection, frameSourceModule, rendererModule, encoderModule, tierModule, ffmpegPackage] =
			await Promise.all([
				import(`${root}/src/common/editor/runtime-clip-projection.ts`),
				import(`${root}/src/common/editor/video-keyframe-export-frame-source.ts`),
				import(`${root}/src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts`),
				import(`${root}/src/common/editor/video-keyframe-video-encoder.ts`),
				import(`${root}/src/common/editor/video-delivery-encoder-tier.ts`),
				import('@ffmpeg/ffmpeg'),
			]);
		const project = projection.resolveRuntimeProjectProjection(createProject());
		const decision = await tierModule.resolveVideoDeliveryEncoderTier({
			format: 'mp4',
			canvas: { ...canvasSize, frameRate: rate },
			quality: 'balanced',
			eligible: true,
		});
		if (decision.tier !== 'webcodecs') {
			throw new Error(`Chromium declined the WebCodecs tier: ${String(decision.reason)}`);
		}
		const ffmpeg = new ffmpegPackage.FFmpeg();
		const logs = [];
		ffmpeg.on('log', ({ message }) => { logs.push(message); });
		let terminated = false;
		await bounded(ffmpeg.load({
			classWorkerURL: `${root}/ffmpeg/worker.js`,
			coreURL: `${root}/core/ffmpeg-core.js`,
			wasmURL: `${root}/core/ffmpeg-core.wasm`,
		}), 60_000);
		const editorFfmpeg = Object.freeze({
			runVideoKeyframeEncoderOperation: (operation) => operation(Object.freeze({
				createInputStream: (...args) => ffmpeg.createInputStream(...args),
				exec: (...args) => ffmpeg.exec(...args),
				statFile: (...args) => ffmpeg.statFile(...args),
				readFileRange: (...args) => ffmpeg.readFileRange(...args),
				deleteFile: (...args) => ffmpeg.deleteFile(...args),
				terminateExecution() { terminated = true; ffmpeg.terminate(); },
				isExecutionTerminated: () => terminated,
			})),
		});
		try {
			// One presentation for the whole witness: the resolver owns a source
			// occurrence's lifecycle, and handing back a fresh object per frame
			// is a replaced occurrence rather than a resolved one.
			const presentation = sourcePresentation();
			const deliveries = [];
			for (const tier of ['ffmpeg', 'webcodecs']) {
				const frameSource = frameSourceModule.createVideoKeyframeExportFrameSource({
					project,
					canvas: { ...canvasSize, frameRate: rate },
					startFrame: 0,
					endFrame: Math.round((frameCount * 48_000 * rate.den) / rate.num),
				});
				const renderer = rendererModule.createVideoKeyframeOfflineRgbaRenderer({
					frameSource,
					canvas: document.createElement('canvas'),
					resolveSource: () => presentation,
				});
				const encoded = await bounded(encoderModule.encodeVideoKeyframeVideo(editorFfmpeg, {
					frameSource,
					producer: renderer,
					format: 'mp4',
					quality: 'balanced',
					ringCapacityBytes: 65_536,
					maximumOutputBytes: 4 * 1024 * 1024,
					maximumOutputChunkBytes: 65_536,
					...(tier === 'webcodecs' ? {
						webCodecs: {
							codec: decision.codec,
							bitrate: decision.bitrate,
							encoderClass: globalThis.VideoEncoder,
							videoFrameClass: globalThis.VideoFrame,
						},
					} : {}),
				}, {
					createJobToken: () => (tier === 'webcodecs'
						? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
						: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
				}), 90_000, `the ${tier} encode`);
				deliveries.push({ tier, encoded });
			}
			const readings = [];
			for (const { tier, encoded } of deliveries) {
				const probePath = `/tier-probe-${tier}.mp4`;
				const rawPath = `/tier-probe-${tier}.rgb`;
				logs.length = 0;
				await bounded(ffmpeg.writeFile(probePath, encoded.bytes), 10_000);
				const decodeExit = await bounded(ffmpeg.exec([
					'-v', 'info', '-i', probePath, '-map', '0:v:0', '-vsync', '0',
					'-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath,
				]), 40_000, `the ${tier} decode`);
				const raw = await bounded(ffmpeg.readFile(rawPath), 20_000);
				await bounded(ffmpeg.deleteFile(rawPath), 10_000);
				await bounded(ffmpeg.deleteFile(probePath), 10_000);
				readings.push({
					tier,
					videoEncoder: encoded.videoEncoder,
					codec: encoded.codec ?? null,
					byteLength: encoded.byteLength,
					decodeExit,
					pixels: raw instanceof Uint8Array ? raw : new Uint8Array(0),
					// FFmpeg's own reading of the delivered file, not the plan's claim.
					rateLine: logs.filter((line) => line.includes(' tbr')).join(' | '),
				});
			}
			const [ffmpegTier, webCodecsTier] = readings;
			const pixelCount = Math.min(ffmpegTier.pixels.length, webCodecsTier.pixels.length);
			let absoluteError = 0;
			for (let index = 0; index < pixelCount; index += 1) {
				absoluteError += Math.abs(ffmpegTier.pixels[index] - webCodecsTier.pixels[index]);
			}
			return {
				ffmpeg: reading(ffmpegTier),
				webcodecs: reading(webCodecsTier),
				expectedPixelBytes: canvasSize.width * canvasSize.height * 3 * frameCount,
				meanAbsoluteError: pixelCount === 0 ? Number.POSITIVE_INFINITY : absoluteError / pixelCount,
			};
		} finally {
			if (!terminated) ffmpeg.terminate();
		}

		function reading(value) {
			return {
				videoEncoder: value.videoEncoder,
				codec: value.codec,
				byteLength: value.byteLength,
				decodeExit: value.decodeExit,
				decodedByteLength: value.pixels.length,
				rateLine: value.rateLine,
			};
		}

		function bounded(operation, timeoutMs, label = 'a real tier comparison') {
			return Promise.race([
				operation,
				new Promise((_, reject) => setTimeout(
					() => reject(new Error(`Timed out during ${label}.`)),
					timeoutMs,
				)),
			]);
		}

		function sourcePresentation() {
			const canvas = document.createElement('canvas');
			canvas.width = 32;
			canvas.height = 32;
			const context = canvas.getContext('2d', { alpha: false });
			// Flat blocks: two encoders at different settings agree on these,
			// where a gradient would only measure their rate-control curves.
			context.fillStyle = '#ff4000';
			context.fillRect(0, 0, 32, 16);
			context.fillStyle = '#0040ff';
			context.fillRect(0, 16, 32, 16);
			return Object.freeze({
				sourceId: 'source-1',
				identity: 'sha256:video-delivery-encoder-tiers-source-1',
				drawable: canvas,
				decodedWidth: 32,
				decodedHeight: 32,
				displayWidth: 32,
				displayHeight: 32,
				present: () => undefined,
				dispose: () => undefined,
			});
		}

		function createProject() {
			return {
				schemaVersion: 9,
				sampleRate: 48_000,
				primarySequenceId: 'sequence-1',
				sequences: [{
					id: 'sequence-1', type: 'video', rate: rate, trackIds: ['track-1'],
				}],
				sources: [{
					id: 'source-1', kind: 'video', sampleRate: 48_000,
					frameRate: rate, sourceFrameCount: frameCount, width: 32, height: 32,
				}],
				clips: [{
					id: 'clip-1', kind: 'video', sourceId: 'source-1', sequenceId: 'sequence-1',
					sequenceStartFrame: 0, sequenceFrameCount: frameCount,
					sourceInFrame: 0, sourceFrameCount: frameCount,
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
					videoEffects: [],
				}],
				tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
				projectBin: { clips: [] },
			};
		}
	}, [ROOT, FRAME_RATE, FRAME_COUNT, CANVAS]);

	// Each delivery states which encoder produced it, and the accelerated one
	// names the codec string the browser accepted.
	expect(result.ffmpeg.videoEncoder).toBe('ffmpeg');
	expect(result.ffmpeg.codec).toBeNull();
	expect(result.webcodecs.videoEncoder).toBe('webcodecs');
	expect(result.webcodecs.codec).toMatch(/^avc1\./u);

	// Both are readable MP4s of the same length in frames.
	expect(result.ffmpeg.decodeExit).toBe(0);
	expect(result.webcodecs.decodeExit).toBe(0);
	expect(result.ffmpeg.decodedByteLength).toBe(result.expectedPixelBytes);
	expect(result.webcodecs.decodedByteLength).toBe(result.expectedPixelBytes);

	// The exact rational survived the elementary-stream boundary: FFmpeg reads
	// 29.97 out of both files, not 30 out of one of them.
	expect(result.ffmpeg.rateLine).toMatch(/29\.97 tbr/u);
	expect(result.webcodecs.rateLine).toMatch(/29\.97 tbr/u);

	// Same picture, within what two compressors of the same tier may differ by.
	// Measured at 1.4 of 255 on the reference run; the bound leaves room for
	// encoder revisions without leaving room for a different picture.
	expect(result.meanAbsoluteError).toBeLessThanOrEqual(4);
});

test('a browser without the WebCodecs encoder falls back with a reason rather than failing', async ({
	page,
}) => {
	test.setTimeout(60_000);
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const decisions = await page.evaluate(async ([root, rate, canvasSize]) => {
		const tierModule = await import(`${root}/src/common/editor/video-delivery-encoder-tier.ts`);
		const request = {
			format: 'mp4',
			canvas: { ...canvasSize, frameRate: rate },
			quality: 'balanced',
			eligible: true,
		};
		const native = await tierModule.resolveVideoDeliveryEncoderTier(request);
		// The same question asked of a browser that has no encoder at all.
		const absent = await tierModule.resolveVideoDeliveryEncoderTier(request, null);
		return {
			hasEncoder: typeof globalThis.VideoEncoder === 'function',
			native: { tier: native.tier, reason: native.reason },
			absent: { tier: absent.tier, reason: absent.reason },
		};
	}, [ROOT, FRAME_RATE, CANVAS]);

	// Whatever this browser is, the question was answered rather than thrown.
	expect(['webcodecs', 'ffmpeg']).toContain(decisions.native.tier);
	if (decisions.native.tier === 'ffmpeg') expect(decisions.native.reason).toBeTruthy();
	else expect(decisions.native.reason).toBeNull();
	expect(decisions.absent.tier).toBe('ffmpeg');
	expect(decisions.absent.reason).toBeTruthy();
});

async function installRoutes(page) {
	const editorModules = await transpileEditorModules();
	const packageRoot = new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/', import.meta.url);
	const coreRoot = new URL('../../node_modules/@ffmpeg/core/dist/esm/', import.meta.url);
	const nobleRoot = new URL('../../node_modules/@noble/hashes/', import.meta.url);
	const routes = new Map(editorModules);
	for (const name of PACKAGE_FILES) {
		routes.set(`${ROOT}/ffmpeg/${name}`, {
			body: await readFile(new URL(name, packageRoot)),
			contentType: 'text/javascript',
		});
	}
	for (const name of NOBLE_HASH_FILES) {
		routes.set(`${ROOT}/noble/${name}`, {
			body: await readFile(new URL(name, nobleRoot)),
			contentType: 'text/javascript',
		});
	}
	for (const [name, contentType] of [
		['ffmpeg-core.js', 'text/javascript'],
		['ffmpeg-core.wasm', 'application/wasm'],
	]) {
		routes.set(`${ROOT}/core/${name}`, {
			body: await readFile(new URL(name, coreRoot)),
			contentType,
		});
	}
	await page.route(`**${ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				headers: isolationHeaders(),
				body: `<!doctype html><meta charset="utf-8">
					<script type="importmap">{"imports":{"@ffmpeg/ffmpeg":"${ROOT}/ffmpeg/index.js","@noble/hashes/sha2.js":"${ROOT}/noble/sha2.js"}}</script>
					<title>video delivery encoder tiers</title>`,
			});
			return;
		}
		const descriptor = routes.get(pathname);
		await route.fulfill(descriptor === undefined
			? { status: 404, body: `Unknown fixture path ${pathname}` }
			: { status: 200, headers: isolationHeaders(), ...descriptor });
	});
}

async function transpileEditorModules() {
	const sourceRoot = new URL('../../src/common/editor/', import.meta.url);
	const pending = ENTRY_MODULES.map((name) => new URL(name, sourceRoot));
	const discovered = new Map();
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
			if (!dependency.pathname.startsWith(sourceRoot.pathname)) continue;
			if (dependency.pathname.endsWith('.js')) {
				const typed = new URL(dependency.href.replace(/\.js$/u, '.ts'));
				try { await readFile(typed, 'utf8'); pending.push(typed); continue; } catch { /* JavaScript owns it. */ }
			}
			pending.push(dependency);
		}
	}
	const routes = new Map();
	for (const [href, code] of discovered) {
		const relative = new URL(href).pathname.slice(sourceRoot.pathname.length);
		const path = `${ROOT}/src/common/editor/${relative}`;
		const descriptor = { body: code, contentType: 'text/javascript' };
		routes.set(path, descriptor);
		if (path.endsWith('.ts')) routes.set(path.replace(/\.ts$/u, '.js'), descriptor);
	}
	return routes;
}

function isolationHeaders() {
	return {
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'credentialless',
		'Cross-Origin-Resource-Policy': 'same-origin',
	};
}
