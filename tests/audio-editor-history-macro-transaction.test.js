/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_HISTORY_LIMIT,
	collapseEditorHistory,
	createEditorHistory,
	executeEditorCommand,
	rollbackEditorHistory,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const addTrack = (name) => ({ type: 'track/add', track: { name } });
const trackNames = (project) => project.tracks.map(({ name }) => name);

function historyWith(names) {
	let history = createEditorHistory(createCurrentAudioEditorProject({ id: 'project-a', title: 'Macro' }));
	for (const name of names) history = executeEditorCommand(history, addTrack(name));
	return history;
}

test('a macro collapses to one entry that undoes the whole run', () => {
	const before = historyWith(['user-a', 'user-b']);
	const depth = before.undoStack.length;
	const started = before.present;

	let history = before;
	for (const name of ['macro-1', 'macro-2', 'macro-3']) {
		history = executeEditorCommand(history, addTrack(name));
	}
	assert.equal(history.undoStack.length, depth + 3);

	const collapsed = collapseEditorHistory(history, depth, { type: 'macro/run', name: 'Restoration' });
	assert.equal(collapsed.undoStack.length, depth + 1);
	assert.deepEqual(collapsed.undoStack.at(-1).command, { type: 'macro/run', name: 'Restoration' });
	assert.deepEqual(trackNames(collapsed.present), trackNames(history.present),
		'collapsing changes the history, never the project');

	const undone = undoEditorCommand(collapsed);
	assert.deepEqual(trackNames(undone.present), trackNames(started));
	assert.equal(undone.undoStack.length, depth, 'the user\'s own history survives underneath');
});

test('a rolled-back macro leaves neither its work nor an entry behind', () => {
	const before = historyWith(['user-a']);
	const depth = before.undoStack.length;

	let history = before;
	for (const name of ['macro-1', 'macro-2']) history = executeEditorCommand(history, addTrack(name));

	const rolled = rollbackEditorHistory(history, depth);
	assert.deepEqual(trackNames(rolled.present), trackNames(before.present));
	assert.equal(rolled.undoStack.length, depth);
	assert.deepEqual(rolled.redoStack, []);
	// Undo restores a snapshot, so the restored project takes a fresh revision
	// rather than silently reusing the one the macro left behind.
	assert.equal(rolled.present.revision, history.present.revision + 1);
});

test('collapsing and rolling back a macro that committed nothing change nothing', () => {
	const history = historyWith(['user-a']);
	const depth = history.undoStack.length;
	assert.equal(collapseEditorHistory(history, depth, { type: 'macro/run' }), history);
	assert.equal(rollbackEditorHistory(history, depth), history);
	assert.throws(() => collapseEditorHistory(history, -1, { type: 'macro/run' }), /non-negative/u);
	assert.throws(() => rollbackEditorHistory(history, 1.5), /non-negative/u);
});

test('a macro longer than the history limit still collapses to its own opening', () => {
	// The stack is bounded, so a long macro pushes the entry it opened with off
	// the end. Carrying the opening project through the collapse rather than
	// looking it up is what keeps one undo correct.
	let history = historyWith(['user-a']);
	const depth = history.undoStack.length;
	const started = history.present;
	for (let index = 0; index < AUDIO_EDITOR_HISTORY_LIMIT + 10; index += 1) {
		history = executeEditorCommand(history, addTrack(`macro-${index}`));
	}
	assert.equal(history.undoStack.length, AUDIO_EDITOR_HISTORY_LIMIT);

	const collapsed = collapseEditorHistory(history, depth, { type: 'macro/run' });
	assert.equal(collapsed.undoStack.length, depth + 1);
	assert.notDeepEqual(trackNames(undoEditorCommand(collapsed).present), trackNames(started),
		'the project the macro began from is already gone, and the entry says so honestly');
});
