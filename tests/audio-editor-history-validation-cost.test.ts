/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	cloneEditorProjectHistory,
	createEditorProjectHistory,
	executeEditorProjectCommand,
	redoEditorProjectCommand,
	undoEditorProjectCommand,
	validateEditorProjectHistory,
	type EditorHistoryDocument,
	type EditorProjectHistoryRevision,
	type EditorProjectHistoryState,
} from '../src/common/editor/project-history-mechanics.ts';

interface CountingCommand {
	readonly type: string;
}

interface Counts {
	validated: number;
}

const DEPTH = 3;

function document(revision: number): EditorHistoryDocument {
	return { id: 'cost-document', revision, updatedAt: '2026-09-05T09:00:00.000Z' };
}

function revisionFor(counts: Counts): EditorProjectHistoryRevision<CountingCommand> {
	return {
		label: 'Counting',
		validateProject: (project) => {
			counts.validated += 1;
			if (!project || typeof project !== 'object') throw new TypeError('A counting document is required.');
		},
		cloneProject: (project) => structuredClone(project) as EditorHistoryDocument,
		snapshotCommand: (command) => ({ type: String((command as CountingCommand).type) }),
		applyCommand: (project) => ({ ...project, revision: Number(project.revision) + 1 }),
	};
}

/** A history whose stacks are deep enough that walking them is visible in the count. */
function deepHistory(counts: Counts): EditorProjectHistoryState<CountingCommand> {
	let history = createEditorProjectHistory(document(0), revisionFor(counts), 200);
	for (let index = 0; index < DEPTH; index += 1) {
		history = executeEditorProjectCommand(history, { type: `edit-${String(index)}` }, revisionFor(counts), {});
	}
	for (let index = 0; index < DEPTH; index += 1) {
		history = undoEditorProjectCommand(history, revisionFor(counts), {});
	}
	for (let index = 0; index < DEPTH; index += 1) {
		history = redoEditorProjectCommand(history, revisionFor(counts), {});
	}
	assert.equal(history.undoStack.length, DEPTH, 'the undo stack is deep');
	assert.equal(history.redoStack.length, 0);
	// Undo once more so both stacks hold entries a full validation would walk.
	history = undoEditorProjectCommand(history, revisionFor(counts), {});
	assert.equal(history.redoStack.length, 1);
	return history;
}

test('a command validates the present document, not the whole stack behind it', () => {
	const counts: Counts = { validated: 0 };
	const history = deepHistory(counts);

	counts.validated = 0;
	executeEditorProjectCommand(history, { type: 'edit' }, revisionFor(counts), {});
	assert.equal(counts.validated, 1, 'one execute validates the present document once');

	counts.validated = 0;
	const undone = undoEditorProjectCommand(history, revisionFor(counts), {});
	assert.equal(counts.validated, 2, 'undo validates the present document and the one it restores');

	counts.validated = 0;
	redoEditorProjectCommand(undone, revisionFor(counts), {});
	assert.equal(counts.validated, 2, 'so does redo');
});

test('reading a stored history still validates every entry in it', () => {
	const counts: Counts = { validated: 0 };
	const history = deepHistory(counts);
	const entries = history.undoStack.length + history.redoStack.length;

	counts.validated = 0;
	validateEditorProjectHistory(history, revisionFor(counts));
	assert.equal(counts.validated, entries + 1, 'the present document and every entry');

	counts.validated = 0;
	cloneEditorProjectHistory(history, revisionFor(counts));
	assert.equal(counts.validated, entries + 1, 'cloning validates what it is copying');

	counts.validated = 0;
	createEditorProjectHistory(document(0), revisionFor(counts), 200);
	assert.equal(counts.validated, 1, 'creating validates the document it opens on');
});

test('a command still refuses a history whose present document is invalid', () => {
	const counts: Counts = { validated: 0 };
	const history = deepHistory(counts);
	const broken = { ...history, present: null } as unknown as EditorProjectHistoryState<CountingCommand>;
	assert.throws(() => executeEditorProjectCommand(broken, { type: 'edit' }, revisionFor(counts), {}),
		/counting document/iu);
	assert.throws(() => undoEditorProjectCommand(broken, revisionFor(counts), {}), /counting document/iu);
});

test('a command still refuses a history whose stacks are not bounded arrays', () => {
	const counts: Counts = { validated: 0 };
	const history = deepHistory(counts);
	const broken = { ...history, undoStack: 'not a stack' } as unknown as EditorProjectHistoryState<CountingCommand>;
	assert.throws(() => executeEditorProjectCommand(broken, { type: 'edit' }, revisionFor(counts), {}),
		/undoStack/u);
	const overfull = { ...history, limit: 1 } as unknown as EditorProjectHistoryState<CountingCommand>;
	assert.throws(() => executeEditorProjectCommand(overfull, { type: 'edit' }, revisionFor(counts), {}),
		/undoStack/u);
});
