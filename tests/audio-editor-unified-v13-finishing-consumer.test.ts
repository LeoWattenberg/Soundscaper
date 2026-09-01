/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createUnifiedExactRenderFinishingExportConsumerV13,
	createUnifiedExactRenderFinishingPreviewConsumerV13,
} from '../src/common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { warpApplied } from '../src/common/editor/unified-exact-render-finishing-motion-v13.ts';
import { analyzeVideoMotionV1 } from '../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectFinishing,
} from '../src/framescaper/editor-project-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE;
const SOURCE_SHA = '12'.repeat(32);

test('motion warping preserves abort reasons and AbortError classification', () => {
	const frame = rgba(1, 1, [0]);
	const transform = {
		scale: 1, rotationRadians: 0, translateX: 0, translateY: 0,
		inlierCount: 1, meanError: 0,
	};
	const reason = new DOMException('cancelled by caller', 'AbortError');
	const withReason = new AbortController();
	withReason.abort(reason);
	assert.throws(() => warpApplied(frame, transform, withReason.signal), (error) => error === reason);

	const withoutErrorReason = new AbortController();
	withoutErrorReason.abort('cancelled');
	assert.throws(
		() => warpApplied(frame, transform, withoutErrorReason.signal),
		(error: unknown) => error instanceof DOMException && error.name === 'AbortError',
	);
});

test('preview and V13 export use the same managed-SDR grade and denoise resolver', async () => {
	const project = createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: finishing({
			processors: [{
				schemaVersion: 1, id: 'spatial-1', kind: 'spatial-denoise', enabled: true,
				radius: 1, strength: 1,
			}],
			grade: {
				schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
				lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
				saturation: 1, lut: null,
			},
		}),
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const input = rgba(3, 1, [0, 255, 0]);
	const progress: string[] = [];
	const request = {
		clipId: 'video-clip', sourceFrame: 0, sequenceFrame: 0, frame: input,
		onProgress(value: Readonly<{ phase: string }>) { progress.push(value.phase); },
	};
	const preview = createUnifiedExactRenderFinishingPreviewConsumerV13(plan);
	const exporting = createUnifiedExactRenderFinishingExportConsumerV13(plan);
	const previewFrame = await preview.resolveFrame(request);
	const exportFrame = await exporting.resolveFrame({ ...request, onProgress: undefined });
	assert.deepEqual(exportFrame.pixels, previewFrame.pixels);
	assert.notDeepEqual(previewFrame.pixels, input.pixels);
	assert.deepEqual(progress, ['spatial-denoise', 'managed-color']);
	assert.equal(preview.plan, exporting.plan);
});

test('a processor stack shared by two applicable presentations executes once', async () => {
	const shared = finishing({
		processors: [{
			schemaVersion: 1, id: 'spatial-1', kind: 'spatial-denoise', enabled: true,
			radius: 1, strength: 1,
		}],
		grade: null,
	});
	const project = createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			...shared,
			visualPresentations: [
				...shared.visualPresentations,
				{
					...shared.visualPresentations[0], id: 'presentation-source',
					owner: { kind: 'source', id: 'video-source' },
				},
			],
		},
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const progress: string[] = [];
	await createUnifiedExactRenderFinishingExportConsumerV13(plan).resolveFrame({
		clipId: 'video-clip', sourceFrame: 0, sequenceFrame: 0, frame: rgba(3, 1, [0, 255, 0]),
		onProgress(value) { progress.push(value.phase); },
	});
	assert.deepEqual(progress, ['spatial-denoise', 'managed-color']);
});

test('preview and V13 export both refuse legacy unmanaged source color before processing', async () => {
	const project = createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(),
		finishing: {
			...finishing({ processors: [], grade: null }),
			sourceColorInterpretations: [{
				schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video',
				primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
				provenance: 'legacy-unmanaged-encoded',
			}],
		},
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const request = {
		clipId: 'video-clip', sourceFrame: 0, sequenceFrame: 0, frame: rgba(1, 1, [128]),
	};
	for (const consumer of [
		createUnifiedExactRenderFinishingPreviewConsumerV13(plan),
		createUnifiedExactRenderFinishingExportConsumerV13(plan),
	]) {
		const progress: string[] = [];
		await assert.rejects(() => consumer.resolveFrame({
			...request,
			onProgress(value) { progress.push(value.phase); },
		}), /legacy unmanaged source/iu);
		assert.deepEqual(progress, [], 'color admission precedes all pixel processing');
	}
});

