/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = '/__video-keyframe-video-encoder__';
const ENTRY_MODULES = [
	'runtime-clip-projection.ts',
	'video-keyframe-export-frame-source.ts',
	'ui/video-keyframe-offline-rgba-renderer.ts',
	'video-keyframe-video-encoder.ts',
	'video-delivery-encoder-tier.ts',
];
const NOBLE_HASH_FILES = ['sha2.js', '_md.js', '_u64.js', 'utils.js'];

test('encodes and muxes a complete MP4 without FFmpeg, a lease, or shared memory', async ({
	browserName,
	page,
}) => {
	test.skip(browserName !== 'chromium', 'The production WebCodecs witness needs Chromium.');
	test.setTimeout(120_000);
	const requestedUrls = [];
	page.on('request', (request) => { requestedUrls.push(request.url()); });
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async (root) => {
		if (crossOriginIsolated || typeof SharedArrayBuffer === 'function') {
			throw new Error('The browser-native encoder witness must not depend on shared memory.');
		}
		const [projection, frameSourceModule, rendererModule, encoderModule, tierModule, media] =
			await Promise.all([
				import(`${root}/src/common/editor/runtime-clip-projection.ts`),
				import(`${root}/src/common/editor/video-keyframe-export-frame-source.ts`),
				import(`${root}/src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts`),
				import(`${root}/src/common/editor/video-keyframe-video-encoder.ts`),
				import(`${root}/src/common/editor/video-delivery-encoder-tier.ts`),
				import('mediabunny'),
			]);
		const project = projection.resolveRuntimeProjectProjection(createProject());
		const frameSource = frameSourceModule.createVideoKeyframeExportFrameSource({
			project,
			canvas: { width: 64, height: 64, frameRate: 2 },
		});
		const decision = await tierModule.resolveVideoDeliveryEncoderTier({
			format: 'mp4',
			canvas: frameSource.canvas,
			quality: 'balanced',
			eligible: true,
		});
		if (decision.tier !== 'webcodecs' || !decision.codec || !decision.bitrate) {
			throw new Error('Chromium declined the browser-native MP4 delivery tier.');
		}
		const sourceCanvas = createSourceCanvas();
		let presentationDisposals = 0;
		const presentation = Object.freeze({
			sourceId: 'source-1',
			identity: 'sha256:keyframe-video-encoder-source-1',
			drawable: sourceCanvas,
			decodedWidth: 32,
			decodedHeight: 16,
			displayWidth: 32,
			displayHeight: 16,
			present: () => undefined,
			dispose: () => { presentationDisposals += 1; },
		});
		const renderer = rendererModule.createVideoKeyframeOfflineRgbaRenderer({
			frameSource,
			canvas: document.createElement('canvas'),
			resolveSource: () => presentation,
		});
		// A null owner is intentional: this branch must never take an FFmpeg lease.
		const encoded = await bounded(encoderModule.encodeVideoKeyframeVideo(null, {
			frameSource,
			producer: renderer,
			format: 'mp4',
			quality: 'balanced',
			webCodecs: {
				codec: decision.codec,
				bitrate: decision.bitrate,
				encoderClass: globalThis.VideoEncoder,
				videoFrameClass: globalThis.VideoFrame,
			},
			ringCapacityBytes: 4_096,
			maximumOutputBytes: 1024 * 1024,
			maximumOutputChunkBytes: 4_096,
		}, {
			createJobToken: () => '0123456789abcdef0123456789abcdef',
		}), 80_000);
		if (encoded.byteLength > 1024 * 1024) {
			throw new Error('The encoded video witness exceeded its output bound.');
		}
		const input = new media.Input({
			source: new media.BufferSource(encoded.bytes),
			formats: [media.MP4],
		});
		let container;
		try {
			const [format, canRead, mimeType, duration, videoTrack, audioTracks] = await Promise.all([
				input.getFormat(),
				input.canRead(),
				input.getMimeType(),
				input.computeDuration(),
				input.getPrimaryVideoTrack(),
				input.getAudioTracks(),
			]);
			if (!videoTrack) {
				throw new Error('The completed MP4 does not contain a primary video track.');
			}
			const [
				videoCodec,
				videoConfig,
				codedWidth,
				codedHeight,
			] = await Promise.all([
				videoTrack.getCodec(),
				videoTrack.getDecoderConfig(),
				videoTrack.getCodedWidth(),
				videoTrack.getCodedHeight(),
			]);
			container = {
				isMp4: format === media.MP4,
				canRead,
				mimeType,
				duration,
				videoCodec,
				videoConfigCodec: videoConfig?.codec ?? null,
				videoConfigBytes: videoConfig?.description?.byteLength ?? 0,
				codedWidth,
				codedHeight,
				audioTrackCount: audioTracks.length,
				videoPackets: await packetEvidence(media, videoTrack),
			};
		} finally {
			input.dispose();
		}
		return {
			byteLength: encoded.byteLength,
			firstBox: [...encoded.bytes.subarray(0, 12)],
			format: encoded.format,
			extension: encoded.extension,
			mimeType: encoded.mimeType,
			videoEncoder: encoded.videoEncoder,
			codec: encoded.codec,
			frameCount: encoded.frameCount,
			rgbaChunkCount: encoded.rgbaChunkCount,
			outputChunkCount: encoded.outputChunkCount,
			presentationDisposals,
			inputDisposed: input.disposed,
			crossOriginIsolated,
			hasSharedArrayBuffer: typeof SharedArrayBuffer === 'function',
			container,
		};

		async function packetEvidence(mediaModule, track) {
			const sink = new mediaModule.EncodedPacketSink(track);
			let count = 0;
			let byteLength = 0;
			let firstType = null;
			let lastEnd = 0;
			for await (const packet of sink.packets()) {
				if (count === 0) firstType = packet.type;
				count += 1;
				byteLength += packet.byteLength;
				lastEnd = Math.max(lastEnd, packet.timestamp + packet.duration);
			}
			return { count, byteLength, firstType, lastEnd };
		}

		function bounded(operation, timeoutMs) {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error('Timed out during browser-native keyframe video encoding.')),
					timeoutMs,
				);
				operation.then(
					(value) => { clearTimeout(timer); resolve(value); },
					(error) => { clearTimeout(timer); reject(error); },
				);
			});
		}

		function createSourceCanvas() {
			const canvas = document.createElement('canvas');
			canvas.width = 32;
			canvas.height = 16;
			const context = canvas.getContext('2d', { alpha: false });
			context.fillStyle = '#ff4000';
			context.fillRect(0, 0, 32, 8);
			context.fillStyle = '#0040ff';
			context.fillRect(0, 8, 32, 8);
			return canvas;
		}

		function createProject() {
			return {
				schemaVersion: 9,
				sampleRate: 48_000,
				primarySequenceId: 'sequence-1',
				sequences: [{
					id: 'sequence-1', type: 'video', rate: { num: 2, den: 1 }, trackIds: ['track-1'],
				}],
				sources: [{
					id: 'source-1', kind: 'video', sampleRate: 48_000,
					frameRate: { num: 2, den: 1 }, sourceFrameCount: 2, width: 32, height: 16,
				}],
				clips: [{
					id: 'clip-1', kind: 'video', sourceId: 'source-1', sequenceId: 'sequence-1',
					sequenceStartFrame: 0, sequenceFrameCount: 2,
					sourceInFrame: 0, sourceFrameCount: 2,
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
	}, ROOT);

	expect(requestedUrls.filter(isFfmpegRuntimeRequest)).toEqual([]);
	expect(result.crossOriginIsolated).toBe(false);
	expect(result.hasSharedArrayBuffer).toBe(false);
	expect(result.byteLength).toBeGreaterThan(12);
	expect(String.fromCharCode(...result.firstBox.slice(4, 8))).toBe('ftyp');
	expect(result).toMatchObject({
		format: 'mp4',
		extension: '.mp4',
		mimeType: 'video/mp4',
		videoEncoder: 'webcodecs',
		frameCount: 2,
		rgbaChunkCount: 2,
		presentationDisposals: 1,
		inputDisposed: true,
		container: {
			isMp4: true,
			canRead: true,
			videoCodec: 'avc',
			codedWidth: 64,
			codedHeight: 64,
			audioTrackCount: 0,
		},
	});
	expect(result.codec).toMatch(/^avc1\./u);
	expect(result.outputChunkCount).toBeGreaterThan(0);
	expect(result.container.mimeType).toMatch(/^video\/mp4/u);
	expect(result.container.duration).toBeGreaterThanOrEqual(1);
	expect(result.container.duration).toBeLessThanOrEqual(1.05);
	expect(result.container.videoConfigCodec).toMatch(/^avc1\./u);
	expect(result.container.videoConfigBytes).toBeGreaterThan(0);
	expect(result.container.videoPackets).toMatchObject({ count: 2, firstType: 'key' });
	expect(result.container.videoPackets.byteLength).toBeGreaterThan(0);
	expect(result.container.videoPackets.lastEnd).toBeGreaterThanOrEqual(1);
});

