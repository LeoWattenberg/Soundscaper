/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	mapVideoSourceFrameToTimeline,
	mapVideoTimelineFrameToSource,
	resolveActiveVideoClip,
	resolveVideoTimelineSegments,
	selectVideoThumbnailTimestamps,
	videoClipPlaybackRate,
	videoThumbnailIntervalSeconds,
} from '../src/common/editor/video-timeline.js';
import { layeredProject, videoClip, videoSource } from './helpers/video-domain-fixture.js';

test('video time mapping treats source range as trim and duration as stretch', () => {
	const clip = videoClip({
		id: 'mapped',
		timelineStartFrame: 1_000,
		durationFrames: 8_000,
		sourceStartFrame: 2_000,
		sourceDurationFrames: 4_000,
		speedRatio: 0.5,
	});
	assert.equal(videoClipPlaybackRate(clip, 1_000, 1_000), 0.5);
	assert.deepEqual(mapVideoTimelineFrameToSource(clip, 5_000, {
		projectSampleRate: 1_000,
		sourceSampleRate: 1_000,
	}), {
		timelineFrame: 5_000,
		timelineTimeSeconds: 5,
		localTimelineFrame: 4_000,
		progress: 0.5,
		sourceFrame: 4_000,
		sourceTimeSeconds: 4,
	});
	assert.deepEqual(mapVideoSourceFrameToTimeline(clip, 5_000, {
		projectSampleRate: 1_000,
		sourceSampleRate: 1_000,
	}), {
		sourceFrame: 5_000,
		sourceTimeSeconds: 5,
		localSourceFrame: 3_000,
		progress: 0.75,
		timelineFrame: 7_000,
		timelineTimeSeconds: 7,
	});
	assert.throws(() => mapVideoTimelineFrameToSource(clip, 999), /active clip range/);
	assert.equal(mapVideoTimelineFrameToSource(clip, 999, { clamp: true }).sourceFrame, 2_000);
});

test('active video resolution uses first visible track and makes gaps black', () => {
	const project = layeredProject();
	let active = resolveActiveVideoClip(project, 2_000);
	assert.equal(active.kind, 'video');
	assert.equal(active.clipId, 'lower-clip');
	assert.equal(active.sourceFrame, 1_000);
	assert.equal(active.playbackRate, 0.5);

	active = resolveActiveVideoClip(project, 6_000);
	assert.equal(active.kind, 'video');
	assert.equal(active.clipId, 'top-clip');
	assert.equal(active.sourceFrame, 3_000);

	project.tracks[0].hidden = true;
	active = resolveActiveVideoClip(project, 6_000);
	assert.equal(active.clipId, 'lower-clip');
	project.tracks[0].hidden = false;

	active = resolveActiveVideoClip(project, 22_000);
	assert.deepEqual(active, {
		kind: 'black',
		color: '#000000',
		timelineFrame: 22_000,
		timelineTimeSeconds: 22,
	});
});

test('video resolution rejects ambiguous same-track overlaps', () => {
	const project = layeredProject();
	project.clips.push(videoClip({
		id: 'top-overlap',
		sourceId: 'top-source',
		timelineStartFrame: 7_000,
		durationFrames: 3_000,
		sourceStartFrame: 0,
		sourceDurationFrames: 3_000,
	}));
	project.tracks[0].clipIds.push('top-overlap');
	assert.throws(() => resolveActiveVideoClip(project, 8_000), /overlapping clips/);
});

test('timeline segments are non-overlapping, merge obscured boundaries, and cover black gaps', () => {
	const segments = resolveVideoTimelineSegments(layeredProject(), {
		startFrame: 0,
		endFrame: 25_000,
	});
	assert.deepEqual(segments.map((segment) => ({
		kind: segment.kind,
		clipId: segment.clipId,
		start: segment.timelineStartFrame,
		end: segment.timelineEndFrame,
		sourceStart: segment.sourceStartFrame,
		sourceEnd: segment.sourceEndFrame,
	})), [
		{ kind: 'video', clipId: 'lower-clip', start: 0, end: 5_000, sourceStart: 0, sourceEnd: 2_500 },
		{ kind: 'video', clipId: 'top-clip', start: 5_000, end: 15_000, sourceStart: 2_000, sourceEnd: 12_000 },
		{ kind: 'video', clipId: 'lower-clip', start: 15_000, end: 20_000, sourceStart: 7_500, sourceEnd: 10_000 },
		{ kind: 'black', clipId: undefined, start: 20_000, end: 25_000, sourceStart: undefined, sourceEnd: undefined },
	]);
	assert.equal(segments.reduce((duration, segment) => duration + segment.durationFrames, 0), 25_000);
	for (let index = 1; index < segments.length; index += 1) {
		assert.equal(segments[index - 1].timelineEndFrame, segments[index].timelineStartFrame);
	}
});

test('thumbnail timestamps stay on the reusable five-second source grid and thin at low zoom', () => {
	const source = videoSource({ id: 'thumb-source', frameCount: 30_000 });
	const clip = videoClip({
		id: 'thumb-clip',
		sourceId: source.id,
		durationFrames: 30_000,
		sourceDurationFrames: 30_000,
	});
	assert.equal(videoThumbnailIntervalSeconds({ pixelsPerSecond: 20, minimumSpacingPixels: 80 }), 5);
	assert.equal(videoThumbnailIntervalSeconds({ pixelsPerSecond: 20, minimumSpacingPixels: 101 }), 10);
	assert.deepEqual(selectVideoThumbnailTimestamps(clip, source, {
		projectSampleRate: 1_000,
		pixelsPerSecond: 20,
		minimumSpacingPixels: 101,
	}).map((thumbnail) => thumbnail.sourceTimeSeconds), [0, 10, 20]);

	const trimmed = {
		...clip,
		sourceStartFrame: 2_000,
		sourceDurationFrames: 10_000,
		durationFrames: 20_000,
	};
	const timestamps = selectVideoThumbnailTimestamps(trimmed, source, {
		projectSampleRate: 1_000,
		pixelsPerSecond: 10,
		minimumSpacingPixels: 101,
	});
	assert.deepEqual(timestamps.map((thumbnail) => thumbnail.sourceTimeSeconds), [2, 10]);
	assert.deepEqual(timestamps.map((thumbnail) => thumbnail.timelineTimeSeconds), [0, 16]);
});