test('similarity stabilization consumes only an authenticated fresh source-domain analysis', async () => {
	const trackingStack = {
		schemaVersion: 1 as const, id: 'stack-1', sourceId: 'video-source',
		processors: [
			{
				schemaVersion: 1 as const, id: 'tracking-1', kind: 'tracking' as const,
				enabled: true, maximumFeatures: 32, quality: 0.01,
				minimumDistance: 2, windowRadius: 2, pyramidLevels: 3,
			},
			{
				schemaVersion: 1 as const, id: 'stabilize-1',
				kind: 'similarity-stabilization' as const, enabled: true,
				motionProvider: 'pyramidal-lucas-kanade' as const,
				analysisId: 'analysis-1', strength: 1,
			},
		],
	};
	const before = square(0, 0);
	const after = square(1, 1);
	const analysis = await analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SOURCE_SHA,
		processorStack: trackingStack,
		frames: [{ frameNumber: 0, frame: before }, { frameNumber: 1, frame: after }],
	});
	const project = createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			...finishing({ processors: trackingStack.processors, grade: null }),
			motionAnalyses: [analysis.reference],
		},
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const consumer = createUnifiedExactRenderFinishingExportConsumerV13(plan);
	const frame = grayRgba(after);
	await assert.rejects(() => consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 1, sequenceFrame: 1, frame,
	}), /analysis.*body|unavailable|authenticated/iu);
	const stabilized = await consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 1, sequenceFrame: 1, frame,
		analysisBodies: new Map([['analysis-1', analysis.bytes]]),
	});
	assert.ok(centroidX(stabilized) < centroidX(frame) - 0.5);
	const large = scaledGrayRgba(after, 2);
	const largeStabilized = await consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 1, sequenceFrame: 1, frame: large,
		analysisBodies: new Map([['analysis-1', analysis.bytes]]),
	});
	assert.ok(
		centroidX(largeStabilized) < centroidX(large) - 1.5,
		'analysis-space translations scale to the rendered source geometry',
	);

	const corrupt = analysis.bytes.slice();
	corrupt[corrupt.length - 2] ^= 1;
	await assert.rejects(() => consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 1, sequenceFrame: 1, frame,
		analysisBodies: new Map([['analysis-1', corrupt]]),
	}), /digest|analysis body/iu);
});

test('temporal denoise requests an exact symmetric frame-addressed neighborhood', async () => {
	const processors = [
		{
			schemaVersion: 1 as const, id: 'tracking-1', kind: 'tracking' as const,
			enabled: true, maximumFeatures: 32, quality: 0.01,
			minimumDistance: 2, windowRadius: 2, pyramidLevels: 3,
		},
		{
			schemaVersion: 1 as const, id: 'temporal-1', kind: 'temporal-denoise' as const,
			enabled: true, motionProvider: 'pyramidal-lucas-kanade' as const,
			analysisId: 'analysis-1', radius: 2, strength: 0.5,
		},
	];
	const stack = {
		schemaVersion: 1 as const, id: 'stack-1', sourceId: 'video-source', processors,
	};
	const analysis = await analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SOURCE_SHA, processorStack: stack,
		frames: [0, 1, 2, 3, 4].map((frameNumber) => ({
			frameNumber, frame: square(frameNumber, 0),
		})),
	});
	const project = createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			...finishing({ processors, grade: null }), motionAnalyses: [analysis.reference],
		},
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const consumer = createUnifiedExactRenderFinishingExportConsumerV13(plan);
	const requested: number[] = [];
	const current = grayRgba(square(2, 0));
	await consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 2, sequenceFrame: 2, frame: current,
		analysisBodies: new Map([['analysis-1', analysis.bytes]]),
		resolveTemporalFrame({ sourceFrame }) {
			requested.push(sourceFrame);
			return grayRgba(square(sourceFrame, 0));
		},
	});
	assert.deepEqual(requested, [0, 1, 3, 4]);
	await assert.rejects(() => consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 2, sequenceFrame: 2, frame: current,
		analysisBodies: new Map([['analysis-1', analysis.bytes]]),
	}), /temporal neighbor 0.*unavailable/iu);
});

test('canvas-readback frames decode as canvas sRGB while the file interpretation still gates admission', async () => {
	// Canvas 2D readback returns full-range sRGB pixels no matter what the
	// source file's tags say: the browser already applied the file
	// interpretation while drawing. Decoding readback bytes with the file
	// tuple applies limited-range expansion and the BT.709 EOTF a second
	// time, crushing shadows and clipping highlights in preview and export
	// alike.
	const project = createFramescaperProjectFinishing(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			...finishing({ processors: [], grade: null }),
			sourceColorInterpretations: [{
				schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video',
				primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
				provenance: 'default-video-bt709-limited',
			}],
			visualPresentations: [],
			processorStacks: [],
		},
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	});
	const consumer = createUnifiedExactRenderFinishingExportConsumerV13(plan);
	const input = rgba(3, 1, [16, 128, 235]);
	const resolved = await consumer.resolveFrame({
		clipId: 'video-clip', sourceFrame: 0, sequenceFrame: 0, frame: input,
		frameEncoding: 'canvas-srgb',
	});
	assert.deepEqual(
		[...resolved.pixels], [...input.pixels],
		'an ungraded readback frame round-trips identically through managed color',
	);
});

