/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMasteringSequenceV23, validateMasteringSequenceV23 } from '../src/common/editor/mastering-sequence.ts';
import {
	addMasteringSequenceEntry,
	removeMasteringSequenceEntry,
	renameMasteringSequence,
	reorderMasteringSequenceEntry,
	retitleMasteringSequenceEntry,
	setMasteringSequenceEntryMetadata,
	setMasteringSequenceEntryTiming,
} from '../src/common/editor/mastering-sequence-edit.ts';

const REGIONS = [
	{ id: 'a', sequenceId: 'seq', name: 'One', startFrame: 0, endFrame: 480_000 },
	{ id: 'b', sequenceId: 'seq', name: 'Two', startFrame: 500_000, endFrame: 960_000 },
	{ id: 'c', sequenceId: 'seq', name: 'Three', startFrame: 1_000_000, endFrame: 1_400_000 },
];

const sequence = () => createMasteringSequenceV23({
	id: 'album', sequenceId: 'seq', name: 'Album order',
	entries: [{ id: 'e1', annotationId: 'a' }, { id: 'e2', annotationId: 'b' }],
});

const ids = (value: { entries: readonly { id: string }[] }) => value.entries.map((entry) => entry.id);

test('entries are added at the end, or at a position', () => {
	const appended = addMasteringSequenceEntry(sequence(), { id: 'e3', annotationId: 'c' });
	assert.deepEqual(ids(appended), ['e1', 'e2', 'e3']);

	const inserted = addMasteringSequenceEntry(sequence(), { id: 'e0', annotationId: 'c' }, 0);
	assert.deepEqual(ids(inserted), ['e0', 'e1', 'e2']);

	const between = addMasteringSequenceEntry(sequence(), { id: 'em', annotationId: 'c' }, 1);
	assert.deepEqual(ids(between), ['e1', 'em', 'e2']);
});

test('an added entry is canonicalized by the document model, not trusted', () => {
	const added = addMasteringSequenceEntry(sequence(), { id: 'e3', annotationId: 'c' });
	assert.deepEqual(added.entries[2], {
		id: 'e3', annotationId: 'c', title: null, metadata: {},
		gapBeforeFrames: 0, fadeInFrames: 0, fadeOutFrames: 0,
	});
	assert.ok(Object.isFrozen(added.entries[2]));
	assert.throws(
		() => addMasteringSequenceEntry(sequence(), { id: 'e3', annotationId: '' }),
		/annotationId must be a non-empty string/u,
	);
	assert.throws(
		() => addMasteringSequenceEntry(sequence(), { id: 'e1', annotationId: 'c' }),
		/listed more than once/u,
	);
});

test('removing an entry leaves the rest in order', () => {
	const removed = removeMasteringSequenceEntry(sequence(), 'e1');
	assert.deepEqual(ids(removed), ['e2']);
	assert.deepEqual(ids(sequence()), ['e1', 'e2'], 'the input is untouched');
	assert.throws(() => removeMasteringSequenceEntry(sequence(), 'nope'), /no entry nope/u);
});

test('reordering moves one entry to a position counted in the result', () => {
	const three = addMasteringSequenceEntry(sequence(), { id: 'e3', annotationId: 'c' });
	assert.deepEqual(ids(reorderMasteringSequenceEntry(three, 'e3', 0)), ['e3', 'e1', 'e2']);
	assert.deepEqual(ids(reorderMasteringSequenceEntry(three, 'e1', 2)), ['e2', 'e3', 'e1']);
	assert.deepEqual(ids(reorderMasteringSequenceEntry(three, 'e2', 1)), ['e1', 'e2', 'e3'], 'a move to its own place');
});

test('an out-of-range position is refused rather than clamped', () => {
	// Clamping would turn a bug in a caller into a silent reorder of a delivery.
	const value = sequence();
	assert.throws(() => reorderMasteringSequenceEntry(value, 'e1', 2), /index within the sequence/u);
	assert.throws(() => reorderMasteringSequenceEntry(value, 'e1', -1), /index within the sequence/u);
	assert.throws(() => addMasteringSequenceEntry(value, { id: 'x', annotationId: 'c' }, 3), /within the sequence/u);
});

test('retitling sets and clears the override', () => {
	const titled = retitleMasteringSequenceEntry(sequence(), 'e1', 'Overture');
	assert.equal(titled.entries[0].title, 'Overture');
	assert.equal(retitleMasteringSequenceEntry(titled, 'e1', null).entries[0].title, null);
});

