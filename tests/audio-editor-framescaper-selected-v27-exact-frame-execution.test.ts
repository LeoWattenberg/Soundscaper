/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { bindVideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV27 } from '../src/framescaper/editor-project-unified-render-plan-v27.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsV27 } from '../src/framescaper/editor-project-unified-render-timing-v27.ts';
import { createFramescaperSelectedExactPreviewV27 } from '../src/framescaper/editor-selected-v27-exact-preview.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createFramescaperSelectedExactFrameExecutionV27 } from '../src/framescaper/selected-v27-exact-frame-execution.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { freshness, renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 finishes each straight-alpha source layer in linear light and encodes once', async () => {
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: finishing(),
	});
	const authority = {
		...renderAuthority(project, 10),
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map(),
	};
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, authority);
	const signal = new AbortController().signal;
	const executionSignal = new AbortController().signal;
	let capturedSignal: AbortSignal | null = null;
	let currentChecks = 0;
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsV27(
			project, authority.timingViews,
		), signal, assertCurrent() { currentChecks += 1; },
		captureFrame: (_entry, frameSignal) => {
			capturedSignal = frameSignal;
			return {
				width: 2, height: 2,
				pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? 128
					: index % 4 === 3 ? 255 : 0),
			};
		},
	});
	currentChecks = 0;
	const target = new Uint8Array(16);
	const result = await execution.render({
		sequencePosition: { num: 0, den: 1 },
		layers: [mediaLayer('video-clip', 1)], width: 2, height: 2, target,
		signal: executionSignal,
	});
	assert.strictEqual(capturedSignal, executionSignal);
	assert.equal(currentChecks, 2, 'both frame boundaries retain outer currentness checks');
	assert.deepEqual([...target.subarray(0, 4)], [128, 0, 0, 255]);
	assert.ok(result.consumedNodeIds.some((nodeId) => nodeId.includes('finishing')));
	assert.deepEqual(execution.acceleratorDisposition(), {
		attempted: false, active: false, fallbackReasons: [],
	});
	await execution.dispose();
});

test('selected V27 records a stable fallback when WebGL2 context creation is unavailable', async () => {
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: temporalFinishing(),
	});
	const authority = {
		...renderAuthority(project, 10), visualFreshnessByModelId: new Map(),
	};
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, authority);
	const signal = new AbortController().signal;
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsV27(
			project, authority.timingViews,
		), signal, assertCurrent() {}, createAcceleratorCanvas: () => ({
			getContext() { return null; },
		}),
	});
	assert.deepEqual(execution.acceleratorDisposition(), {
		attempted: true, active: false, fallbackReasons: ['webgl2-context-unavailable'],
	});
	await execution.dispose();
});

test('selected V27 executes clip and adjustment effects once in their authored scopes', async () => {
	const clipEffect = videoEffect('clip-effect', 0.1);
	const adjustmentEffect = videoEffect('adjustment-effect', 0.25);
	const adjustment = {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		targetTrackIds: ['video-track'], effectIds: [adjustmentEffect.id],
	};
	const options = framescaperV20Options();
	(options.clips as Record<string, unknown>[])[0]!.videoEffects = [clipEffect, adjustmentEffect];
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { adjustmentLayers: [adjustment] }, finishing: finishing(),
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10),
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map([['adjustment', freshness(adjustment)]]),
	});
	const applied: string[][] = [];
	const signal = new AbortController().signal;
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsV27(
			project, renderAuthority(project, 10).timingViews,
		), signal, assertCurrent() {},
		captureFrame: () => rgbaFrame(64),
		applyEffects: (frame, effects) => {
			applied.push(effects.map((effect) => String((effect as { id?: unknown }).id)));
			return Promise.resolve(frame);
		},
	});
	await execution.render({
		sequencePosition: { num: 0, den: 1 },
		layers: [mediaLayer('video-clip', 1, [clipEffect, adjustmentEffect])],
		width: 2, height: 2, target: new Uint8Array(16), signal,
	});
	assert.deepEqual(applied, [['clip-effect'], ['adjustment-effect']]);
	await execution.dispose();
});