function finishing(input: Readonly<{ processors: readonly unknown[]; grade: unknown }>) {
	return {
		colorContexts: [{
			schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working',
			toneMapping: 'none',
		}],
		sourceColorInterpretations: [{
			schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video',
			primaries: 'srgb', transfer: 'srgb', matrix: 'rgb', range: 'full',
			provenance: 'user-override',
		}],
		visualPresentations: [{
			schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
			enabled: true, opacity: 1, blendMode: 'normal', grade: input.grade,
			processorStackId: 'stack-1', maskMatteIds: [],
		}],
		processorStacks: [{
			schemaVersion: 1, id: 'stack-1', sourceId: 'video-source',
			processors: input.processors,
		}],
	};
}

function rgba(width: number, height: number, red: readonly number[]) {
	const pixels = new Uint8Array(width * height * 4);
	red.forEach((value, index) => {
		pixels[index * 4] = value;
		pixels[index * 4 + 1] = value;
		pixels[index * 4 + 2] = value;
		pixels[index * 4 + 3] = 255;
	});
	return { width, height, pixels };
}

function square(dx: number, dy: number) {
	const width = 24;
	const height = 24;
	const samples = Array.from({ length: width * height }, () => 0);
	for (let y = 7 + dy; y < 15 + dy; y += 1) {
		for (let x = 6 + dx; x < 14 + dx; x += 1) samples[y * width + x] = 1;
	}
	return createGrayVideoFrameV1({ width, height, samples });
}

function grayRgba(frame: ReturnType<typeof square>) {
	return rgba(frame.width, frame.height, frame.samples.map((value) => Math.round(value * 255)));
}

function scaledGrayRgba(frame: ReturnType<typeof square>, scale: number) {
	const width = frame.width * scale;
	const height = frame.height * scale;
	const values = Array.from({ length: width * height }, (_, index) => {
		const x = index % width;
		const y = Math.floor(index / width);
		return Math.round(frame.samples[Math.floor(y / scale) * frame.width + Math.floor(x / scale)]! * 255);
	});
	return rgba(width, height, values);
}

function centroidX(frame: Readonly<{ width: number; height: number; pixels: Uint8Array }>): number {
	let weighted = 0;
	let total = 0;
	for (let y = 0; y < frame.height; y += 1) {
		for (let x = 0; x < frame.width; x += 1) {
			const value = frame.pixels[(y * frame.width + x) * 4]!;
			weighted += value * x;
			total += value;
		}
	}
	return weighted / total;
}

test('the V14 professional plan reaches the same finishing resolver', async () => {
	// The V14 wrappers projected onto a fake V13 wire, which refused the
	// deliveryProfile field — and, once that was stripped, every professional
	// container tuple V13 never admits. Every V14 finishing consumer threw
	// before resolving a single frame; validation authority stays with V14 now.
	const [
		{ createFramescaperProjectUnifiedExactRenderPlanNativeMedia },
		{ createFramescaperNativeRenderPlanAuthorityNativeMedia },
		{ FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE },
		{ createFramescaperProjectNativeMedia },
		{ createUnifiedExactRenderFinishingExportConsumerV14, createUnifiedExactRenderFinishingPreviewConsumerV14 },
	] = await Promise.all([
		import('../src/framescaper/editor-project-unified-render-plan-native-media.ts'),
		import('../src/framescaper/editor-native-render-plan-authority.ts'),
		import('../src/framescaper/editor-domain-runtime-profile.ts'),
		import('../src/framescaper/editor-project-native-media.ts'),
		import('../src/common/editor/unified-exact-render-finishing-consumers-v14.ts'),
	]);
	const project = createFramescaperProjectNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	);
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	assert.equal(plan.version, 14);
	assert.equal(plan.format.container, 'mov');

	const exporter = createUnifiedExactRenderFinishingExportConsumerV14(plan);
	assert.equal(exporter.plan, plan);
	const preview = createUnifiedExactRenderFinishingPreviewConsumerV14(plan);
	const frame = await preview.resolveFrame({
		clipId: 'video-clip', sourceFrame: 0, sequenceFrame: 0,
		frame: { width: 2, height: 2, pixels: new Uint8Array(16) },
	});
	assert.deepEqual([frame.width, frame.height, frame.pixels.length], [2, 2, 16]);

	// Hostile input still fails closed at the V14 boundary.
	assert.throws(
		() => createUnifiedExactRenderFinishingExportConsumerV14({
			...plan, deliveryProfile: 'encode-mp4-h264',
		} as never),
		/unavailable|derived|exact|unsupported/iu,
	);
});
