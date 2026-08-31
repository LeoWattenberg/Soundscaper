/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorEditService } from '../src/common/editor/controller/edit-service.ts';
import {
	createSoundscaperProjectHistory,
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
