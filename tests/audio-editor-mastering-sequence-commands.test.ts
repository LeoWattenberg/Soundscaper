/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_EDITOR_COMMAND_TYPES } from '../src/common/editor/commands/protocol.ts';
import { MASTERING_SEQUENCE_COMMAND_TYPES } from '../src/common/editor/commands/mastering-sequence.ts';
import { createMasteringSequenceRuntimeHandlers } from '../src/common/editor/commands/mastering-sequence-runtime.ts';
import { createMasteringSequenceV23 } from '../src/common/editor/mastering-sequence.ts';
import { assertEditorCommandCapabilities } from '../src/common/editor/controller/command-capability-policy.ts';

const HANDLERS = createMasteringSequenceRuntimeHandlers();

const CAPABILITIES = {
	audioEffects: true, audioRecording: true, audioSpectralEditing: true, audioWarp: true,
	takeComp: true, timelineAnnotations: true, trackFolders: true, videoEffects: true,
};

/**
 * Built through the document model, because that is the only shape a real
 * project holds: validation canonicalizes every sequence on the way in, and the
 * no-op short-circuit compares canonical forms.
 */
function project(entries: readonly unknown[] = [{ id: 'e1', annotationId: 'a' }]) {
	return {
		masteringSequences: [createMasteringSequenceV23({
			id: 'album', sequenceId: 'main', name: 'Album order', entries,
		})],
	} as Record<string, unknown>;
}

const sequences = (value: Record<string, unknown>) => value.masteringSequences as readonly {
	id: string; name: string; entries: readonly { id: string; title: string | null }[];
}[];

test('every discriminant is registered in the authoritative protocol exactly once', () => {
	assert.equal(MASTERING_SEQUENCE_COMMAND_TYPES.length, 9);
	for (const type of MASTERING_SEQUENCE_COMMAND_TYPES) {
		assert.equal(
			AUDIO_EDITOR_COMMAND_TYPES.filter((candidate) => candidate === type).length,
			1,
			`${type} must appear exactly once in the protocol`,
		);
		assert.equal(typeof HANDLERS[type], 'function', `${type} needs a handler`);
	}
});

test('the namespace is the full one, so nothing later becomes a prefix of it', () => {
	// The capability gate and the product apply branch both match on this prefix.
	for (const type of MASTERING_SEQUENCE_COMMAND_TYPES) {
		assert.ok(type.startsWith('mastering-sequence/'), type);
	}
	assert.equal(
		AUDIO_EDITOR_COMMAND_TYPES.some((type) => type.startsWith('mastering/')),
		false,
		'a shorter namespace would make this one ambiguous',
	);
});

test('adding and removing a sequence', () => {
	const value = { masteringSequences: [] } as Record<string, unknown>;
	HANDLERS['mastering-sequence/add'](value, {
		type: 'mastering-sequence/add',
		sequence: { id: 'album', sequenceId: 'main', name: 'Album', entries: [] },
	} as never);
	assert.deepEqual(sequences(value).map((entry) => entry.id), ['album']);

	assert.throws(() => HANDLERS['mastering-sequence/add'](value, {
		type: 'mastering-sequence/add',
		sequence: { id: 'album', sequenceId: 'main', name: 'Again', entries: [] },
	} as never), /already exists/u);

	HANDLERS['mastering-sequence/remove'](value, {
		type: 'mastering-sequence/remove', sequenceId: 'album',
	} as never);
	assert.deepEqual(sequences(value), []);
	assert.throws(() => HANDLERS['mastering-sequence/remove'](value, {
		type: 'mastering-sequence/remove', sequenceId: 'album',
	} as never), /is missing/u);
});

