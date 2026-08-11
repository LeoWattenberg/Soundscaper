/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createVideoRollRippleTrimService,
	type VideoRollRippleTrimServiceDependencies,
} from '../src/common/editor/controller/video-roll-ripple-trim-service.ts';
import type {
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimRequest,
} from '../src/common/editor/frame-canonical-roll-ripple-trim-domain.ts';
import { planFrameCanonicalRollRippleTrim } from '../src/common/editor/frame-canonical-roll-ripple-trim-planner.ts';
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
import { createAudioEditorProjectV16 } from '../src/common/editor/project-v16.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';

const NOW = '2026-08-11T17:00:00.000Z';
const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 24, den: 1 });

type PersistedProject = ReturnType<typeof createProject>;

test('every preview reads a fresh command projection and never commits or reports', () => {
	const harness = createHarness();
	const request = rippleRequest(22);
	const firstProject = harness.project();
	const expected = planFrameCanonicalRollRippleTrim(firstProject, request);

	assert.deepEqual(harness.service.preview(request), expected);
	assert.equal(harness.getProjectCalls(), 1);
	assert.deepEqual(harness.events, []);

	harness.setLockedTracks(['video-track']);
	assert.throws(() => harness.service.preview(request), /lock|video-track/iu);
	assert.equal(harness.getProjectCalls(), 2);
	assert.deepEqual(harness.events, []);
});

test('commit replans with live V16 locks and ignores a weakening caller predicate', () => {
	const harness = createHarness();
	const request = Object.freeze({
		...rippleRequest(22),
		isTrackLocked: () => false,
	});
	const stale = harness.service.preview(request);
	assert.equal(stale.kind, 'transform');

	harness.setLockedTracks(['video-track']);
	assert.throws(() => harness.service.commit(request), /lock|video-track/iu);
	assert.equal(harness.getProjectCalls(), 2);
	assert.deepEqual(harness.events, []);
});

test('one successful commit prepares exactly one transform-many from the live plan', () => {
	const harness = createHarness();
	const request = rippleRequest(22);
	const result = harness.service.commit(request);

	assert.equal(result.kind, 'transform');
	assert.equal(harness.getProjectCalls(), 1);
	assert.deepEqual(harness.events, ['commit:clip/transform-many', 'report:transform']);
	assert.equal(harness.commands.length, 1);
	const command = requireTransformCommand(harness.commands[0]);
	assert.deepEqual(command.transforms, result.transforms);
	assert.ok(command.transforms.length > 1, 'edge and suffix must share one command');
});

test('a no-op reports information without a command, while refusal and failed mutation report nothing', () => {
	const harness = createHarness();
	const noChange = harness.service.commit(rippleRequest(20));
	assert.equal(noChange.kind, 'noop');
	assert.deepEqual(harness.events, ['report:noop']);
	assert.deepEqual(harness.commands, []);

	harness.events.length = 0;
	assert.throws(() => harness.service.commit({
		mode: 'ripple', activeClipId: 'missing', edge: 'right',
		requestedBoundarySample: boundary(22),
	}), /active|clip|unknown/iu);
	assert.deepEqual(harness.events, []);

	const failedEvents: string[] = [];
	const failed = createVideoRollRippleTrimService({
		lifetime: { assertActive: () => undefined },
		getProject: harness.project,
		editingBlocked: () => false,
		commit: () => { throw new Error('commit failed'); },
		reportResult: (plan) => failedEvents.push(`report:${plan.kind}`),
	});
	assert.throws(() => failed.commit(rippleRequest(22)), /commit failed/u);
	assert.deepEqual(failedEvents, []);
});

test('editing and upstream project-provider failures propagate without mutation or feedback', () => {
	const harness = createHarness({ blocked: true });
	assert.throws(() => harness.service.commit(rippleRequest(22)), /editing.*blocked/iu);
	assert.equal(harness.getProjectCalls(), 0);
	assert.deepEqual(harness.events, []);

	const capabilityEvents: string[] = [];
	const capabilityError = new RangeError('Soundscaper does not support videoCompositing.');
	const unavailable = createVideoRollRippleTrimService({
		lifetime: { assertActive: () => undefined },
		getProject: () => { throw capabilityError; },
		editingBlocked: () => false,
		commit: () => capabilityEvents.push('commit'),
		reportResult: () => capabilityEvents.push('report'),
	});
	assert.throws(() => unavailable.preview(rippleRequest(22)), (error) => error === capabilityError);
	assert.throws(() => unavailable.commit(rippleRequest(22)), (error) => error === capabilityError);
	assert.deepEqual(capabilityEvents, []);
});

test('one service commit persists V16 canonical geometry in one exact undo and redo step', () => {
	const original = createProject();
	let history = createEditorHistory(original);
	const commands: AudioEditorCommand[] = [];
	const service = createVideoRollRippleTrimService({
		lifetime: { assertActive: () => undefined },
		getProject: () => commandProjection(history.present as PersistedProject),
		editingBlocked: () => false,
		commit: (command) => {
			commands.push(command);
			history = executeEditorCommand(history, command, { now: NOW });
			return history.present;
		},
	});

	const plan = service.commit(rippleRequest(22));
	assert.equal(plan.kind, 'transform');
	assert.equal(commands.length, 1);
	assert.equal(history.undoStack.length, 1);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
	assert.deepEqual(resolvedVideoRanges(history.present as Readonly<Record<string, unknown>>), [
		['active-video', boundary(10), boundary(22)],
		['suffix-video', boundary(22), boundary(27)],
	]);
	const editedCoordinates = canonicalCoordinates(history.present as PersistedProject);

	history = undoEditorCommand(history, { now: '2026-08-11T17:01:00.000Z' });
	assert.deepEqual(
		canonicalCoordinates(history.present as PersistedProject),
		canonicalCoordinates(original),
	);
	assert.equal(history.undoStack.length, 0);
	assert.equal(history.redoStack.length, 1);

	history = redoEditorCommand(history, { now: '2026-08-11T17:02:00.000Z' });
	assert.deepEqual(canonicalCoordinates(history.present as PersistedProject), editedCoordinates);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
});

