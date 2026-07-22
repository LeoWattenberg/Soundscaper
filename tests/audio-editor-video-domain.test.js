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
} from '../src/lib/tools/audio-editor/video-timeline.js';
import {
	VIDEO_EXPORT_FORMATS,
	createVideoExportPlan,
	getVideoExportFormat,
	resolveVideoExportCanvas,
} from '../src/lib/tools/audio-editor/video-export.js';

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

test('automatic video canvas preserves aspect ratio and caps dimensions and frame rate', () => {
	const project = layeredProject();
	const canvas = resolveVideoExportCanvas(project);
	assert.deepEqual(canvas, {
		width: 1_280,
		height: 720,
		frameRate: 30,
		pixelFormat: 'yuv420p',
		backgroundColor: '#000000',
		maximumWidth: 1_280,
		maximumHeight: 720,
		maximumFrameRate: 30,
		referenceClipId: 'lower-clip',
		referenceSourceId: 'lower-source',
	});

	project.sources.find((source) => source.id === 'lower-source').width = 1_080;
	project.sources.find((source) => source.id === 'lower-source').height = 1_920;
	const portrait = resolveVideoExportCanvas(project);
	assert.deepEqual({ width: portrait.width, height: portrait.height }, { width: 404, height: 720 });
	assert.equal(portrait.width % 2, 0);
	assert.equal(portrait.height % 2, 0);
});

test('video export plan describes layered composition, codecs, transparent fitting, and staged audio', () => {
	const project = layeredProject();
	const plan = createVideoExportPlan(project, {
		format: 'webm',
		range: { startFrame: 0, endFrame: 25_000 },
	});
	assert.equal(plan.version, 3);
	assert.equal(plan.format, 'webm');
	assert.equal(plan.mimeType, 'video/webm');
	assert.deepEqual(plan.codecs, {
		video: 'vp9',
		videoEncoder: 'libvpx-vp9',
		audio: 'opus',
		audioEncoder: 'libopus',
		pixelFormat: 'yuv420p',
	});
	assert.equal(plan.durationSeconds, 25);
	assert.equal(plan.outputFrameCount, 750);
	assert.deepEqual(plan.inputs.map((input) => [input.kind, input.sourceId, input.inputIndex]), [
		['video-source', 'lower-source', 0],
		['video-source', 'top-source', 1],
		['staged-audio-mix', undefined, 2],
	]);
	assert.deepEqual(plan.intervals.map((interval) => [
		interval.kind,
		interval.timelineStartFrame,
		interval.timelineEndFrame,
		interval.layers.map((layer) => [
			layer.trackId,
			layer.clips.map((clip) => [clip.clipId, clip.inputIndex]),
		]),
	]), [
		['composition', 0, 5_000, [['lower-track', [['lower-clip', 0]]]]],
		['composition', 5_000, 15_000, [
			['lower-track', [['lower-clip', 0]]],
			['top-track', [['top-clip', 1]]],
		]],
		['composition', 15_000, 20_000, [['lower-track', [['lower-clip', 0]]]]],
		['black', 20_000, 25_000, []],
	]);
	assert.equal(plan.filterPlan.strategy, 'layered-composition');
	assert.deepEqual(
		plan.filterPlan.intervals[0].layers[0].clips[0].operations.map((operation) => operation.name),
		['trim', 'setpts', 'scale', 'format', 'fps', 'pad', 'premultiply', 'setsar'],
	);
	assert.equal(
		plan.filterPlan.intervals[0].layers[0].clips[0].operations[1].playbackRate,
		0.5,
	);
	assert.deepEqual(plan.filterPlan.intervals[0].layers[0].clips[0].operations[5], {
		name: 'pad',
		width: 1_280,
		height: 720,
		x: '(ow-iw)/2',
		y: '(oh-ih)/2',
		color: 'black@0',
	});
	assert.equal(plan.filterPlan.intervals[3].kind, 'black');
	assert.equal(plan.filterPlan.intervals[3].base.name, 'color');
	assert.deepEqual(plan.filterPlan.concat.inputLabels, [
		'video_interval_0',
		'video_interval_1',
		'video_interval_2',
		'video_interval_3',
	]);
	assert.deepEqual(plan.filterPlan.audio, {
		strategy: 'staged-mix',
		inputIndex: 2,
		startFrame: 0,
		durationFrames: 25_000,
		sampleRate: 1_000,
		codec: 'opus',
	});
	assert.ok(Object.isFrozen(plan));
	assert.ok(Object.isFrozen(plan.intervals[1].layers[0].clips[0]));
	assert.ok(Object.isFrozen(plan.filterPlan.intervals[0].layers[0].clips[0].operations));

	const silentMp4 = createVideoExportPlan(project, {
		format: 'h264',
		includeAudio: false,
		range: { startFrame: 0, endFrame: 1_000 },
	});
	assert.equal(silentMp4.format, 'mp4');
	assert.equal(silentMp4.codecs.videoEncoder, 'libx264');
	assert.equal(silentMp4.codecs.audio, null);
	assert.deepEqual(silentMp4.filterPlan.audio, { strategy: 'none' });
});

