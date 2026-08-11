/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createVideoEdgeTrimService,
	type VideoEdgeTrimServiceDependencies,
} from '../src/common/editor/controller/video-edge-trim-service.ts';
import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import type { FrameCanonicalEdgeTrimRequest } from '../src/common/editor/frame-canonical-edge-trim-domain.ts';
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

const NOW = '2026-08-11T14:00:00.000Z';
type PersistedVideoProject = ReturnType<typeof createPersistedVideoProject>['project'];

test('left and right previews and commits send the same absolute request through the shared planner', () => {
	for (const request of [
		trimRequest('left', 9_600),
		trimRequest('right', 38_400),
	]) {
		const harness = createHarness();
		const expected = planFrameCanonicalEdgeTrim(harness.project(), request);
		const preview = harness.service.preview(request);
		assert.deepEqual(preview, expected);
		assert.equal(harness.commands.length, 0);

		const committed = harness.service.commit(request);
		assert.deepEqual(committed, preview);
		assert.equal(harness.commands.length, 1);
		const command = requireTransformCommand(harness.commands[0]);
		assert.deepEqual(command.transforms, preview.transforms);
		assert.equal(Object.isFrozen(preview), true);
		assert.equal(Object.isFrozen(committed), true);
	}
});

test('commit replans against the live project and never treats stale preview transforms as authority', () => {
	const harness = createHarness();
	const request = trimRequest('right', 38_400);
	const stale = harness.service.preview(request);
	assert.equal(stale.kind, 'transform');
	assert.deepEqual(stale.participantClipIds, [
		'persisted-timeline-video', 'persisted-timeline-audio',
	]);

	const unlinked = applyEditorCommand(harness.persisted, {
		type: 'clip/unlink-av', clipId: 'persisted-timeline-video',
	}, { now: NOW });
	harness.setProject(unlinked);
	const applied = harness.service.commit(request);
	assert.equal(applied.kind, 'transform');
	assert.deepEqual(applied.participantClipIds, ['persisted-timeline-video']);
	assert.notDeepEqual(applied.transforms, stale.transforms);
	assert.deepEqual(
		requireTransformCommand(harness.commands[0]).transforms.map(({ clipId }) => clipId),
		['persisted-timeline-video'],
	);
});

test('a planner no-op returns its diagnostics without committing or publishing a hidden edit', () => {
	const harness = createHarness();
	const request = trimRequest('right', 48_000);
	const expected = planFrameCanonicalEdgeTrim(harness.project(), request);
	assert.equal(expected.kind, 'noop');

	const result = harness.service.commit(request);
	assert.deepEqual(result, expected);
	assert.equal(result.kind, 'noop');
	assert.deepEqual(result.transforms, []);
	assert.equal(harness.commands.length, 0);
});

test('planning refusal propagates before command preparation and leaves the live projection untouched', () => {
	const harness = createHarness();
	const before = JSON.stringify(harness.project());
	assert.throws(() => harness.service.commit({
		activeClipId: 'missing-video', edge: 'right', requestedBoundarySample: 38_400,
	}), /active|clip|unknown/iu);
	assert.equal(harness.commands.length, 0);
	assert.equal(JSON.stringify(harness.project()), before);
});

test('blocked editing refuses commit before planning or mutation', () => {
	const harness = createHarness({ blocked: true });
	const before = JSON.stringify(harness.project());
	assert.throws(
		() => harness.service.commit(trimRequest('right', 38_400)),
		/editing.*blocked/iu,
	);
	assert.equal(harness.commands.length, 0);
	assert.equal(JSON.stringify(harness.project()), before);
});

test('one service commit persists canonical linked V14 geometry in one undoable history step', () => {
	const { project } = createPersistedVideoProject({ timeline: true });
	let history = createEditorHistory(project);
	const commands: AudioEditorCommand[] = [];
	const service = createVideoEdgeTrimService({
		lifetime: { assertActive: () => undefined },
		getProject: () => projectV10ForCommand(
			history.present as unknown as Record<string, unknown>,
		),
		editingBlocked: () => false,
		commit: (command) => {
			commands.push(command);
			history = executeEditorCommand(history, command, { now: NOW });
			return history.present;
		},
	});

	const plan = service.commit(trimRequest('right', 38_400));
	assert.equal(plan.kind, 'transform');
	assert.equal(commands.length, 1);
	assert.equal(commands[0]?.type, 'clip/transform-many');
	assert.equal(history.undoStack.length, 1);
	const edited = history.present as PersistedVideoProject;
	const video = edited.clips.find(({ id }) => id === 'persisted-timeline-video');
	assert.ok(video?.kind === 'video');
	assert.deepEqual([
		video.sequenceStartFrame, video.sequenceFrameCount,
		video.sourceInFrame, video.sourceFrameCount,
	], [0, 24, 0, 20]);
	for (const alias of [
		'timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames',
	]) assert.equal(Object.hasOwn(video, alias), false, alias);
	assert.deepEqual(resolvedEndpoints(edited), [
		['persisted-timeline-video', 0, 38_400],
		['persisted-timeline-audio', 0, 38_400],
	]);
	assert.equal(validateCurrentAudioEditorProject(edited), true);

	const editedCoordinates = coordinateState(edited);
	history = undoEditorCommand(history, { now: '2026-08-11T14:01:00.000Z' });
	assert.deepEqual(
		coordinateState(history.present as PersistedVideoProject),
		coordinateState(project),
	);
	history = redoEditorCommand(history, { now: '2026-08-11T14:02:00.000Z' });
	assert.deepEqual(coordinateState(history.present as PersistedVideoProject), editedCoordinates);
	assert.equal(validateCurrentAudioEditorProject(history.present as PersistedVideoProject), true);
});

function createHarness(options: Readonly<{ blocked?: boolean }> = {}) {
	const fixture = createPersistedVideoProject({ timeline: true });
	let persisted = fixture.project;
	let projection = projectV10ForCommand(persisted as unknown as Record<string, unknown>);
	const commands: AudioEditorCommand[] = [];
	const dependencies: VideoEdgeTrimServiceDependencies = {
		lifetime: { assertActive: () => undefined },
		getProject: () => projection,
		editingBlocked: () => options.blocked === true,
		commit: (command) => { commands.push(command); return command; },
	};
	return {
		persisted,
		commands,
		service: createVideoEdgeTrimService(dependencies),
		project: () => projection,
		setProject(value: typeof persisted) {
			persisted = value;
			projection = projectV10ForCommand(value as unknown as Record<string, unknown>);
		},
	};
}

function trimRequest(
	edge: 'left' | 'right',
	requestedBoundarySample: number,
): FrameCanonicalEdgeTrimRequest {
	return Object.freeze({
		activeClipId: 'persisted-timeline-video', edge, requestedBoundarySample,
	});
}

function requireTransformCommand(command: AudioEditorCommand | undefined): Extract<
	AudioEditorCommand,
	{ readonly type: 'clip/transform-many' }
> {
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
	return command;
}

function resolvedEndpoints(project: Parameters<typeof resolveRuntimeProjectProjection>[0]) {
	return resolveRuntimeProjectProjection(project).clips.map((clip) => [
		clip.id, clip.timelineStartFrame, clip.timelineEndFrame,
	]);
}

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