test('one roll command persists one shared cut and restores both neighbors with undo', () => {
	const original = createProject();
	let history = createEditorHistory(original);
	const service = createVideoRollRippleTrimService({
		lifetime: { assertActive: () => undefined },
		getProject: () => commandProjection(history.present as PersistedProject),
		editingBlocked: () => false,
		commit: (command) => {
			history = executeEditorCommand(history, command, { now: NOW });
			return history.present;
		},
	});

	const plan = service.commit({
		mode: 'roll', activeClipId: 'active-video', edge: 'right',
		requestedBoundarySample: boundary(21),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(history.undoStack.length, 1);
	assert.deepEqual(canonicalCoordinates(history.present as PersistedProject), [
		{
			id: 'active-video', sequenceStartFrame: 10, sequenceFrameCount: 11,
			sourceInFrame: 100, sourceFrameCount: 11,
		},
		{
			id: 'suffix-video', sequenceStartFrame: 21, sequenceFrameCount: 4,
			sourceInFrame: 301, sourceFrameCount: 4,
		},
	]);
	assert.deepEqual(resolvedVideoRanges(history.present as Readonly<Record<string, unknown>>), [
		['active-video', boundary(10), boundary(21)],
		['suffix-video', boundary(21), boundary(25)],
	]);

	history = undoEditorCommand(history, { now: '2026-08-11T17:03:00.000Z' });
	assert.deepEqual(canonicalCoordinates(history.present as PersistedProject), canonicalCoordinates(original));
});

function createHarness(options: Readonly<{ blocked?: boolean }> = {}) {
	let persisted = createProject();
	let lockedTrackIds = new Set<string>();
	let projection = lockedProjection(persisted, lockedTrackIds);
	let projectReads = 0;
	const commands: AudioEditorCommand[] = [];
	const events: string[] = [];
	const dependencies: VideoRollRippleTrimServiceDependencies = {
		lifetime: { assertActive: () => undefined },
		getProject: () => {
			projectReads += 1;
			return projection;
		},
		editingBlocked: () => options.blocked === true,
		commit: (command) => {
			commands.push(command);
			events.push(`commit:${command.type}`);
			return command;
		},
		reportResult: (plan: FrameCanonicalRollRippleTrimPlan) => {
			events.push(`report:${plan.kind}`);
		},
	};
	return {
		commands,
		events,
		service: createVideoRollRippleTrimService(dependencies),
		project: () => projection,
		getProjectCalls: () => projectReads,
		setLockedTracks(trackIds: readonly string[]) {
			lockedTrackIds = new Set(trackIds);
			projection = lockedProjection(persisted, lockedTrackIds);
		},
		setProject(project: PersistedProject) {
			persisted = project;
			projection = lockedProjection(persisted, lockedTrackIds);
		},
	};
}

function createProject() {
	const source = createVideoSourceV10({
		id: 'video-source', frameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: 1_000,
	}, SAMPLE_RATE);
	const clips = [
		createVideoClipV10({
			id: 'active-video', sourceId: 'video-source', sequenceId: 'main',
			sequenceStartFrame: 10, sequenceFrameCount: 10,
			sourceInFrame: 100, sourceFrameCount: 10,
		}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE }, source }),
		createVideoClipV10({
			id: 'suffix-video', sourceId: 'video-source', sequenceId: 'main',
			sequenceStartFrame: 20, sequenceFrameCount: 5,
			sourceInFrame: 300, sourceFrameCount: 5,
		}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE }, source }),
	];
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: clips.map(({ id }) => String(id)), locked: false,
	});
	return createAudioEditorProjectV16({
		id: 'roll-ripple-service', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main', sources: [source], clips, tracks: [track],
	});
}

function lockedProjection(project: PersistedProject, lockedTrackIds: ReadonlySet<string>) {
	return projectV10ForCommand({
		...project,
		tracks: project.tracks.map((track) => ({
			...track, locked: lockedTrackIds.has(String(track.id)),
		})),
	} as unknown as Record<string, unknown>);
}

function commandProjection(project: PersistedProject) {
	return projectV10ForCommand(project as unknown as Record<string, unknown>);
}

function rippleRequest(boundaryFrame: number): FrameCanonicalRollRippleTrimRequest {
	return Object.freeze({
		mode: 'ripple', activeClipId: 'active-video', edge: 'right',
		requestedBoundarySample: boundary(boundaryFrame),
	});
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, RATE, SAMPLE_RATE, 'point');
}

function requireTransformCommand(command: AudioEditorCommand | undefined): Extract<
	AudioEditorCommand,
	{ readonly type: 'clip/transform-many' }
> {
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
	return command;
}

function resolvedVideoRanges(project: Readonly<Record<string, unknown>>) {
	return resolveRuntimeProjectProjection(project).clips.map((clip) => [
		clip.id, clip.timelineStartFrame, clip.timelineEndFrame,
	]);
}

function canonicalCoordinates(project: PersistedProject) {
	return project.clips.map((clip) => ({
		id: clip.id,
		sequenceStartFrame: clip.kind === 'video' ? clip.sequenceStartFrame : undefined,
		sequenceFrameCount: clip.kind === 'video' ? clip.sequenceFrameCount : undefined,
		sourceInFrame: clip.kind === 'video' ? clip.sourceInFrame : undefined,
		sourceFrameCount: clip.kind === 'video' ? clip.sourceFrameCount : undefined,
	}));
}
