import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { buildVideoFfmpegArgs } from '../../src/lib/tools/audio-editor/video-ffmpeg.js';
import {
	VIDEO_EFFECT_TYPES,
	videoEffectDefaults,
} from '../../src/lib/tools/audio-editor/video-effects.js';
import {
	VIDEO_EFFECT_PARITY_HEIGHT,
	VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE,
	VIDEO_EFFECT_PARITY_MINIMUM_SSIM,
	VIDEO_EFFECT_PARITY_WIDTH,
	compareVideoEffectFrames,
	createVideoEffectParityFixture,
} from './video-effect-parity-helpers.js';

const PARITY_ROUTE_ROOT = '/__video-effect-parity__';
const RUNTIME_ROUTES = new Map([
	[`${PARITY_ROUTE_ROOT}/compositor.js`, {
		file: new URL('../../src/components/tools/audio-editor/video-preview-compositor.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/classes.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/const.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/const.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/errors.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/utils.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/utils.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/worker.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/core/ffmpeg-core.js`, {
		file: new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/core/ffmpeg-core.wasm`, {
		file: new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url),
		contentType: 'application/wasm',
	}],
]);

const PARITY_CASES = Object.freeze([
	parityCase('color-adjust-default', 'color-chart', effect('color-adjust')),
	parityCase('transparency-baseline', 'transparency'),
	parityCase('color-adjust-upper-boundaries', 'color-chart', effect('color-adjust', {
		brightness: 1,
		contrast: 2,
		saturation: 3,
		gamma: 4,
		hueDegrees: 180,
	})),
	parityCase('color-adjust-lower-boundaries', 'color-chart', effect('color-adjust', {
		brightness: -1,
		contrast: 0,
		saturation: 0,
		gamma: 0.25,
		hueDegrees: -180,
	})),
	parityCase('color-adjust-eq-upper-boundaries', 'color-chart', effect('color-adjust', {
		brightness: 1,
		contrast: 2,
		saturation: 3,
		gamma: 4,
		hueDegrees: 0,
	})),
	parityCase('color-adjust-hue-boundary', 'color-chart', effect('color-adjust', {
		hueDegrees: 180,
	})),
	parityCase('pixelate-default', 'gradient', effect('pixelate')),
	parityCase('pixelate-lower-boundary', 'gradient', effect('pixelate', { blockSize: 2 })),
	parityCase('pixelate-upper-boundary', 'color-chart', effect('pixelate', { blockSize: 128 })),
	parityCase('vignette-default', 'gradient', effect('vignette')),
	parityCase('vignette-default-transparency', 'transparency', effect('vignette')),
	parityCase('vignette-lower-boundary', 'transparency', effect('vignette', { amount: 0 })),
	parityCase('vignette-upper-boundary', 'gradient', effect('vignette', { amount: 1 })),
	parityCase('gaussian-blur-default', 'edge', effect('gaussian-blur')),
	parityCase('gaussian-blur-lower-boundary', 'edge', effect('gaussian-blur', { sigma: 0 })),
	parityCase('gaussian-blur-upper-boundary', 'edge', effect('gaussian-blur', { sigma: 20 })),
	parityCase('sharpen-default', 'edge', effect('sharpen')),
	parityCase('sharpen-zero-control', 'gradient', effect('sharpen', { amount: 0 })),
	parityCase('sharpen-upper-boundary', 'edge', effect('sharpen', { amount: 2 })),
	parityCase('rgb-split-default', 'transparency', effect('rgb-split')),
	parityCase('rgb-split-default-opaque', 'gradient', effect('rgb-split')),
	parityCase('rgb-split-boundaries', 'transparency', effect('rgb-split', {
		offsetX: 64,
		offsetY: -64,
	})),
	parityCase('rgb-split-opposite-boundaries', 'transparency', effect('rgb-split', {
		offsetX: -64,
		offsetY: 64,
	})),
	parityCase(
		'complete-default-stack',
		'gradient',
		...VIDEO_EFFECT_TYPES.map((type) => effect(type)),
	),
]);

test('WebGL preview stays within the calibrated FFmpeg golden-frame thresholds', async ({ page }, testInfo) => {
	test.skip(
		process.env.AUDIO_EDITOR_FFMPEG_BROWSER !== '1',
		'Enable for the pinned 31 MB FFmpeg/WebGL parity check.',
	);
	test.setTimeout(300_000);
	await installParityRuntimeRoutes(page);
	await page.goto(`${PARITY_ROUTE_ROOT}/index.html`);
	await initializeParityRuntime(page);
	const transparencyFixture = createVideoEffectParityFixture('transparency');
	const vignetteGraph = effectFilterGraph(
		[effect('vignette')],
		transparencyFixture.width,
		transparencyFixture.height,
	);
	const vignetteExpression = vignetteGraph.match(/vignette=[^[]+/)?.[0]?.split(',')[0];
	expect(vignetteExpression, 'The production graph must contain the allowlisted vignette filter.').toBeTruthy();
	const alphaAudit = await auditVignetteAlpha(page, {
		width: transparencyFixture.width,
		height: transparencyFixture.height,
		inputBase64: Buffer.from(transparencyFixture.bytes).toString('base64'),
		vignetteExpression,
		clipGraph: isolatedFirstClipGraph(vignetteGraph),
	});
	const opaqueFixture = createVideoEffectParityFixture('gradient');
	const opaqueVignetteAudit = await auditVignetteAlpha(page, {
		width: opaqueFixture.width,
		height: opaqueFixture.height,
		inputBase64: Buffer.from(opaqueFixture.bytes).toString('base64'),
		vignetteExpression,
		clipGraph: isolatedFirstClipGraph(vignetteGraph),
		filePrefix: 'opaque-',
	});

	const results = [];
	const collectResult = async (metadata, rendered, width, height) => {
		const preview = new Uint8Array(Buffer.from(rendered.previewBase64, 'base64'));
		const exported = new Uint8Array(Buffer.from(rendered.exportBase64, 'base64'));
		const metrics = compareVideoEffectFrames(preview, exported, width, height);
		const result = { ...metadata, ...metrics };
		results.push(result);
		const failed = metrics.ssim < VIDEO_EFFECT_PARITY_MINIMUM_SSIM
			|| Object.values(metrics.channelMae).some((mae) => mae > VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE);
		if (failed) {
			await testInfo.attach(`${metadata.name}-preview.ppm`, {
				body: rgbaToPpm(preview, width, height),
				contentType: 'image/x-portable-pixmap',
			});
			await testInfo.attach(`${metadata.name}-ffmpeg.ppm`, {
				body: rgbaToPpm(exported, width, height),
				contentType: 'image/x-portable-pixmap',
			});
		}
	};
	for (const parity of PARITY_CASES) {
		const fixture = createVideoEffectParityFixture(parity.fixture);
		const graph = effectFilterGraph(parity.effects, fixture.width, fixture.height);
		const rendered = await renderParityCase(page, {
			...parity,
			graph,
			width: fixture.width,
			height: fixture.height,
			inputBase64: Buffer.from(fixture.bytes).toString('base64'),
		});
		await collectResult(
			{ name: parity.name, fixture: parity.fixture, effects: parity.effects },
			rendered,
			fixture.width,
			fixture.height,
		);
	}

	const scaledFixture = createVideoEffectParityFixture('gradient');
	const scaledEffects = VIDEO_EFFECT_TYPES.map((type) => effect(type));
	const scaledRendered = await renderParityCase(page, {
		name: 'scaled-letterboxed-complete-stack',
		graph: effectFilterGraph(scaledEffects, scaledFixture.width, scaledFixture.height),
		width: scaledFixture.width,
		height: scaledFixture.height,
		panelWidth: scaledFixture.width * 2,
		panelHeight: scaledFixture.height * 2 + 32,
		inputBase64: Buffer.from(scaledFixture.bytes).toString('base64'),
		effects: scaledEffects,
	});
	expect(
		scaledRendered.letterboxMismatchedPixels,
		'The physical-panel letterbox must remain opaque black outside the export canvas.',
	).toBe(0);
	await collectResult(
		{
			name: 'scaled-letterboxed-complete-stack',
			fixture: 'gradient',
			effects: scaledEffects,
			panelScale: 2,
		},
		scaledRendered,
		scaledFixture.width,
		scaledFixture.height,
	);

	const alternateTransparency = alternateTransparencyFixture(transparencyFixture);
	for (const composition of [
		{
			name: 'transparent-layered-clips',
			kind: 'layered',
			layers: [
				[{ sourceIndex: 0, effects: [], opacity: 1 }],
				[{ sourceIndex: 1, effects: [], opacity: 1 }],
			],
		},
		{
			name: 'transparent-crossfade',
			kind: 'crossfade',
			layers: [[
				{ sourceIndex: 0, effects: [], opacity: 0.75 },
				{ sourceIndex: 1, effects: [], opacity: 0.25 },
			]],
		},
	]) {
		const rendered = await renderCompositionParityCase(page, {
			name: composition.name,
			graph: compositionFilterGraph(
				composition.kind,
				transparencyFixture.width,
				transparencyFixture.height,
			),
			width: transparencyFixture.width,
			height: transparencyFixture.height,
			inputBase64s: [transparencyFixture, alternateTransparency].map(
				(fixture) => Buffer.from(fixture.bytes).toString('base64'),
			),
			layers: composition.layers,
		});
		await collectResult(
			{ name: composition.name, fixture: 'transparency', effects: [], composition: composition.kind },
			rendered,
			transparencyFixture.width,
			transparencyFixture.height,
		);
	}

	await testInfo.attach('video-effect-parity-metrics.json', {
		body: Buffer.from(JSON.stringify({
			core: '@ffmpeg/core@0.12.10',
			alphaAudit,
			opaqueVignetteAudit,
			thresholds: {
				minimumSsim: VIDEO_EFFECT_PARITY_MINIMUM_SSIM,
				maximumPerChannelMae: VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE,
			},
			results,
		}, null, 2)),
		contentType: 'application/json',
	});
	console.info(`Video effect parity audit:\n${JSON.stringify({ alphaAudit, opaqueVignetteAudit, results }, null, 2)}`);
	expect(alphaAudit.mismatchedPixels, 'Vignette must retain every source alpha value before composition.').toBe(0);
	expect(alphaAudit.maximumDelta, 'Vignette must not alter source alpha before composition.').toBe(0);
	expect(alphaAudit.referenceRgbMaximum, 'The FFmpeg vignette reference must retain visible color.').toBeGreaterThan(0);
	expect(alphaAudit.outputRgbMaximum, 'The alpha-preserving vignette branch must retain visible color.').toBeGreaterThan(0);
	expect(alphaAudit.premultipliedRgbMaximum, 'The transparent vignette must remain visible after premultiplication.').toBeGreaterThan(0);
	expect(alphaAudit.mismatchedColorValues, 'Alpha preservation must not change vignette RGB values.').toBe(0);
	expect(alphaAudit.maximumColorDelta, 'Alpha preservation must not change the vignette color plane.').toBe(0);
	expect(alphaAudit.productionClipByteLength, 'The exact transparent production branch must emit one complete RGBA frame.').toBe(
		transparencyFixture.width * transparencyFixture.height * 4,
	);
	expect(alphaAudit.productionClipRgbMaximum, 'The exact transparent production branch must retain visible color.').toBeGreaterThan(0);
	expect(opaqueVignetteAudit.referenceRgbMaximum, 'The opaque vignette reference must retain visible color.').toBeGreaterThan(0);
	expect(opaqueVignetteAudit.outputRgbMaximum, 'The opaque alpha-preserving vignette branch must retain visible color.').toBeGreaterThan(0);
	expect(opaqueVignetteAudit.premultipliedRgbMaximum, 'The opaque vignette must remain visible after premultiplication.').toBeGreaterThan(0);
	expect(opaqueVignetteAudit.mismatchedColorValues, 'Opaque alpha preservation must retain vignette RGB values.').toBe(0);
	expect(opaqueVignetteAudit.productionClipByteLength, 'The exact opaque production branch must emit one complete RGBA frame.').toBe(
		opaqueFixture.width * opaqueFixture.height * 4,
	);
	expect(opaqueVignetteAudit.productionClipRgbMaximum, 'The exact opaque production branch must retain visible color.').toBeGreaterThan(0);

	for (const result of results) {
		expect.soft(
			result.ssim,
			`${result.name} SSIM must be at least ${VIDEO_EFFECT_PARITY_MINIMUM_SSIM}.`,
		).toBeGreaterThanOrEqual(VIDEO_EFFECT_PARITY_MINIMUM_SSIM);
		for (const [channel, mae] of Object.entries(result.channelMae)) {
			expect.soft(
				mae,
				`${result.name} ${channel} MAE must be at most ${VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE}.`,
			).toBeLessThanOrEqual(VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE);
		}
	}
});

function parityCase(name, fixture, ...effects) {
	return Object.freeze({ name, fixture, effects: Object.freeze(effects) });
}

function effect(type, params = {}) {
	return Object.freeze({
		id: `parity-${type}`,
		type,
		enabled: true,
		params: Object.freeze({ ...videoEffectDefaults(type), ...params }),
	});
}

function effectFilterGraph(effects, width, height) {
	const plan = {
		version: 3,
		format: 'mp4',
		container: 'mp4',
		durationSeconds: 1,
		canvas: {
			width,
			height,
			frameRate: 1,
			pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
		},
		codecs: {
			videoEncoder: 'libx264',
			audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		inputs: [{ kind: 'video-source', inputIndex: 0, sourceId: 'fixture' }],
		intervals: [{
			kind: 'composition',
			durationSeconds: 1,
			layers: [{
				trackId: 'fixture-track',
				clips: [{
					role: 'single',
					inputIndex: 0,
					sourceId: 'fixture',
					sourceStartTimeSeconds: 0,
					sourceEndTimeSeconds: 1,
					playbackRate: 1,
					opacityStart: 1,
					opacityEnd: 1,
					videoEffects: effects,
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

function isolatedFirstClipGraph(graph) {
	const outputLabel = 'video_interval_0_track_0_clip_0';
	const segments = graph.split(';');
	const first = segments.findIndex((segment) => segment.startsWith('[0:v:0]'));
	const last = segments.findIndex((segment, index) => (
		index >= first && segment.endsWith(`[${outputLabel}]`)
	));
	if (first < 0 || last < first) throw new Error('Unable to isolate the production clip graph.');
	return { graph: segments.slice(first, last + 1).join(';'), outputLabel };
}

function compositionFilterGraph(kind, width, height) {
	if (kind !== 'layered' && kind !== 'crossfade') {
		throw new RangeError(`Unsupported parity composition: ${kind}.`);
	}
	const clip = (inputIndex, role, opacityStart, opacityEnd) => ({
		role,
		inputIndex,
		sourceId: `fixture-${inputIndex}`,
		sourceStartTimeSeconds: 0,
		sourceEndTimeSeconds: 1,
		playbackRate: 1,
		opacityStart,
		opacityEnd,
		videoEffects: [],
	});
	const layers = kind === 'layered'
		? [
			{ trackId: 'fixture-lower', clips: [clip(0, 'single', 1, 1)] },
			{ trackId: 'fixture-upper', clips: [clip(1, 'single', 1, 1)] },
		]
		: [{
			trackId: 'fixture-crossfade',
			clips: [
				clip(0, 'outgoing', 0.75, 0.25),
				clip(1, 'incoming', 0.25, 0.75),
			],
		}];
	const plan = {
		version: 3,
		format: 'mp4',
		container: 'mp4',
		durationSeconds: 1,
		canvas: {
			width,
			height,
			frameRate: 1,
			pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
		},
		codecs: {
			videoEncoder: 'libx264',
			audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		inputs: [0, 1].map((inputIndex) => ({
			kind: 'video-source',
			inputIndex,
			sourceId: `fixture-${inputIndex}`,
		})),
		intervals: [{ kind: 'composition', durationSeconds: 1, layers }],
		filterPlan: { audio: { strategy: 'none' } },
	};
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: {
			'fixture-0': 'fixture-0.rgba',
			'fixture-1': 'fixture-1.rgba',
		},
	}, 'unused.mp4');
	return args[args.indexOf('-filter_complex') + 1];
}

function alternateTransparencyFixture(fixture) {
	const bytes = new Uint8Array(fixture.bytes.length);
	for (let y = 0; y < fixture.height; y += 1) {
		for (let x = 0; x < fixture.width; x += 1) {
			const target = (y * fixture.width + x) * 4;
			bytes[target] = Math.round(224 - 160 * x / Math.max(1, fixture.width - 1));
			bytes[target + 1] = Math.round(40 + 176 * y / Math.max(1, fixture.height - 1));
			bytes[target + 2] = Math.round(64 + 128 * (x + y) / Math.max(1, fixture.width + fixture.height - 2));
			bytes[target + 3] = Math.round(48 + 160 * (fixture.width - 1 - x) / Math.max(1, fixture.width - 1));
		}
	}
	return { ...fixture, name: 'transparency-alternate', bytes };
}

async function installParityRuntimeRoutes(page) {
	await page.route(`**${PARITY_ROUTE_ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${PARITY_ROUTE_ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style>',
			});
			return;
		}
		const descriptor = RUNTIME_ROUTES.get(pathname);
		if (!descriptor) {
			await route.fulfill({ status: 404, body: 'Not found' });
			return;
		}
		const body = await readFile(descriptor.file);
		await route.fulfill({
			status: 200,
			contentType: descriptor.contentType,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Content-Length': String(body.byteLength),
			},
			body,
		});
	});
}

