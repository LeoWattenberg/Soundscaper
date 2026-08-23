/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	clearVideoPreviewCompositorLayer,
	primeVideoPreviewCompositorPool,
	synchronizeVideoPreviewCompositorLayers,
} from '../src/common/editor/ui/workspace/video-preview-compositor-pool.js';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createVideoKeyframeRenderStateProvider } from '../src/common/editor/video-keyframe-render-state-provider.ts';
import { isVideoKeyframePreviewStateError } from '../src/common/editor/video-keyframe-preview-state.ts';
import { resolveVideoRenderDescription } from '../src/common/editor/video-render-description.ts';

test('preview resolves its reference canvas before opting both timeline views into descriptions', async () => {
	const source = await readFile(new URL(
		'../src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		import.meta.url,
	), 'utf8');
	const timelineSource = await readFile(new URL(
		'../src/common/editor/ui/workspace/video-preview-timeline-state.js',
		import.meta.url,
	), 'utf8');
	assert.ok(source.indexOf('const referenceCanvas = useMemo') < source.indexOf('const layerResolution = useMemo'));
	assert.match(source, /resolveActiveVideoLayers\(project, positionFrame, \{[\s\S]*renderCanvas: referenceCanvas,[\s\S]*resolveClipRenderState,[\s\S]*\}\)/u);
	assert.match(timelineSource, /resolveVideoCompositionIntervals\(project, \{[\s\S]*renderCanvas, resolveClipPresentation, resolveTransitionWeight,[\s\S]*\}\)/u);
	assert.match(source, /failedVideoSourcesRef\.current,\s*referenceCanvas,\s*keyframeStateProvider,/u);
	assert.match(source, /isVideoKeyframePreviewStateError\(error\)/u);
	assert.match(source, /clearVideoPreviewCompositorLayers/u);
	assert.match(source, /data-video-preview-keyframe-error/u);
	assert.match(source, /videoPreviewKeyframesUnavailable/u);
});

test('program compositor pauses and seeks retimed media from the exact ordinal descriptor', () => {
	const layerPool = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const targetLayers = [];
	let pauses = 0;
	const video = {
		readyState: 4, videoWidth: 640, videoHeight: 360, currentTime: 0,
		pause() { pauses += 1; },
	};
	const timeline = compositionTimeline({});
	timeline.resolveClipPresentation = ({ timelineSample }) => ({
		sourceTime: { numerator: BigInt(timelineSample + 5), denominator: 2n },
	});
	assert.equal(synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		timeline,
		5,
		new Map([['clip', video]]),
		effectBypass(),
		new Map(),
	), true);
	assert.equal(video.currentTime, 5);
	assert.equal(pauses, 1);
});

test('preview pool carries canonical render descriptions into entries and layer blend state', () => {
	const renderDescription = resolveVideoRenderDescription({
		composition: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION,
			opacity: 0.5,
			blendMode: 'multiply',
		},
		sourceDisplaySize: { width: 640, height: 360 },
		canvas: { width: 1_280, height: 720 },
		opacityStart: 0,
		opacityEnd: 1,
	});
	const layerPool = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const targetLayers = [];
	const video = { readyState: 4, videoWidth: 640, videoHeight: 360 };
	const timeline = compositionTimeline({ renderDescription });

	assert.equal(synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		timeline,
		5,
		new Map([['clip', video]]),
		effectBypass(),
		new Map(),
	), true);
	assert.equal(targetLayers.length, 1);
	assert.equal(targetLayers[0].blendMode, 'multiply');
	assert.strictEqual(targetLayers[0].entries[0].renderDescription, renderDescription);
	assert.equal(targetLayers[0].entries[0].intervalProgress, 0.5);
	assert.equal(targetLayers[0].entries[0].opacity, 0.5);
});

test('preview pool removes render fields when a legacy descriptor is absent or a layer clears', () => {
	const layerPool = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const targetLayers = [];
	const entry = layerPool[0].entryPool[0];
	entry.renderDescription = { stale: true };
	entry.intervalProgress = 0.75;
	layerPool[0].blendMode = 'screen';

	synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		compositionTimeline({}),
		5,
		new Map([['clip', { readyState: 4, videoWidth: 640, videoHeight: 360 }]]),
		effectBypass(),
		new Map(),
	);
	assert.equal(Object.hasOwn(entry, 'renderDescription'), false);
	assert.equal(Object.hasOwn(entry, 'intervalProgress'), false);
	assert.equal(Object.hasOwn(layerPool[0], 'blendMode'), false);

	entry.renderDescription = { stale: true };
	entry.intervalProgress = 0.25;
	layerPool[0].blendMode = 'overlay';
	clearVideoPreviewCompositorLayer(layerPool[0]);
	assert.equal(Object.hasOwn(entry, 'renderDescription'), false);
	assert.equal(Object.hasOwn(entry, 'intervalProgress'), false);
	assert.equal(Object.hasOwn(layerPool[0], 'blendMode'), false);
});