test('selected V27 preview uses the same exact source-layer route and presentation authority', async () => {
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: finishing(),
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10),
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map(),
	});
	const source = (project.sources as readonly VideoSourceFixture[])
		.find((candidate) => candidate.kind === 'video')!;
	const timingViews = new Map([[source.id, Object.freeze({
		kind: 'cfr' as const, rate: source.frameRate, frameCount: source.sourceFrameCount,
	})]]);
	const boundTimingViews = new Map([[source.id, bindVideoSourceTimingView(timingViews, source)]]);
	const signal = new AbortController().signal;
	const outputState: { written: Uint8Array<ArrayBuffer> | null } = { written: null };
	const preview = await createFramescaperSelectedExactPreviewV27({
		project, plan, timingViews, boundTimingViews, signal, assertCurrent() {},
		store: {} as AudioEditorProjectStore,
		captureFrame: () => ({
			width: 2, height: 2,
			pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? 128
				: index % 4 === 3 ? 255 : 0),
		}),
		createOutput: () => ({
			drawable: Object.freeze({}),
			write(pixels) { outputState.written = pixels.slice(); },
			dispose() {},
		}),
	});
	const frame = Object.freeze({
		layers: Object.freeze([]), adjustments: Object.freeze([]),
		activeFreezeNodeIds: Object.freeze([]), availablePresetIds: Object.freeze([]),
		ledger: Object.freeze({ requestedNodeIds: Object.freeze([]),
			consumedNodeIds: Object.freeze([]), omittedNodeIds: Object.freeze([]) }),
	});
	const result = await preview.render({ timelineSample: 0, mediaLayers: [mediaLayer('video-clip', 1)], frame });
	assert.ok(outputState.written);
	assert.deepEqual([...outputState.written.subarray(0, 4)], [128, 0, 0, 255]);
	assert.equal(result.layers[0]?.trackId, 'framescaper-v27-exact-output');
	assert.deepEqual(result.renderedEffectIds, []);
	assert.deepEqual(result.frame.ledger.requestedNodeIds, result.frame.ledger.consumedNodeIds);
	preview.dispose();
});

test('selected V27 honors authored compositingOrder across tracks', async () => {
	// The canonical painter order sorts by compositingOrder ascending, then
	// track position descending: a lower track whose clip authors a higher
	// compositingOrder must paint in front of the top track.
	const options = twoTrackOptions();
	(options.clips as Record<string, unknown>[])
		.find((clip) => clip.id === 'video-clip-b')!.videoComposition = {
		...DEFAULT_VIDEO_CLIP_COMPOSITION, compositingOrder: 5,
	};
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [], 'video-track-b': [] },
		finishing: { ...finishing(), visualPresentations: [] },
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10),
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map(),
	});
	const signal = new AbortController().signal;
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsV27(
			project, renderAuthority(project, 10).timingViews,
		), signal, assertCurrent() {},
		captureFrame: (entry) => solidFrame((entry as { clipId?: unknown }).clipId === 'video-clip-b'
			? [0, 255, 0, 255] : [255, 0, 0, 255]),
	});
	const target = new Uint8Array(16);
	await execution.render({
		sequencePosition: { num: 0, den: 1 },
		layers: [
			mediaLayer('video-clip', 1),
			backTrackLayer('video-clip-b', 5),
		],
		width: 2, height: 2, target, signal,
	});
	assert.deepEqual(
		[...target.subarray(0, 4)], [0, 255, 0, 255],
		'the lower track with compositingOrder 5 paints in front',
	);
	await execution.dispose();
});

test('an inert adjustment layer preserves the targeted track blend mode', async () => {
	// Flattening a targeted track must keep its authored blend authority
	// against lower tracks; an empty adjustment layer must not change pixels.
	const render = async (withAdjustment: boolean) => {
		const adjustment = {
			schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			targetTrackIds: ['video-track'], effectIds: [],
		};
		const project = createFramescaperProjectV27(PROFILE, {
			...twoTrackOptions(),
			videoTransitionsByTrackId: { 'video-track': [], 'video-track-b': [] },
			...(withAdjustment ? { visualModel: { adjustmentLayers: [adjustment] } } : {}),
			finishing: {
				...finishing(),
				visualPresentations: [{
					schemaVersion: 1, id: 'presentation-multiply',
					owner: { kind: 'clip', id: 'video-clip' },
					enabled: true, opacity: 1, blendMode: 'multiply',
					grade: null, processorStackId: null, maskMatteIds: [],
				}],
			},
		});
		const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
			...renderAuthority(project, 10),
			canvas: { width: 2, height: 2, fit: 'contain' as const,
				pixelFormat: 'yuv420p', backgroundColor: '#000000' },
			visualFreshnessByModelId: withAdjustment
				? new Map([['adjustment', freshness(adjustment)]]) : new Map(),
		});
		const signal = new AbortController().signal;
		const execution = await createFramescaperSelectedExactFrameExecutionV27({
			project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsV27(
				project, renderAuthority(project, 10).timingViews,
			), signal, assertCurrent() {},
			captureFrame: (entry) => solidFrame((entry as { clipId?: unknown }).clipId === 'video-clip'
				? [128, 128, 128, 255] : [200, 200, 200, 255]),
		});
		const target = new Uint8Array(16);
		await execution.render({
			sequencePosition: { num: 0, den: 1 },
			layers: [mediaLayer('video-clip', 1), backTrackLayer('video-clip-b', 0)],
			width: 2, height: 2, target, signal,
		});
		await execution.dispose();
		return [...target.subarray(0, 4)];
	};
	const without = await render(false);
	const withAdjustment = await render(true);
	assert.deepEqual(without, [99, 99, 99, 255], 'the upper clip multiplies against the lower track');
	assert.deepEqual(withAdjustment, without, 'an empty adjustment layer changes nothing');
});

