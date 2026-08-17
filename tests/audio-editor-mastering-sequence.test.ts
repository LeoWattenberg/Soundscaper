/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MASTERING_SEQUENCE_LIMITS,
	MasteringSequenceValidationError,
	assertMasteringSequenceDeliverableV23,
	createMasteringSequenceV23,
	masteringSequenceEntryTitle,
	validateMasteringSequenceV23,
} from '../src/common/editor/mastering-sequence.ts';

const region = (id: string, startFrame: number, endFrame: number, overrides = {}) => ({
	id, sequenceId: 'seq', name: `Region ${id}`, startFrame, endFrame, ...overrides,
});

const REGIONS = [region('a', 0, 480_000), region('b', 500_000, 960_000), region('c', 1_000_000, 1_400_000)];

function sequence(overrides: Record<string, unknown> = {}) {
	return createMasteringSequenceV23({
		id: 'album',
		sequenceId: 'seq',
		name: 'Album order',
		entries: [
			{ id: 'e1', annotationId: 'a' },
			{ id: 'e2', annotationId: 'b', gapBeforeFrames: 96_000, fadeInFrames: 4_800, fadeOutFrames: 9_600 },
			{ id: 'e3', annotationId: 'c', title: 'Reprise', metadata: { isrc: 'GBAYE0000123', performer: 'The Band' } },
		],
		...overrides,
	});
}

test('a sequence stores order, identity and delivery metadata, and nothing about time', () => {
	const created = sequence();
	assert.deepEqual(created.entries.map((entry) => entry.annotationId), ['a', 'b', 'c']);
	// The one structural rule that matters: no entry carries a time range. The
	// region model owns where a piece is, and a copy would be a second answer.
	for (const entry of created.entries) {
		assert.equal('startFrame' in entry, false);
		assert.equal('endFrame' in entry, false);
	}
	assert.equal(created.entries[1].gapBeforeFrames, 96_000);
	assert.deepEqual(created.entries[2].metadata, { isrc: 'GBAYE0000123', performer: 'The Band' });
});

test('delivery metadata is open, not a field list', () => {
	const created = sequence({
		entries: [{
			id: 'e1', annotationId: 'a',
			metadata: { isrc: 'GBAYE0000123', 'catalogue-number': 'KW-001', 'upc': '000000000000', mood: 'brisk' },
		}],
	});
	assert.deepEqual(Object.keys(created.entries[0].metadata), ['catalogue-number', 'isrc', 'mood', 'upc']);
});

test('metadata keys are sorted so a stored sequence compares equal to itself', () => {
	const forward = sequence({ entries: [{ id: 'e', annotationId: 'a', metadata: { b: '2', a: '1' } }] });
	const backward = sequence({ entries: [{ id: 'e', annotationId: 'a', metadata: { a: '1', b: '2' } }] });
	assert.equal(JSON.stringify(forward), JSON.stringify(backward));
});

test('the title falls back to the region name, so renaming a region flows through', () => {
	const created = sequence();
	assert.equal(created.entries[0].title, null, 'no override was authored');
	assert.equal(masteringSequenceEntryTitle(created.entries[0], REGIONS[0]), 'Region a');
	assert.equal(masteringSequenceEntryTitle(created.entries[2], REGIONS[2]), 'Reprise', 'an override wins');
	assert.equal(masteringSequenceEntryTitle(created.entries[0], null), '', 'and a missing region invents nothing');
});

test('a whole, in-order sequence validates cleanly', () => {
	const validation = validateMasteringSequenceV23(sequence(), REGIONS);
	assert.equal(validation.valid, true);
	assert.deepEqual(validation.issues, []);
	assert.doesNotThrow(() => assertMasteringSequenceDeliverableV23(validation));
});

test('a deleted region is a typed validation error, never a shrunk sequence', () => {
	// The acceptance in one test: the entry must survive, the sequence must not
	// silently reorder itself, and the delivery must refuse with the reason.
	const created = sequence();
	const validation = validateMasteringSequenceV23(created, [REGIONS[0], REGIONS[2]]);
	assert.equal(validation.valid, false);
	assert.equal(created.entries.length, 3, 'the authored order is untouched');

	const issue = validation.issues.find((entry) => entry.code === 'mastering-sequence.region-missing');
	assert.equal(issue?.severity, 'error');
	assert.equal(issue?.entryId, 'e2');
	assert.equal(issue?.annotationId, 'b');

	assert.throws(() => assertMasteringSequenceDeliverableV23(validation), (error: unknown) => {
		assert.ok(error instanceof MasteringSequenceValidationError);
		assert.equal(error.issues.length, 1, 'only the error-level issues travel with the refusal');
		assert.equal(error.issues[0].code, 'mastering-sequence.region-missing');
		return true;
	});
});

test('a region moved into a different timeline sequence is refused rather than followed', () => {
	const moved = [REGIONS[0], { ...REGIONS[1], sequenceId: 'other' }, REGIONS[2]];
	const validation = validateMasteringSequenceV23(sequence(), moved);
	assert.equal(validation.valid, false);
	assert.equal(validation.issues[0].code, 'mastering-sequence.region-other-sequence');
});