test('preview pool resolves keyed composition and effects at the live sample, not the interval endpoints', () => {
	const layerPool = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const targetLayers = [];
	const effects = [createVideoEffect('color-adjust', { id: 'color' })];
	const clip = keyframedClip(effects);
	const timeline = compositionTimeline({
		clip,
		source: { id: 'source', width: 640, height: 360 },
		opacityStart: 1,
		opacityEnd: 1,
		renderDescription: resolveVideoRenderDescription({
			composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			sourceDisplaySize: { width: 640, height: 360 },
			canvas: { width: 1_280, height: 720 },
		}),
	});
	timeline.keyframeStateProvider = createVideoKeyframeRenderStateProvider();
	timeline.renderCanvas = { width: 1_280, height: 720 };

	assert.equal(synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		timeline,
		2,
		new Map([['clip', { readyState: 4, videoWidth: 640, videoHeight: 360 }]]),
		effectBypass(),
		new Map(),
	), true);
	assert.equal(targetLayers[0].entries[0].renderDescription.opacityStart, 0.2);
	assert.equal(targetLayers[0].entries[0].opacity, 0.2);
	assert.equal(targetLayers[0].entries[0].intervalProgress, 0);
	assert.ok(Math.abs(targetLayers[0].entries[0].effects[0].params.brightness + 0.6) < 1e-12);
});

test('invalid keyed state fails before pooled preview entries are mutated', () => {
	const layerPool = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const targetLayers = [];
	const videoElements = new Map([['clip', { readyState: 4, videoWidth: 640, videoHeight: 360 }]]);
	synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		compositionTimeline({}),
		5,
		videoElements,
		effectBypass(),
		new Map(),
	);
	const priorEntry = { ...targetLayers[0].entries[0] };
	const invalid = compositionTimeline({ clip: { ...keyframedClip([]), videoKeyframes: null } });
	invalid.keyframeStateProvider = createVideoKeyframeRenderStateProvider();
	invalid.renderCanvas = { width: 1_280, height: 720 };
	assert.throws(() => synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		invalid,
		5,
		videoElements,
		effectBypass(),
		new Map(),
	), (error) => isVideoKeyframePreviewStateError(error));
	assert.deepEqual(targetLayers[0].entries[0], priorEntry);
});

test('a keyed pool entry without the injected provider fails branded before readiness can retain stale pixels', () => {
	const layerPool = [];
	primeVideoPreviewCompositorPool(layerPool, 1);
	const targetLayers = [layerPool[0]];
	const timeline = compositionTimeline({ clip: keyframedClip([]) });
	timeline.renderCanvas = { width: 1_280, height: 720 };
	assert.throws(() => synchronizeVideoPreviewCompositorLayers(
		targetLayers,
		layerPool,
		timeline,
		5,
		new Map([['clip', { readyState: 0, videoWidth: 0, videoHeight: 0 }]]),
		effectBypass(),
		new Map(),
	), (error) => isVideoKeyframePreviewStateError(error));
});

function compositionTimeline(clipFields) {
	const clip = clipFields.clip || { videoEffects: [] };
	const source = clipFields.source || { id: 'source', width: 640, height: 360 };
	return {
		clipStateById: new Map([['clip', { available: true }]]),
		intervals: [{
			kind: 'composition',
			timelineStartFrame: 0,
			timelineEndFrame: 10,
			layers: [{
				trackId: 'video-track',
				clips: [{
					clipId: 'clip',
					role: 'single',
					clip,
					source,
					opacityStart: 0,
					opacityEnd: 1,
					...clipFields,
				}],
			}],
		}],
	};
}

function keyframedClip(effects) {
	return {
		kind: 'video',
		id: 'clip',
		timelineStartFrame: 0,
		durationFrames: 10,
		sequenceFrameCount: 10,
		videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: effects,
		videoKeyframes: {
			schemaVersion: 1,
			timeDomain: {
				authoredDuration: { num: 10, den: 1 },
				viewStart: { num: 0, den: 1 },
				viewDuration: { num: 10, den: 1 },
			},
			curves: [{
				target: { kind: 'composition', parameterId: 'opacity' },
				curve: linearCurve(0, 1),
			}, ...(effects.length ? [{
				target: { kind: 'video-effect', effectId: 'color', parameterId: 'brightness' },
				curve: linearCurve(-1, 1),
			}] : [])],
		},
	};
}

function linearCurve(start, end) {
	return {
		anchors: [
			{ position: { num: 0, den: 1 }, value: start },
			{ position: { num: 10, den: 1 }, value: end },
		],
		segments: [{ kind: 'linear' }],
	};
}

function effectBypass() {
	return { effectsFor: (_clipId, effects) => effects };
}
