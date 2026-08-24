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
import type { FramescaperOpenFxFrameExecutionRequestV28 } from '../src/framescaper/editor-openfx-frame-graph-v28.ts';
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
	const openFxPlan = Object.freeze({ ...plan, version: 14 as const,
		nodes: Object.freeze([...plan.nodes, openFxFilterNode()]) });
	let openFxCalls = 0;
	const preview = await createFramescaperSelectedExactPreviewV27({
		profile: PROFILE, project, plan, timingViews, boundTimingViews, signal, assertCurrent() {},
		store: {} as AudioEditorProjectStore,
		captureFrame: () => ({
			width: 2, height: 2,
			pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? 128
				: index % 4 === 3 ? 255 : 0),
		}),
		openFx: Object.freeze({ plan: openFxPlan as never,
		execute(request: FramescaperOpenFxFrameExecutionRequestV28) {
			openFxCalls += 1;
			assert.equal(request.context, 'filter');
			assert.deepEqual(request.inputs.map(({ name, sourceRef }) => [name, sourceRef]), [
				['Source', 'video-source'],
			]);
			return Promise.resolve({
				mode: 'render' as const, rgba: rgbaFrameColor(0, 255), backend: 'cpu' as const,
				retriedOnCpu: true, reportsDegradation: true,
			});
		} }),
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
	assert.ok(outputState.written[1]! > 0, 'the real preview consumes the OpenFX output pixels');
	assert.equal(openFxCalls, 1);
	assert.deepEqual(result.openFxDispositions, [{
		instanceId: 'effect-preview-filter', context: 'filter', outputOrdinal: 0,
		mode: 'render', reportsDegradation: true, backend: 'cpu', retriedOnCpu: true,
	}]);
	assert.equal(result.reportsOpenFxDegradation, true);
	assert.equal(result.layers[0]?.trackId, 'framescaper-v27-exact-output');
	assert.deepEqual(result.renderedEffectIds, []);
	assert.deepEqual(result.frame.ledger.requestedNodeIds, result.frame.ledger.consumedNodeIds);
	preview.dispose();
});

test('selected V27 preview resolves descriptors on the export point-rounded frame grid', async () => {
	// Export resolves every entry through the exact ordinal oracle, whose
	// outer cell comes from the point-rounded sequence grid. At NTSC rates the
	// exact-fraction floor disagrees on boundary samples — sample 3203 is
	// frame 2 on the point grid but floors to cell 1 — so a preview resolving
	// without the oracle previews different material than the export writes.
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	source.frameRate = { num: 30_000, den: 1_001 };
	source.frameCount = 16_016;
	source.sampleFrameCount = 16_016;
	source.timingDecision = { mode: 'conform-cfr-at-ingest', rate: { num: 30_000, den: 1_001 } };
	(options.sequences as Record<string, unknown>[])[0]!.rate = { num: 30_000, den: 1_001 };
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
		finishing: finishing(),
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 10),
		outputRate: { num: 30_000, den: 1_001 },
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map(),
	});
	const previewSource = (project.sources as readonly VideoSourceFixture[])
		.find((candidate) => candidate.kind === 'video')!;
	const timingViews = new Map([[previewSource.id, Object.freeze({
		kind: 'cfr' as const, rate: previewSource.frameRate, frameCount: previewSource.sourceFrameCount,
	})]]);
	const boundTimingViews = new Map([[previewSource.id, bindVideoSourceTimingView(timingViews, previewSource)]]);
	const observedCells: unknown[] = [];
	const signal = new AbortController().signal;
	const preview = await createFramescaperSelectedExactPreviewV27({
		profile: PROFILE, project, plan, timingViews, boundTimingViews, signal, assertCurrent() {},
		store: {} as AudioEditorProjectStore,
		captureFrame: (entry) => {
			const descriptor = (entry as {
				presentationDescriptor?: { outerCell?: unknown };
			}).presentationDescriptor;
			observedCells.push(descriptor?.outerCell);
			return {
				width: 2, height: 2,
				pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 3 ? 255 : 128),
			};
		},
		createOutput: () => ({ drawable: Object.freeze({}), write() {}, dispose() {} }),
	});
	const frame = Object.freeze({
		layers: Object.freeze([]), adjustments: Object.freeze([]),
		activeFreezeNodeIds: Object.freeze([]), availablePresetIds: Object.freeze([]),
		ledger: Object.freeze({ requestedNodeIds: Object.freeze([]),
			consumedNodeIds: Object.freeze([]), omittedNodeIds: Object.freeze([]) }),
	});
	await preview.render({ timelineSample: 3_203, mediaLayers: [mediaLayer('video-clip', 1)], frame });
	preview.dispose();
	assert.deepEqual(observedCells, [2], 'the boundary sample resolves the export grid cell');
});

