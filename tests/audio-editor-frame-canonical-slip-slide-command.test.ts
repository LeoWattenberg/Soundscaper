/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareTransformClipsCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type {
	FrameCanonicalSlipSlidePlan,
	FrameCanonicalSlipSlideRequest,
	VideoSourceTimingView,
} from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import { planFrameCanonicalSlipSlide } from '../src/common/editor/frame-canonical-slip-slide-planner.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV15 } from '../src/common/editor/project-v15.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const SEQUENCE_RATE = Object.freeze({ num: 40_000, den: 1 });
const SOURCE_RATE = Object.freeze({ num: 24, den: 1 });
const NOW = '2026-08-11T18:30:00.000Z';

type PersistedProject = ReturnType<typeof createProject>;

const planSlipSlide = planFrameCanonicalSlipSlide as unknown as (
	project: unknown,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	request: FrameCanonicalSlipSlideRequest,
) => FrameCanonicalSlipSlidePlan;

test('incommensurate slide persistence equals every canonical preview in one undoable command', () => {
	const original = createProject();
	const projection = commandProjection(original);
	const plan = planSlipSlide(projection, timingViews(), {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(2),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.deepEqual(plan.previews.map((preview) => [
		preview.clipId,
		preview.timelineStartFrame,
		preview.timelineStartFrame + preview.durationFrames,
		preview.sourceStartFrame,
		preview.sourceStartFrame + preview.sourceDurationFrames,
	]), [
		['left-video', 0, 2, 100, 120],
		['center-video', 2, 4, 200, 210],
		['right-video', 4, 5, 310, 320],
	]);
	assert.ok(plan.transforms.every(({ sequencePlacement }) => sequencePlacement != null));

	const command = prepareTransformClipsCommand(projection, plan.transforms) as AudioEditorCommand;
	assert.equal(command.type, 'clip/transform-many');
	if (command.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
	assert.equal(command.transforms.length, 3);
	let history = executeEditorCommand(createEditorHistory(original), command, { now: NOW });
	assert.equal(history.undoStack.length, 1);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
	assert.deepEqual(canonicalState(history.present as PersistedProject), [
		['left-video', 0, 2, 100, 20],
		['center-video', 2, 1, 200, 10],
		['right-video', 3, 1, 310, 10],
	]);
	assert.deepEqual(runtimeState(history.present as PersistedProject), previewState(plan.previews));
	assertNoPersistedAliases(history.present as PersistedProject);

	const edited = canonicalState(history.present as PersistedProject);
	history = undoEditorCommand(history, { now: '2026-08-11T18:31:00.000Z' });
	assert.deepEqual(canonicalState(history.present as PersistedProject), canonicalState(original));
	assert.equal(history.undoStack.length, 0);
	assert.equal(history.redoStack.length, 1);
	history = redoEditorCommand(history, { now: '2026-08-11T18:32:00.000Z' });
	assert.deepEqual(canonicalState(history.present as PersistedProject), edited);
	assert.deepEqual(runtimeState(history.present as PersistedProject), previewState(plan.previews));
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
});

test('slip commits canonical source frames while program placement stays byte-stable through undo', () => {
	const original = createProject();
	const projection = commandProjection(original);
	const plan = planSlipSlide(projection, timingViews(), {
		mode: 'slip', activeClipId: 'center-video', requestedSourceInFrame: 202,
	});
	assert.equal(plan.kind, 'transform');
	assert.deepEqual(plan.transforms, [{
		clipId: 'center-video', trackId: 'video-track', changes: { sourceStartFrame: 202 },
	}]);
	const command = prepareTransformClipsCommand(projection, plan.transforms) as AudioEditorCommand;
	let history = executeEditorCommand(createEditorHistory(original), command, { now: NOW });
	assert.equal(history.undoStack.length, 1);
	const edited = history.present as PersistedProject;
	assert.deepEqual(canonicalState(edited), [
		['left-video', 0, 1, 100, 10],
		['center-video', 1, 1, 202, 10],
		['right-video', 2, 2, 300, 20],
	]);
	assert.deepEqual(runtimeState(edited).find(([id]) => id === 'center-video'), [
		'center-video', boundary(1), boundary(2), 202, 212,
	]);
	assertNoPersistedAliases(edited);
	history = undoEditorCommand(history, { now: '2026-08-11T18:33:00.000Z' });
	assert.deepEqual(canonicalState(history.present as PersistedProject), canonicalState(original));
});

test('tampered canonical slide placement refuses before a command can be prepared', () => {
	const project = commandProjection(createProject());
	const plan = planSlipSlide(project, timingViews(), {
		mode: 'slide', activeClipId: 'center-video', requestedStartSample: boundary(2),
	});
	assert.equal(plan.kind, 'transform');
	const tampered = plan.transforms.map((transform) => transform.clipId === 'center-video'
		? {
			...transform,
			sequencePlacement: { sequenceStartFrame: 3, sequenceFrameCount: 1 },
		}
		: transform);
	assert.throws(
		() => prepareTransformClipsCommand(project, tampered),
		/canonical|placement|sequence|alias|agree/iu,
	);
});

function createProject() {
	const source = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: SOURCE_RATE, sourceFrameCount: 1_000,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: SOURCE_RATE },
	}, SAMPLE_RATE);
	const specifications = [
		{ id: 'left-video', sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 100, sourceFrameCount: 10 },
		{ id: 'center-video', sequenceStartFrame: 1, sequenceFrameCount: 1, sourceInFrame: 200, sourceFrameCount: 10 },
		{ id: 'right-video', sequenceStartFrame: 2, sequenceFrameCount: 2, sourceInFrame: 300, sourceFrameCount: 20 },
	] as const;
	const clips = specifications.map((specification) => createVideoClipV10({
		...specification, sourceId: 'video-source', sequenceId: 'main',
	}, {
		projectSampleRate: SAMPLE_RATE,
		sequence: { id: 'main', rate: SEQUENCE_RATE },
		source,
	}));
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: specifications.map(({ id }) => id), locked: false,
	});
	return createAudioEditorProjectV15({
		id: 'incommensurate-slip-slide', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: SEQUENCE_RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main', sources: [source], clips, tracks: [track],
	});
}