test('a region moved earlier in time is reported, and the delivery order is left alone', () => {
	// A sequence owns its own order, so this is worth saying and never acting on.
	const reordered = [{ ...REGIONS[0], startFrame: 700_000, endFrame: 900_000 }, REGIONS[1], REGIONS[2]];
	const created = sequence();
	const validation = validateMasteringSequenceV23(created, reordered);
	assert.equal(validation.valid, true, 'diverging from timeline order is legal');
	const issue = validation.issues.find(
		(entry) => entry.code === 'mastering-sequence.order-diverges-from-timeline',
	);
	assert.equal(issue?.severity, 'info');
	assert.equal(issue?.entryId, 'e2');
	assert.deepEqual(created.entries.map((entry) => entry.id), ['e1', 'e2', 'e3'], 'nothing moved');
});

test('fades longer than their region are refused', () => {
	const created = sequence({
		entries: [{ id: 'e1', annotationId: 'a', fadeInFrames: 300_000, fadeOutFrames: 300_000 }],
	});
	const validation = validateMasteringSequenceV23(created, REGIONS);
	assert.equal(validation.valid, false);
	assert.equal(validation.issues[0].code, 'mastering-sequence.fades-exceed-region');

	// Exactly filling the region is allowed: a piece may be all fade.
	const exact = sequence({
		entries: [{ id: 'e1', annotationId: 'a', fadeInFrames: 240_000, fadeOutFrames: 240_000 }],
	});
	assert.equal(validateMasteringSequenceV23(exact, REGIONS).valid, true);
});

test('the same region may be delivered twice, because a reprise is a real thing', () => {
	const created = sequence({
		entries: [{ id: 'e1', annotationId: 'a' }, { id: 'e2', annotationId: 'a' }],
	});
	assert.equal(validateMasteringSequenceV23(created, REGIONS).valid, true);
});

test('the sequence owns ordering and metadata only', () => {
	// No audio, no render settings: a sequence that could carry a bit depth would
	// be a second export plan.
	const created = sequence();
	assert.deepEqual(Object.keys(created).sort(), ['entries', 'id', 'name', 'opaqueExtensions', 'sequenceId']);
	assert.deepEqual(
		Object.keys(created.entries[0]).sort(),
		['annotationId', 'fadeInFrames', 'fadeOutFrames', 'gapBeforeFrames', 'id', 'metadata', 'title'],
	);
});

test('malformed input is refused rather than repaired', () => {
	assert.throws(() => createMasteringSequenceV23(null), /must be an object/u);
	assert.throws(() => createMasteringSequenceV23({ id: 'a', sequenceId: 's', name: '' }), /entries array/u);
	assert.throws(() => sequence({ id: '' }), /non-empty string/u);
	assert.throws(() => sequence({ id: ' album ' }), /canonical string/u);
	assert.throws(() => sequence({ name: 'one\ntwo' }), /single-line/u);
	assert.throws(
		() => sequence({ entries: [{ id: 'e', annotationId: 'a' }, { id: 'e', annotationId: 'b' }] }),
		/listed more than once/u,
	);
	assert.throws(() => sequence({ entries: [{ id: 'e' }] }), /annotationId must be a non-empty string/u);
	assert.throws(
		() => sequence({ entries: [{ id: 'e', annotationId: 'a', gapBeforeFrames: -1 }] }),
		/non-negative integer/u,
	);
	assert.throws(
		() => sequence({ entries: [{ id: 'e', annotationId: 'a', fadeInFrames: 1.5 }] }),
		/non-negative integer/u,
	);
	assert.throws(
		() => sequence({ entries: [{ id: 'e', annotationId: 'a', metadata: { isrc: 5 } }] }),
		/metadata.isrc must be a string/u,
	);
});

test('the sequence is bounded, and says so rather than accepting anything', () => {
	const entries = Array.from({ length: MASTERING_SEQUENCE_LIMITS.maximumEntries + 1 }, (_, index) => ({
		id: `e${index}`, annotationId: 'a',
	}));
	assert.throws(() => sequence({ entries }), /maximum entry count/u);
	assert.throws(
		() => sequence({ entries: [{ id: 'e', annotationId: 'a', gapBeforeFrames: MASTERING_SEQUENCE_LIMITS.maximumGapFrames + 1 }] }),
		/exceeds its maximum/u,
	);
	const metadata = Object.fromEntries(
		Array.from({ length: MASTERING_SEQUENCE_LIMITS.maximumMetadataEntries + 1 }, (_, index) => [`k${index}`, 'v']),
	);
	assert.throws(() => sequence({ entries: [{ id: 'e', annotationId: 'a', metadata }] }), /maximum entry count/u);
});

test('a created sequence is frozen all the way down', () => {
	const created = sequence();
	assert.ok(Object.isFrozen(created));
	assert.ok(Object.isFrozen(created.entries));
	assert.ok(Object.isFrozen(created.entries[0]));
	assert.ok(Object.isFrozen(created.entries[2].metadata));
	assert.ok(Object.isFrozen(created.opaqueExtensions));
});

test('a sequence round-trips through JSON unchanged', () => {
	const created = sequence();
	assert.deepEqual(createMasteringSequenceV23(JSON.parse(JSON.stringify(created))), created);
});
