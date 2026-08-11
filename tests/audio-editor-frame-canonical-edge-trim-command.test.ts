/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareTransformClipsCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';

const NOW = '2026-08-11T13:00:00.000Z';

test('one current V15 transform persists canonical video fields and linked equal endpoints', () => {
	const { project } = createPersistedVideoProject({ timeline: true });
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	const plan = planFrameCanonicalEdgeTrim(runtime, {
		activeClipId: 'persisted-timeline-video',
		edge: 'right',
		requestedBoundarySample: 38_400,
	});
	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.participantClipIds, [
		'persisted-timeline-video', 'persisted-timeline-audio',
	]);
	const command = prepareTransformClipsCommand(runtime, plan.transforms) as AudioEditorCommand;
	assert.equal(command.type, 'clip/transform-many');
	if (command.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
	assert.equal(command.transforms.length, 2);

	let history = executeEditorCommand(createEditorHistory(project), command, { now: NOW });
	assert.equal(history.undoStack.length, 1);
	const edited = history.present;
	const persistedVideo = edited.clips.find((clip: Readonly<Record<string, unknown>>) => (
		clip.id === 'persisted-timeline-video'
	));
	assert.ok(persistedVideo?.kind === 'video');
	assert.deepEqual([
		persistedVideo.sequenceStartFrame,
		persistedVideo.sequenceFrameCount,
		persistedVideo.sourceInFrame,
		persistedVideo.sourceFrameCount,
	], [0, 24, 0, 20]);
	for (const alias of [
		'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
	]) assert.equal(Object.hasOwn(persistedVideo, alias), false, alias);
	const resolved = resolveRuntimeProjectProjection(edited).clips;
	const video = resolved.find(({ id }) => id === 'persisted-timeline-video');
	const audio = resolved.find(({ id }) => id === 'persisted-timeline-audio');
	assert.ok(video && audio);
	assert.deepEqual(
		[video.timelineStartFrame, video.timelineEndFrame],
		[0, 38_400],
	);
	assert.deepEqual(
		[audio.timelineStartFrame, audio.timelineEndFrame],
		[video.timelineStartFrame, video.timelineEndFrame],
	);
	assert.equal(validateCurrentAudioEditorProject(edited), true);

	const editedCoordinates = coordinateState(edited);
	history = undoEditorCommand(history, { now: '2026-08-11T13:01:00.000Z' });
	assert.deepEqual(coordinateState(history.present), coordinateState(project));
	history = redoEditorCommand(history, { now: '2026-08-11T13:02:00.000Z' });
	assert.deepEqual(coordinateState(history.present), editedCoordinates);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
});

test('a left trim reconciles V15 sequence and source starts in one undo step', () => {
	const { project } = createPersistedVideoProject({ timeline: true });
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	const plan = planFrameCanonicalEdgeTrim(runtime, {
		activeClipId: 'persisted-timeline-video',
		edge: 'left',
		requestedBoundarySample: 9_600,
	});
	assert.equal(plan.kind, 'transform');
	const command = prepareTransformClipsCommand(runtime, plan.transforms) as AudioEditorCommand;
	assert.equal(command.type, 'clip/transform-many');

	let history = executeEditorCommand(createEditorHistory(project), command, { now: NOW });
	assert.equal(history.undoStack.length, 1);
	const persistedVideo = history.present.clips.find((clip: Readonly<Record<string, unknown>>) => (
		clip.id === 'persisted-timeline-video'
	));
	assert.ok(persistedVideo?.kind === 'video');
	assert.deepEqual([
		persistedVideo.sequenceStartFrame,
		persistedVideo.sequenceFrameCount,
		persistedVideo.sourceInFrame,
		persistedVideo.sourceFrameCount,
	], [6, 24, 5, 20]);
	for (const alias of [
		'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
	]) assert.equal(Object.hasOwn(persistedVideo, alias), false, alias);
	const resolved = resolveRuntimeProjectProjection(history.present).clips;
	const video = resolved.find(({ id }) => id === 'persisted-timeline-video');
	const audio = resolved.find(({ id }) => id === 'persisted-timeline-audio');
	assert.ok(video && audio);
	assert.deepEqual([video.timelineStartFrame, video.timelineEndFrame], [9_600, 48_000]);
	assert.deepEqual(
		[audio.timelineStartFrame, audio.timelineEndFrame],
		[video.timelineStartFrame, video.timelineEndFrame],
	);

	const editedCoordinates = coordinateState(history.present);
	history = undoEditorCommand(history, { now: '2026-08-11T13:03:00.000Z' });
	assert.deepEqual(coordinateState(history.present), coordinateState(project));
	history = redoEditorCommand(history, { now: '2026-08-11T13:04:00.000Z' });
	assert.deepEqual(coordinateState(history.present), editedCoordinates);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
});

function coordinateState(project: Readonly<{ clips: readonly Readonly<Record<string, unknown>>[] }>) {
	return project.clips.map((clip) => ({
		id: clip.id,
		sequenceStartFrame: clip.sequenceStartFrame,
		sequenceFrameCount: clip.sequenceFrameCount,
		sourceInFrame: clip.sourceInFrame,
		sourceFrameCount: clip.sourceFrameCount,
		timelineStartFrame: clip.timelineStartFrame,
		durationFrames: clip.durationFrames,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
	}));
}