function commandProjection(project: PersistedProject) {
	return projectV10ForCommand(project as unknown as Record<string, unknown>);
}

function timingViews(): ReadonlyMap<string, VideoSourceTimingView> {
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'cfr', rate: Object.freeze({ ...SOURCE_RATE }), frameCount: 1_000,
	});
	return Object.freeze(new Map([['video-source', view]]));
}

function canonicalState(project: PersistedProject) {
	return project.clips.map((clip) => [
		clip.id,
		clip.kind === 'video' ? clip.sequenceStartFrame : undefined,
		clip.kind === 'video' ? clip.sequenceFrameCount : undefined,
		clip.kind === 'video' ? clip.sourceInFrame : undefined,
		clip.kind === 'video' ? clip.sourceFrameCount : undefined,
	]);
}

function runtimeState(project: PersistedProject) {
	return resolveRuntimeProjectProjection(project).clips.map((clip) => [
		clip.id, clip.timelineStartFrame, clip.timelineEndFrame,
		clip.sourceStartFrame, clip.sourceEndFrame,
	]);
}

function previewState(previews: readonly Readonly<{
	clipId: string;
	timelineStartFrame: number;
	durationFrames: number;
	sourceStartFrame: number;
	sourceDurationFrames: number;
}>[]) {
	return previews.map((preview) => [
		preview.clipId,
		preview.timelineStartFrame,
		preview.timelineStartFrame + preview.durationFrames,
		preview.sourceStartFrame,
		preview.sourceStartFrame + preview.sourceDurationFrames,
	]);
}

function assertNoPersistedAliases(project: PersistedProject): void {
	for (const clip of project.clips) if (clip.kind === 'video') {
		for (const alias of [
			'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
		]) assert.equal(Object.hasOwn(clip, alias), false, `${clip.id}.${alias}`);
	}
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, SEQUENCE_RATE, SAMPLE_RATE, 'point');
}