test('selected V27 decodes canvas-captured media as canvas sRGB regardless of the file tags', async () => {
	// The browser already expanded limited range and converted the transfer
	// while drawing the video into the capture canvas, so a BT.709
	// limited-tagged source must not be range-expanded or EOTF-decoded a
	// second time from its readback bytes.
	const project = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			...finishing(),
			sourceColorInterpretations: [{
				schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video',
				primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
				provenance: 'default-video-bt709-limited',
			}],
			visualPresentations: [],
		},
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10),
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map(),
	});
	const signal = new AbortController().signal;
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsV27(
			project, renderAuthority(project, 10).timingViews,
		), signal, assertCurrent() {},
		captureFrame: () => rgbaFrame(128),
	});
	const target = new Uint8Array(16);
	await execution.render({
		sequencePosition: { num: 0, den: 1 },
		layers: [mediaLayer('video-clip', 1)], width: 2, height: 2, target, signal,
	});
	assert.deepEqual(
		[...target.subarray(0, 4)], [128, 0, 0, 255],
		'mid-gray readback survives managed color unshifted',
	);
	await execution.dispose();
});

function finishing() {
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
			enabled: true, opacity: 0.5, blendMode: 'normal',
			grade: {
				schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
				lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
				saturation: 1, lut: null,
			},
			processorStackId: null, maskMatteIds: [],
		}],
		processorStacks: [], motionAnalyses: [],
	};
}

function temporalFinishing() {
	const value = finishing();
	return {
		...value,
		processorStacks: [{
			schemaVersion: 1, id: 'stack-temporal', sourceId: 'video-source', processors: [{
				schemaVersion: 1, id: 'denoise-temporal', kind: 'temporal-denoise', enabled: true,
				motionProvider: 'pyramidal-lucas-kanade', analysisId: 'analysis-temporal',
				radius: 1, strength: 0.5,
			}],
		}],
		motionAnalyses: [{
			schemaVersion: 1, id: 'analysis-temporal', sourceId: 'video-source',
			processorStackId: 'stack-temporal', inputSha256: '12'.repeat(32),
			settingsSha256: '34'.repeat(32), storageKey: `motion-sha256:${'56'.repeat(32)}`,
			sha256: '56'.repeat(32), byteLength: 1, startFrame: 0, endFrame: 1,
		}],
	};
}

function twoTrackOptions(): Record<string, unknown> {
	const options = framescaperV20Options();
	(options.clips as Record<string, unknown>[]).push({
		kind: 'video', id: 'video-clip-b', sourceId: 'video-source', title: 'Lower',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
	});
	(options.tracks as Record<string, unknown>[]).splice(1, 0, createVideoTrack({
		id: 'video-track-b', name: 'Lower video', clipIds: ['video-clip-b'], locked: false,
	}));
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = [
		'video-track', 'video-track-b', 'audio-track',
	];
	return options;
}

function solidFrame(rgba: readonly number[]) {
	return Object.freeze({
		width: 2, height: 2,
		pixels: Uint8Array.from({ length: 16 }, (_, index) => rgba[index % 4]!),
	});
}

function backTrackLayer(clipId: string, compositingOrder: number) {
	return {
		trackId: 'video-track-b', trackIndex: 1, entries: [{
			kind: 'video', role: 'single', clipId, sourceId: 'video-source',
			presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
			video: { videoWidth: 2, videoHeight: 2 },
			displayWidth: 2, displayHeight: 2, effects: [], intervalProgress: 0,
			renderDescription: resolveVideoRenderDescription({
				composition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, compositingOrder },
				sourceDisplaySize: { width: 2, height: 2 },
				canvas: { width: 2, height: 2 }, opacityStart: 1,
			}),
		}],
	};
}

function mediaLayer(clipId: string, opacity: number, effects: readonly unknown[] = []) {
	return {
		trackId: 'video-track', trackIndex: 0, entries: [{
			kind: 'video', role: 'single', clipId, sourceId: 'video-source',
			presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
			video: { videoWidth: 2, videoHeight: 2 },
			displayWidth: 2, displayHeight: 2, effects, intervalProgress: 0,
			renderDescription: resolveVideoRenderDescription({
				composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				sourceDisplaySize: { width: 2, height: 2 },
				canvas: { width: 2, height: 2 }, opacityStart: opacity,
			}),
		}],
	};
}

interface VideoSourceFixture extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'video';
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly sourceFrameCount: number;
}

function videoEffect(id: string, brightness: number) {
	return Object.freeze({
		id, type: 'color-adjust', enabled: true,
		params: Object.freeze({ brightness, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 }),
	});
}

function rgbaFrame(red: number) {
	return Object.freeze({
		width: 2, height: 2,
		pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? red
			: index % 4 === 3 ? 255 : 0),
	});
}