async function initializeParityRuntime(page) {
	await page.evaluate(async (root) => {
		const [{ FFmpeg }, { VideoPreviewCompositor }] = await Promise.all([
			import(`${root}/ffmpeg/classes.js`),
			import(`${root}/compositor.js`),
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
		window.__videoEffectParity = { FFmpeg, VideoPreviewCompositor, ffmpeg, logs };
	}, PARITY_ROUTE_ROOT);
}

async function renderParityCase(page, parity) {
	return renderCompositionParityCase(page, {
		name: parity.name,
		graph: parity.graph,
		width: parity.width,
		height: parity.height,
		panelWidth: parity.panelWidth,
		panelHeight: parity.panelHeight,
		inputBase64s: [parity.inputBase64],
		layers: [[{ sourceIndex: 0, effects: parity.effects, opacity: 1 }]],
	});
}

async function renderCompositionParityCase(page, parity) {
	return page.evaluate(async ({
		name,
		graph,
		width,
		height,
		panelWidth = width,
		panelHeight = height,
		inputBase64s,
		layers,
	}) => {
		const runtime = window.__videoEffectParity;
		const inputs = inputBase64s.map((inputBase64) => (
			Uint8Array.from(atob(inputBase64), (value) => value.charCodeAt(0))
		));
		document.body.replaceChildren();
		const sources = inputs.map((input) => {
			const source = document.createElement('canvas');
			source.width = width;
			source.height = height;
			Object.defineProperties(source, {
				videoWidth: { configurable: true, get: () => width },
				videoHeight: { configurable: true, get: () => height },
				readyState: { configurable: true, get: () => 4 },
			});
			const sourceContext = source.getContext('2d');
			sourceContext.putImageData(new ImageData(new Uint8ClampedArray(input), width, height), 0, 0);
			return source;
		});

		const output = document.createElement('canvas');
		output.style.width = `${panelWidth}px`;
		output.style.height = `${panelHeight}px`;
		document.body.append(output);
		const compositor = new runtime.VideoPreviewCompositor(output);
		const previewLayers = layers.map((layer) => ({
			entries: layer.map((entry) => ({
				video: sources[entry.sourceIndex],
				effects: entry.effects,
				opacity: entry.opacity,
			})),
		}));
		const count = compositor.render(previewLayers, { referenceWidth: width, referenceHeight: height });
		const expectedCount = layers.reduce((total, layer) => total + layer.length, 0);
		if (count !== expectedCount) {
			throw new Error(`Preview rendered ${count} fixture entries instead of ${expectedCount}.`);
		}
		const gl = compositor.gl;
		gl.finish();
		const outputWidth = output.width;
		const outputHeight = output.height;
		const bottomUp = new Uint8Array(outputWidth * outputHeight * 4);
		gl.readPixels(0, 0, outputWidth, outputHeight, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
		if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL readback failed.');
		const fullPreview = flipRgbaRows(bottomUp, outputWidth, outputHeight);
		const previewScale = Math.min(outputWidth / width, outputHeight / height);
		const previewWidth = Math.max(1, Math.round(width * previewScale));
		const previewHeight = Math.max(1, Math.round(height * previewScale));
		const previewX = Math.round((outputWidth - previewWidth) / 2);
		const previewY = Math.round((outputHeight - previewHeight) / 2);
		let letterboxMismatchedPixels = 0;
		for (let y = 0; y < outputHeight; y += 1) {
			for (let x = 0; x < outputWidth; x += 1) {
				if (
				x >= previewX && x < previewX + previewWidth
				&& y >= previewY && y < previewY + previewHeight
				) continue;
				const offset = (y * outputWidth + x) * 4;
				if (
					fullPreview[offset] !== 0
					|| fullPreview[offset + 1] !== 0
					|| fullPreview[offset + 2] !== 0
					|| fullPreview[offset + 3] !== 255
				) letterboxMismatchedPixels += 1;
			}
		}
		const preview = boxResampleRgba(
			fullPreview,
			outputWidth,
			previewX,
			previewY,
			previewWidth,
			previewHeight,
			width,
			height,
		);
		compositor.dispose();

		const safeName = name.replace(/[^a-z0-9-]+/gi, '-');
		const inputNames = inputs.map((input, index) => `${safeName}-${index}.rgba`);
		const outputName = `${safeName}-ffmpeg.rgba`;
		const logOffset = runtime.logs.length;
		try {
			for (const [index, input] of inputs.entries()) {
				await runtime.ffmpeg.writeFile(inputNames[index], input.slice());
			}
			const inputArgs = inputNames.flatMap((inputName) => [
				'-f', 'rawvideo',
				'-pixel_format', 'rgba',
				'-video_size', `${width}x${height}`,
				'-framerate', '1',
				'-i', inputName,
			]);
			const exitCode = await runtime.ffmpeg.exec([
				...inputArgs,
				'-filter_complex', graph,
				'-map', '[video_out]',
				'-frames:v', '1',
				'-c:v', 'rawvideo',
				'-pix_fmt', 'rgba',
				'-f', 'rawvideo',
				outputName,
			]);
			if (exitCode !== 0) {
				throw new Error(`FFmpeg exited with ${exitCode}: ${runtime.logs.slice(logOffset).join('\n')}`);
			}
			const exported = await runtime.ffmpeg.readFile(outputName);
			if (!(exported instanceof Uint8Array) || exported.length !== width * height * 4) {
				throw new Error(`FFmpeg returned ${exported?.length ?? 'no'} bytes; expected ${width * height * 4}.`);
			}
			return {
				previewBase64: bytesToBase64(preview),
				exportBase64: bytesToBase64(exported),
				letterboxMismatchedPixels,
			};
		} finally {
			for (const inputName of inputNames) {
				await runtime.ffmpeg.deleteFile(inputName).catch(() => undefined);
			}
			await runtime.ffmpeg.deleteFile(outputName).catch(() => undefined);
		}

		function flipRgbaRows(bytes, frameWidth, frameHeight) {
			const result = new Uint8Array(bytes.length);
			const stride = frameWidth * 4;
			for (let y = 0; y < frameHeight; y += 1) {
				result.set(bytes.subarray((frameHeight - 1 - y) * stride, (frameHeight - y) * stride), y * stride);
			}
			return result;
		}

		function boxResampleRgba(bytes, sourceWidth, sourceX, sourceY, sourceWidthInPixels, sourceHeightInPixels, targetWidth, targetHeight) {
			if (sourceWidthInPixels === targetWidth && sourceHeightInPixels === targetHeight) {
				const result = new Uint8Array(targetWidth * targetHeight * 4);
				for (let y = 0; y < targetHeight; y += 1) {
					const start = ((sourceY + y) * sourceWidth + sourceX) * 4;
					result.set(bytes.subarray(start, start + targetWidth * 4), y * targetWidth * 4);
				}
				return result;
			}
			const result = new Uint8Array(targetWidth * targetHeight * 4);
			for (let targetY = 0; targetY < targetHeight; targetY += 1) {
				const firstY = sourceY + Math.floor(targetY * sourceHeightInPixels / targetHeight);
				const lastY = sourceY + Math.ceil((targetY + 1) * sourceHeightInPixels / targetHeight);
				for (let targetX = 0; targetX < targetWidth; targetX += 1) {
					const firstX = sourceX + Math.floor(targetX * sourceWidthInPixels / targetWidth);
					const lastX = sourceX + Math.ceil((targetX + 1) * sourceWidthInPixels / targetWidth);
					const sums = [0, 0, 0, 0];
					let sampleCount = 0;
					for (let sourcePixelY = firstY; sourcePixelY < lastY; sourcePixelY += 1) {
						for (let sourcePixelX = firstX; sourcePixelX < lastX; sourcePixelX += 1) {
							const sourceOffset = (sourcePixelY * sourceWidth + sourcePixelX) * 4;
							for (let channel = 0; channel < 4; channel += 1) {
								sums[channel] += bytes[sourceOffset + channel];
							}
							sampleCount += 1;
						}
					}
					const targetOffset = (targetY * targetWidth + targetX) * 4;
					for (let channel = 0; channel < 4; channel += 1) {
						result[targetOffset + channel] = Math.round(sums[channel] / sampleCount);
					}
				}
			}
			return result;
		}

		function bytesToBase64(bytes) {
			let binary = '';
			const chunkSize = 0x4000;
			for (let offset = 0; offset < bytes.length; offset += chunkSize) {
				binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
			}
			return btoa(binary);
		}
	}, parity);
}

async function auditVignetteAlpha(page, audit) {
	return page.evaluate(async ({
		width,
		height,
		inputBase64,
		vignetteExpression,
		clipGraph,
		filePrefix = '',
	}) => {
		const runtime = window.__videoEffectParity;
		const input = Uint8Array.from(atob(inputBase64), (value) => value.charCodeAt(0));
		const inputName = `${filePrefix}vignette-alpha-input.rgba`;
		const outputName = `${filePrefix}vignette-alpha-output.rgba`;
		const referenceName = `${filePrefix}vignette-color-reference.rgba`;
		const premultipliedName = `${filePrefix}vignette-premultiplied.rgba`;
		const productionClipName = `${filePrefix}vignette-production-clip.rgba`;
		const graph = '[0:v]format=pix_fmts=rgba,split=2[color][alpha_source];'
			+ '[alpha_source]alphaextract[alpha];'
			+ `[color]${vignetteExpression},format=pix_fmts=rgb24[filtered_color];`
			+ '[filtered_color][alpha]alphamerge,format=pix_fmts=rgba[video_out]';
		const referenceGraph = `[0:v]format=pix_fmts=rgba,${vignetteExpression},`
			+ 'format=pix_fmts=rgb24,format=pix_fmts=rgba[video_out]';
		const premultipliedGraph = '[0:v]format=pix_fmts=rgba,split=2[color][alpha_source];'
			+ '[alpha_source]alphaextract[alpha];'
			+ `[color]${vignetteExpression},format=pix_fmts=rgb24[filtered_color];`
			+ '[filtered_color][alpha]alphamerge,format=pix_fmts=rgba,'
			+ 'premultiply=inplace=1,format=pix_fmts=rgba[video_out]';
		try {
			await runtime.ffmpeg.writeFile(inputName, input.slice());
			const runGraph = (filterGraph, target, outputLabel = 'video_out') => runtime.ffmpeg.exec([
				'-f', 'rawvideo',
				'-pixel_format', 'rgba',
				'-video_size', `${width}x${height}`,
				'-framerate', '1',
				'-i', inputName,
				'-filter_complex', filterGraph,
				'-map', `[${outputLabel}]`,
				'-frames:v', '1',
				'-c:v', 'rawvideo',
				'-pix_fmt', 'rgba',
				'-f', 'rawvideo',
				target,
			]);
			let exitCode = await runGraph(graph, outputName);
			if (exitCode !== 0) throw new Error(`FFmpeg alpha audit exited with ${exitCode}.`);
			exitCode = await runGraph(referenceGraph, referenceName);
			if (exitCode !== 0) throw new Error(`FFmpeg vignette reference exited with ${exitCode}.`);
			exitCode = await runGraph(premultipliedGraph, premultipliedName);
			if (exitCode !== 0) throw new Error(`FFmpeg vignette premultiplication audit exited with ${exitCode}.`);
			exitCode = await runGraph(clipGraph.graph, productionClipName, clipGraph.outputLabel);
			if (exitCode !== 0) throw new Error(`FFmpeg production clip audit exited with ${exitCode}.`);
			const output = await runtime.ffmpeg.readFile(outputName);
			const reference = await runtime.ffmpeg.readFile(referenceName);
			const premultiplied = await runtime.ffmpeg.readFile(premultipliedName);
			const productionClip = await runtime.ffmpeg.readFile(productionClipName);
			let mismatchedPixels = 0;
			let maximumDelta = 0;
			let mismatchedColorValues = 0;
			let maximumColorDelta = 0;
			let referenceRgbMaximum = 0;
			let outputRgbMaximum = 0;
			let premultipliedRgbMaximum = 0;
			let productionClipRgbMaximum = 0;
			let productionClipAlphaMinimum = 255;
			let productionClipAlphaMaximum = 0;
			for (let offset = 3; offset < input.length; offset += 4) {
				const delta = Math.abs(input[offset] - output[offset]);
				if (delta) mismatchedPixels += 1;
				maximumDelta = Math.max(maximumDelta, delta);
			}
			for (let offset = 0; offset < input.length; offset += 4) {
				for (let channel = 0; channel < 3; channel += 1) {
					const colorDelta = Math.abs(reference[offset + channel] - output[offset + channel]);
					if (colorDelta) mismatchedColorValues += 1;
					maximumColorDelta = Math.max(maximumColorDelta, colorDelta);
					referenceRgbMaximum = Math.max(referenceRgbMaximum, reference[offset + channel]);
					outputRgbMaximum = Math.max(outputRgbMaximum, output[offset + channel]);
					premultipliedRgbMaximum = Math.max(
						premultipliedRgbMaximum,
						premultiplied[offset + channel],
					);
					productionClipRgbMaximum = Math.max(
						productionClipRgbMaximum,
						productionClip[offset + channel] ?? 0,
					);
				}
				productionClipAlphaMinimum = Math.min(
					productionClipAlphaMinimum,
					productionClip[offset + 3] ?? 0,
				);
				productionClipAlphaMaximum = Math.max(
					productionClipAlphaMaximum,
					productionClip[offset + 3] ?? 0,
				);
			}
			return {
				mismatchedPixels,
				maximumDelta,
				mismatchedColorValues,
				maximumColorDelta,
				referenceRgbMaximum,
				outputRgbMaximum,
				premultipliedRgbMaximum,
				productionClipByteLength: productionClip.length,
				productionClipRgbMaximum,
				productionClipAlphaMinimum,
				productionClipAlphaMaximum,
			};
		} finally {
			await runtime.ffmpeg.deleteFile(inputName).catch(() => undefined);
			await runtime.ffmpeg.deleteFile(outputName).catch(() => undefined);
			await runtime.ffmpeg.deleteFile(referenceName).catch(() => undefined);
			await runtime.ffmpeg.deleteFile(premultipliedName).catch(() => undefined);
			await runtime.ffmpeg.deleteFile(productionClipName).catch(() => undefined);
		}
	}, audit);
}

function rgbaToPpm(rgba, width, height) {
	const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
	const rgb = Buffer.alloc(width * height * 3);
	for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
		rgb[target] = rgba[source];
		rgb[target + 1] = rgba[source + 1];
		rgb[target + 2] = rgba[source + 2];
	}
	return Buffer.concat([header, rgb]);
}
