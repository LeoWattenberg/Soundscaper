import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
	M4_PRODUCTION_PARITY_FIXTURE_ID,
	M4_PRODUCTION_PARITY_PROFILE,
	M4_PRODUCTION_PARITY_SPECIFICATION,
	M4_PRODUCTION_PARITY_WORKLOAD_ID,
	compareM4ProductionParityAudio,
	createM4ProductionParityAudioFixture,
	decodeM4ProductionParityAudio,
	encodeM4ProductionParityAudio,
} from '../../src/common/editor/quality/m4-production-parity-workload.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	VIDEO_CLIP_COMPOSITION_BLEND_MODES,
} from '../../src/common/editor/video-clip-composition.ts';
import { buildVideoFfmpegArgs } from '../../src/common/editor/video-ffmpeg.js';
import { videoEffectDefaults } from '../../src/common/editor/video-effects.js';
import { resolveVideoRenderDescription } from '../../src/common/editor/video-render-description.ts';
import {
	mergeM4ParityReferenceFingerprint,
	readM4ParityReferenceHostObservation,
} from '../../scripts/lib/m4-production-parity-identity.mjs';
import {
	VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE,
	VIDEO_EFFECT_PARITY_MINIMUM_SSIM,
	compareVideoEffectFrames,
	createVideoEffectParityFixture,
} from './video-effect-parity-helpers.js';
import { videoPreviewSourceResponse } from './video-preview-source-route.js';

const ROUTE_ROOT = '/__m4-production-parity__';
const LOCAL_ENVIRONMENT_ID = 'local-browser-correctness';
const HOSTED_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.61.1';
const REFERENCE_ENVIRONMENT_ID = 'reference-linux-gpu-01';
const ENVIRONMENT_ID = process.env.SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID
	|| (process.env.GITHUB_ACTIONS === 'true' ? HOSTED_ENVIRONMENT_ID : LOCAL_ENVIRONMENT_ID);
