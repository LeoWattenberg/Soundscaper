/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collapseEditorHistory,
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	rollbackEditorHistory,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const LIMIT = 4;

/** The shared history, typed only as far as this test reads it. */
interface SharedHistory {
	readonly limit: number;
	readonly present: { readonly tracks: readonly { readonly name: string }[]; readonly revision: number };
	readonly undoStack: readonly { readonly command: unknown }[];
	readonly redoStack: readonly unknown[];
	readonly dropped?: number;
}

/**
 * Where a macro opens, read the way the macro transaction reads it
 * (src/common/editor/controller/project-mutation-service.ts): a position in the
 * whole sequence of commits rather than an index into the bounded stack.
 */
function macroDepth(history: SharedHistory): number {
	return (history.dropped ?? 0) + history.undoStack.length;
}

function trackNames(history: SharedHistory): readonly string[] {
	return history.present.tracks.map(({ name }) => name);
}

function commit(history: SharedHistory, name: string): SharedHistory {
	return executeEditorCommand(history, { type: 'track/add', track: { name } }) as SharedHistory;
}

function historyWith(names: readonly string[]): SharedHistory {
	let history = createEditorHistory(
		createCurrentAudioEditorProject({ id: 'macro-bounded-project', title: 'Macro bounded' }),
		{ limit: LIMIT },
	) as SharedHistory;
	for (const name of names) history = commit(history, name);
	return history;
}

test('a macro that opens on a full undo stack still collapses to one entry', () => {
	const before = historyWith(['user-a', 'user-b', 'user-c', 'user-d']);
	assert.equal(before.undoStack.length, LIMIT, 'the stack is at its limit before the macro runs');
	const depth = macroDepth(before);
	const started = trackNames(before);

	let history = before;
	for (const name of ['macro-1', 'macro-2']) history = commit(history, name);
	assert.equal(history.undoStack.length, LIMIT, 'the macro pushed the oldest entries off the end');

	const collapsed = collapseEditorHistory(
		history, depth, { type: 'macro/run', name: 'Restoration' },
	) as SharedHistory;
	assert.deepEqual(trackNames(collapsed), trackNames(history), 'collapsing changes the history, never the project');
	assert.equal(collapsed.undoStack.length, LIMIT - 1, 'the two macro entries became one');
	assert.deepEqual(collapsed.undoStack.at(-1)?.command, { type: 'macro/run', name: 'Restoration' });

	const undone = undoEditorCommand(collapsed) as SharedHistory;
	assert.deepEqual(trackNames(undone), started, 'one undo reverts the whole macro');
	assert.equal(undone.undoStack.length, LIMIT - 2, 'the user\'s own surviving history is untouched');
});

test('a macro that opens on a full undo stack rolls back to the project it began from', () => {
	const before = historyWith(['user-a', 'user-b', 'user-c', 'user-d']);
	const depth = macroDepth(before);
	const started = trackNames(before);

	let history = before;
	for (const name of ['macro-1', 'macro-2']) history = commit(history, name);

	const rolled = rollbackEditorHistory(history, depth) as SharedHistory;
	assert.deepEqual(trackNames(rolled), started, 'the work the macro applied is gone');
	assert.equal(rolled.undoStack.length, LIMIT - 2, 'and so are the entries it committed');
	assert.deepEqual(rolled.redoStack, []);
	assert.equal(rolled.present.revision, history.present.revision + 1);
});

test('a macro that fills the last free slot rolls back past its own steps', () => {
	const before = historyWith(['user-a', 'user-b', 'user-c']);
	assert.equal(before.undoStack.length, LIMIT - 1, 'one slot short of the limit');
	const depth = macroDepth(before);
	const started = trackNames(before);

	let history = before;
	for (const name of ['macro-1', 'macro-2', 'macro-3']) history = commit(history, name);

	const rolled = rollbackEditorHistory(history, depth) as SharedHistory;
	assert.deepEqual(trackNames(rolled), started, 'rollback restores the pre-macro project, not a mid-macro one');
	assert.equal(rolled.undoStack.length, LIMIT - 3);
});

test('the history counts what the limit pushed off the bottom', () => {
	const before = historyWith(['user-a', 'user-b', 'user-c', 'user-d', 'user-e', 'user-f']);
	assert.equal(before.undoStack.length, LIMIT);
	assert.equal(before.dropped, 2, 'two commits no longer have a slot');
	assert.equal(macroDepth(before), 6, 'the sequence still counts every commit');

	const undone = undoEditorCommand(before) as SharedHistory;
	assert.equal(undone.dropped, 2, 'undoing does not drop anything further');
	assert.equal(macroDepth(undone), 5, 'an undo takes one commit back off the sequence');

	const redone = redoEditorCommand(undone) as SharedHistory;
	assert.equal(redone.dropped, 2);
	assert.equal(macroDepth(redone), 6, 'and redo puts it back');
});
