/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	prepareLinkedSplitCommand,
	prepareOverwriteClipCommand,
	prepareRangeDeleteCommand,
	prepareTransformClipsCommand,
} from '../src/common/editor/commands.js';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NOW = '2026-08-09T12:00:00.000Z';
const RATE = { num: 24, den: 1 };

test('mixed ripple conforms one range for unlinked audio and video lanes', () => {
	const project = mixedProject();
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const command = prepareRangeDeleteCommand(runtime, {
		startFrame: 0,
		endFrame: 800,
		trackIds: ['video-track', 'audio-track'],
		rippleMode: 'track',
	});
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);

	assert.deepEqual(
		resolved.clips.map((clip) => [clip.id, clip.timelineStartFrame]),
		[['video', 3_675], ['audio', 3_675]],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('sub-frame mixed ripple is one no-op even when the range intersects clips', () => {
	const project = mixedProject({ sequenceStartFrame: 0, audioStartFrame: 0, frameCount: 1 });
	const before = structuredClone(project);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const command = prepareRangeDeleteCommand(runtime, {
		startFrame: 0,
		endFrame: 800,
		trackIds: ['video-track', 'audio-track'],
		rippleMode: 'track',
	});
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });

	assert.deepEqual(edited.clips, before.clips);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('grouped video move reuses one frame delta instead of rounding each absolute start', () => {
	const source = videoSource();
	const clips = [0, 3].map((sequenceStartFrame, index) => createVideoClip({
		id: `video-${String(index + 1)}`, sourceId: source.id, sequenceId: 'main',
		sequenceStartFrame, sequenceFrameCount: 1,
		sourceInFrame: index, sourceFrameCount: 1,
		groupId: 'group',
	}, { projectSampleRate: 44_100, sequence: { id: 'main', rate: RATE }, source }));
	const project = createCurrentAudioEditorProject({
		id: 'grouped-move', now: NOW, sampleRate: 44_100,
		sequences: [{ id: 'main', rate: RATE }], primarySequenceId: 'main',
		sources: [source], clips,
		tracks: [createVideoTrack({ id: 'video-track', clipIds: ['video-1', 'video-2'] })],
	});
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const runtimeClips = runtime.clips as Array<Record<string, number | string>>;
	const command = prepareTransformClipsCommand(runtime, runtimeClips.map((clip) => ({
		clipId: String(clip.id),
		trackId: 'video-track',
		changes: { timelineStartFrame: Number(clip.timelineStartFrame) + 2_756 },
	})));
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });

	assert.deepEqual(
		edited.clips.map((clip) => [clip.id, clip.sequenceStartFrame]),
		[['video-1', 1], ['video-2', 4]],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('mixed grouped move gives unlinked audio the video operation delta', () => {
	const video = videoSource();
	const audio = createAudioSource({ id: 'audio-source', frameCount: 44_100, channelCount: 1, sampleRate: 44_100 });
	const project = createCurrentAudioEditorProject({
		id: 'mixed-grouped-move', now: NOW, sampleRate: 44_100,
		sequences: [{ id: 'main', rate: RATE }], primarySequenceId: 'main',
		sources: [video, audio],
		clips: [
			createVideoClip({
				id: 'video', sourceId: video.id, sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 1,
				sourceInFrame: 0, sourceFrameCount: 1, groupId: 'group',
			}, { projectSampleRate: 44_100, sequence: { id: 'main', rate: RATE }, source: video }),
			createAudioClip({
				id: 'audio', sourceId: audio.id, timelineStartFrame: 0,
				durationFrames: 1_838, sourceDurationFrames: 1_838, groupId: 'group',
			}),
		],
		tracks: [
			createVideoTrack({ id: 'video-track', clipIds: ['video'] }),
			createAudioTrack({ id: 'audio-track', clipIds: ['audio'] }, 44_100),
		],
	});
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const command = prepareTransformClipsCommand(runtime, [
		{ clipId: 'video', trackId: 'video-track', changes: { timelineStartFrame: 2_756 } },
		{ clipId: 'audio', trackId: 'audio-track', changes: { timelineStartFrame: 2_756 } },
	]);
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);

	assert.deepEqual(
		resolved.clips.map((clip) => [clip.id, clip.timelineStartFrame]),
		[['video', 1_838], ['audio', 1_838]],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('separate batched moves do not couple unrelated equal numeric deltas', () => {
	const video = videoSource();
	const audio = createAudioSource({ id: 'audio-source', frameCount: 44_100, channelCount: 1, sampleRate: 44_100 });
	const project = createCurrentAudioEditorProject({
		id: 'independent-batch-moves', now: NOW, sampleRate: 44_100,
		sequences: [{ id: 'main', rate: RATE }], primarySequenceId: 'main',
		sources: [video, audio],
		clips: [
			createVideoClip({
				id: 'video', sourceId: video.id, sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 1,
				sourceInFrame: 0, sourceFrameCount: 1,
			}, { projectSampleRate: 44_100, sequence: { id: 'main', rate: RATE }, source: video }),
			createAudioClip({
				id: 'audio', sourceId: audio.id, timelineStartFrame: 10_000,
				durationFrames: 100, sourceDurationFrames: 100,
			}),
		],
		tracks: [
			createVideoTrack({ id: 'video-track', clipIds: ['video'] }),
			createAudioTrack({ id: 'audio-track', clipIds: ['audio'] }, 44_100),
		],
	});
	const edited = applyEditorCommand(project, {
		type: 'batch',
		commands: [
			{ type: 'clip/move', clipId: 'video', trackId: 'video-track', timelineStartFrame: 2_756 },
			{ type: 'clip/move', clipId: 'audio', trackId: 'audio-track', timelineStartFrame: 12_756 },
		],
	}, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);

	assert.deepEqual(
		resolved.clips.map((clip) => [clip.id, clip.timelineStartFrame]),
		[['video', 1_838], ['audio', 12_756]],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('mixed roll conforms both audio boundaries to the video edit point', () => {
	const video = videoSource();
	const audio = createAudioSource({ id: 'audio-source', frameCount: 44_100, channelCount: 1, sampleRate: 44_100 });
	const project = createCurrentAudioEditorProject({
		id: 'mixed-roll', now: NOW, sampleRate: 44_100,
		sequences: [{ id: 'main', rate: RATE }], primarySequenceId: 'main',
		sources: [video, audio],
		clips: [
			createVideoClip({
				id: 'video-1', sourceId: video.id, sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 2,
				sourceInFrame: 0, sourceFrameCount: 2,
			}, { projectSampleRate: 44_100, sequence: { id: 'main', rate: RATE }, source: video }),
			createVideoClip({
				id: 'video-2', sourceId: video.id, sequenceId: 'main',
				sequenceStartFrame: 2, sequenceFrameCount: 2,
				sourceInFrame: 2, sourceFrameCount: 2,
			}, { projectSampleRate: 44_100, sequence: { id: 'main', rate: RATE }, source: video }),
			createAudioClip({
				id: 'audio-1', sourceId: audio.id, timelineStartFrame: 0,
				durationFrames: 3_675, sourceDurationFrames: 3_675,
			}),
			createAudioClip({
				id: 'audio-2', sourceId: audio.id, timelineStartFrame: 3_675,
				durationFrames: 3_675, sourceStartFrame: 3_675, sourceDurationFrames: 3_675,
			}),
		],
		tracks: [
			createVideoTrack({ id: 'video-track', clipIds: ['video-1', 'video-2'] }),
			createAudioTrack({ id: 'audio-track', clipIds: ['audio-1', 'audio-2'] }, 44_100),
		],
	});
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const command = prepareTransformClipsCommand(runtime, [
		{ clipId: 'video-1', trackId: 'video-track', changes: { durationFrames: 4_675, sourceDurationFrames: 3 } },
		{ clipId: 'video-2', trackId: 'video-track', changes: {
			timelineStartFrame: 4_675, durationFrames: 2_675,
			sourceStartFrame: 3, sourceDurationFrames: 1,
		} },
		{ clipId: 'audio-1', trackId: 'audio-track', changes: { durationFrames: 4_675, sourceDurationFrames: 4_675 } },
		{ clipId: 'audio-2', trackId: 'audio-track', changes: {
			timelineStartFrame: 4_675, durationFrames: 2_675,
			sourceStartFrame: 4_675, sourceDurationFrames: 2_675,
		} },
	]);
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);

	assert.deepEqual(
		resolved.clips.map((clip) => [clip.id, clip.timelineStartFrame, clip.timelineEndFrame]),
		[
			['video-1', 0, 5_513],
			['video-2', 5_513, 7_350],
			['audio-1', 0, 5_513],
			['audio-2', 5_513, 7_350],
		],
	);
	assert.deepEqual(
		edited.clips.filter((clip) => clip.kind === 'audio').map((clip) => (
			[clip.id, clip.sourceStartFrame, clip.sourceDurationFrames]
		)),
		[['audio-1', 0, 5_513], ['audio-2', 5_513, 1_837]],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('sample edits retain exact musical authority when its reduced denominator exceeds one million', () => {
	const source = createAudioSource({ id: 'source', frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, anchor: 'musical',
		musicalStartBeat: { num: 0, den: 1 }, musicalExtent: 'fixedSamples',
		durationFrames: 100, sourceDurationFrames: 100,
	});
	const project = createCurrentAudioEditorProject({
		id: 'musical-inverse', now: NOW, sources: [source], clips: [clip],
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 121, den: 1 } }],
		},
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const edited = applyEditorCommand(project, {
		type: 'clip/move', clipId: 'clip', trackId: 'track', timelineStartFrame: 1,
	}, { now: NOW });

	assert.deepEqual(edited.clips[0].musicalStartBeat, { num: 121, den: 2_880_000 });
	assert.equal(validateCurrentAudioEditorProject(edited), true);
	assert.equal(loadCurrentAudioEditorProject(structuredClone(edited)).readOnly, false);
});

test('video split uses one conformed sequence boundary for both halves', () => {
	const project = splitProject(false);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	let nextId = 0;
	const command = prepareLinkedSplitCommand(runtime, 'video', 2_759, (prefix) => (
		`${prefix}-split-${String(nextId++)}`
	));
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);

	assert.deepEqual(
		edited.clips.map((clip) => [clip.id, clip.sequenceStartFrame, clip.sequenceFrameCount]),
		[['video', 0, 1], ['clip-split-0', 1, 2]],
	);
	assert.deepEqual(
		edited.clips.map((clip) => [clip.id, clip.sourceInFrame, clip.sourceFrameCount]),
		[['video', 0, 1], ['clip-split-0', 1, 2]],
	);
	assert.deepEqual(
		resolved.clips.map((clip) => [clip.id, clip.timelineStartFrame, clip.timelineEndFrame]),
		[['video', 0, 1_839], ['clip-split-0', 1_839, 5_518]],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('linked split reuses the video-conformed boundary for both A/V pairs', () => {
	const project = splitProject(true);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	let nextId = 0;
	const command = prepareLinkedSplitCommand(runtime, 'audio', 2_759, (prefix) => (
		`${prefix}-split-${String(nextId++)}`
	));
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);
	const byLink = new Map<unknown, Array<(typeof resolved.clips)[number]>>();
	for (const clip of resolved.clips) {
		const linked = byLink.get(clip.avLinkId) ?? [];
		linked.push(clip);
		byLink.set(clip.avLinkId, linked);
	}

	assert.deepEqual(
		[...byLink.values()].map((clips) => clips.map((clip) => (
			[clip.kind, clip.timelineStartFrame, clip.timelineEndFrame]
		))),
		[
			[['video', 0, 1_839], ['audio', 0, 1_839]],
			[['audio', 1_839, 5_518], ['video', 1_839, 5_518]],
		],
	);
	assert.deepEqual(
		edited.clips.filter((clip) => clip.kind === 'audio').map((clip) => (
			[clip.sourceStartFrame, clip.sourceDurationFrames]
		)),
		[[0, 1_839], [1_839, 3_679]],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('video overwrite cuts inactive material at the active clip conformed boundaries', () => {
	const project = overwriteProject();
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	let nextId = 0;
	const command = prepareTransformClipsCommand(runtime, [{
		clipId: 'moving', trackId: 'video-track', changes: { timelineStartFrame: 2_759 },
	}], { overwrite: true }, (prefix) => `${prefix}-overwrite-${String(nextId++)}`);
	assertConformedOverwrite(project, command as AudioEditorCommand);
});

test('single-clip overwrite cuts inactive material at the active clip conformed boundaries', () => {
	const project = overwriteProject();
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	let nextId = 0;
	const command = prepareOverwriteClipCommand(runtime, 'moving', {
		trackId: 'video-track', changes: { timelineStartFrame: 2_759 },
	}, (prefix) => `${prefix}-overwrite-${String(nextId++)}`);
	assertConformedOverwrite(project, command as AudioEditorCommand);
});

test('video overwrite propagates its conformed cut through an inactive linked A/V pair', () => {
	const project = overwriteProject(true);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	let nextId = 0;
	const command = prepareTransformClipsCommand(runtime, [{
		clipId: 'moving', trackId: 'video-track', changes: { timelineStartFrame: 2_759 },
	}], { overwrite: true }, (prefix) => `${prefix}-overwrite-${String(nextId++)}`);
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });

	assert.deepEqual(
		edited.clips.filter((clip) => clip.kind === 'video').map((clip) => (
			[clip.id, clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount]
		)),
		[
			['target', 0, 1, 0, 1],
			['clip-overwrite-0', 2, 1, 2, 1],
			['moving', 1, 1, 5, 1],
		],
	);
	assert.deepEqual(
		edited.clips.filter((clip) => clip.kind === 'audio').map((clip) => (
			[clip.id, clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames]
		)),
		[
			['target-audio', 0, 1_839, 0, 1_839],
			['clip-overwrite-1', 3_679, 1_839, 3_679, 1_839],
		],
	);
	assert.deepEqual(
		edited.clips.filter((clip) => clip.id !== 'moving').map((clip) => clip.avLinkId),
		['target-link', 'av-link-overwrite-2', 'target-link', 'av-link-overwrite-2'],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('video move controllers adopt the destination sequence and preserve frame extent', () => {
	for (const controller of ['move', 'transform-many']) {
		const project = crossSequenceProject();
		const runtime = projectForCommand(project as unknown as Record<string, unknown>);
		const command = controller === 'move'
			? { type: 'batch', commands: [
				{ type: 'clip/move', clipId: 'video', trackId: 'track-30', timelineStartFrame: 5_000 },
				{ type: 'clip/move', clipId: 'audio', trackId: 'audio-track-30', timelineStartFrame: 5_000 },
			] }
			: prepareTransformClipsCommand(runtime, [
				{ clipId: 'video', trackId: 'track-30', changes: { timelineStartFrame: 5_000 } },
				{ clipId: 'audio', trackId: 'audio-track-30', changes: { timelineStartFrame: 5_000 } },
			]);
		const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
		const clip = edited.clips.find((value) => value.kind === 'video');
		assert.ok(clip?.kind === 'video');

		assert.deepEqual(
			[clip.sequenceId, clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount],
			['sequence-30', 3, 2, 0, 2],
			controller,
		);
		assert.deepEqual(
			resolveRuntimeProjectProjection(edited).clips.map((value) => (
				[value.timelineStartFrame, value.timelineEndFrame]
			)),
			[[4_410, 7_350], [4_410, 7_350]],
			controller,
		);
		assert.deepEqual(
			edited.clips.filter((value) => value.kind === 'audio').map((value) => (
				[value.timelineStartFrame, value.durationFrames, value.sourceStartFrame, value.sourceDurationFrames]
			)),
			[[4_410, 2_940, 0, 3_678]],
		);
		assert.equal(validateCurrentAudioEditorProject(edited), true);
	}
});

function assertConformedOverwrite(
	project: ReturnType<typeof overwriteProject>,
	command: AudioEditorCommand,
) {
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const resolved = resolveRuntimeProjectProjection(edited);

	assert.deepEqual(
		edited.clips.map((clip) => (
			[clip.id, clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount]
		)).sort(([left], [right]) => String(left).localeCompare(String(right))),
		[
			['clip-overwrite-0', 2, 1, 2, 1],
			['moving', 1, 1, 5, 1],
			['target', 0, 1, 0, 1],
		],
	);
	assert.deepEqual(
		resolved.clips.map((clip) => [clip.id, clip.timelineStartFrame, clip.timelineEndFrame])
			.sort(([left], [right]) => String(left).localeCompare(String(right))),
		[
			['clip-overwrite-0', 3_679, 5_518],
			['moving', 1_839, 3_679],
			['target', 0, 1_839],
		],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
}

function overwriteProject(linked = false) {
	const sampleRate = 44_100;
	const rate = { num: 24_000, den: 1_001 };
	const source = createVideoSource({
		id: 'overwrite-source', frameCount: sampleRate, sampleRate,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 24,
	}, sampleRate);
	const audio = createAudioSource({
		id: 'overwrite-audio-source', frameCount: sampleRate, sampleRate, channelCount: 1,
	});
	const target = createVideoClip({
		id: 'target', sourceId: source.id, sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 3,
		sourceInFrame: 0, sourceFrameCount: 3,
		avLinkId: linked ? 'target-link' : null,
	}, { projectSampleRate: sampleRate, sequence: { id: 'main', rate }, source });
	const moving = createVideoClip({
		id: 'moving', sourceId: source.id, sequenceId: 'main',
		sequenceStartFrame: 5, sequenceFrameCount: 1,
		sourceInFrame: 5, sourceFrameCount: 1,
	}, { projectSampleRate: sampleRate, sequence: { id: 'main', rate }, source });
	return createCurrentAudioEditorProject({
		id: 'overwrite-conformance', now: NOW, sampleRate,
		sequences: [{ id: 'main', rate }], primarySequenceId: 'main',
		sources: linked ? [source, audio] : [source],
		clips: linked ? [
			target,
			createAudioClip({
				id: 'target-audio', sourceId: audio.id, timelineStartFrame: 0,
				durationFrames: 5_518, sourceDurationFrames: 5_518, avLinkId: 'target-link',
			}),
			moving,
		] : [target, moving],
		tracks: linked ? [
			createVideoTrack({
				id: 'video-track', laneGroupId: 'overwrite-lanes', clipIds: ['target', 'moving'],
			}),
			createAudioTrack({
				id: 'audio-track', laneGroupId: 'overwrite-lanes', clipIds: ['target-audio'],
			}, sampleRate),
		] : [createVideoTrack({ id: 'video-track', clipIds: ['target', 'moving'] })],
	});
}

function crossSequenceProject() {
	const sampleRate = 44_100;
	const sourceRate = { num: 24_000, den: 1_001 };
	const source = createVideoSource({
		id: 'cross-sequence-source', frameCount: sampleRate, sampleRate,
		width: 16, height: 16, frameRate: sourceRate, sourceFrameCount: 24,
	}, sampleRate);
	const clip = createVideoClip({
		id: 'video', sourceId: source.id, sequenceId: 'sequence-24',
		sequenceStartFrame: 2, sequenceFrameCount: 2, sourceInFrame: 0, sourceFrameCount: 2,
		avLinkId: 'cross-sequence-link',
	}, { projectSampleRate: sampleRate, sequence: { id: 'sequence-24', rate: sourceRate }, source });
	const audio = createAudioSource({ id: 'cross-sequence-audio', frameCount: sampleRate, sampleRate, channelCount: 1 });
	const audioClip = createAudioClip({
		id: 'audio', sourceId: audio.id, timelineStartFrame: 3_679, durationFrames: 3_678,
		sourceDurationFrames: 3_678, avLinkId: 'cross-sequence-link',
	});
	return createCurrentAudioEditorProject({
		id: 'cross-sequence-move', now: NOW, sampleRate, sources: [source, audio], clips: [clip, audioClip],
		sequences: [
			{ id: 'sequence-24', rate: sourceRate, trackIds: ['track-24', 'audio-track-24'] },
			{ id: 'sequence-30', rate: { num: 30, den: 1 }, trackIds: ['track-30', 'audio-track-30'] },
		],
		primarySequenceId: 'sequence-24',
		tracks: [
			createVideoTrack({ id: 'track-24', laneGroupId: 'lanes-24', clipIds: ['video'] }),
			createAudioTrack({ id: 'audio-track-24', laneGroupId: 'lanes-24', clipIds: ['audio'] }, sampleRate),
			createVideoTrack({ id: 'track-30', laneGroupId: 'lanes-30', clipIds: [] }),
			createAudioTrack({ id: 'audio-track-30', laneGroupId: 'lanes-30', clipIds: [] }, sampleRate),
		],
	});
}

function mixedProject(options: Readonly<{
	sequenceStartFrame?: number;
	audioStartFrame?: number;
	frameCount?: number;
}> = {}) {
	const video = videoSource();
	const audio = createAudioSource({
		id: 'audio-source', frameCount: 44_100, sampleRate: 44_100, channelCount: 1,
	});
	return createCurrentAudioEditorProject({
		id: 'mixed-ripple', now: NOW, sampleRate: 44_100,
		sequences: [{ id: 'main', rate: RATE }], primarySequenceId: 'main',
		sources: [video, audio],
		clips: [
			createVideoClip({
				id: 'video', sourceId: video.id, sequenceId: 'main',
				sequenceStartFrame: options.sequenceStartFrame ?? 2,
				sequenceFrameCount: options.frameCount ?? 2,
				sourceInFrame: 0, sourceFrameCount: options.frameCount ?? 2,
			}, { projectSampleRate: 44_100, sequence: { id: 'main', rate: RATE }, source: video }),
			createAudioClip({
				id: 'audio', sourceId: audio.id,
				timelineStartFrame: options.audioStartFrame ?? 3_675,
				durationFrames: options.frameCount === 1 ? 1_838 : 3_675,
				sourceDurationFrames: options.frameCount === 1 ? 1_838 : 3_675,
			}),
		],
		tracks: [
			createVideoTrack({ id: 'video-track', clipIds: ['video'] }),
			createAudioTrack({ id: 'audio-track', clipIds: ['audio'] }, 44_100),
		],
	});
}

function videoSource() {
	return createVideoSource({
		id: 'video-source', frameCount: 44_100, sampleRate: 44_100,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: 24,
	}, 44_100);
}

function splitProject(linked: boolean) {
	const sampleRate = 44_100;
	const rate = { num: 24_000, den: 1_001 };
	const video = createVideoSource({
		id: 'split-video-source', frameCount: sampleRate, sampleRate,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 24,
	}, sampleRate);
	const audio = createAudioSource({
		id: 'split-audio-source', frameCount: sampleRate, sampleRate, channelCount: 1,
	});
	const clips = [createVideoClip({
		id: 'video', sourceId: video.id, sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 3,
		sourceInFrame: 0, sourceFrameCount: 3,
		avLinkId: linked ? 'left-link' : null,
	}, { projectSampleRate: sampleRate, sequence: { id: 'main', rate }, source: video })];
	if (linked) clips.push(createAudioClip({
		id: 'audio', sourceId: audio.id, timelineStartFrame: 0,
		durationFrames: 5_518, sourceStartFrame: 0, sourceDurationFrames: 5_518,
		avLinkId: 'left-link',
		}) as unknown as typeof clips[number]);
	return createCurrentAudioEditorProject({
		id: `split-${linked ? 'linked' : 'video'}`, now: NOW, sampleRate,
		sequences: [{ id: 'main', rate }], primarySequenceId: 'main',
		sources: linked ? [video, audio] : [video], clips,
		tracks: linked ? [
			createVideoTrack({ id: 'video-track', laneGroupId: 'lane', clipIds: ['video'] }),
			createAudioTrack({ id: 'audio-track', laneGroupId: 'lane', clipIds: ['audio'] }, sampleRate),
		] : [createVideoTrack({ id: 'video-track', clipIds: ['video'] })],
	});
}
