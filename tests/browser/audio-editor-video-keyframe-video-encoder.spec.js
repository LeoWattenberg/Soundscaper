/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = '/__video-keyframe-video-encoder__';
const PACKAGE_FILES = [
	'index.js', 'classes.js', 'const.js', 'errors.js', 'types.js', 'utils.js', 'worker.js',
];
const NOBLE_HASH_FILES = ['sha2.js', '_md.js', '_u64.js', 'utils.js'];

test('encodes exact offline WebGL frames through the bounded production FFmpeg stream', async ({
	browserName,
	page,
}) => {
	test.skip(browserName !== 'chromium', 'The dormant encoder witness needs Chromium WebGL and shared memory.');
	test.setTimeout(120_000);
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async (root) => {
		if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') {
			throw new Error('The video keyframe encoder witness requires cross-origin isolation.');
		}
		const [projection, frameSourceModule, rendererModule, encoderModule, ffmpegPackage] =
			await Promise.all([
				import(`${root}/src/common/editor/runtime-clip-projection.ts`),
				import(`${root}/src/common/editor/video-keyframe-export-frame-source.ts`),
				import(`${root}/src/common/editor/ui/video-keyframe-offline-rgba-renderer.ts`),
				import(`${root}/src/common/editor/video-keyframe-video-encoder.ts`),
				import('@ffmpeg/ffmpeg'),
			]);
		const project = projection.resolveRuntimeProjectProjection(createProject());
		const frameSource = frameSourceModule.createVideoKeyframeExportFrameSource({
			project,
			canvas: { width: 64, height: 64, frameRate: 2 },
		});
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
		const ffmpeg = new ffmpegPackage.FFmpeg();
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
			const audioFrames = new Float32Array(48_000);
			for (let index = 0; index < audioFrames.length; index += 1) {
				audioFrames[index] = Math.sin((index / 48_000) * Math.PI * 880) * 0.125;
			}
			const audioMix = floatWav(audioFrames, 48_000);
			const encoded = await bounded(encoderModule.encodeVideoKeyframeVideo(editorFfmpeg, {
				frameSource,
				producer: renderer,
				format: 'mp4',
				audioMix,
				ringCapacityBytes: 4_096,
				audioRingCapacityBytes: 4_096,
				maximumOutputBytes: 1024 * 1024,
				maximumOutputChunkBytes: 4_096,
			}, {
				createJobToken: () => '0123456789abcdef0123456789abcdef',
			}), 80_000);
			if (encoded.byteLength > 1024 * 1024) {
				throw new Error('The encoded A/V probe exceeded its witnessed output bound.');
			}
			const firstBox = [...encoded.bytes.subarray(0, 12)];
			const probePath = '/framescaper-keyframes-av-probe.mp4';
			const decodedAudioPath = '/framescaper-keyframes-av-probe.f32le';
			let probeWritten = false;
			let decodedAudioWritten = false;
			let probeExitCode;
			let decodedAudioByteLength;
			let authoredAudioPrefixError;
			try {
				await bounded(ffmpeg.writeFile(probePath, encoded.bytes), 10_000);
				probeWritten = true;
				probeExitCode = await bounded(ffmpeg.exec([
					'-v', 'error', '-i', probePath,
					'-map', '0:v:0', '-map', '0:a:0',
					'-f', 'null', '-',
				]), 20_000);
				if (probeExitCode !== 0) {
					throw new Error(`The encoded A/V probe exited with ${String(probeExitCode)}.`);
				}
				const decodeExitCode = await bounded(ffmpeg.exec([
					'-v', 'error', '-i', probePath, '-map', '0:a:0',
					'-f', 'f32le', '-acodec', 'pcm_f32le', decodedAudioPath,
				]), 20_000);
				if (decodeExitCode !== 0) {
					throw new Error(`The encoded audio decode probe exited with ${String(decodeExitCode)}.`);
				}
				decodedAudioWritten = true;
				const decodedAudio = await bounded(ffmpeg.readFile(decodedAudioPath), 10_000);
				if (!(decodedAudio instanceof Uint8Array)) {
					throw new Error('The encoded audio decode probe returned no bytes.');
				}
				decodedAudioByteLength = decodedAudio.byteLength;
				if (decodedAudioByteLength < audioFrames.length * 4) {
					throw new Error('The encoded audio decode probe truncated the authored sample range.');
				}
				const decodedSamples = new Float32Array(
					decodedAudio.buffer, decodedAudio.byteOffset, Math.floor(decodedAudio.byteLength / 4),
				);
				let absoluteError = 0;
				let authoredMagnitude = 0;
				for (let index = 0; index < audioFrames.length; index += 1) {
					absoluteError += Math.abs(decodedSamples[index] - audioFrames[index]);
					authoredMagnitude += Math.abs(audioFrames[index]);
				}
				authoredAudioPrefixError = absoluteError / authoredMagnitude;
				if (authoredAudioPrefixError > 0.2) {
					throw new Error('The encoded audio decode probe did not preserve its authored prefix.');
				}
			} finally {
				if (decodedAudioWritten) await bounded(ffmpeg.deleteFile(decodedAudioPath), 10_000);
				if (probeWritten) await bounded(ffmpeg.deleteFile(probePath), 10_000);
			}
			return {
				byteLength: encoded.byteLength,
				firstBox,
				format: encoded.format,
				extension: encoded.extension,
				mimeType: encoded.mimeType,
				frameCount: encoded.frameCount,
				rgbaChunkCount: encoded.rgbaChunkCount,
				outputChunkCount: encoded.outputChunkCount,
				audioByteLength: encoded.audioByteLength,
				audioChunkCount: encoded.audioChunkCount,
				probeExitCode,
				decodedAudioByteLength,
				authoredAudioPrefixError,
				presentationDisposals,
			};
		} finally {
			if (!terminated) ffmpeg.terminate();
		}

		function bounded(operation, timeoutMs) {
			return Promise.race([
				operation,
				new Promise((_, reject) => setTimeout(
					() => reject(new Error('Timed out during real keyframe video encoding.')),
					timeoutMs,
				)),
			]);
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

		function floatWav(samples, sampleRate) {
			const bytes = new Uint8Array(44 + samples.length * 4);
			const view = new DataView(bytes.buffer);
			ascii(view, 0, 'RIFF');
			view.setUint32(4, bytes.length - 8, true);
			ascii(view, 8, 'WAVE');
			ascii(view, 12, 'fmt ');
			view.setUint32(16, 16, true);
			view.setUint16(20, 3, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, sampleRate, true);
			view.setUint32(28, sampleRate * 4, true);
			view.setUint16(32, 4, true);
			view.setUint16(34, 32, true);
			ascii(view, 36, 'data');
			view.setUint32(40, samples.length * 4, true);
			for (let index = 0; index < samples.length; index += 1) {
				view.setFloat32(44 + index * 4, samples[index], true);
			}
			return new Blob([bytes.buffer], { type: 'audio/wav' });
		}

		function ascii(view, offset, value) {
			for (let index = 0; index < value.length; index += 1) {
				view.setUint8(offset + index, value.charCodeAt(index));
			}
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

	expect(result.byteLength).toBeGreaterThan(12);
	expect(String.fromCharCode(...result.firstBox.slice(4, 8))).toBe('ftyp');
	expect(result).toMatchObject({
		format: 'mp4',
		extension: '.mp4',
		mimeType: 'video/mp4',
		frameCount: 2,
		rgbaChunkCount: 8,
		audioByteLength: 192_044,
		audioChunkCount: 47,
		probeExitCode: 0,
		presentationDisposals: 1,
	});
	expect(result.outputChunkCount).toBeGreaterThan(0);
	expect(result.decodedAudioByteLength).toBeGreaterThanOrEqual(48_000 * 4);
	expect(result.decodedAudioByteLength).toBeLessThanOrEqual((48_000 + 1_023) * 4);
	expect(result.authoredAudioPrefixError).toBeLessThanOrEqual(0.2);
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
					<title>video keyframe encoder</title>`,
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
	const pending = [
		'runtime-clip-projection.ts',
		'video-keyframe-export-frame-source.ts',
		'ui/video-keyframe-offline-rgba-renderer.ts',
		'video-keyframe-video-encoder.ts',
	].map((name) => new URL(name, sourceRoot));
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
