/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EditorProjectGeneration,
	type EditorProjectToken,
} from '../src/common/editor/controller/shared/lifecycle.ts';
import {
	createProjectMutationService,
	type MutationHistory,
	type MutationProject,
} from '../src/common/editor/controller/document/project-mutation-service.ts';

interface FenceTrack {
	readonly id: string;
	readonly type: string;
}

interface FenceProject extends MutationProject<FenceTrack> {
	readonly clips: readonly Readonly<{ readonly id: string }>[];
}

interface FenceHistory extends MutationHistory<FenceProject> {
	readonly undoStack: readonly Readonly<{ project: FenceProject }>[];
}

interface FenceRouting {
	readonly routes: Readonly<Record<string, unknown>>;
}

test('a macro rollback cannot revert the project a switch put in its place', () => {
	// The macro opened against project A at depth 5. While it awaited its effect
	// run the user opened project B, whose deeper undo stack would be truncated
	// back to 5 entries — and autosaved that way — if the transaction settled
	// against whatever history is current instead of the one it opened.
	const fixture = fenceFixture();
	const transaction = fixture.service.beginMacroTransaction();
	assert.equal(transaction.depth, 5);

	const switched = fixture.switchProject('project-b', 8);
	assert.throws(() => transaction.rollback(), /active editor project changed/u);

	assert.equal(fixture.currentHistory(), switched, 'the switched-in history is left as it was');
	assert.equal(switched.undoStack.length, 8);
	assert.deepEqual(fixture.events, [], 'nothing is published, compacted or autosaved');
});

test('a macro commit cannot collapse the project a switch put in its place', () => {
	const fixture = fenceFixture();
	const transaction = fixture.service.beginMacroTransaction();

	const switched = fixture.switchProject('project-b', 8);
	assert.throws(
		() => transaction.commit({ type: 'macro/run', name: 'Cleanup', stepCount: 2 }),
		/active editor project changed/u,
	);
	// Both macro callers roll back in the catch that a refused commit lands in,
	// so that second settlement has to be refused for the same reason rather
	// than reported as an internal double settlement.
	assert.throws(() => transaction.rollback(), /active editor project changed/u);

	assert.equal(fixture.currentHistory(), switched);
	assert.equal(switched.undoStack.length, 8);
	assert.deepEqual(fixture.events, []);
});

test('a macro still settles into the project it opened against', () => {
	const fixture = fenceFixture();
	const transaction = fixture.service.beginMacroTransaction();

	transaction.commit({ type: 'macro/run', name: 'Cleanup', stepCount: 2 });

	assert.equal(fixture.currentHistory().undoStack.length, 5);
	assert.deepEqual(fixture.events, ['history', 'project', 'compact', 'autosave']);
	assert.throws(() => transaction.rollback(), /settles exactly once/u);
});

function projectFixture(id: string): FenceProject {
	return {
		id,
		tracks: [{ id: `${id}-track`, type: 'audio' }],
		clips: [{ id: `${id}-clip` }],
	};
}

function historyFixture(project: FenceProject, entries: number): FenceHistory {
	return {
		present: project,
		dropped: 0,
		undoStack: Array.from({ length: entries }, () => ({ project })),
	};
}

function fenceFixture() {
	const generation = new EditorProjectGeneration();
	const events: string[] = [];
	let project = projectFixture('project-a');
	let history = historyFixture(project, 5);
	generation.activate(project.id);
	const state = {
		readOnly: false,
		history: history as FenceHistory | null,
		selectedTrackId: null as string | null,
		selectedClipId: null as string | null,
		projectBinPreview: null as unknown,
		recordingRouting: { routes: {} } as FenceRouting,
		recordingRouteHealth: {} as Record<string, string>,
	};
	const service = createProjectMutationService<FenceProject, FenceHistory, EditorProjectToken>({
		lifetime: { capture: () => ({ generation: 1 }), assertActive: () => undefined },
		state,
		productName: 'Test editor',
		capabilities: {
			audioEffects: true, audioRecording: true, audioSpectralEditing: true,
			audioWarp: true, takeComp: true, timelineAnnotations: true,
			trackFolders: true, videoEffects: true,
		},
		projectReadOnlyMessage: 'Project is read-only.',
		assertEditingAllowed: () => undefined,
		getProject: () => project,
		setProject: (value) => { if (value) project = value; events.push('project'); },
		getHistory: () => history,
		setHistory: (value) => { history = value; state.history = value; events.push('history'); },
		executeEditorCommand: (value) => value,
		applyEditorCommand: (value) => value,
		collapseEditorHistory: (value, depth) => ({ ...value, undoStack: value.undoStack.slice(0, depth) }),
		rollbackEditorHistory: (value, depth) => ({
			...value,
			present: value.undoStack[depth]?.project ?? value.present,
			undoStack: value.undoStack.slice(0, depth),
		}),
		retention: {
			compactLiveSourceState: () => { events.push('compact'); },
			retainLiveClipIds: () => undefined,
			synchronizeLiveHistory: (value) => value,
		},
		publisher: { publishProjectState: () => undefined },
		saves: {
			scheduleAutosave: () => { events.push('autosave'); return true; },
			flushProject: async () => undefined,
		},
		stopProjectBinPreview: () => undefined,
		clearWaveformPcmWindows: () => undefined,
		reconcileRecordingRouting: () => false,
		persistRecordingRouting: async () => undefined,
		findClip: (value, clipId) => value.clips.find((clip) => clip.id === clipId) ?? null,
		findTrack: (value, trackId) => value.tracks.find((track) => track.id === trackId) ?? null,
		synchronizeMicrophoneMeterTarget: () => undefined,
		synchronizeAnnotationFocus: () => undefined,
		getPlaybackState: () => 'stopped',
		projectHasTimePitchClips: () => false,
		beginPlaybackCachePreparation: async () => undefined,
		applyProjectToPlaybackEngine: async () => undefined,
		captureProject: (projectId) => generation.capture(projectId),
		assertProject: (token) => { generation.assertCurrent(token); },
		handleError: () => undefined,
		isExpectedCancellation: (error) => error instanceof Error && error.name === 'AbortError',
	});
	return {
		service,
		events,
		currentHistory: () => history,
		/** What a project switch does to the one history slot the controller owns. */
		switchProject(id: string, entries: number): FenceHistory {
			project = projectFixture(id);
			history = historyFixture(project, entries);
			state.history = history;
			generation.activate(id);
			events.length = 0;
			return history;
		},
	};
}
