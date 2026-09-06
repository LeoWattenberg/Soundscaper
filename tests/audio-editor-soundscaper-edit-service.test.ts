/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorEditService } from '../src/common/editor/controller/edit-service.ts';
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('empty Soundscaper undo and redo do not dirty or autosave the project', () => {
	const history = createSoundscaperProjectHistory(createSoundscaperProject({
		id: 'clean-history-project',
		title: 'Clean history project',
		now: '2026-08-31T12:00:00.000Z',
	}));
	const state = {
		history,
		videoEffectGestures: new Map(),
	};
	let projectChanges = 0;
	const handleEdit = createEditorEditService({
		editingBlocked: () => false,
		projectChanged: () => { projectChanges += 1; },
		redoEditorCommand: redoSoundscaperProjectCommand,
		state,
		undoEditorCommand: undoSoundscaperProjectCommand,
	});

	handleEdit('undo');
	handleEdit('redo');

	assert.strictEqual(state.history, history);
	assert.equal(projectChanges, 0);
});

test('Soundscaper undo and redo hand back the playhead each step was left at', () => {
	const history = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(createSoundscaperProject({
			id: 'playhead-history-project',
			title: 'Playhead history project',
			now: '2026-09-06T12:00:00.000Z',
		})),
		{ type: 'project/rename', title: 'Edited' },
		{ playheadFrame: 48_000 },
	);
	const state = { history, videoEffectGestures: new Map() };
	let positionFrame = 120_000;
	const restored: unknown[] = [];
	const handleEdit = createEditorEditService({
		editingBlocked: () => false,
		engine: { getPositionFrames: () => positionFrame },
		projectChanged: (options: { restorePlayheadFrame?: number } = {}) => {
			restored.push(options.restorePlayheadFrame);
		},
		redoEditorCommand: redoSoundscaperProjectCommand,
		state,
		undoEditorCommand: undoSoundscaperProjectCommand,
	});

	handleEdit('undo');
	assert.deepEqual(restored, [48_000], 'undo asks for the position the edit was made from');

	positionFrame = 48_000;
	handleEdit('redo');
	assert.deepEqual(restored, [48_000, 120_000], 'redo asks for the position the undo was made from');
});