test('entry commands edit the addressed sequence', () => {
	const value = project();
	HANDLERS['mastering-sequence/entry-add'](value, {
		type: 'mastering-sequence/entry-add', sequenceId: 'album', entry: { id: 'e2', annotationId: 'b' },
	} as never);
	assert.deepEqual(sequences(value)[0].entries.map((entry) => entry.id), ['e1', 'e2']);

	HANDLERS['mastering-sequence/entry-reorder'](value, {
		type: 'mastering-sequence/entry-reorder', sequenceId: 'album', entryId: 'e2', toIndex: 0,
	} as never);
	assert.deepEqual(sequences(value)[0].entries.map((entry) => entry.id), ['e2', 'e1']);

	HANDLERS['mastering-sequence/entry-retitle'](value, {
		type: 'mastering-sequence/entry-retitle', sequenceId: 'album', entryId: 'e1', title: 'Overture',
	} as never);
	assert.equal(sequences(value)[0].entries[1].title, 'Overture');

	HANDLERS['mastering-sequence/entry-timing'](value, {
		type: 'mastering-sequence/entry-timing', sequenceId: 'album', entryId: 'e1', gapBeforeFrames: 96_000,
	} as never);
	assert.equal(
		(sequences(value)[0].entries[1] as unknown as { gapBeforeFrames: number }).gapBeforeFrames,
		96_000,
	);

	HANDLERS['mastering-sequence/entry-remove'](value, {
		type: 'mastering-sequence/entry-remove', sequenceId: 'album', entryId: 'e2',
	} as never);
	assert.deepEqual(sequences(value)[0].entries.map((entry) => entry.id), ['e1']);
});

test('renaming replaces only the name', () => {
	const value = project();
	HANDLERS['mastering-sequence/rename'](value, {
		type: 'mastering-sequence/rename', sequenceId: 'album', name: 'Final order',
	} as never);
	assert.equal(sequences(value)[0].name, 'Final order');
	assert.deepEqual(sequences(value)[0].entries.map((entry) => entry.id), ['e1']);
});

test('an edit that changes nothing leaves the collection identical', () => {
	// No-op suppression upstream is identity based, so a handler that rebuilt the
	// array unconditionally would push empty steps onto the undo stack and bump
	// the document revision for an edit that changed nothing.
	const value = project();
	const before = value.masteringSequences;
	HANDLERS['mastering-sequence/entry-retitle'](value, {
		type: 'mastering-sequence/entry-retitle', sequenceId: 'album', entryId: 'e1', title: null,
	} as never);
	assert.equal(value.masteringSequences, before, 'the very same array object');

	HANDLERS['mastering-sequence/entry-timing'](value, {
		type: 'mastering-sequence/entry-timing', sequenceId: 'album', entryId: 'e1', gapBeforeFrames: 0,
	} as never);
	assert.equal(value.masteringSequences, before);

	HANDLERS['mastering-sequence/rename'](value, {
		type: 'mastering-sequence/rename', sequenceId: 'album', name: 'Album order',
	} as never);
	assert.equal(value.masteringSequences, before);
});

test('an edit that does change something replaces the collection', () => {
	const value = project();
	const before = value.masteringSequences;
	HANDLERS['mastering-sequence/rename'](value, {
		type: 'mastering-sequence/rename', sequenceId: 'album', name: 'Final order',
	} as never);
	assert.notEqual(value.masteringSequences, before);
});

test('a missing sequence or entry is a reference error, not a silent no-op', () => {
	const value = project();
	assert.throws(() => HANDLERS['mastering-sequence/rename'](value, {
		type: 'mastering-sequence/rename', sequenceId: 'nope', name: 'x',
	} as never), /Mastering sequence nope is missing/u);
	assert.throws(() => HANDLERS['mastering-sequence/entry-remove'](value, {
		type: 'mastering-sequence/entry-remove', sequenceId: 'album', entryId: 'nope',
	} as never), /no entry nope/u);
});

test('the capability gate refuses the commands, directly and inside a batch', () => {
	// The policy recurses into batch children, so a gate written only for the
	// top-level type would be bypassable by wrapping the command in a batch.
	const command = {
		type: 'mastering-sequence/rename', sequenceId: 'album', name: 'x',
	} as never;
	assert.throws(
		() => assertEditorCommandCapabilities(command, CAPABILITIES as never, 'Framescaper'),
		/masteringSequences/u,
	);
	assert.throws(
		() => assertEditorCommandCapabilities(
			{ type: 'batch', commands: [command] } as never, CAPABILITIES as never, 'Framescaper',
		),
		/masteringSequences/u,
	);
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		command, { ...CAPABILITIES, masteringSequences: true } as never, 'Soundscaper',
	));
});