test('video export plan carries ordered normalized effects and omits bypassed operations', () => {
	const project = layeredProject();
	project.clips.find((clip) => clip.id === 'lower-clip').videoEffects = [
		{
			id: 'pixelate-enabled',
			type: 'pixelate',
			enabled: true,
			params: { blockSize: 24 },
		},
		{
			id: 'blur-bypassed',
			type: 'gaussian-blur',
			enabled: false,
			params: { sigma: 8 },
		},
	];

	const plan = createVideoExportPlan(project, {
		includeAudio: false,
		range: { startFrame: 0, endFrame: 1_000 },
	});
	const clip = plan.intervals[0].layers[0].clips[0];
	assert.equal(plan.version, 3);
	assert.deepEqual(clip.videoEffects, [
		{
			id: 'pixelate-enabled',
			type: 'pixelate',
			enabled: true,
			params: { blockSize: 24 },
		},
		{
			id: 'blur-bypassed',
			type: 'gaussian-blur',
			enabled: false,
			params: { sigma: 8 },
		},
	]);
	assert.deepEqual(
		plan.filterPlan.intervals[0].layers[0].clips[0].operations.map((operation) => (
			operation.name === 'video-effect' ? operation.effect.id : operation.name
		)),
		['trim', 'setpts', 'scale', 'format', 'fps', 'pixelate-enabled', 'pad', 'premultiply', 'setsar'],
	);
	assert.ok(Object.isFrozen(clip.videoEffects));
	assert.ok(clip.videoEffects.every(Object.isFrozen));
});

test('video export ranges retain absolute crossfade progress and deduplicate source inputs', () => {
	const project = layeredProject();
	project.clips.push(videoClip({
		id: 'top-incoming',
		sourceId: 'top-source',
		timelineStartFrame: 10_000,
		durationFrames: 10_000,
		sourceStartFrame: 0,
		sourceDurationFrames: 10_000,
	}));
	project.tracks[0].clipIds.push('top-incoming');

	const plan = createVideoExportPlan(project, {
		includeAudio: false,
		range: { startFrame: 12_000, endFrame: 14_000 },
	});
	assert.deepEqual(plan.inputs.map((input) => [input.sourceId, input.inputIndex]), [
		['lower-source', 0],
		['top-source', 1],
	]);
	assert.equal(plan.intervals.length, 1);
	assert.deepEqual(
		plan.intervals[0].layers.map((layer) => [
			layer.trackId,
			layer.clips.map((clip) => ({
				role: clip.role,
				clipId: clip.clipId,
				sourceStartFrame: clip.sourceStartFrame,
				sourceEndFrame: clip.sourceEndFrame,
				opacityStart: Number(clip.opacityStart.toFixed(6)),
				opacityEnd: Number(clip.opacityEnd.toFixed(6)),
			})),
		]),
		[
			['lower-track', [{
				role: 'single',
				clipId: 'lower-clip',
				sourceStartFrame: 6_000,
				sourceEndFrame: 7_000,
				opacityStart: 1,
				opacityEnd: 1,
			}]],
			['top-track', [
				{
					role: 'outgoing',
					clipId: 'top-clip',
					sourceStartFrame: 9_000,
					sourceEndFrame: 11_000,
					opacityStart: 0.6,
					opacityEnd: 0.2,
				},
				{
					role: 'incoming',
					clipId: 'top-incoming',
					sourceStartFrame: 2_000,
					sourceEndFrame: 4_000,
					opacityStart: 0.4,
					opacityEnd: 0.8,
				},
			]],
		],
	);
	assert.deepEqual({
		...plan.filterPlan.intervals[0].layers[1].blend,
		opacityStart: plan.filterPlan.intervals[0].layers[1].blend.opacityStart
			.map((opacity) => Number(opacity.toFixed(6))),
		opacityEnd: plan.filterPlan.intervals[0].layers[1].blend.opacityEnd
			.map((opacity) => Number(opacity.toFixed(6))),
	}, {
		name: 'blend',
		opacityStart: [0.6, 0.4],
		opacityEnd: [0.2, 0.8],
	});
});