test('metadata is replaced wholesale, so clearing a field is possible at all', () => {
	const withMetadata = setMasteringSequenceEntryMetadata(sequence(), 'e1', { isrc: 'GBAYE0000123', performer: 'A' });
	assert.deepEqual(withMetadata.entries[0].metadata, { isrc: 'GBAYE0000123', performer: 'A' });
	const narrowed = setMasteringSequenceEntryMetadata(withMetadata, 'e1', { isrc: 'GBAYE0000123' });
	assert.deepEqual(narrowed.entries[0].metadata, { isrc: 'GBAYE0000123' }, 'performer is gone, not merged back');
	assert.deepEqual(setMasteringSequenceEntryMetadata(narrowed, 'e1', {}).entries[0].metadata, {});
});

test('timing edits touch only what they name', () => {
	const timed = setMasteringSequenceEntryTiming(sequence(), 'e2', { gapBeforeFrames: 96_000 });
	assert.equal(timed.entries[1].gapBeforeFrames, 96_000);
	assert.equal(timed.entries[1].fadeInFrames, 0);

	const faded = setMasteringSequenceEntryTiming(timed, 'e2', { fadeInFrames: 4_800, fadeOutFrames: 9_600 });
	assert.equal(faded.entries[1].gapBeforeFrames, 96_000, 'the gap survives a fade edit');
	assert.equal(faded.entries[1].fadeInFrames, 4_800);
	assert.equal(faded.entries[1].fadeOutFrames, 9_600);

	assert.throws(
		() => setMasteringSequenceEntryTiming(sequence(), 'e1', { gapBeforeFrames: -1 }),
		/non-negative integer/u,
	);
});

test('an edit that changes nothing returns the very same object', () => {
	// Undo history and document revisions key on identity, so a fresh-but-equal
	// sequence would put an empty step on the undo stack and dirty the project.
	const value = sequence();
	assert.equal(retitleMasteringSequenceEntry(value, 'e1', null), value);
	assert.equal(setMasteringSequenceEntryTiming(value, 'e1', {}), value);
	assert.equal(setMasteringSequenceEntryTiming(value, 'e1', { gapBeforeFrames: 0 }), value);
	assert.equal(setMasteringSequenceEntryMetadata(value, 'e1', {}), value);
	assert.equal(reorderMasteringSequenceEntry(value, 'e1', 0), value);
	assert.equal(renameMasteringSequence(value, 'Album order'), value);

	// And an edit that only reorders metadata keys is recognised as no edit.
	const withMetadata = setMasteringSequenceEntryMetadata(value, 'e1', { a: '1', b: '2' });
	assert.equal(setMasteringSequenceEntryMetadata(withMetadata, 'e1', { b: '2', a: '1' }), withMetadata);
});

test('an edit that does change something returns a new frozen sequence', () => {
	const value = sequence();
	const next = retitleMasteringSequenceEntry(value, 'e1', 'Overture');
	assert.notEqual(next, value);
	assert.ok(Object.isFrozen(next) && Object.isFrozen(next.entries));
	assert.equal(value.entries[0].title, null, 'the original is not mutated');
});

test('a sequence survives every edit primitive and is still deliverable', () => {
	// The slice's acceptance, walked end to end.
	let value = sequence();
	value = addMasteringSequenceEntry(value, { id: 'e3', annotationId: 'c' });
	value = reorderMasteringSequenceEntry(value, 'e3', 0);
	value = retitleMasteringSequenceEntry(value, 'e3', 'Overture');
	value = setMasteringSequenceEntryMetadata(value, 'e3', { isrc: 'GBAYE0000123' });
	value = setMasteringSequenceEntryTiming(value, 'e3', { gapBeforeFrames: 48_000, fadeInFrames: 2_400 });
	value = removeMasteringSequenceEntry(value, 'e2');
	value = renameMasteringSequence(value, 'Final order');

	assert.deepEqual(ids(value), ['e3', 'e1']);
	assert.equal(value.name, 'Final order');
	assert.equal(value.entries[0].metadata.isrc, 'GBAYE0000123');
	const validation = validateMasteringSequenceV23(value, REGIONS);
	assert.equal(validation.valid, true);
	// The order it ended up in is the authored one, even though the timeline
	// disagrees; that divergence is reported and never repaired.
	assert.equal(
		validation.issues.some(({ code }) => code === 'mastering-sequence.order-diverges-from-timeline'),
		true,
	);
});

test('editing never consults the regions, so a broken sequence can still be repaired', () => {
	// An entry whose region was deleted must still be removable, or a project
	// could reach a state its own commands cannot fix.
	const orphaned = addMasteringSequenceEntry(sequence(), { id: 'e9', annotationId: 'deleted' });
	assert.equal(validateMasteringSequenceV23(orphaned, REGIONS).valid, false);
	const repaired = removeMasteringSequenceEntry(orphaned, 'e9');
	assert.equal(validateMasteringSequenceV23(repaired, REGIONS).valid, true);
});
