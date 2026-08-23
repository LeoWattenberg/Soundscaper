/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
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
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsV27(
			project, authority.timingViews,
		), signal, assertCurrent() {},
		captureFrame: () => ({
			width: 2, height: 2,
			pixels: Uint8Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? 128
				: index % 4 === 3 ? 255 : 0),
		}),
	});
	const target = new Uint8Array(16);
	const result = await execution.render({
		sequencePosition: { num: 0, den: 1 },
		layers: [mediaLayer('video-clip', 1)], width: 2, height: 2, target, signal,
	});
	assert.deepEqual([...target.subarray(0, 4)], [128, 0, 0, 255]);
	assert.ok(result.consumedNodeIds.some((nodeId) => nodeId.includes('finishing')));
	assert.deepEqual(execution.acceleratorDisposition(), {
		attempted: false, active: false, fallbackReasons: [],
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
	assert.deepEqual(result.frame.ledger.requestedNodeIds, result.frame.ledger.consumedNodeIds);
	preview.dispose();
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