test('selected V27 preview constructs its exact oracle with sequence-placed visual clips present', async () => {
	// A freeze-authored still or a menu-authored generator only carries
	// sequence-domain placement in the canonical V27 document. The exact
	// ordinal oracle consumes runtime coordinates, so the preview must resolve
	// it through the product runtime projection: projecting the canonical
	// document routes 'still' and 'generator' clips through the audio/legacy
	// resolver, which fails with "clip.timelineStartFrame must be a safe
	// integer." and drops the whole workspace preview into its non-exact
	// fallback.
	const options = framescaperV20Options();
	(options.clips as Record<string, unknown>[]).push({
		schemaVersion: 1, kind: 'generator', id: 'generator-clip',
		sourceId: 'generator-source', sequenceId: 'main-sequence',
		sequenceStartFrame: 10, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	});
	((options.tracks as Record<string, unknown>[])[0]!.clipIds as string[]).push('generator-clip');
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			generatorSources: [{
				schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Wash',
				width: 1_920, height: 1_080, frameRate: { num: 10, den: 1 }, frameCount: 100,
				generator: { kind: 'solid', color: '#ffffff80' },
			}],
		},
		finishing: finishing(),
	});
	const generatorClip = (project.clips as readonly Readonly<Record<string, unknown>>[])
		.find((clip) => clip.id === 'generator-clip')!;
	const generatorSource = (project.sources as readonly Readonly<Record<string, unknown>>[])
		.find((candidate) => candidate.id === 'generator-source')!;
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, project, {
		...renderAuthority(project, 20),
		canvas: { width: 2, height: 2, fit: 'contain' as const,
			pixelFormat: 'yuv420p', backgroundColor: '#000000' },
		visualFreshnessByModelId: new Map([
			['generator-clip', freshness({ source: generatorSource, clip: generatorClip })],
		]),
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
		profile: PROFILE, project, plan, timingViews, boundTimingViews, signal, assertCurrent() {},
		store: {} as AudioEditorProjectStore,
		captureFrame: () => rgbaFrame(128),
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
	await preview.render({ timelineSample: 0, mediaLayers: [mediaLayer('video-clip', 1)], frame });
	preview.dispose();
	assert.ok(outputState.written, 'the exact preview rendered with a still clip in the document');
	assert.deepEqual([...outputState.written.subarray(0, 4)], [128, 0, 0, 255]);
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

function rgbaFrameColor(red: number, green: number) {
	return Object.freeze({
		width: 2, height: 2,
		pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? red
			: index % 4 === 1 ? green : index % 4 === 3 ? 255 : 0),
	});
}

function openFxFilterNode() {
	const sha = 'a1'.repeat(32);
	return Object.freeze({
		kind: 'openfx' as const, nodeId: 'openfx-preview-filter',
		state: Object.freeze({
			schemaVersion: 1 as const, instanceId: 'effect-preview-filter',
			pluginId: 'net.example.PreviewFilter', binarySha256: sha, context: 'filter' as const,
			attachment: Object.freeze({ kind: 'filter' as const, targetId: 'video-clip' }),
			inputs: Object.freeze([Object.freeze({ name: 'Source', sourceRef: 'video-source' })]),
			parameters: Object.freeze([]), customEncodings: Object.freeze({}), enabled: true,
			freshness: Object.freeze({ authoredStateSha256: sha, inputIdentitiesSha256: sha,
				renderPlanFingerprintSha256: sha, nativeEffectFingerprintSha256: sha }),
			frozenFallback: null,
		}),
	});
}
