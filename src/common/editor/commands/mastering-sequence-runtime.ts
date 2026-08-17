/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createMasteringSequenceV23,
	type MasteringSequenceV23,
} from '../mastering-sequence.ts';
import {
	addMasteringSequenceEntry,
	removeMasteringSequenceEntry,
	renameMasteringSequence,
	reorderMasteringSequenceEntry,
	retitleMasteringSequenceEntry,
	setMasteringSequenceEntryMetadata,
	setMasteringSequenceEntryTiming,
} from '../mastering-sequence-edit.ts';
import {
	defineMasteringSequenceCommandHandlers,
	type MasteringSequenceCommandHandlers,
} from './mastering-sequence.ts';

/**
 * Applying mastering-sequence commands to a project draft.
 *
 * Every handler that edits one sequence goes through `editSequence`, which
 * writes the collection back **only when the primitive returned a different
 * object**. That is not a micro-optimisation: no-op suppression in both the
 * command applier and the history is identity- and serialization-based, so a
 * handler that rebuilt the array unconditionally would push empty steps onto the
 * undo stack and bump the document revision for edits that changed nothing.
 */

export function createMasteringSequenceRuntimeHandlers(): Readonly<MasteringSequenceCommandHandlers> {
	return defineMasteringSequenceCommandHandlers({
		'mastering-sequence/add': (projectValue, command) => {
			const project = dataRecord(projectValue, 'mastering sequence project');
			const sequences = sequenceArray(project);
			const created = createMasteringSequenceV23(command.sequence);
			if (sequences.some((sequence) => sequence.id === created.id)) {
				throw new RangeError(`Mastering sequence ${created.id} already exists.`);
			}
			project.masteringSequences = Object.freeze([...sequences, created]);
		},
		'mastering-sequence/remove': (projectValue, command) => {
			const project = dataRecord(projectValue, 'mastering sequence project');
			const sequenceId = nonEmptyString(command.sequenceId, 'mastering sequence ID');
			const sequences = sequenceArray(project);
			const remaining = sequences.filter((sequence) => sequence.id !== sequenceId);
			if (remaining.length === sequences.length) {
				throw new ReferenceError(`Mastering sequence ${sequenceId} is missing.`);
			}
			project.masteringSequences = Object.freeze(remaining);
		},
		'mastering-sequence/rename': (projectValue, command) => editSequence(
			projectValue, command.sequenceId,
			(sequence) => renameMasteringSequence(sequence, stringValue(command.name, 'mastering sequence name')),
		),
		'mastering-sequence/entry-add': (projectValue, command) => editSequence(
			projectValue, command.sequenceId,
			(sequence) => addMasteringSequenceEntry(
				sequence,
				command.entry as never,
				command.index === undefined ? undefined : command.index,
			),
		),
		'mastering-sequence/entry-remove': (projectValue, command) => editSequence(
			projectValue, command.sequenceId,
			(sequence) => removeMasteringSequenceEntry(sequence, nonEmptyString(command.entryId, 'entry ID')),
		),
		'mastering-sequence/entry-reorder': (projectValue, command) => editSequence(
			projectValue, command.sequenceId,
			(sequence) => reorderMasteringSequenceEntry(
				sequence, nonEmptyString(command.entryId, 'entry ID'), command.toIndex,
			),
		),
		'mastering-sequence/entry-retitle': (projectValue, command) => editSequence(
			projectValue, command.sequenceId,
			(sequence) => retitleMasteringSequenceEntry(
				sequence,
				nonEmptyString(command.entryId, 'entry ID'),
				command.title === null ? null : stringValue(command.title, 'entry title'),
			),
		),
		'mastering-sequence/entry-metadata': (projectValue, command) => editSequence(
			projectValue, command.sequenceId,
			(sequence) => setMasteringSequenceEntryMetadata(
				sequence, nonEmptyString(command.entryId, 'entry ID'), command.metadata,
			),
		),
		'mastering-sequence/entry-timing': (projectValue, command) => editSequence(
			projectValue, command.sequenceId,
			(sequence) => setMasteringSequenceEntryTiming(sequence, nonEmptyString(command.entryId, 'entry ID'), {
				...(command.gapBeforeFrames === undefined ? {} : { gapBeforeFrames: command.gapBeforeFrames }),
				...(command.fadeInFrames === undefined ? {} : { fadeInFrames: command.fadeInFrames }),
				...(command.fadeOutFrames === undefined ? {} : { fadeOutFrames: command.fadeOutFrames }),
			}),
		),
	});
}

function editSequence(
	projectValue: unknown,
	sequenceIdValue: unknown,
	update: (sequence: MasteringSequenceV23) => MasteringSequenceV23,
): void {
	const project = dataRecord(projectValue, 'mastering sequence project');
	const sequenceId = nonEmptyString(sequenceIdValue, 'mastering sequence ID');
	const sequences = sequenceArray(project);
	const index = sequences.findIndex((sequence) => sequence.id === sequenceId);
	if (index < 0) throw new ReferenceError(`Mastering sequence ${sequenceId} is missing.`);
	const next = update(sequences[index]);
	// The edit primitives return the same object when nothing changed. Passing
	// that through is what keeps an empty edit off the undo stack.
	if (next === sequences[index]) return;
	const replaced = [...sequences];
	replaced[index] = next;
	project.masteringSequences = Object.freeze(replaced);
}

function sequenceArray(project: Record<string, unknown>): readonly MasteringSequenceV23[] {
	const value = project.masteringSequences;
	if (!Array.isArray(value)) throw new TypeError('project.masteringSequences must be an array.');
	return value as readonly MasteringSequenceV23[];
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function stringValue(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
	return value;
}
