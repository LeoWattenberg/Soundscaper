/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectHistoryRetime as cloneHistory,
	createFramescaperProjectHistoryRetime as createHistory,
	executeFramescaperProjectCommandRetime as execute,
	redoFramescaperProjectCommandRetime as redo,
	undoFramescaperProjectCommandRetime as undo,
	validateFramescaperProjectHistoryRetime as validate,
} from '../src/framescaper/editor-project-retime-history.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';

type Data = Record<string, unknown>;

const RENAME = Object.freeze({ type: 'project/rename', title: 'Renamed' });
const OPTIONS = Object.freeze({ now: new Date('2026-01-01T00:00:00.000Z') });

function history(): Data {
	return createHistory(
		PROFILE,
		createFramescaperProjectRetime(PROFILE, {} as never) as never,
	) as unknown as Data;
}

function stacks(value: Data): Readonly<{ undo: number; redo: number; title: unknown }> {
	return {
		undo: (value.undoStack as unknown[]).length,
		redo: (value.redoStack as unknown[]).length,
		title: (value.present as Data).title,
	};
}

test('a fresh history holds the project with both stacks empty', () => {
	const initial = history();

	assert.deepEqual(Object.keys(initial), ['limit', 'present', 'undoStack', 'redoStack']);
	assert.deepEqual(stacks(initial), { undo: 0, redo: 0, title: 'Untitled project' });
});

test('a history validates against its own runtime profile', () => {
	assert.doesNotThrow(() => validate(PROFILE, history() as never));
	assert.throws(() => validate({}, history() as never), TypeError);
	assert.throws(() => validate(PROFILE, {} as never), /history\.limit is required/u);
});

test('cloning a history reproduces it without sharing structure', () => {
	const initial = history();

	const copy = cloneHistory(PROFILE, initial as never) as unknown as Data;

	assert.deepEqual(copy, initial);
	assert.notEqual(copy, initial);
	assert.notEqual(copy.present, initial.present);
});

test('executing a command advances the present and records one undo step', () => {
	const executed = execute(
		PROFILE, history() as never, RENAME as never, OPTIONS as never,
	) as unknown as Data;

	assert.deepEqual(stacks(executed), { undo: 1, redo: 0, title: 'Renamed' });
});

test('undo restores the previous present and offers the command for redo', () => {
	const executed = execute(PROFILE, history() as never, RENAME as never, OPTIONS as never);

	const undone = undo(PROFILE, executed as never) as unknown as Data;

	assert.deepEqual(stacks(undone), { undo: 0, redo: 1, title: 'Untitled project' });
});

test('redo reapplies the undone command and returns it to the undo stack', () => {
	const executed = execute(PROFILE, history() as never, RENAME as never, OPTIONS as never);
	const undone = undo(PROFILE, executed as never);

	const redone = redo(PROFILE, undone as never) as unknown as Data;

	assert.deepEqual(stacks(redone), { undo: 1, redo: 0, title: 'Renamed' });
});

test('history navigation advances the revision rather than rewinding it', () => {
	const initial = history();
	const executed = execute(
		PROFILE, initial as never, RENAME as never, OPTIONS as never,
	) as unknown as Data;
	const undone = undo(PROFILE, executed as never) as unknown as Data;
	const redone = redo(PROFILE, undone as never) as unknown as Data;

	const revision = (value: Data): number => Number((value.present as Data).revision);

	assert.equal(revision(executed), revision(initial) + 1);
	assert.equal(revision(undone), revision(executed) + 1);
	assert.equal(
		revision(redone),
		revision(undone) + 1,
		'undo and redo are themselves recorded revisions, so a redone project is '
		+ 'never byte-identical to the one it reproduces',
	);
	assert.equal((redone.present as Data).title, (executed.present as Data).title);
});

test('undo and redo at the ends of the stack leave the history unchanged', () => {
	const initial = history();

	assert.deepEqual(undo(PROFILE, initial as never), initial);
	assert.deepEqual(redo(PROFILE, initial as never), initial);
});

test('executing a new command discards a pending redo branch', () => {
	const executed = execute(PROFILE, history() as never, RENAME as never, OPTIONS as never);
	const undone = undo(PROFILE, executed as never);

	const branched = execute(
		PROFILE, undone as never, { type: 'project/rename', title: 'Other' } as never, OPTIONS as never,
	) as unknown as Data;

	assert.deepEqual(stacks(branched), { undo: 1, redo: 0, title: 'Other' });
});
