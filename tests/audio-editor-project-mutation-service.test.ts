/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createProjectMutationService,
	type MutationHistory,
	type MutationProject,
} from '../src/common/editor/controller/project-mutation-service.ts';

interface TestTrack {
	readonly id: string;
	readonly type: string;
}

interface TestProject extends MutationProject<TestTrack> {
	readonly revision: number;
	readonly clips: readonly Readonly<{ id: string }>[];
}

interface TestHistory extends MutationHistory<TestProject> {
	readonly undo: readonly string[];
}

interface TestRouting {
	readonly routes: Readonly<Record<string, unknown>>;
}

test('commit executes one atomic history transition before project publication and autosave', () => {
	const initial = projectFixture(1);
	let project: TestProject | null = initial;
	let history: TestHistory = { present: initial, undo: [] };
	const events: string[] = [];
	const fixture = mutationFixture({
		getProject: () => project,
		setProject: (value) => { project = value; events.push(`project:${value?.revision ?? 'null'}`); },
		getHistory: () => history,
		setHistory: (value) => { history = value; events.push('history'); },
		executeHistory(value, command) {
			assert.equal(command.type, 'batch');
			return { present: projectFixture(2), undo: [...value.undo, command.type] };
		},
		compact: () => { events.push('compact'); },
		publish: () => { events.push('publish'); },
		autosave: () => { events.push('autosave'); return true; },
	});

	const result = fixture.service.commit({
		type: 'batch',
		commands: [{ type: 'project/rename', title: 'Changed' }],
	}, { selectTrackId: 'track-b', selectClipId: 'clip-b' });

	assert.equal(result.revision, 2);
	assert.equal(fixture.state.selectedTrackId, 'track-a', 'missing track selection falls back to the first track');
	assert.equal(fixture.state.selectedClipId, null);
	assert.deepEqual(history.undo, ['batch']);
	assert.deepEqual(events.slice(0, 5), ['history', 'project:2', 'compact', 'publish', 'autosave']);
});

test('selection updates replace only history.present and do not autosave or compact', () => {
	const initial = projectFixture(1);
	const selected = projectFixture(2);
	let history: TestHistory = { present: initial, undo: ['existing'] };
	let published = 0;
	let autosaves = 0;
	let compacted = 0;
	let annotationSynchronizations = 0;
	const fixture = mutationFixture({
		getProject: () => history.present,
		setProject: () => undefined,
		getHistory: () => history,
		setHistory: (value) => { history = value; },
		applyCommand: (_project, command) => {
			assert.equal(command.type, 'selection/set');
			return selected;
		},
		publish: () => { published += 1; },
		autosave: () => { autosaves += 1; return true; },
		compact: () => { compacted += 1; },
		synchronizeAnnotationFocus: () => { annotationSynchronizations += 1; },
	});

	assert.equal(fixture.service.updateSelection({
		type: 'selection/set', startFrame: 10, endFrame: 20,
	}), selected);
	assert.deepEqual(history, { present: selected, undo: ['existing'] });
	assert.equal(published, 1);
	assert.equal(autosaves, 0);
	assert.equal(compacted, 0);
	assert.equal(annotationSynchronizations, 1);
});

test('read-only mutation fails before command execution', () => {
	let executed = 0;
	const fixture = mutationFixture({
		readOnly: true,
		executeHistory: (history) => { executed += 1; return history; },
	});
	assert.throws(
		() => fixture.service.commit({ type: 'project/rename', title: 'Blocked' }),
		/Project is read-only\./u,
	);
	assert.throws(
		() => fixture.service.updateSelection({ type: 'selection/set', startFrame: 0, endFrame: 0 }),
		/Project is read-only\./u,
	);
	assert.equal(executed, 0);
});