function isFfmpegRuntimeRequest(value) {
	const url = new URL(value);
	return url.pathname.includes('/node_modules/@ffmpeg/')
		|| url.pathname.includes('/ffmpeg/')
		|| url.pathname.includes('/core/ffmpeg-core');
}

async function installRoutes(page) {
	const routes = await transpileEditorModules();
	const nobleRoot = new URL('../../node_modules/@noble/hashes/', import.meta.url);
	for (const name of NOBLE_HASH_FILES) {
		routes.set(`${ROOT}/noble/${name}`, {
			body: await readFile(new URL(name, nobleRoot)),
			contentType: 'text/javascript',
		});
	}
	routes.set(`${ROOT}/mediabunny.mjs`, {
		body: await readFile(new URL(
			'../../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', import.meta.url,
		)),
		contentType: 'text/javascript',
	});
	await page.route(`**${ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: `<!doctype html><meta charset="utf-8">
					<script type="importmap">{"imports":{"mediabunny":"${ROOT}/mediabunny.mjs","@noble/hashes/sha2.js":"${ROOT}/noble/sha2.js"}}</script>
					<title>browser-native video keyframe encoder</title>`,
			});
			return;
		}
		const descriptor = routes.get(pathname);
		await route.fulfill(descriptor === undefined
			? { status: 404, body: `Unknown fixture path ${pathname}` }
			: { status: 200, ...descriptor });
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
