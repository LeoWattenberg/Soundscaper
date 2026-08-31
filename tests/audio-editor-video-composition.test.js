import test from 'node:test';
import assert from 'node:assert/strict';

import {
	resolveActiveVideoLayers,
	resolveVideoCompositionIntervals,
	validateVideoTrackComposition,
} from '../src/common/editor/video-timeline.js';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { compileInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { createVideoKeyframeRenderStateProvider } from '../src/common/editor/video-keyframe-render-state-provider.ts';
import {
	isVideoKeyframePreviewStateError,
	resolveVideoKeyframePreviewState,
} from '../src/common/editor/video-keyframe-preview-state.ts';

const RENDER_CANVAS = Object.freeze({ width: 640, height: 360 });

test('video composition validation permits only proper two-clip edge overlaps', () => {
	const clips = [
		videoClip({ id: 'first', timelineStartFrame: 0, durationFrames: 100 }),
		videoClip({ id: 'second', timelineStartFrame: 60, durationFrames: 100 }),
		videoClip({ id: 'touching', timelineStartFrame: 160, durationFrames: 40 }),
	];
	const clipById = new Map(clips.map((clip) => [clip.id, clip]));
	assert.equal(validateVideoTrackComposition(
		videoTrack({ clipIds: clips.map((clip) => clip.id) }),
		clipById,
	), true);

	const nested = videoClip({ id: 'nested', timelineStartFrame: 20, durationFrames: 20 });
	assert.throws(() => validateVideoTrackComposition(
		videoTrack({ clipIds: ['first', nested.id] }),
		new Map([...clipById, [nested.id, nested]]),
	), /proper edge transition/);

	const equalEnd = videoClip({ id: 'equal-end', timelineStartFrame: 20, durationFrames: 80 });
	assert.throws(() => validateVideoTrackComposition(
		videoTrack({ clipIds: ['first', equalEnd.id] }),
		new Map([...clipById, [equalEnd.id, equalEnd]]),
	), /proper edge transition/);

	const equalStart = videoClip({ id: 'equal-start', timelineStartFrame: 0, durationFrames: 120 });
	assert.throws(() => validateVideoTrackComposition(
		videoTrack({ clipIds: ['first', equalStart.id] }),
		new Map([...clipById, [equalStart.id, equalStart]]),
	), /proper edge transition/);

	const third = videoClip({ id: 'third', timelineStartFrame: 80, durationFrames: 100 });
	assert.throws(() => validateVideoTrackComposition(
		videoTrack({ clipIds: ['first', 'second', third.id] }),
		new Map([...clipById, [third.id, third]]),
	), /three-way transition/);
});

test('active video layers are frozen, bottom-to-top, and expose complementary crossfade weights', () => {
	const layers = resolveActiveVideoLayers(layeredProject(), 80);
	assert.deepEqual(layers.map((layer) => layer.trackId), ['lower-track', 'top-track']);
	assert.deepEqual(layers[0].clips.map((clip) => ({
		clipId: clip.clipId,
		role: clip.role,
		sourceFrame: clip.sourceFrame,
		opacity: clip.opacity,
	})), [{
		clipId: 'lower',
		role: 'single',
		sourceFrame: 80,
		opacity: 1,
	}]);
	assert.deepEqual(layers[1].clips.map((clip) => ({
		clipId: clip.clipId,
		role: clip.role,
		sourceFrame: clip.sourceFrame,
		playbackRate: clip.playbackRate,
		opacity: clip.opacity,
	})), [
		{
			clipId: 'outgoing',
			role: 'outgoing',
			sourceFrame: 260,
			playbackRate: 2,
			opacity: 0.5,
		},
		{
			clipId: 'incoming',
			role: 'incoming',
			sourceFrame: 20,
			playbackRate: 1,
			opacity: 0.5,
		},
	]);
	assert.ok(Object.isFrozen(layers));
	assert.ok(layers.every(Object.isFrozen));
	assert.ok(layers.every((layer) => Object.isFrozen(layer.clips)));
	assert.ok(layers.flatMap((layer) => layer.clips).every(Object.isFrozen));
	assert.equal(layers.some((layer) => layer.trackId === 'hidden-track'), false);
	assert.equal('renderDescription' in layers[0].clips[0], false, 'the canvas opt-in preserves legacy shape');
});

test('media composition delegates dissolve weights to the exact shared resolver and ignores visual clips', () => {
	const project = layeredProject();
	project.sources.push({ kind: 'generator', id: 'title-source' });
	project.sources.push({ kind: 'image', id: 'image-source' });
	project.clips.push({
		kind: 'generator', id: 'title-clip', sourceId: 'title-source',
		timelineStartFrame: 0, durationFrames: 100,
		sourceStartFrame: 0, sourceDurationFrames: 100,
	});
	project.clips.push({
		kind: 'image', id: 'image-clip', sourceId: 'image-source',
		timelineStartFrame: 0, durationFrames: 100,
		sourceStartFrame: 0, sourceDurationFrames: 100, sourceStartTicks: '0',
	});
	project.tracks.find(({ id }) => id === 'top-track').clipIds.push('title-clip', 'image-clip');
	const exact = (clipId) => clipId === 'outgoing' ? 0.8 : clipId === 'incoming' ? 0.2 : null;
	const layers = resolveActiveVideoLayers(project, 80, { resolveTransitionWeight: exact });
	assert.deepEqual(layers.at(-1).clips.map(({ clipId, opacity }) => ({ clipId, opacity })), [
		{ clipId: 'outgoing', opacity: 0.8 },
		{ clipId: 'incoming', opacity: 0.2 },
	]);
	const intervals = resolveVideoCompositionIntervals(project, {
		startFrame: 70, endFrame: 90, resolveTransitionWeight: exact,
	});
	assert.deepEqual(intervals[0].layers.at(-1).clips.map(({ opacityStart, opacityEnd }) => ({
		opacityStart, opacityEnd,
	})), [
		{ opacityStart: 0.8, opacityEnd: 0.8 },
		{ opacityStart: 0.2, opacityEnd: 0.2 },
	]);
});

test('composition interval fallback evaluates an authored transition curve after snapshot cloning', () => {
	let project = layeredProject();
	project.tracks.find(({ id }) => id === 'top-track').videoTransitions = [{
		id: 'held-dissolve',
		type: 'dissolve',
		outgoingClipId: 'outgoing',
		incomingClipId: 'incoming',
		alignment: 'center-at-cut',
		durationFrames: 40,
		curve: compileInterpolationCurve({
			anchors: [
				{ position: { num: 0, den: 1 }, value: 0 },
				{ position: { num: 40, den: 1 }, value: 1 },
			],
			segments: [{ kind: 'hold' }],
		}),
	}];
	project = structuredClone(project);
	const [interval] = resolveVideoCompositionIntervals(project, { startFrame: 70, endFrame: 90 });
	assert.deepEqual(interval.layers.at(-1).clips.map(({ clipId, opacityStart, opacityEnd }) => ({
		clipId, opacityStart, opacityEnd,
	})), [
		{ clipId: 'outgoing', opacityStart: 1, opacityEnd: 1 },
		{ clipId: 'incoming', opacityStart: 0, opacityEnd: 0 },
	]);
});

test('a render canvas resolves frozen identity descriptions without changing legacy painter order', () => {
	const layers = resolveActiveVideoLayers(layeredProject(), 80, { renderCanvas: RENDER_CANVAS });
	assert.deepEqual(layers.map((layer) => layer.trackId), ['lower-track', 'top-track']);
	assert.deepEqual(layers[0].clips[0].renderDescription, {
		crop: {
			normalized: { left: 0, top: 0, right: 0, bottom: 0 },
			sourcePixels: { x: 0, y: 0, width: 1_280, height: 720 },
		},
		sourceDisplayToCanvas: [0.5, 0, 0, 0.5, 0, 0],
		opacityStart: 1,
		opacityEnd: 1,
		blendMode: 'normal',
		compositingOrder: 0,
	});
	assert.equal(Object.isFrozen(layers[0].clips[0].renderDescription), true);
	assert.equal(Object.isFrozen(layers[0].clips[0].renderDescription.crop), true);
});

test('authored composition controls effective opacity and stable painter ordering', () => {
	const project = layeredProject();
	project.clips.find((clip) => clip.id === 'lower').videoComposition = composition({
		opacity: 0.25,
		blendMode: 'multiply',
		compositingOrder: 5,
	});
	for (const id of ['outgoing', 'incoming']) {
		project.clips.find((clip) => clip.id === id).videoComposition = composition({
			opacity: 0.4,
			blendMode: 'screen',
			compositingOrder: -2,
		});
	}

	const layers = resolveActiveVideoLayers(project, 80, { renderCanvas: RENDER_CANVAS });
	assert.deepEqual(layers.map((layer) => layer.trackId), ['top-track', 'lower-track']);
	assert.deepEqual(layers[0].clips.map((clip) => ({
		clipId: clip.clipId,
		opacity: clip.opacity,
		descriptorOpacity: clip.renderDescription.opacityStart,
		blendMode: clip.renderDescription.blendMode,
		order: clip.renderDescription.compositingOrder,
	})), [
		{ clipId: 'outgoing', opacity: 0.2, descriptorOpacity: 0.2, blendMode: 'screen', order: -2 },
		{ clipId: 'incoming', opacity: 0.2, descriptorOpacity: 0.2, blendMode: 'screen', order: -2 },
	]);
	assert.equal(layers[1].clips[0].opacity, 0.25);
	assert.equal(layers[1].clips[0].renderDescription.opacityStart, 0.25);
});

test('active preview layers opt keyed clips into exact playhead state while legacy shapes stay unchanged', () => {
	const project = layeredProject();
	const legacy = resolveActiveVideoLayers(project, 50, { renderCanvas: RENDER_CANVAS });
	const provider = createVideoKeyframeRenderStateProvider();
	const resolveClipRenderState = (request) => resolveVideoKeyframePreviewState(provider, request);
	assert.deepEqual(resolveActiveVideoLayers(project, 50, {
		renderCanvas: RENDER_CANVAS,
		resolveClipRenderState,
	}), legacy);
	assert.ok(legacy.flatMap((layer) => layer.clips).every((entry) => (
		Object.hasOwn(entry, 'videoEffects') === false
	)));
	const lower = project.clips.find((clip) => clip.id === 'lower');
	lower.sequenceFrameCount = 20;
	lower.videoComposition = DEFAULT_VIDEO_CLIP_COMPOSITION;
	lower.videoEffects = [];
	lower.videoKeyframes = opacityKeyframes(20);
	const layers = resolveActiveVideoLayers(project, 50, {
		renderCanvas: RENDER_CANVAS,
		resolveClipRenderState,
	});
	const keyed = layers.find((layer) => layer.trackId === 'lower-track').clips[0];
	const legacyEntry = layers.find((layer) => layer.trackId === 'top-track').clips[0];
	assert.equal(keyed.renderDescription.opacityStart, 0.25);
	assert.deepEqual(keyed.videoEffects, []);
	assert.equal(Object.hasOwn(legacyEntry, 'videoEffects'), false);

	lower.videoKeyframes = null;
	assert.throws(() => resolveActiveVideoLayers(project, 50, {
		renderCanvas: RENDER_CANVAS,
		resolveClipRenderState,
	}), (error) => isVideoKeyframePreviewStateError(error));
	lower.videoKeyframes = opacityKeyframes(20);
	delete project.sources.find((source) => source.id === 'lower-source').width;
	delete project.sources.find((source) => source.id === 'lower-source').height;
	assert.throws(() => resolveActiveVideoLayers(project, 50, {
		renderCanvas: RENDER_CANVAS,
		resolveClipRenderState,
	}), (error) => isVideoKeyframePreviewStateError(error));
});

test('authored same-track transitions require one blend mode and compositing order', () => {
	const project = layeredProject();
	project.clips.find((clip) => clip.id === 'outgoing').videoComposition = composition({ blendMode: 'screen' });
	assert.throws(
		() => resolveActiveVideoLayers(project, 80, { renderCanvas: RENDER_CANVAS }),
		/same-track transition.*blend mode/iu,
	);
	project.clips.find((clip) => clip.id === 'incoming').videoComposition = composition({ blendMode: 'screen' });
	project.clips.find((clip) => clip.id === 'outgoing').videoComposition = composition({
		blendMode: 'screen',
		compositingOrder: 2,
	});
	assert.throws(
		() => resolveVideoCompositionIntervals(project, {
			startFrame: 70,
			endFrame: 90,
			renderCanvas: RENDER_CANVAS,
		}),
		/same-track transition.*compositing order/iu,
	);
});

test('composition intervals preserve absolute opacity and source ranges when starting mid-fade', () => {
	const intervals = resolveVideoCompositionIntervals(layeredProject(), {
		startFrame: 70,
		endFrame: 220,
	});
	assert.deepEqual(intervals.map((interval) => ({
		kind: interval.kind,
		start: interval.timelineStartFrame,
		end: interval.timelineEndFrame,
		tracks: interval.layers.map((layer) => layer.trackId),
	})), [
		{ kind: 'composition', start: 70, end: 100, tracks: ['lower-track', 'top-track'] },
		{ kind: 'composition', start: 100, end: 160, tracks: ['lower-track', 'top-track'] },
		{ kind: 'composition', start: 160, end: 200, tracks: ['lower-track'] },
		{ kind: 'black', start: 200, end: 220, tracks: [] },
	]);

	const transition = intervals[0].layers.at(-1).clips;
	assert.deepEqual(transition.map((clip) => ({
		clipId: clip.clipId,
		role: clip.role,
		sourceStartFrame: clip.sourceStartFrame,
		sourceEndFrame: clip.sourceEndFrame,
		sourceStartTimeSeconds: clip.sourceStartTimeSeconds,
		sourceEndTimeSeconds: clip.sourceEndTimeSeconds,
		opacityStart: clip.opacityStart,
		opacityEnd: clip.opacityEnd,
	})), [
		{
			clipId: 'outgoing',
			role: 'outgoing',
			sourceStartFrame: 240,
			sourceEndFrame: 300,
			sourceStartTimeSeconds: 2.4,
			sourceEndTimeSeconds: 3,
			opacityStart: 0.75,
			opacityEnd: 0,
		},
		{
			clipId: 'incoming',
			role: 'incoming',
			sourceStartFrame: 10,
			sourceEndFrame: 40,
			sourceStartTimeSeconds: 0.1,
			sourceEndTimeSeconds: 0.4,
			opacityStart: 0.25,
			opacityEnd: 1,
		},
	]);
	assert.equal(intervals[1].layers.at(-1).clips[0].role, 'single');
	assert.equal(intervals[1].layers.at(-1).clips[0].opacityStart, 1);
	assert.equal(intervals[1].layers.at(-1).clips[0].opacityEnd, 1);
	assert.equal(intervals.at(-1).color, '#000000');
	assert.ok(Object.isFrozen(intervals));
	assert.ok(intervals.every(Object.isFrozen));
	assert.ok(intervals.every((interval) => Object.isFrozen(interval.layers)));
});

test('composition interval descriptions multiply authored opacity by absolute transition endpoints', () => {
	const project = layeredProject();
	for (const id of ['outgoing', 'incoming']) {
		project.clips.find((clip) => clip.id === id).videoComposition = composition({ opacity: 0.4 });
	}
	const intervals = resolveVideoCompositionIntervals(project, {
		startFrame: 70,
		endFrame: 100,
		renderCanvas: RENDER_CANVAS,
	});
	const transition = intervals[0].layers.at(-1).clips;
	assert.deepEqual(transition.map((clip) => ({
		clipId: clip.clipId,
		opacityStart: clip.opacityStart,
		opacityEnd: clip.opacityEnd,
		descriptorStart: clip.renderDescription.opacityStart,
		descriptorEnd: clip.renderDescription.opacityEnd,
	})), [
		{
			clipId: 'outgoing',
			opacityStart: 0.30000000000000004,
			opacityEnd: 0,
			descriptorStart: 0.30000000000000004,
			descriptorEnd: 0,
		},
		{
			clipId: 'incoming',
			opacityStart: 0.1,
			opacityEnd: 0.4,
			descriptorStart: 0.1,
			descriptorEnd: 0.4,
		},
	]);
	assert.equal(Object.isFrozen(transition[0].renderDescription), true);
});

function layeredProject() {
	return {
		sampleRate: 100,
		sources: [
			videoSource({ id: 'outgoing-source' }),
			videoSource({ id: 'incoming-source' }),
			videoSource({ id: 'lower-source' }),
			videoSource({ id: 'hidden-source' }),
		],
		clips: [
			videoClip({
				id: 'outgoing',
				sourceId: 'outgoing-source',
				timelineStartFrame: 0,
				durationFrames: 100,
				sourceStartFrame: 100,
				sourceDurationFrames: 200,
			}),
			videoClip({
				id: 'incoming',
				sourceId: 'incoming-source',
				timelineStartFrame: 60,
				durationFrames: 100,
				sourceDurationFrames: 100,
			}),
			videoClip({
				id: 'lower',
				sourceId: 'lower-source',
				timelineStartFrame: 0,
				durationFrames: 200,
				sourceDurationFrames: 200,
			}),
			videoClip({
				id: 'hidden',
				sourceId: 'hidden-source',
				timelineStartFrame: 0,
				durationFrames: 220,
				sourceDurationFrames: 220,
			}),
		],
		tracks: [
			videoTrack({ id: 'top-track', clipIds: ['outgoing', 'incoming'] }),
			videoTrack({ id: 'lower-track', clipIds: ['lower'] }),
			videoTrack({ id: 'hidden-track', clipIds: ['hidden'], hidden: true }),
		],
	};
}

function videoSource(options = {}) {
	return {
		kind: 'video',
		id: options.id,
		sampleRate: 100,
		width: options.width ?? 1_280,
		height: options.height ?? 720,
	};
}

function videoClip(options = {}) {
	return {
		kind: 'video',
		id: options.id,
		sourceId: options.sourceId || `${options.id}-source`,
		timelineStartFrame: options.timelineStartFrame,
		durationFrames: options.durationFrames,
		sourceStartFrame: options.sourceStartFrame ?? 0,
		sourceDurationFrames: options.sourceDurationFrames ?? options.durationFrames,
	};
}

function videoTrack(options = {}) {
	return {
		type: 'video',
		id: options.id || 'video-track',
		clipIds: options.clipIds || [],
		hidden: Boolean(options.hidden),
	};
}

function composition(changes = {}) {
	return {
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		...changes,
		crop: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION.crop,
			...(changes.crop || {}),
		},
		transform: {
			...DEFAULT_VIDEO_CLIP_COMPOSITION.transform,
			...(changes.transform || {}),
		},
	};
}

function opacityKeyframes(duration) {
	return {
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: { num: duration, den: 1 },
			viewStart: { num: 0, den: 1 },
			viewDuration: { num: duration, den: 1 },
		},
		curves: [{
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: {
				anchors: [
					{ position: { num: 0, den: 1 }, value: 0 },
					{ position: { num: duration, den: 1 }, value: 1 },
				],
				segments: [{ kind: 'linear' }],
			},
		}],
	};
}