test('projectChanged normalizes routing, prunes stale selections, and owns publication order', async () => {
	const project = projectFixture(1);
	const normalized: TestRouting = { routes: { 'track-a': { kind: 'device' } } };
	const events: string[] = [];
	let persisted = 0;
	const fixture = mutationFixture({
		project,
		selectedTrackId: 'missing-track',
		selectedClipId: 'missing-clip',
		routing: { routes: { missing: {} } },
		normalizeRouting: () => normalized,
		persistRouting: async () => { persisted += 1; },
		compact: () => { events.push('compact'); },
		retainClips: () => { events.push('retain'); },
		publish: () => { events.push('publish'); },
		autosave: () => { events.push('autosave'); return true; },
	});
	fixture.state.recordingRouteHealth.missing = 'open';

	fixture.service.projectChanged({ skipPlaybackEngine: true });
	await Promise.resolve();

	assert.equal(fixture.state.selectedTrackId, 'track-a');
	assert.equal(fixture.state.selectedClipId, null);
	assert.equal(fixture.state.recordingRouteHealth.missing, undefined);
	assert.equal(fixture.state.recordingRouting, normalized);
	assert.equal(persisted, 1);
	assert.deepEqual(events, ['compact', 'retain', 'publish', 'autosave']);
});

test('projectChanged synchronizes ephemeral timeline annotation focus before publication', () => {
	const events: string[] = [];
	const fixture = mutationFixture({
		synchronizeAnnotationFocus: () => { events.push('annotations'); },
		publish: () => { events.push('publish'); },
	});

	fixture.service.projectChanged({ skipPlaybackEngine: true });
	assert.deepEqual(events, ['annotations', 'publish']);
});

test('superseded playback preparation cannot apply or report an expected cancellation', async () => {
	const first = projectFixture(1);
	const second = { ...projectFixture(2), id: 'other' };
	let project: TestProject | null = first;
	let resolvePreparation!: () => void;
	const preparation = new Promise<void>((resolve) => { resolvePreparation = resolve; });
	let generation = 1;
	let applied = 0;
	let handled = 0;
	const fixture = mutationFixture({
		getProject: () => project,
		setProject: (value) => { project = value; },
		playing: true,
		hasTimePitch: true,
		beginPlaybackPreparation: () => preparation,
		applyPlayback: async () => { applied += 1; },
		captureProject: (projectId) => ({ projectId, generation }),
		assertProject: (token) => {
			if (token.generation !== generation || token.projectId !== project?.id) {
				throw Object.assign(new Error('Project changed'), { name: 'AbortError' });
			}
		},
		handleError: () => { handled += 1; },
	});

	fixture.service.projectChanged();
	project = second;
	generation += 1;
	resolvePreparation();
	await settleMicrotasks();

	assert.equal(applied, 0);
	assert.equal(handled, 0);
});

test('save aliases delegate to the single serialized project save service', async () => {
	let scheduled = 0;
	let flushed = 0;
	const fixture = mutationFixture({
		autosave: () => { scheduled += 1; return true; },
		flush: async () => { flushed += 1; return 'saved'; },
	});
	assert.equal(fixture.service.scheduleAutosave(), true);
	assert.equal(await fixture.service.saveNow(), 'saved');
	assert.equal(await fixture.service.flushProject(), 'saved');
	assert.equal(scheduled, 1);
	assert.equal(flushed, 2);
});

interface FixtureOverrides {
	readonly project?: TestProject;
	readonly readOnly?: boolean;
	readonly selectedTrackId?: string | null;
	readonly selectedClipId?: string | null;
	readonly routing?: TestRouting;
	readonly playing?: boolean;
	readonly hasTimePitch?: boolean;
	readonly getProject?: () => TestProject | null;
	readonly setProject?: (project: TestProject | null) => void;
	readonly getHistory?: () => TestHistory;
	readonly setHistory?: (history: TestHistory) => void;
	readonly executeHistory?: (history: TestHistory, command: AudioEditorCommand) => TestHistory;
	readonly applyCommand?: (project: TestProject, command: AudioEditorCommand) => TestProject;
	readonly compact?: () => void;
	readonly retainClips?: () => void;
	readonly publish?: () => void;
	readonly autosave?: () => boolean;
	readonly flush?: () => Promise<unknown>;
	readonly normalizeRouting?: (
		routing: TestRouting,
		tracks: readonly Readonly<{ id: string }>[],
	) => TestRouting;
	readonly persistRouting?: () => Promise<unknown>;
	readonly beginPlaybackPreparation?: (project: TestProject) => Promise<unknown>;
	readonly applyPlayback?: (project: TestProject) => Promise<unknown>;
	readonly captureProject?: (projectId: string) => Readonly<{ projectId: string; generation: number }>;
	readonly assertProject?: (token: Readonly<{ projectId: string; generation: number }>) => void;
	readonly handleError?: (error: unknown) => void;
	readonly synchronizeAnnotationFocus?: () => void;
}

