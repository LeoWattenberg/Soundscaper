/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createClipboardDescriptor,
	prepareLinkedSplitCommand,
	preparePasteCommand,
	prepareRangeDeleteCommand,
} from '../src/common/editor/commands.js';
import { segmentOfClip } from '../src/common/editor/commands/shared-runtime.js';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createAudioEditorProjectV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
	validateAudioEditorProjectV10,
} from '../src/common/editor/project-v10.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NOW = '2026-08-09T12:00:00.000Z';
const SAMPLE_RATE = 44_100;
const RATE = { num: 24_000, den: 1_001 } as const;

test('slow video splits retain one positive in-bounds source frame at every internal boundary', () => {
	for (const boundary of [2, 3]) {
		const project = videoProject(1);
		const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
		let nextId = 0;
		const command = prepareLinkedSplitCommand(
			runtime,
			'video',
			videoBoundary(boundary),
			(prefix) => `${prefix}-${String(boundary)}-${String(nextId++)}`,
		);
		const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });

		assert.deepEqual(videoAuthority(edited), [
			[0, boundary, 5, 1],
			[boundary, 4 - boundary, 5, 1],
		]);
		assert.equal(validateAudioEditorProjectV10(edited), true);
	}
});

test('slow video lift-delete retains positive in-bounds source authority for both survivors', () => {
	const project = videoProject(1);
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	let nextId = 0;
	const command = prepareRangeDeleteCommand(runtime, {
		startFrame: videoBoundary(1),
		endFrame: videoBoundary(2),
		trackIds: ['video-track'],
		rippleMode: 'none',
	}, (prefix) => `${prefix}-${String(nextId++)}`);
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });

	assert.deepEqual(videoAuthority(edited), [
		[0, 1, 5, 1],
		[2, 2, 5, 1],
	]);
	assert.equal(validateAudioEditorProjectV10(edited), true);
});

test('slow video later-half clipboard segments stay valid through duplicate-style paste', () => {
	const project = videoProject(1);
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	const clipboard = createClipboardDescriptor(runtime, {
		startFrame: videoBoundary(2),
		endFrame: videoBoundary(4),
		trackIds: ['video-track'],
	});
	const descriptor = clipboard.tracks[0]?.clips[0];

	assert.ok(descriptor);
	assert.deepEqual(
		[descriptor.sourceStartFrame, descriptor.sourceDurationFrames, descriptor.sourceInFrame, descriptor.sourceFrameCount],
		[5, 1, 5, 1],
	);
	let nextId = 0;
	const command = preparePasteCommand(clipboard, {
		atFrame: videoBoundary(4),
		mode: 'reject',
		project: runtime,
	}, (prefix) => `${prefix}-${String(nextId++)}`);
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });

	assert.deepEqual(videoAuthority(edited), [
		[0, 4, 5, 1],
		[4, 2, 5, 1],
	]);
	assert.equal(validateAudioEditorProjectV10(edited), true);
});

test('ordinary video segmentation keeps exact contiguous source-frame authority', () => {
	const splitProject = videoProject(4);
	const splitRuntime = projectV10ForCommand(splitProject as unknown as Record<string, unknown>);
	let splitId = 0;
	const split = applyEditorCommand(splitProject, prepareLinkedSplitCommand(
		splitRuntime,
		'video',
		videoBoundary(2),
		(prefix) => `${prefix}-split-${String(splitId++)}`,
	) as AudioEditorCommand, { now: NOW });

	assert.deepEqual(videoAuthority(split), [
		[0, 2, 5, 2],
		[2, 2, 7, 2],
	]);
	assert.equal(validateAudioEditorProjectV10(split), true);

	const liftProject = videoProject(4);
	const liftRuntime = projectV10ForCommand(liftProject as unknown as Record<string, unknown>);
	let liftId = 0;
	const lift = applyEditorCommand(liftProject, prepareRangeDeleteCommand(liftRuntime, {
		startFrame: videoBoundary(1),
		endFrame: videoBoundary(2),
		trackIds: ['video-track'],
		rippleMode: 'none',
	}, (prefix) => `${prefix}-lift-${String(liftId++)}`) as AudioEditorCommand, { now: NOW });

	assert.deepEqual(videoAuthority(lift), [
		[0, 1, 5, 1],
		[2, 2, 7, 2],
	]);
	assert.equal(validateAudioEditorProjectV10(lift), true);

	const clipboardProject = videoProject(4);
	const clipboardRuntime = projectV10ForCommand(clipboardProject as unknown as Record<string, unknown>);
	const clipboard = createClipboardDescriptor(clipboardRuntime, {
		startFrame: videoBoundary(2),
		endFrame: videoBoundary(4),
		trackIds: ['video-track'],
	});
	const descriptor = clipboard.tracks[0]?.clips[0];

	assert.ok(descriptor);
	assert.deepEqual(
		[descriptor.sourceStartFrame, descriptor.sourceDurationFrames, descriptor.sourceInFrame, descriptor.sourceFrameCount],
		[7, 2, 7, 2],
	);
});

test('non-collapsed fractional-speed source segmentation preserves established mapping', () => {
	const audio = segmentOfClip({
		id: 'audio',
		kind: 'audio',
		anchor: 'sample',
		timelineStartFrame: 0,
		durationFrames: 10,
		sourceStartFrame: 100,
		sourceDurationFrames: 7,
		trimStartFrames: 0,
		trimEndFrames: 0,
	}, 2, 5, 2, 'audio-segment');
	const video = segmentOfClip({
		id: 'video',
		kind: 'video',
		sequenceId: 'main',
		timelineStartFrame: 0,
		durationFrames: 10,
		sourceStartFrame: 100,
		sourceDurationFrames: 7,
		trimStartFrames: 0,
		trimEndFrames: 0,
	}, 2, 5, 2, 'video-segment');

	assert.deepEqual(
		[audio.sourceStartFrame, audio.sourceDurationFrames],
		[101, 2],
	);
	assert.deepEqual(
		[video.sourceStartFrame, video.sourceDurationFrames],
		[101, 2],
	);
});

function videoProject(sourceFrameCount: number) {
	const source = createVideoSourceV10({
		id: 'video-source',
		frameCount: SAMPLE_RATE,
		sampleRate: SAMPLE_RATE,
		width: 16,
		height: 16,
		frameRate: RATE,
		sourceFrameCount: 24,
	}, SAMPLE_RATE);
	const clip = createVideoClipV10({
		id: 'video',
		sourceId: source.id,
		sequenceId: 'main',
		sequenceStartFrame: 0,
		sequenceFrameCount: 4,
		sourceInFrame: 5,
		sourceFrameCount,
	}, {
		projectSampleRate: SAMPLE_RATE,
		sequence: { id: 'main', rate: RATE },
		source,
	});
	return createAudioEditorProjectV10({
		id: 'source-segmentation',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE }],
		primarySequenceId: 'main',
		sources: [source],
		clips: [clip],
		tracks: [createVideoTrackV10({ id: 'video-track', clipIds: ['video'] })],
	});
}

function videoBoundary(frame: number): number {
	return videoFrameToSampleFrame(frame, RATE, SAMPLE_RATE, 'point');
}

function videoAuthority(project: ReturnType<typeof videoProject>): unknown[] {
	return [...project.clips]
		.sort((left, right) => Number(left.sequenceStartFrame) - Number(right.sequenceStartFrame))
		.map((clip) => [
			clip.sequenceStartFrame,
			clip.sequenceFrameCount,
			clip.sourceInFrame,
			clip.sourceFrameCount,
		]);
}
