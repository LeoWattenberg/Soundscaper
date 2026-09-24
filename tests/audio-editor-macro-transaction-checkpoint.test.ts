/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectMutationService, type MutationHistory } from '../src/common/editor/controller/document/project-mutation-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration, type EditorProjectToken } from '../src/common/editor/controller/shared/lifecycle.ts';
import {
	collapseEditorHistory, createEditorHistory, executeEditorCommand,
	rollbackEditorHistory, undoEditorCommand,
} from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

type Project = ReturnType<typeof createCurrentAudioEditorProject>;
type History = MutationHistory<Project> & Readonly<{
	limit: number;
	undoStack: readonly Readonly<{ project: Project }>[];
	dropped: number;
}>;

test('a macro transaction keeps its opening checkpoint through 210 edits', () => {
	const opening = createCurrentAudioEditorProject({ id: 'long-macro', title: 'Long macro' });
	let project = opening;
	let history = createEditorHistory(opening, { limit: 200 }) as unknown as History;
	const generation = new EditorProjectGeneration();
	generation.activate(opening.id);
	const state = {
		readOnly: false,
		history: history as History | null,
		selectedTrackId: null,
		selectedClipId: null,
		projectBinPreview: null,
	};
	const service = createProjectMutationService<Project, History, EditorProjectToken>({
		lifetime: new EditorControllerLifetime(), state,
		productName: 'Soundscaper',
		capabilities: {
			audioEffects: true, audioRecording: true, audioSpectralEditing: true,
			audioWarp: true, takeComp: true, timelineAnnotations: true,
			trackFolders: true, videoEffects: true,
		},
		projectReadOnlyMessage: 'Project is read-only.',
		assertEditingAllowed: () => undefined,
		getProject: () => project,
		setProject: (value) => { if (value) project = value; },
		getHistory: () => history,
		setHistory: (value) => { history = value; state.history = value; },
		executeEditorCommand: (value, command, options) => (
			executeEditorCommand(value, command, options) as unknown as History
		),
		applyEditorCommand: (value) => value,
		collapseEditorHistory: (value, depth, command, checkpoint) => (
			collapseEditorHistory(value, depth, command, checkpoint) as unknown as History
		),
		rollbackEditorHistory: (value, depth, options, checkpoint) => (
			rollbackEditorHistory(value, depth, options, checkpoint) as unknown as History
		),
		retention: {
			compactLiveSourceState: () => undefined,
			retainLiveClipIds: () => undefined,
			synchronizeLiveHistory: (value) => value,
		},
		publisher: { publishProjectState: () => undefined },
		saves: { scheduleAutosave: () => true, flushProject: async () => undefined },
		stopProjectBinPreview: () => undefined,
		clearWaveformPcmWindows: () => undefined,
		reconcileRecordingRouting: () => false,
		persistRecordingRouting: async () => undefined,
		findClip: (value, id) => value.clips.find((clip) => clip.id === id) ?? null,
		findTrack: (value, id) => value.tracks.find((track) => track.id === id) ?? null,
		synchronizeMicrophoneMeterTarget: () => undefined,
		synchronizeAnnotationFocus: () => undefined,
		getPlaybackState: () => 'stopped',
		projectHasTimePitchClips: () => false,
		beginPlaybackCachePreparation: async () => undefined,
		applyProjectToPlaybackEngine: async () => undefined,
		captureProject: (id) => generation.capture(id),
		assertProject: (token) => { generation.assertCurrent(token); },
		handleError: () => undefined,
		isExpectedCancellation: () => false,
	});
	const edit = () => {
		for (let index = 0; index < 210; index += 1) {
			service.commit({ type: 'track/add', track: { name: `macro-${index}` } });
		}
		assert.equal(history.undoStack.length, 200);
	};

	const failed = service.beginMacroTransaction();
	edit();
	failed.rollback();
	assert.deepEqual(project.tracks, opening.tracks, 'rollback removes every edit');
	assert.equal(history.undoStack.length, 0);

	const completed = service.beginMacroTransaction();
	edit();
	completed.commit({ type: 'macro/run', name: 'Long macro', stepCount: 210 });
	assert.equal(history.undoStack.length, 1);
	assert.deepEqual(
		(undoEditorCommand(history) as unknown as History).present.tracks,
		opening.tracks,
		'one Undo removes every edit',
	);
});