const AUDIO_ENGINE_HARNESS_SOURCE = bundleAudioEngineHarness(productionDynamicsWorkletPath());
const RUNTIME_ROUTES = new Map([
	[`${ROUTE_ROOT}/engine/harness.js`, { body: AUDIO_ENGINE_HARNESS_SOURCE, contentType: 'text/javascript' }],
	[`${ROUTE_ROOT}/ffmpeg/classes.js`, route('../../node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js', 'text/javascript')],
	[`${ROUTE_ROOT}/ffmpeg/const.js`, route('../../node_modules/@ffmpeg/ffmpeg/dist/esm/const.js', 'text/javascript')],
	[`${ROUTE_ROOT}/ffmpeg/errors.js`, route('../../node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js', 'text/javascript')],
	[`${ROUTE_ROOT}/ffmpeg/utils.js`, route('../../node_modules/@ffmpeg/ffmpeg/dist/esm/utils.js', 'text/javascript')],
	[`${ROUTE_ROOT}/ffmpeg/worker.js`, route('../../node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js', 'text/javascript')],
	[`${ROUTE_ROOT}/core/ffmpeg-core.js`, route('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'text/javascript')],
	[`${ROUTE_ROOT}/core/ffmpeg-core.wasm`, route('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'application/wasm')],
]);
const VIDEO_CASES = Object.freeze([
	videoCase('gradient-color-adjust', 'gradient', effect('m4-gradient-color-adjust', 'color-adjust')),
	videoCase('edge-gaussian-blur', 'edge', effect('m4-edge-gaussian-blur', 'gaussian-blur')),
	videoCase('transparency-vignette', 'transparency', effect('m4-transparency-vignette', 'vignette')),
	videoCase('color-chart-baseline', 'color-chart'),
	...VIDEO_CLIP_COMPOSITION_BLEND_MODES.map((blendMode) => compositionVideoCase(
		`composition-blend-${blendMode}`,
		'transparency',
		{ blendMode, opacity: 0.625, compositingOrder: 2 },
	)),
	compositionVideoCase('composition-combined-transform-order', 'gradient', {
		crop: { left: 0.0625, top: 0.125, right: 0.125, bottom: 0.0625 },
		transform: {
			anchorX: 0.375,
			anchorY: 0.625,
			positionX: 0.54,
			positionY: 0.46,
			scaleX: 0.875,
			scaleY: 1.125,
			rotationDegrees: 12,
			flipHorizontal: true,
			flipVertical: true,
		},
		opacity: 0.2,
		blendMode: 'normal',
		compositingOrder: 7,
	}),
]);

test('collects complete M4 PCM, RGBA, and render-ledger evidence without qualifying the host', async ({
	page,
	browser,
}) => {
	test.skip(
		process.env.SOUNDSCAPER_M4_PRODUCTION_PARITY !== '1',
		'Run explicitly through quality:collect:m4-production-parity.',
	);
	test.setTimeout(300_000);
	await installRuntimeRoutes(page);
	await page.goto(`${ROUTE_ROOT}/index.html`);
	await initializeRuntime(page);

	const fixture = createM4ProductionParityAudioFixture();
	const inputBase64 = Buffer.from(encodeM4ProductionParityAudio(fixture.input)).toString('base64');
	const audio = await renderAudioParity(
		page,
		inputBase64,
		M4_PRODUCTION_PARITY_SPECIFICATION,
	);
	expect(audio.previewEvidence).toEqual(productionPathEvidence('live', true));
	expect(audio.exportEvidence).toEqual(productionPathEvidence('offline', false));
	const referenceBase64 = Buffer.from(
		encodeM4ProductionParityAudio(fixture.reference),
	).toString('base64');
	for (const encoded of [audio.previewBase64, audio.exportBase64]) {
		const actual = decodeM4ProductionParityAudio(new Uint8Array(Buffer.from(encoded, 'base64')));
		const metrics = compareM4ProductionParityAudio(actual, fixture.reference);
		expect(metrics.maximumAbsoluteSampleError).toBeLessThanOrEqual(0.000_001);
		expect(metrics.pdcErrorSamples).toBe(0);
	}

	const omissionAudit = await auditDeliberateOmission(page);
	expect(omissionAudit.report.effects.omitted).toEqual(['m4-deliberately-omitted-effect']);
	expect(omissionAudit.report.effects.rendered).toEqual([]);
	expect(omissionAudit.playbackFrameCount).toBe(2);

	const videoCases = [];
	for (const parity of VIDEO_CASES) {
		const fixtureFrame = createVideoEffectParityFixture(parity.fixture);
		const rendered = await renderVideoParityCase(page, {
			name: parity.name,
			width: fixtureFrame.width,
			height: fixtureFrame.height,
			inputBase64: Buffer.from(fixtureFrame.bytes).toString('base64'),
			effects: parity.effects,
			layers: parity.layers,
			graph: parity.graph
				?? effectFilterGraph(parity.effects, fixtureFrame.width, fixtureFrame.height),
		});
		const preview = new Uint8Array(Buffer.from(rendered.previewBase64, 'base64'));
		const exported = new Uint8Array(Buffer.from(rendered.exportBase64, 'base64'));
		const metrics = compareVideoEffectFrames(
			preview,
			exported,
			fixtureFrame.width,
			fixtureFrame.height,
		);
		expect(
			metrics.ssim,
			`${parity.name} SSIM; channel MAE ${JSON.stringify(metrics.channelMae)}`,
		).toBeGreaterThanOrEqual(
			VIDEO_EFFECT_PARITY_MINIMUM_SSIM,
		);
		for (const [channel, mae] of Object.entries(metrics.channelMae)) {
			expect(mae, `${parity.name} ${channel} MAE`).toBeLessThanOrEqual(
				VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE,
			);
		}
		expect(rendered.renderReport.effects.omitted).toEqual([]);
		expect(rendered.renderReport.composition?.omitted ?? []).toEqual([]);
		videoCases.push({
			name: parity.name,
			fixtureArtifactId: parity.fixture,
			fixtureBase64: Buffer.from(fixtureFrame.bytes).toString('base64'),
			width: fixtureFrame.width,
			height: fixtureFrame.height,
			previewBase64: rendered.previewBase64,
			exportBase64: rendered.exportBase64,
			renderReport: rendered.renderReport,
		});
	}

	const renderer = await rendererDiagnostic(page);
	const environmentFingerprint = await diagnosticEnvironmentFingerprint(browser, renderer);
	const diagnostic = {
		schemaVersion: 1,
		profile: M4_PRODUCTION_PARITY_PROFILE,
		observationClass: 'complete-pcm-rgba-render-ledger-v1',
		workloadId: M4_PRODUCTION_PARITY_WORKLOAD_ID,
		fixtureId: M4_PRODUCTION_PARITY_FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		rendererClass: renderer.rendererClass,
		environmentFingerprint,
		fixture: { ...M4_PRODUCTION_PARITY_SPECIFICATION },
		audio: {
			previewBase64: audio.previewBase64,
			exportBase64: audio.exportBase64,
			referenceBase64,
		},
		videoCases,
	};
	console.log(`SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(diagnostic)}`);
});

async function diagnosticEnvironmentFingerprint(browser, renderer) {
	const portable = {
		browserVersion: browser.version(),
		platform: process.platform,
		architecture: process.arch,
		webglVendor: renderer.vendor,
		webglRenderer: renderer.renderer,
	};
	if (ENVIRONMENT_ID !== REFERENCE_ENVIRONMENT_ID) return portable;
	const host = await readM4ParityReferenceHostObservation(
		process.env.SOUNDSCAPER_M4_REFERENCE_HOST_OBSERVATION_PATH,
	);
	const browserObservation = {
		osImage: await linuxOsImage(),
		cpuModel: cpus()[0]?.model || 'unknown',
		logicalCpuCount: cpus().length,
		memoryBytes: totalmem(),
		webglVendor: renderer.vendor,
		webglRenderer: renderer.renderer,
		devicePixelRatio: renderer.devicePixelRatio,
		browserVersion: browser.version(),
		browserBinarySha256: await sha256File(browser.browserType().executablePath()),
	};
	return mergeM4ParityReferenceFingerprint(host, browserObservation);
}

async function sha256File(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

async function linuxOsImage() {
	const lines = (await readFile('/etc/os-release', 'utf8')).split(/\r?\n/u);
	const values = Object.fromEntries(lines.flatMap((line) => {
		const separator = line.indexOf('=');
		if (separator < 1) return [];
		return [[line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/gu, '')]];
	}));
	if (!values.ID || !values.VERSION_ID) throw new Error('Reference host OS image is unavailable.');
	return `${values.ID}-${values.VERSION_ID}`;
}

function route(relativePath, contentType) {
	return { file: new URL(relativePath, import.meta.url), contentType };
}

function bundleAudioEngineHarness(dynamicsWorkletPath) {
	const result = buildSync({
		entryPoints: [fileURLToPath(new URL(
			'../../src/common/editor/quality/m4-production-parity-browser-harness.ts',
			import.meta.url,
		))],
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'esm',
		target: 'chrome120',
		external: ['module'],
		legalComments: 'none',
	});
	if (result.outputFiles.length !== 1) throw new Error('The M4 audio engine harness did not produce one bundle.');
	const marker = 'new URL("../dynamics-worklet.js", import.meta.url)';
	const source = result.outputFiles[0].text;
	if (source.split(marker).length !== 2) {
		throw new Error('The M4 audio engine harness did not preserve one production dynamics-worklet URL.');
	}
	return Buffer.from(source.replace(
		marker,
		`new URL(${JSON.stringify(dynamicsWorkletPath)}, import.meta.url)`,
	));
}

function productionDynamicsWorkletPath() {
	const assetsDirectory = fileURLToPath(new URL('../../dist/assets/', import.meta.url));
	const matches = readdirSync(assetsDirectory).filter((name) => /^dynamics-worklet-[\w-]+\.js$/u.test(name));
	if (matches.length !== 1) throw new Error('The production build must contain one dynamics worklet asset.');
	return `/assets/${matches[0]}`;
}

function productionPathEvidence(schedulerMode, monitoring) {
	return {
		schemaVersion: 1,
		schedulerMode,
		monitoring,
		scheduledClipCount: 2,
		latencyFrames: M4_PRODUCTION_PARITY_SPECIFICATION.pdcLatencyFrames,
		pdcErrorSamples: 0,
		programInputLatencyFrames: 7,
		fastPathCompensationFrames: 10,
	};
}

function effect(id, type, params = {}) {
	return Object.freeze({
		id,
		type,
		enabled: true,
		params: Object.freeze({ ...videoEffectDefaults(type), ...params }),
	});
}

function videoCase(name, fixture, ...effects) {
	return Object.freeze({ name, fixture, effects: Object.freeze(effects) });
}

function compositionVideoCase(name, fixture, composition) {
	const width = M4_PRODUCTION_PARITY_SPECIFICATION.videoWidth;
	const height = M4_PRODUCTION_PARITY_SPECIFICATION.videoHeight;
	const background = compositionDescription({ compositingOrder: -1 }, width, height);
	const foreground = compositionDescription(composition, width, height);
	const layers = Object.freeze([
		Object.freeze({
			blendMode: background.blendMode,
			entries: Object.freeze([Object.freeze({
				clipId: `${name}-background`, effects: Object.freeze([]), renderDescription: background,
			})]),
		}),
		Object.freeze({
			blendMode: foreground.blendMode,
			entries: Object.freeze([Object.freeze({
				clipId: `${name}-foreground`, effects: Object.freeze([]), renderDescription: foreground,
			})]),
		}),
	]);
	return Object.freeze({
		name,
		fixture,
		effects: Object.freeze([]),
		layers,
		graph: compositionFilterGraph(layers, width, height),
	});
}

function compositionDescription(changes, width, height) {
	return resolveVideoRenderDescription({
		composition: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION,
			...changes,
			crop: { ...DEFAULT_VIDEO_CLIP_COMPOSITION.crop, ...changes.crop },
			transform: { ...DEFAULT_VIDEO_CLIP_COMPOSITION.transform, ...changes.transform },
		},
		sourceDisplaySize: { width, height },
		canvas: { width, height },
	});
}

async function installRuntimeRoutes(page) {
	await page.route(`**${ROUTE_ROOT}/**`, async (requestRoute) => {
		const pathname = new URL(requestRoute.request().url()).pathname;
		if (pathname === `${ROUTE_ROOT}/index.html`) {
			await requestRoute.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style>',
			});
			return;
		}
		const source = await videoPreviewSourceResponse(pathname, ROUTE_ROOT);
		if (source) {
			await requestRoute.fulfill({ status: 200, ...source });
			return;
		}
		const descriptor = RUNTIME_ROUTES.get(pathname);
		if (!descriptor) {
			await requestRoute.fulfill({ status: 404, body: 'Not found' });
			return;
		}
		const body = descriptor.body ?? await readFile(descriptor.file);
		await requestRoute.fulfill({
			status: 200,
			contentType: descriptor.contentType,
			headers: { 'Access-Control-Allow-Origin': '*', 'Content-Length': String(body.byteLength) },
			body,
		});
	});
}

async function initializeRuntime(page) {
	await page.evaluate(async (root) => {
		const [{ FFmpeg }, compositor, audioEngine] = await Promise.all([
			import(`${root}/ffmpeg/classes.js`),
			import(`${root}/source/common/editor/ui/video-preview-compositor.js`),
			import(`${root}/engine/harness.js`),
		]);
		const logs = [];
		const ffmpeg = new FFmpeg();
		ffmpeg.on('log', ({ type, message }) => {
			logs.push(`${type}: ${message}`);
			if (logs.length > 200) logs.shift();
		});
		await ffmpeg.load({
			classWorkerURL: `${root}/ffmpeg/worker.js`,
			coreURL: `${root}/core/ffmpeg-core.js`,
			wasmURL: `${root}/core/ffmpeg-core.wasm`,
		});
		window.__m4ProductionParity = {
			VideoPreviewCompositor: compositor.VideoPreviewCompositor,
			shouldContinueVideoPreviewPlayback: compositor.shouldContinueVideoPreviewPlayback,
			renderM4ProductionParityProductionPath: audioEngine.renderM4ProductionParityProductionPath,
			ffmpeg,
			logs,
		};
	}, ROUTE_ROOT);
}

async function renderAudioParity(page, inputBase64, specification) {
	return page.evaluate(async ({ encoded, fixture }) => {
		const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
		const channels = Array.from(
			{ length: fixture.channelCount },
			() => new Float32Array(fixture.frameCount),
		);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let offset = 0;
		for (let frame = 0; frame < fixture.frameCount; frame += 1) {
			for (const channel of channels) {
				channel[frame] = view.getFloat32(offset, true);
				offset += 4;
			}
		}
		const render = async (mode) => {
			const rendered = await window.__m4ProductionParity
				.renderM4ProductionParityProductionPath(channels, mode);
			const result = new Uint8Array(fixture.frameCount * fixture.channelCount * 4);
			const resultView = new DataView(result.buffer);
			let resultOffset = 0;
			for (let frame = 0; frame < fixture.frameCount; frame += 1) {
				for (let channel = 0; channel < fixture.channelCount; channel += 1) {
					resultView.setFloat32(resultOffset, rendered.channels[channel][frame], true);
					resultOffset += 4;
				}
			}
			return { base64: bytesToBase64(result), evidence: rendered.evidence };
		};
		const preview = await render('preview');
		const exported = await render('export');
		return {
			previewBase64: preview.base64,
			exportBase64: exported.base64,
			previewEvidence: preview.evidence,
			exportEvidence: exported.evidence,
		};

		function bytesToBase64(value) {
			let binary = '';
			for (let start = 0; start < value.length; start += 0x4000) {
				binary += String.fromCharCode(...value.subarray(start, start + 0x4000));
			}
			return btoa(binary);
		}
	}, { encoded: inputBase64, fixture: specification });
}

async function auditDeliberateOmission(page) {
	return page.evaluate(async () => {
		const runtime = window.__m4ProductionParity;
		const source = sourceCanvas(128, 72, new Uint8Array(128 * 72 * 4));
		const output = outputCanvas(128, 72);
		const compositor = new runtime.VideoPreviewCompositor(output);
		try {
			const report = compositor.render([{ entries: [{
				clipId: 'm4-omission-clip',
				video: source,
				opacity: 1,
				effects: [{
					id: 'm4-deliberately-omitted-effect',
					type: 'unregistered-effect',
					enabled: true,
					params: {},
				}],
			}] }], { referenceWidth: 128, referenceHeight: 72 });
			const playbackFrameCount = await scheduledFrameCount(report);
			return { report, playbackFrameCount };
		} finally {
			compositor.dispose();
		}

		function sourceCanvas(width, height, bytes) {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			Object.defineProperties(canvas, {
				videoWidth: { get: () => width },
				videoHeight: { get: () => height },
				readyState: { get: () => 4 },
			});
			canvas.getContext('2d').putImageData(
				new ImageData(new Uint8ClampedArray(bytes), width, height),
				0,
				0,
			);
			return canvas;
		}

		function scheduledFrameCount(report) {
			return new Promise((resolve) => {
				let count = 0;
				const frame = () => {
					count += 1;
					if (count >= 2 || !runtime.shouldContinueVideoPreviewPlayback(report, 'playing')) {
						resolve(count);
						return;
					}
					requestAnimationFrame(frame);
				};
				if (runtime.shouldContinueVideoPreviewPlayback(report, 'playing')) {
					requestAnimationFrame(frame);
				} else resolve(count);
			});
		}

		function outputCanvas(width, height) {
			const canvas = document.createElement('canvas');
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			document.body.append(canvas);
			return canvas;
		}
	});
}

async function renderVideoParityCase(page, parity) {
	return page.evaluate(async ({ name, width, height, inputBase64, effects, layers, graph }) => {
		const runtime = window.__m4ProductionParity;
		const input = Uint8Array.from(atob(inputBase64), (value) => value.charCodeAt(0));
		const source = document.createElement('canvas');
		source.width = width;
		source.height = height;
		Object.defineProperties(source, {
			videoWidth: { get: () => width },
			videoHeight: { get: () => height },
			readyState: { get: () => 4 },
		});
		source.getContext('2d').putImageData(
			new ImageData(new Uint8ClampedArray(input), width, height),
			0,
			0,
		);
		const output = document.createElement('canvas');
		output.style.width = `${width}px`;
		output.style.height = `${height}px`;
		document.body.replaceChildren(output);
		const compositor = new runtime.VideoPreviewCompositor(output);
		const previewLayers = layers?.map((layer) => ({
			...layer,
			entries: layer.entries.map((entry) => ({ ...entry, video: source })),
		})) ?? [{ entries: [{ clipId: `${name}-clip`, video: source, opacity: 1, effects }] }];
		const renderReport = compositor.render(
			previewLayers,
			{ referenceWidth: width, referenceHeight: height },
		);
		const gl = compositor.gl;
		gl.finish();
		const bottomUp = new Uint8Array(width * height * 4);
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
		const preview = new Uint8Array(bottomUp.length);
		const stride = width * 4;
		for (let y = 0; y < height; y += 1) {
			preview.set(bottomUp.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
		}
		compositor.dispose();

		const safeName = name.replace(/[^a-z0-9-]+/giu, '-');
		const inputName = `${safeName}.rgba`;
		const outputName = `${safeName}-ffmpeg.rgba`;
		try {
			await runtime.ffmpeg.writeFile(inputName, input.slice());
			const exitCode = await runtime.ffmpeg.exec([
				'-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`,
				'-framerate', '1', '-i', inputName,
				'-filter_complex', graph, '-map', '[video_out]', '-frames:v', '1',
				'-c:v', 'rawvideo', '-pix_fmt', 'rgba', '-f', 'rawvideo', outputName,
			]);
			if (exitCode !== 0) {
				throw new Error(
					`${name}: FFmpeg exited with ${exitCode}.\n${runtime.logs.slice(-30).join('\n')}`,
				);
			}
			const exported = await runtime.ffmpeg.readFile(outputName);
			return {
				previewBase64: bytesToBase64(preview),
				exportBase64: bytesToBase64(exported),
				renderReport,
			};
		} finally {
			await runtime.ffmpeg.deleteFile(inputName).catch(() => undefined);
			await runtime.ffmpeg.deleteFile(outputName).catch(() => undefined);
		}

		function bytesToBase64(bytes) {
			let binary = '';
			for (let start = 0; start < bytes.length; start += 0x4000) {
				binary += String.fromCharCode(...bytes.subarray(start, start + 0x4000));
			}
			return btoa(binary);
		}
	}, parity);
}

function effectFilterGraph(effects, width, height) {
	const plan = {
		version: 4,
		format: 'mp4',
		container: 'mp4',
		durationSeconds: 1,
		canvas: { width, height, frameRate: 1, pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		codecs: { videoEncoder: 'libx264', audioEncoder: null, pixelFormat: 'yuv420p' },
		inputs: [{ kind: 'video-source', inputIndex: 0, sourceId: 'fixture' }],
		intervals: [{
			kind: 'composition',
			durationSeconds: 1,
			layers: [{
				trackId: 'fixture-track',
				clips: [{
					role: 'single', inputIndex: 0, sourceId: 'fixture',
					sourceStartTimeSeconds: 0, sourceEndTimeSeconds: 1, playbackRate: 1,
					opacityStart: 1, opacityEnd: 1, videoEffects: effects,
				}],
			}],
		}],
		filterPlan: { audio: { strategy: 'none' } },
	};
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: { fixture: 'fixture.rgba' },
	}, 'unused.mp4');
	return args[args.indexOf('-filter_complex') + 1];
}

function compositionFilterGraph(layers, width, height) {
	const plan = {
		version: 6,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		durationSeconds: 1,
		canvas: { width, height, frameRate: 1, pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p',
		},
		inputs: [{
			kind: 'video-source', inputIndex: 0, sourceId: 'fixture', mimeType: 'video/raw',
		}],
		intervals: [{
			kind: 'composition',
			durationSeconds: 1,
			layers: layers.map((layer, index) => {
				const description = layer.entries[0].renderDescription;
				return {
					trackId: `fixture-track-${String(index)}`,
					trackIndex: layers.length - index - 1,
					clips: [{
						role: 'single', inputIndex: 0, sourceId: 'fixture',
						sourceStartTimeSeconds: 0, sourceEndTimeSeconds: 1, playbackRate: 1,
						opacityStart: description.opacityStart,
						opacityEnd: description.opacityEnd,
						videoEffects: [],
						renderDescription: description,
					}],
				};
			}),
		}],
		filterPlan: { audio: { strategy: 'none' } },
	};
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: { fixture: 'fixture.rgba' },
	}, 'unused.mp4');
	return args[args.indexOf('-filter_complex') + 1];
}

async function rendererDiagnostic(page) {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2');
		if (!gl) return {
			rendererClass: 'unknown',
			vendor: 'unavailable',
			renderer: 'unavailable',
			devicePixelRatio: window.devicePixelRatio,
		};
		const extension = gl.getExtension('WEBGL_debug_renderer_info');
		const vendor = String(extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
		const renderer = String(extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
		const normalized = `${vendor} ${renderer}`.toLowerCase();
		const software = /swiftshader|llvmpipe|software/iu.test(normalized);
		return {
			rendererClass: software ? 'software' : 'hardware',
			vendor,
			renderer,
			devicePixelRatio: window.devicePixelRatio,
		};
	});
}
