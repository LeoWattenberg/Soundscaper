/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type MasteringSequenceEntryV23,
	type MasteringSequenceV23,
	createMasteringSequenceV23,
} from './mastering-sequence.ts';

/**
 * The edit primitives a mastering sequence's undoable commands are built from.
 *
 * Every one of these is a pure function from a sequence to a sequence, and every
 * result is put back through `createMasteringSequenceV23` before it is returned.
 * That is deliberate and slightly wasteful: it means no edit path can produce a
 * sequence the document model would reject, so the invariants live in exactly
 * one place rather than being re-implemented once per command.
 *
 * **An edit that changes nothing returns the same object.** Undo history and
 * document revisions are driven by identity, so a command that produced a fresh
 * but identical sequence would put an empty step on the undo stack and mark the
 * project dirty for no reason.
 *
 * None of these consult the regions the entries point at. An entry may be added
 * for a region that does not exist yet, or survive one that has been deleted —
 * whether a sequence can be *delivered* is a validation question
 * (`validateMasteringSequenceV23`), and answering it during editing would mean
 * an edit could fail because of something the operator did not touch.
 */

export interface MasteringSequenceEntryDraft {
	readonly id: string;
	readonly annotationId: string;
	readonly title?: string | null;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly gapBeforeFrames?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
}

export interface MasteringSequenceEntryTiming {
	readonly gapBeforeFrames?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
}

/** Insert one entry, at `index` or at the end. */
export function addMasteringSequenceEntry(
	sequence: MasteringSequenceV23,
	entry: MasteringSequenceEntryDraft,
	index?: number,
): MasteringSequenceV23 {
	const entries = [...sequence.entries];
	const at = index === undefined ? entries.length : insertionIndex(index, entries.length);
	entries.splice(at, 0, entry as MasteringSequenceEntryV23);
	return rebuild(sequence, entries);
}

export function removeMasteringSequenceEntry(
	sequence: MasteringSequenceV23,
	entryId: string,
): MasteringSequenceV23 {
	const at = indexOfEntry(sequence, entryId);
	const entries = [...sequence.entries];
	entries.splice(at, 1);
	return rebuild(sequence, entries);
}

/** Move one entry to `toIndex`, counted in the resulting order. */
export function reorderMasteringSequenceEntry(
	sequence: MasteringSequenceV23,
	entryId: string,
	toIndex: number,
): MasteringSequenceV23 {
	const from = indexOfEntry(sequence, entryId);
	const to = positionIndex(toIndex, sequence.entries.length);
	if (from === to) return sequence;
	const entries = [...sequence.entries];
	const [moved] = entries.splice(from, 1);
	entries.splice(to, 0, moved);
	return rebuild(sequence, entries);
}

/** Set the title override, or clear it with null so the region's name shows through. */
export function retitleMasteringSequenceEntry(
	sequence: MasteringSequenceV23,
	entryId: string,
	title: string | null,
): MasteringSequenceV23 {
	return replaceEntry(sequence, entryId, (entry) => ({ ...entry, title }));
}

/** Replace an entry's delivery metadata wholesale; `{}` clears it. */
export function setMasteringSequenceEntryMetadata(
	sequence: MasteringSequenceV23,
	entryId: string,
	metadata: Readonly<Record<string, string>>,
): MasteringSequenceV23 {
	return replaceEntry(sequence, entryId, (entry) => ({ ...entry, metadata }));
}

/** Set any of the gap and fade values, leaving the others alone. */
export function setMasteringSequenceEntryTiming(
	sequence: MasteringSequenceV23,
	entryId: string,
	timing: MasteringSequenceEntryTiming,
): MasteringSequenceV23 {
	return replaceEntry(sequence, entryId, (entry) => ({
		...entry,
		gapBeforeFrames: timing.gapBeforeFrames ?? entry.gapBeforeFrames,
		fadeInFrames: timing.fadeInFrames ?? entry.fadeInFrames,
		fadeOutFrames: timing.fadeOutFrames ?? entry.fadeOutFrames,
	}));
}

export function renameMasteringSequence(
	sequence: MasteringSequenceV23,
	name: string,
): MasteringSequenceV23 {
	if (name === sequence.name) return sequence;
	return createMasteringSequenceV23({ ...sequence, name });
}

function replaceEntry(
	sequence: MasteringSequenceV23,
	entryId: string,
	update: (entry: MasteringSequenceEntryV23) => MasteringSequenceEntryV23,
): MasteringSequenceV23 {
	const at = indexOfEntry(sequence, entryId);
	const entries = [...sequence.entries];
	entries[at] = update(entries[at]);
	return rebuild(sequence, entries);
}

/**
 * Rebuild through the document model, and hand back the original when the result
 * is the same sequence. Comparing the canonical forms rather than the inputs
 * means an edit that only reorders metadata keys, or writes a value that was
 * already there, is correctly recognised as no edit at all.
 */
function rebuild(
	sequence: MasteringSequenceV23,
	entries: readonly MasteringSequenceEntryV23[],
): MasteringSequenceV23 {
	const next = createMasteringSequenceV23({ ...sequence, entries });
	return JSON.stringify(next) === JSON.stringify(sequence) ? sequence : next;
}

function indexOfEntry(sequence: MasteringSequenceV23, entryId: string): number {
	const at = sequence.entries.findIndex((entry) => entry.id === entryId);
	if (at < 0) throw new RangeError(`The mastering sequence has no entry ${entryId}.`);
	return at;
}

function positionIndex(value: unknown, length: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= length) {
		throw new RangeError('A mastering sequence position must be an index within the sequence.');
	}
	return value as number;
}

function insertionIndex(value: unknown, length: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > length) {
		throw new RangeError('A mastering sequence insertion index must be within the sequence.');
	}
	return value as number;
}