test('video export format inventory is frozen and rejects unknown containers', () => {
	assert.equal(getVideoExportFormat('vp9'), VIDEO_EXPORT_FORMATS.webm);
	assert.equal(getVideoExportFormat('h264'), VIDEO_EXPORT_FORMATS.mp4);
	assert.ok(Object.values(VIDEO_EXPORT_FORMATS).every(Object.isFrozen));
	assert.throws(() => getVideoExportFormat('mov'), /Unsupported video export format/);
});

function layeredProject() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [
			videoSource({
				id: 'top-source',
				name: 'Top',
				storageKey: 'media/top',
				frameCount: 20_000,
				width: 1_920,
				height: 1_080,
				frameRate: 24,
			}),
			videoSource({
				id: 'lower-source',
				name: 'Lower',
				storageKey: 'media/lower',
				frameCount: 10_000,
				width: 3_840,
				height: 2_160,
				frameRate: 60,
			}),
			videoSource({
				id: 'hidden-source',
				name: 'Hidden',
				storageKey: 'media/hidden',
				frameCount: 20_000,
				width: 640,
				height: 480,
				frameRate: 25,
			}),
		],
		clips: [
			videoClip({
				id: 'top-clip',
				sourceId: 'top-source',
				timelineStartFrame: 5_000,
				durationFrames: 10_000,
				sourceStartFrame: 2_000,
				sourceDurationFrames: 10_000,
			}),
			videoClip({
				id: 'lower-clip',
				sourceId: 'lower-source',
				timelineStartFrame: 0,
				durationFrames: 20_000,
				sourceStartFrame: 0,
				sourceDurationFrames: 10_000,
				speedRatio: 0.5,
			}),
			videoClip({
				id: 'hidden-clip',
				sourceId: 'hidden-source',
				timelineStartFrame: 0,
				durationFrames: 20_000,
				sourceStartFrame: 0,
				sourceDurationFrames: 20_000,
			}),
		],
		tracks: [
			videoTrack({ id: 'top-track', clipIds: ['top-clip'] }),
			videoTrack({ id: 'lower-track', clipIds: ['lower-clip'] }),
			videoTrack({ id: 'hidden-track', clipIds: ['hidden-clip'], hidden: true }),
		],
	};
}

function videoSource(options = {}) {
	return {
		kind: 'video',
		id: options.id || 'video-source',
		name: options.name || 'Video',
		mimeType: options.mimeType || 'video/mp4',
		storageKey: options.storageKey || `media/${options.id || 'video-source'}`,
		frameCount: options.frameCount ?? 30_000,
		sampleRate: options.sampleRate ?? 1_000,
		width: options.width ?? 1_280,
		height: options.height ?? 720,
		frameRate: options.frameRate ?? 30,
		videoCodec: options.videoCodec || 'h264',
		audioCodec: options.audioCodec || 'aac',
		hasAudio: options.hasAudio !== false,
		posterStorageKey: null,
		thumbnailStorageKey: null,
	};
}

function videoClip(options = {}) {
	return {
		kind: 'video',
		id: options.id || 'video-clip',
		sourceId: options.sourceId || 'video-source',
		title: options.title || 'Video',
		timelineStartFrame: options.timelineStartFrame ?? 0,
		sourceStartFrame: options.sourceStartFrame ?? 0,
		sourceDurationFrames: options.sourceDurationFrames ?? options.durationFrames ?? 1_000,
		durationFrames: options.durationFrames ?? 1_000,
		trimStartFrames: options.trimStartFrames ?? 0,
		trimEndFrames: options.trimEndFrames ?? 0,
		speedRatio: options.speedRatio ?? 1,
		groupId: null,
		avLinkId: null,
		binItemId: null,
		color: 'blue',
	};
}

function videoTrack(options = {}) {
	return {
		type: 'video',
		id: options.id || 'video-track',
		name: options.name || 'Video',
		clipIds: options.clipIds || [],
		mute: Boolean(options.mute),
		hidden: Boolean(options.hidden),
		collapsed: false,
		height: 120,
		laneGroupId: null,
	};
}
