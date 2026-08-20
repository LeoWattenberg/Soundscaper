/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createClipboardDescriptor,
	preparePasteCommand,
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
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NOW = '2026-08-09T12:00:00.000Z';

test('current clipboard paste preserves musical authority and audio warp maps', () => {
	const source = createAudioSource({ id: 'source', frameCount: 480_000, channelCount: 1 });
	const warpMap = {
		feature: 'audio-warp',
		points: [
			{ outer: { num: 0, den: 1 }, source: { num: 12_000, den: 1 }, mode: 'forward' },
			{ outer: { num: 2, den: 1 }, source: { num: 60_000, den: 1 }, mode: 'forward' },
		],
	};
	const clip = createAudioClip({
		id: 'clip', sourceId: source.id, sourceStartFrame: 12_000, sourceDurationFrames: 48_000,
		anchor: 'musical', musicalStartBeat: { num: 3, den: 1 }, musicalExtent: 'beat',
		musicalDurationBeats: { num: 2, den: 1 }, warpMap,
	});
	const project = createCurrentAudioEditorProject({
		id: 'musical-clipboard', now: NOW, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const clipboard = createClipboardDescriptor(runtime, {
		startFrame: 72_000,
		endFrame: 120_000,
		trackIds: ['track'],
	});
	const command = preparePasteCommand(clipboard, {
		atFrame: 144_000,
		project: runtime,
	}, () => 'pasted');
	const pasted = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const result = pasted.clips.find((candidate) => candidate.id === 'pasted');

	assert.ok(result);
	assert.equal(result.anchor, 'musical');
	assert.equal(result.musicalExtent, 'beat');
	assert.deepEqual(result.musicalStartBeat, { num: 6, den: 1 });
	assert.deepEqual(result.musicalDurationBeats, { num: 2, den: 1 });
	assert.deepEqual(result.warpMap, warpMap);
	assert.deepEqual([result.sourceStartFrame, result.sourceDurationFrames], [12_000, 48_000]);
	assert.equal(validateCurrentAudioEditorProject(pasted), true);
});

test('current clipboard carries video retime authority into the protected paste boundary', () => {
	const rate = { num: 24, den: 1 };
	const source = createVideoSource({
		id: 'source', frameCount: 441_000, sampleRate: 44_100,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 240,
	}, 44_100);
	const retimeMap = {
		feature: 'video-retime',
		version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 10, den: 1 } },
			{ outerFrame: 4, sourceFrame: { num: 22, den: 1 } },
		],
		segments: [{ mode: 'constant-forward' }],
	};
	const clip = { ...createVideoClip({
		id: 'clip', sourceId: source.id, sequenceId: 'main',
		sequenceStartFrame: 2, sequenceFrameCount: 4,
		sourceInFrame: 10, sourceFrameCount: 12,
	}, {
		projectSampleRate: 44_100,
		sequence: { id: 'main', rate },
		source,
	}), retimeMap };
	const project = createCurrentAudioEditorProject({
		id: 'video-clipboard', now: NOW, sampleRate: 44_100,
		sequences: [{ id: 'main', rate }], primarySequenceId: 'main',
		sources: [source], clips: [clip],
		tracks: [createVideoTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const original = resolveRuntimeClipProjection(project, project.clips[0]);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const clipboard = createClipboardDescriptor(runtime, {
		startFrame: original.timelineStartFrame,
		endFrame: original.timelineEndFrame,
		trackIds: ['track'],
	});
	const command = preparePasteCommand(clipboard, {
		atFrame: 20_000,
		project: runtime,
	}, () => 'pasted');
	const copied = clipboard.tracks[0]?.clips[0];

	assert.ok(copied);
	assert.deepEqual([
		copied.sequenceFrameCount, copied.sourceInFrame, copied.sourceFrameCount,
	], [4, 10, 12]);
	assert.deepEqual(copied.retimeMap, retimeMap);
	assert.throws(
		() => applyEditorCommand(project, command as AudioEditorCommand, { now: NOW }),
		/retime.*protected/iu,
	);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('current video paste uses one destination frame anchor and the owning sequence', () => {
	const rate = { num: 24, den: 1 };
	const targetRate = { num: 30, den: 1 };
	const source = createVideoSource({
		id: 'source', frameCount: 441_000, sampleRate: 44_100,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 240,
	}, 44_100);
	const clipContext = {
		projectSampleRate: 44_100,
		sequence: { id: 'source-sequence', rate },
		source,
	};
	const clips = [
		createVideoClip({
			id: 'first', sourceId: source.id, sequenceId: 'source-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1,
		}, clipContext),
		createVideoClip({
			id: 'second', sourceId: source.id, sequenceId: 'source-sequence',
			sequenceStartFrame: 3, sequenceFrameCount: 1, sourceInFrame: 3, sourceFrameCount: 1,
		}, clipContext),
	];
	const project = createCurrentAudioEditorProject({
		id: 'cross-sequence-clipboard', now: NOW, sampleRate: 44_100,
		sequences: [
			{ id: 'source-sequence', rate, trackIds: ['source-track'] },
			{ id: 'target-sequence', rate: targetRate, trackIds: ['target-track'] },
		],
		primarySequenceId: 'source-sequence', sources: [source], clips,
		tracks: [
			createVideoTrack({ id: 'source-track', clipIds: ['first', 'second'] }),
			createVideoTrack({ id: 'target-track', clipIds: [] }),
		],
	});
	assert.equal(validateCurrentAudioEditorProject(project), true);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const clipboard = createClipboardDescriptor(runtime, {
		startFrame: 0,
		endFrame: 7_350,
		trackIds: ['source-track'],
	});
	let nextId = 0;
	const command = preparePasteCommand(clipboard, {
		atFrame: 2_756,
		trackMap: { 'source-track': 'target-track' },
		project: runtime,
	}, () => `pasted-${String(nextId++)}`);
	const pasted = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const results = pasted.clips
		.filter((candidate) => String(candidate.id).startsWith('pasted-'))
		.sort((left, right) => Number(left.sequenceStartFrame) - Number(right.sequenceStartFrame));

	assert.deepEqual(results.map(({ sequenceId }) => sequenceId), ['target-sequence', 'target-sequence']);
	assert.deepEqual(results.map(({ sequenceStartFrame }) => sequenceStartFrame), [2, 6]);
	assert.equal(validateCurrentAudioEditorProject(pasted), true);
});

test('overlap paste conforms collision trimming with its linked audio target', () => {
	const rate = { num: 24, den: 1 };
	const sampleRate = 44_100;
	const video = createVideoSource({
		id: 'video-source', frameCount: sampleRate, sampleRate,
		width: 16, height: 16, frameRate: rate, sourceFrameCount: 24,
	}, sampleRate);
	const audio = createAudioSource({
		id: 'audio-source', frameCount: sampleRate, channelCount: 1, sampleRate,
	});
	const context = { projectSampleRate: sampleRate, sequence: { id: 'main', rate }, source: video };
	const project = createCurrentAudioEditorProject({
		id: 'overlap-paste-conformance', now: NOW, sampleRate,
		sequences: [{
			id: 'main', rate,
			trackIds: ['copy-video-track', 'copy-audio-track', 'target-video-track', 'target-audio-track'],
		}],
		primarySequenceId: 'main', sources: [video, audio],
		clips: [
			createVideoClip({
				id: 'copy-video', sourceId: video.id, sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 1,
				sourceInFrame: 0, sourceFrameCount: 1, avLinkId: 'copy-link',
			}, context),
			createAudioClip({
				id: 'copy-audio', sourceId: audio.id, timelineStartFrame: 0,
				durationFrames: 1_838, sourceStartFrame: 0, sourceDurationFrames: 1_838,
				avLinkId: 'copy-link',
			}),
			createVideoClip({
				id: 'target-video', sourceId: video.id, sequenceId: 'main',
				sequenceStartFrame: 1, sequenceFrameCount: 2,
				sourceInFrame: 1, sourceFrameCount: 2, avLinkId: 'target-link',
			}, context),
			createAudioClip({
				id: 'target-audio', sourceId: audio.id, timelineStartFrame: 1_838,
				durationFrames: 3_675, sourceStartFrame: 1_838, sourceDurationFrames: 3_675,
				avLinkId: 'target-link',
			}),
		],
		tracks: [
			createVideoTrack({
				id: 'copy-video-track', laneGroupId: 'copy-lane', clipIds: ['copy-video'],
			}),
			createAudioTrack({
				id: 'copy-audio-track', laneGroupId: 'copy-lane', clipIds: ['copy-audio'],
			}, sampleRate),
			createVideoTrack({
				id: 'target-video-track', laneGroupId: 'target-lane', clipIds: ['target-video'],
			}),
			createAudioTrack({
				id: 'target-audio-track', laneGroupId: 'target-lane', clipIds: ['target-audio'],
			}, sampleRate),
		],
	});
	assert.equal(validateCurrentAudioEditorProject(project), true);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const clipboard = createClipboardDescriptor(runtime, {
		startFrame: 0, endFrame: 1_838, trackIds: ['copy-video-track'],
	});
	let nextId = 0;
	const command = preparePasteCommand(clipboard, {
		atFrame: 900,
		mode: 'overlap',
		trackMap: {
			'copy-video-track': 'target-video-track',
			'copy-audio-track': 'target-audio-track',
		},
		project: runtime,
	}, (prefix) => `${prefix}-pasted-${String(nextId++)}`);
	const pasted = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const targetAudio = pasted.clips.find(({ id }) => id === 'target-audio');

	assert.ok(targetAudio);
	assert.deepEqual(
		[targetAudio.sourceStartFrame, targetAudio.sourceDurationFrames],
		[1_838, 3_675],
	);
	assert.equal(validateCurrentAudioEditorProject(pasted), true);

	let replacementId = 0;
	const replacement = applyEditorCommand(project, preparePasteCommand(clipboard, {
		atFrame: 1_000,
		mode: 'overlap',
		trackMap: {
			'copy-video-track': 'target-video-track',
			'copy-audio-track': 'target-audio-track',
		},
		project: runtime,
	}, (prefix) => `${prefix}-replacement-${String(replacementId++)}`) as AudioEditorCommand, { now: NOW });
	const survivingVideo = replacement.clips.find(({ id }) => id === 'target-video');
	const survivingAudio = replacement.clips.find(({ id }) => id === 'target-audio');

	assert.ok(survivingVideo);
	assert.ok(survivingAudio);
	assert.deepEqual(
		[survivingVideo.sequenceStartFrame, survivingVideo.sequenceFrameCount,
			survivingVideo.sourceInFrame, survivingVideo.sourceFrameCount],
		[2, 1, 2, 1],
	);
	assert.deepEqual(
		[survivingAudio.timelineStartFrame, survivingAudio.durationFrames,
			survivingAudio.sourceStartFrame, survivingAudio.sourceDurationFrames],
		[3_675, 1_838, 3_675, 1_838],
	);
	assert.equal(validateCurrentAudioEditorProject(replacement), true);
});

test('overlap paste uses the pasted destination span when relative rounding is shorter', () => {
	const pasted = pasteCrossRateVideo({
		sourceRate: { num: 24, den: 1 },
		atFrame: 4,
		mode: 'overlap',
	});

	assert.deepEqual(placementAndSource(pasted), [
		[0, 2, 0, 2],
		[2, 6, 12, 6],
	]);
});

test('overlap paste uses the pasted destination span when relative rounding is longer', () => {
	const pasted = pasteCrossRateVideo({
		sourceRate: { num: 24_000, den: 1_001 },
		atFrame: 1_371,
		mode: 'overlap',
	});

	assert.deepEqual(placementAndSource(pasted), [
		[0, 1, 10, 1],
		[1, 3, 0, 2],
		[4, 4, 14, 4],
	]);
});

test('insert-track paste opens the exact destination video span', () => {
	const pasted = pasteCrossRateVideo({
		sourceRate: { num: 24, den: 1 },
		atFrame: 1_476,
		mode: 'insert-track',
	});

	assert.deepEqual(placementAndSource(pasted), [
		[0, 1, 10, 1],
		[1, 2, 0, 2],
		[3, 7, 11, 7],
	]);
});

function pasteCrossRateVideo(options: {
	sourceRate: { num: number; den: number };
	atFrame: number;
	mode: 'overlap' | 'insert-track';
}) {
	const sampleRate = 44_100;
	const targetRate = { num: 30_000, den: 1_001 };
	const source = createVideoSource({
		id: 'cross-rate-source', frameCount: sampleRate * 10, sampleRate,
		width: 16, height: 16, frameRate: options.sourceRate, sourceFrameCount: 240,
	}, sampleRate);
	const copy = createVideoClip({
		id: 'copy', sourceId: source.id, sequenceId: 'copy-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 2,
		sourceInFrame: 0, sourceFrameCount: 2,
	}, {
		projectSampleRate: sampleRate,
		sequence: { id: 'copy-sequence', rate: options.sourceRate },
		source,
	});
	const target = createVideoClip({
		id: 'target', sourceId: source.id, sequenceId: 'target-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 8,
		sourceInFrame: 10, sourceFrameCount: 8,
	}, {
		projectSampleRate: sampleRate,
		sequence: { id: 'target-sequence', rate: targetRate },
		source,
	});
	const project = createCurrentAudioEditorProject({
		id: 'cross-rate-span', now: NOW, sampleRate,
		sequences: [
			{ id: 'copy-sequence', rate: options.sourceRate, trackIds: ['copy-track'] },
			{ id: 'target-sequence', rate: targetRate, trackIds: ['target-track'] },
		],
		primarySequenceId: 'copy-sequence', sources: [source], clips: [copy, target],
		tracks: [
			createVideoTrack({ id: 'copy-track', clipIds: ['copy'] }),
			createVideoTrack({ id: 'target-track', clipIds: ['target'] }),
		],
	});
	const copyProjection = resolveRuntimeClipProjection(project, copy);
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const clipboard = createClipboardDescriptor(runtime, {
		startFrame: copyProjection.timelineStartFrame,
		endFrame: copyProjection.timelineEndFrame,
		trackIds: ['copy-track'],
	});
	let nextId = 0;
	const command = preparePasteCommand(clipboard, {
		atFrame: options.atFrame,
		mode: options.mode,
		trackMap: { 'copy-track': 'target-track' },
		project: runtime,
	}, (prefix) => `${prefix}-${String(nextId++)}`);
	const result = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });

	assert.equal(validateCurrentAudioEditorProject(result), true);
	const targetTrack = result.tracks.find(({ id }) => id === 'target-track') as
		| { clipIds: string[] }
		| undefined;
	assert.ok(targetTrack);
	return targetTrack.clipIds.map((clipId) => {
		const clip = result.clips.find(({ id }) => id === clipId);
		assert.ok(clip?.kind === 'video');
		return clip;
	}).sort((left, right) => Number(left.sequenceStartFrame) - Number(right.sequenceStartFrame));
}

function placementAndSource(clips: ReturnType<typeof pasteCrossRateVideo>) {
	return clips.map((clip) => [
		clip.sequenceStartFrame,
		clip.sequenceFrameCount,
		clip.sourceInFrame,
		clip.sourceFrameCount,
	]);
}
