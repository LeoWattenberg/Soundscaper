/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	prepareOverwriteClipCommand,
	prepareTransformClipsCommand,
} from '../src/common/editor/commands.js';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NOW = '2026-08-09T12:00:00.000Z';

test('absolute video move destinations reject negative sample coordinates', () => {
	const project = crossSequenceVideoProject();
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const before = structuredClone(project);

	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/move', clipId: 'clip', trackId: 'track-24', timelineStartFrame: -1,
	} as AudioEditorCommand, { now: NOW }), /non-negative/u);
	assert.throws(() => prepareTransformClipsCommand(runtime, [{
		clipId: 'clip', trackId: 'track-24', changes: { timelineStartFrame: -1 },
	}]), /non-negative/u);
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/transform-many', overwrite: false,
		transforms: [{ clipId: 'clip', trackId: 'track-24', changes: { timelineStartFrame: -1 } }],
	} as AudioEditorCommand, { now: NOW }), /non-negative/u);
	assert.throws(() => prepareOverwriteClipCommand(runtime, 'clip', {
		trackId: 'track-24', changes: { timelineStartFrame: -1 },
	}), /non-negative/u);
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/overwrite', clipId: 'clip', trackId: 'track-24',
		changes: { timelineStartFrame: -1 }, splitClipIds: {}, videoEffectIds: {},
	} as AudioEditorCommand, { now: NOW }), /non-negative/u);
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/trim', clipId: 'clip', timelineStartFrame: -1,
	} as AudioEditorCommand, { now: NOW }), /non-negative/u);
	assert.deepEqual(project, before);
});

test('legacy overwrite adopts the destination sequence while preserving video extent', () => {
	const project = crossSequenceVideoProject();
	const runtime = projectForCommand(project as unknown as Record<string, unknown>);
	const command = prepareOverwriteClipCommand(runtime, 'clip', {
		trackId: 'track-30', changes: { timelineStartFrame: 5_000 },
	});
	const edited = applyEditorCommand(project, command as AudioEditorCommand, { now: NOW });
	const clip = edited.clips.find(({ id }) => id === 'clip');

	assert.ok(clip?.kind === 'video');
	assert.deepEqual(
		[clip.sequenceId, clip.sequenceStartFrame, clip.sequenceFrameCount,
			clip.sourceInFrame, clip.sourceFrameCount],
		['sequence-30', 3, 2, 4, 2],
	);
	assert.deepEqual(
		resolveRuntimeProjectProjection(edited).clips.map((value) => (
			[value.timelineStartFrame, value.timelineEndFrame]
		)),
		[[4_410, 7_350]],
	);
	assert.deepEqual(edited.tracks.map(({ id, clipIds }) => [id, clipIds]), [
		['track-24', []],
		['track-30', ['clip']],
	]);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

function crossSequenceVideoProject() {
	const sampleRate = 44_100;
	const sourceRate = { num: 24_000, den: 1_001 };
	const source = createVideoSource({
		id: 'source', frameCount: sampleRate, sampleRate,
		width: 16, height: 16, frameRate: sourceRate, sourceFrameCount: 24,
	}, sampleRate);
	const clip = createVideoClip({
		id: 'clip', sourceId: source.id, sequenceId: 'sequence-24',
		sequenceStartFrame: 2, sequenceFrameCount: 2,
		sourceInFrame: 4, sourceFrameCount: 2,
	}, {
		projectSampleRate: sampleRate,
		sequence: { id: 'sequence-24', rate: sourceRate },
		source,
	});
	return createCurrentAudioEditorProject({
		id: 'cross-sequence-command-admission', now: NOW, sampleRate,
		sequences: [
			{ id: 'sequence-24', rate: sourceRate, trackIds: ['track-24'] },
			{ id: 'sequence-30', rate: { num: 30, den: 1 }, trackIds: ['track-30'] },
		],
		primarySequenceId: 'sequence-24', sources: [source], clips: [clip],
		tracks: [
			createVideoTrack({ id: 'track-24', clipIds: ['clip'] }),
			createVideoTrack({ id: 'track-30', clipIds: [] }),
		],
	});
}
