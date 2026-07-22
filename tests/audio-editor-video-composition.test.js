import test from 'node:test';
import assert from 'node:assert/strict';

import {
	resolveActiveVideoLayers,
	resolveVideoCompositionIntervals,
	validateVideoTrackComposition,
} from '../src/common/editor/video-timeline.js';

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
