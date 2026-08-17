/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';
import { applySoundscaperProjectCommandV23 } from '../src/soundscaper/editor-project-v23-commands.ts';
import {
	createSoundscaperProjectHistoryV23,
	executeSoundscaperProjectCommandV23,
	redoSoundscaperProjectCommandV23,
	undoSoundscaperProjectCommandV23,
} from '../src/soundscaper/editor-project-v23-history.ts';

const NOW = '2026-08-17T00:00:00.000Z';

function project() {
	const base = createSoundscaperProjectV23({
		id: 'v23', title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	return createSoundscaperProjectV23({
		id: 'v23', title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
		masteringSequences: [{
			id: 'album', sequenceId: base.primarySequenceId, name: 'Album order',
			entries: [{ id: 'e1', annotationId: 'a' }, { id: 'e2', annotationId: 'b' }],
		}],
	} as never);
}

const entryIds = (value: { masteringSequences: readonly { entries: readonly { id: string }[] }[] }) => (
	value.masteringSequences[0].entries.map((entry) => entry.id)
);

test('a mastering-sequence command is one undo step, and undo restores the order', () => {
	let history = createSoundscaperProjectHistoryV23(project());
	assert.deepEqual(entryIds(history.present), ['e1', 'e2']);

	history = executeSoundscaperProjectCommandV23(history, {
		type: 'mastering-sequence/entry-reorder', sequenceId: 'album', entryId: 'e2', toIndex: 0,
	} as never, { now: NOW });
	assert.deepEqual(entryIds(history.present), ['e2', 'e1']);
	assert.equal(history.undoStack.length, 1);
	assert.equal(history.redoStack.length, 0);

	history = undoSoundscaperProjectCommandV23(history, { now: NOW });
	assert.deepEqual(entryIds(history.present), ['e1', 'e2'], 'the authored order comes back');
	assert.equal(history.undoStack.length, 0);
	assert.equal(history.redoStack.length, 1);

	history = redoSoundscaperProjectCommandV23(history, { now: NOW });
	assert.deepEqual(entryIds(history.present), ['e2', 'e1']);
});

test('an edit that changes nothing puts no step on the undo stack', () => {
	// The identity short-circuit has to survive all the way from the edit
	// primitive through the handler and the applier to the history.
	let history = createSoundscaperProjectHistoryV23(project());
	const before = history;
	history = executeSoundscaperProjectCommandV23(history, {
		type: 'mastering-sequence/entry-retitle', sequenceId: 'album', entryId: 'e1', title: null,
	} as never, { now: NOW });
	assert.equal(history, before, 'the history object itself is unchanged');
	assert.equal(history.undoStack.length, 0);
});

test('a mastering-sequence edit bumps the revision exactly once', () => {
	const original = project();
	const applied = applySoundscaperProjectCommandV23(original, {
		type: 'mastering-sequence/rename', sequenceId: 'album', name: 'Final order',
	} as never, { now: NOW });
	assert.equal(applied.revision, Number(original.revision) + 1);
	assert.equal(applied.masteringSequences[0].name, 'Final order');
});

test('an inherited command is applied with V21 semantics and keeps the new field', () => {
	// The borrow has to be invisible: the inherited command behaves exactly as it
	// does on V21, and the field V21 knows nothing about survives untouched.
	const original = project();
	const applied = applySoundscaperProjectCommandV23(original, {
		type: 'track/update', trackId: 'a1', changes: { name: 'Renamed' },
	} as never, { now: NOW });
	assert.equal(applied.schemaVersion, 23);
	assert.equal((applied.tracks as readonly { name: string }[])[0].name, 'Renamed');
	assert.deepEqual(
		applied.masteringSequences,
		original.masteringSequences,
		'a track rename must not disturb the mastering sequences',
	);
});

test('an inherited no-op stays a no-op through the borrow', () => {
	const original = project();
	assert.equal(
		applySoundscaperProjectCommandV23(original, {
			type: 'track/update', trackId: 'a1', changes: { name: 'A1' },
		} as never, { now: NOW }),
		original,
	);
});

test('undo and redo work for inherited commands too', () => {
	let history = createSoundscaperProjectHistoryV23(project());
	history = executeSoundscaperProjectCommandV23(history, {
		type: 'track/update', trackId: 'a1', changes: { name: 'Renamed' },
	} as never, { now: NOW });
	assert.equal((history.present.tracks as readonly { name: string }[])[0].name, 'Renamed');
	history = undoSoundscaperProjectCommandV23(history, { now: NOW });
	assert.equal((history.present.tracks as readonly { name: string }[])[0].name, 'A1');
	assert.deepEqual(entryIds(history.present), ['e1', 'e2'], 'and the sequences survive the round trip');
});

test('a batch of entry edits is a single undo step', () => {
	let history = createSoundscaperProjectHistoryV23(project());
	history = executeSoundscaperProjectCommandV23(history, {
		type: 'batch',
		commands: [
			{ type: 'mastering-sequence/entry-retitle', sequenceId: 'album', entryId: 'e1', title: 'One' },
			{ type: 'mastering-sequence/entry-retitle', sequenceId: 'album', entryId: 'e2', title: 'Two' },
		],
	} as never, { now: NOW });
	assert.equal(history.undoStack.length, 1, 'a batch is one step, not two');
	assert.deepEqual(
		history.present.masteringSequences[0].entries.map((entry) => entry.title),
		['One', 'Two'],
	);
	history = undoSoundscaperProjectCommandV23(history, { now: NOW });
	assert.deepEqual(
		history.present.masteringSequences[0].entries.map((entry) => entry.title),
		[null, null],
		'one undo reverses the whole batch',
	);
});

test('a batch mixing product-owned and inherited commands is refused', () => {
	// Both paths would have to run in one transaction and neither can run twice,
	// so the combination is refused rather than half-applied.
	assert.throws(
		() => applySoundscaperProjectCommandV23(project(), {
			type: 'batch',
			commands: [
				{ type: 'mastering-sequence/rename', sequenceId: 'album', name: 'x' },
				{ type: 'track/update', trackId: 'a1', changes: { name: 'y' } },
			],
		} as never, { now: NOW }),
		/cannot also contain inherited commands/u,
	);
});