function mutationFixture(overrides: FixtureOverrides = {}) {
	let project = overrides.project || projectFixture(1);
	let history: TestHistory = { present: project, undo: [] };
	const state = {
		readOnly: overrides.readOnly || false,
		history,
		selectedTrackId: overrides.selectedTrackId ?? null,
		selectedClipId: overrides.selectedClipId ?? null,
		projectBinPreview: null,
		recordingRouting: overrides.routing || { routes: {} },
		recordingRouteHealth: {} as Record<string, string>,
	};
	const getHistory = overrides.getHistory || (() => history);
	const setHistory = overrides.setHistory || ((value: TestHistory) => { history = value; state.history = value; });
	const getProject = overrides.getProject || (() => project);
	const setProject = overrides.setProject || ((value: TestProject | null) => { if (value) project = value; });
	const service = createProjectMutationService<TestProject, TestHistory, TestRouting, Readonly<{ projectId: string; generation: number }>>({
		lifetime: {
			capture: () => ({ generation: 1 }),
			assertActive: () => undefined,
		},
		state,
		productName: 'Test editor',
		capabilities: {
			audioEffects: true, audioRecording: true, audioSpectralEditing: true,
			timelineAnnotations: true, videoEffects: true,
		},
		projectReadOnlyMessage: 'Project is read-only.',
		getProject,
		setProject,
		getHistory,
		setHistory,
		executeEditorCommand: overrides.executeHistory || ((value) => value),
		applyEditorCommand: overrides.applyCommand || ((value) => value),
		retention: {
			compactLiveSourceState: overrides.compact || (() => undefined),
			retainLiveClipIds: overrides.retainClips || (() => undefined),
		},
		publisher: { publishProjectState: overrides.publish || (() => undefined) },
		saves: {
			scheduleAutosave: overrides.autosave || (() => true),
			flushProject: overrides.flush || (async () => undefined),
		},
		stopProjectBinPreview: () => undefined,
		clearWaveformPcmWindows: () => undefined,
		normalizeRecordingRouting: overrides.normalizeRouting || ((value) => value),
		persistRecordingRouting: overrides.persistRouting || (async () => undefined),
		findClip: (value, clipId) => value.clips.find((clip) => clip.id === clipId) || null,
		findTrack: (value, trackId) => value.tracks.find((track) => track.id === trackId) || null,
		synchronizeMicrophoneMeterTarget: () => undefined,
		synchronizeAnnotationFocus: overrides.synchronizeAnnotationFocus || (() => undefined),
		getPlaybackState: () => overrides.playing ? 'playing' : 'stopped',
		projectHasTimePitchClips: () => overrides.hasTimePitch || false,
		beginPlaybackCachePreparation: overrides.beginPlaybackPreparation || (async () => undefined),
		applyProjectToPlaybackEngine: overrides.applyPlayback || (async () => undefined),
		captureProject: overrides.captureProject || ((projectId) => ({ projectId, generation: 1 })),
		assertProject: overrides.assertProject || (() => undefined),
		handleError: overrides.handleError || (() => undefined),
		isExpectedCancellation: (error) => error instanceof Error && error.name === 'AbortError',
	});
	return { service, state };
}

function projectFixture(revision: number): TestProject {
	return {
		id: 'project',
		revision,
		tracks: [{ id: 'track-a', type: 'audio' }],
		clips: [{ id: 'clip-a' }],
	};
}

async function settleMicrotasks(): Promise<void> {
	for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
