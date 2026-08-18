import test from 'node:test';
import assert from 'node:assert/strict';

import {
	VIDEO_EXPORT_FORMATS,
	createVideoExportPlan,
	getVideoExportFormat,
	resolveExactVideoExportCanvas,
	resolveVideoExportCanvas,
	resolveVideoExportRange,
} from '../src/common/editor/video-export.js';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';
import { layeredProject, videoClip } from './helpers/video-domain-fixture.js';

test('automatic video canvas preserves aspect ratio and caps dimensions and frame rate', () => {
	const project = layeredProject();
	const canvas = resolveVideoExportCanvas(project);
	assert.deepEqual(canvas, {
		width: 1_280,
		height: 720,
		frameRate: 30,
		fit: 'contain',
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

test('exact video canvas preserves canonical rational rates before applying the exact cap', () => {
	const project = layeredProject();
	const reference = project.sources.find((source) => source.id === 'lower-source');
	reference.frameRate = { num: 30_000, den: 1_001 };

	const ntsc = resolveExactVideoExportCanvas(project);
	assert.deepEqual(ntsc.frameRate, { num: 30_000, den: 1_001 });
	assert.deepEqual(ntsc.maximumFrameRate, { num: 30, den: 1 });
	assert.equal(resolveVideoExportCanvas(project).frameRate, 30_000 / 1_001);

	reference.frameRate = { num: 60_000, den: 1_001 };
	assert.deepEqual(resolveExactVideoExportCanvas(project).frameRate, { num: 30, den: 1 });
	assert.deepEqual(resolveExactVideoExportCanvas(project, {
		frameRate: { num: 24_000, den: 1_001 },
	}).frameRate, { num: 24_000, den: 1_001 });
	assert.deepEqual(resolveExactVideoExportCanvas(project, {
		frameRate: 24_000 / 1_001,
	}).frameRate, { num: 24_000, den: 1_001 });
});

test('exact video canvas selects its reference from the requested export range', () => {
	const project = layeredProject();
	const lower = project.clips.find((clip) => clip.id === 'lower-clip');
	lower.durationFrames = 5_000;
	const exact = resolveExactVideoExportCanvas(project, {
		range: { startFrame: 5_000, endFrame: 15_000 },
	});
	assert.equal(exact.referenceClipId, 'top-clip');
	assert.equal(exact.referenceSourceId, 'top-source');
	assert.deepEqual({ width: exact.width, height: exact.height }, { width: 1_280, height: 720 });
	assert.deepEqual(exact.frameRate, { num: 24, den: 1 });
});

test('video export range authority is shared without changing V6 plan range shape', () => {
	const project = layeredProject();
	project.selection = { startFrame: 123, endFrame: 456 };
	project.loop = { enabled: true, startFrame: 789, endFrame: 1_234 };

	assert.deepEqual(resolveVideoExportRange(project, 'selection'), {
		startFrame: 123, endFrame: 456, durationFrames: 333,
	});
	assert.deepEqual(resolveVideoExportRange(project, 'loop'), {
		startFrame: 789, endFrame: 1_234, durationFrames: 445,
	});
	assert.deepEqual(createVideoExportPlan(project, {
		includeAudio: false,
		range: { startFrame: 12_000, endFrame: 14_000 },
	}).range, resolveVideoExportRange(project, { startFrame: 12_000, endFrame: 14_000 }));
});

test('an anamorphic source sets the canvas and the graph from its display geometry', () => {
	const project = layeredProject();
	const reference = project.sources.find((source) => source.id === 'lower-source');
	reference.width = 720;
	reference.height = 576;
	reference.characteristics = {
		backend: 'ffmpeg',
		codedWidth: 720,
		codedHeight: 576,
		pixelAspectRatio: { num: 64, den: 45 },
	};
	const canvas = resolveVideoExportCanvas(project);
	assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 1_024, height: 576 });

	const plan = createVideoExportPlan(project, { range: { startFrame: 0, endFrame: 25_000 } });
	const presented = plan.inputs.find((input) => input.sourceId === 'lower-source');
	assert.deepEqual(presented.presentation, {
		autorotate: true,
		decodedWidth: 720,
		decodedHeight: 576,
		sampleAspect: { num: 64, den: 45 },
		scaledWidth: 1_024,
		scaledHeight: 576,
	});
	assert.equal(
		plan.inputs.find((input) => input.sourceId === 'top-source').presentation,
		null,
		'a source presented as it decodes states that it needs nothing',
	);
	const lower = plan.intervals[0].layers[0].clips[0].renderDescription;
	assert.deepEqual(lower.crop.sourcePixels, { x: 0, y: 0, width: 1_024, height: 576 });
	assert.deepEqual(lower.sourceDisplayToCanvas, [1, 0, 0, 1, 0, 0]);
});

test('video export plan describes layered composition, codecs, transparent fitting, and staged audio', () => {
	const project = layeredProject();
	const plan = createVideoExportPlan(project, {
		format: 'webm',
		range: { startFrame: 0, endFrame: 25_000 },
	});
	assert.equal(plan.version, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
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
	assert.equal(plan.version, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
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
