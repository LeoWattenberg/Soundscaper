/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';

/**
 * Undo history for a Soundscaper production revision.
 *
 * The stack mechanics — limit, no-op suppression, revision bump on restore,
 * snapshot validation — are identical for every revision that carries the
 * production document, so they live here once and each revision supplies only
 * what differs: how to validate, clone, snapshot and apply.
 */

export interface SoundscaperProductionHistoryRevision {
	readonly label: string;
	validateProject(project: unknown): void;
	cloneProject(project: unknown): Record<string, unknown>;
	snapshotCommand(command: AudioEditorCommand): AudioEditorCommand;
	applyCommand(
		project: unknown,
		command: AudioEditorCommand,
		options: SoundscaperProductionCommandOptions,
	): Record<string, unknown>;
}

export interface SoundscaperProductionCommandOptions {
	readonly now?: Date | string;
}

export interface SoundscaperProductionHistoryEntry {
	readonly project: Record<string, unknown>;
	readonly command: AudioEditorCommand;
}

export interface SoundscaperProductionHistoryState {
	readonly limit: number;
	readonly present: Record<string, unknown>;
	readonly undoStack: readonly SoundscaperProductionHistoryEntry[];
	readonly redoStack: readonly SoundscaperProductionHistoryEntry[];
	/**
	 * How many entries the limit has pushed off the bottom of the undo stack over
	 * this history's life.
	 *
	 * A depth handed to `collapse` or `rollback` is a position in the whole
	 * sequence of commits — `dropped + undoStack.length` — rather than an index
	 * into the bounded stack, because a macro's own steps shift that stack out
	 * from under an index as soon as the history is full.
	 */
	readonly dropped: number;
}

export function createSoundscaperProductionHistory(
	project: unknown,
	revision: SoundscaperProductionHistoryRevision,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProductionHistoryState {
	revision.validateProject(project);
	const limit = historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT);
	return { limit, present: revision.cloneProject(project), undoStack: [], redoStack: [], dropped: 0 };
}

export function validateSoundscaperProductionHistory(
	history: SoundscaperProductionHistoryState | unknown,
	revision: SoundscaperProductionHistoryRevision,
): history is SoundscaperProductionHistoryState {
	if (!history || typeof history !== 'object' || Array.isArray(history)) {
		throw new TypeError('A Soundscaper baseline history is required.');
	}
	const value = history as Partial<SoundscaperProductionHistoryState>;
	const limit = historyLimit(value.limit);
	droppedCount(value.dropped);
	revision.validateProject(value.present);
	const projectId = String(value.present!.id);
	validateStack(value.undoStack, 'undoStack', limit, projectId, revision);
	validateStack(value.redoStack, 'redoStack', limit, projectId, revision);
	return true;
}

export function cloneSoundscaperProductionHistory(
	history: SoundscaperProductionHistoryState | unknown,
	revision: SoundscaperProductionHistoryRevision,
): SoundscaperProductionHistoryState {
	validateSoundscaperProductionHistory(history, revision);
	const valid = history as SoundscaperProductionHistoryState;
	return {
		limit: valid.limit,
		present: revision.cloneProject(valid.present),
		undoStack: valid.undoStack.map((entry) => cloneEntry(entry, revision)),
		redoStack: valid.redoStack.map((entry) => cloneEntry(entry, revision)),
		dropped: droppedCount(valid.dropped),
	};
}

export function executeSoundscaperProductionCommand(
	history: SoundscaperProductionHistoryState | unknown,
	command: AudioEditorCommand,
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions = {},
): SoundscaperProductionHistoryState {
	validateSoundscaperProductionHistory(history, revision);
	const valid = history as SoundscaperProductionHistoryState;
	const normalized = revision.snapshotCommand(command);
	const present = revision.applyCommand(valid.present, normalized, options);
	if (present === valid.present) return valid;
	const pushed = [...valid.undoStack, {
		project: revision.cloneProject(valid.present), command: normalized,
	}];
	const undoStack = pushed.slice(-valid.limit);
	return {
		limit: valid.limit,
		present,
		undoStack,
		redoStack: [],
		dropped: droppedCount(valid.dropped) + (pushed.length - undoStack.length),
	};
}

export function undoSoundscaperProductionCommand(
	history: SoundscaperProductionHistoryState | unknown,
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions = {},
): SoundscaperProductionHistoryState {
	validateSoundscaperProductionHistory(history, revision);
	const valid = history as SoundscaperProductionHistoryState;
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	return restore(valid, entry, valid.undoStack.slice(0, -1), [
		...valid.redoStack,
		{ project: revision.cloneProject(valid.present), command: revision.snapshotCommand(entry.command) },
	].slice(-valid.limit), revision, options);
}

export function redoSoundscaperProductionCommand(
	history: SoundscaperProductionHistoryState | unknown,
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions = {},
): SoundscaperProductionHistoryState {
	validateSoundscaperProductionHistory(history, revision);
	const valid = history as SoundscaperProductionHistoryState;
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	const pushed = [
		...valid.undoStack,
		{ project: revision.cloneProject(valid.present), command: revision.snapshotCommand(entry.command) },
	];
	const undoStack = pushed.slice(-valid.limit);
	return restore(valid, entry, undoStack, valid.redoStack.slice(0, -1), revision, options,
		droppedCount(valid.dropped) + (pushed.length - undoStack.length));
}

/**
 * Fold everything committed since a depth into one entry.
 *
 * A macro is one action to the person who ran it, so it has to be one undo. Its
 * steps commit normally — an effect step writes audio asynchronously and only
 * then knows what it produced — and the range they added is replaced here by a
 * single entry holding the project as it stood before the macro began. That is
 * exactly what undo restores, because undo restores a whole snapshot.
 */
export function collapseSoundscaperProductionHistory(
	history: SoundscaperProductionHistoryState | unknown,
	depth: number,
	command: AudioEditorCommand,
	revision: SoundscaperProductionHistoryRevision,
): SoundscaperProductionHistoryState {
	validateSoundscaperProductionHistory(history, revision);
	const valid = history as SoundscaperProductionHistoryState;
	const undoDepth = boundedDepth(valid, depth);
	if (valid.undoStack.length <= undoDepth) return valid;
	const opening = valid.undoStack[undoDepth]!;
	return {
		limit: valid.limit,
		present: valid.present,
		undoStack: [
			...valid.undoStack.slice(0, undoDepth),
			{ project: opening.project, command: revision.snapshotCommand(command) },
		].slice(-valid.limit),
		redoStack: [],
		dropped: droppedCount(valid.dropped),
	};
}

/** Put the project back as it stood at a depth and drop what was committed since. */
export function rollbackSoundscaperProductionHistory(
	history: SoundscaperProductionHistoryState | unknown,
	depth: number,
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions = {},
): SoundscaperProductionHistoryState {
	validateSoundscaperProductionHistory(history, revision);
	const valid = history as SoundscaperProductionHistoryState;
	const undoDepth = boundedDepth(valid, depth);
	if (valid.undoStack.length <= undoDepth) return valid;
	const opening = valid.undoStack[undoDepth]!;
	return restore(valid, opening, valid.undoStack.slice(0, undoDepth), [], revision, options);
}

/**
 * Turn the depth a macro opened at into an index into the stack as it stands now.
 *
 * The depth counts commits, not slots: a macro's own steps push the entries
 * below it off the bottom once the history is full, so an index captured when
 * the macro began would name a mid-macro snapshot — or, on a stack that was
 * already full, name nothing at all and settle the macro into a no-op. Taking
 * the entries the limit has dropped since then back off keeps it naming the
 * entry the macro opened with. A macro longer than the whole limit has pushed
 * that entry off the end too, and clamps to the oldest one left.
 */
function boundedDepth(history: SoundscaperProductionHistoryState, depth: number): number {
	if (!Number.isInteger(depth) || depth < 0) {
		throw new RangeError('A history depth must be a non-negative integer.');
	}
	const index = depth - droppedCount(history.dropped);
	return Math.min(Math.max(index, 0), history.undoStack.length);
}

function restore(
	history: SoundscaperProductionHistoryState,
	entry: SoundscaperProductionHistoryEntry,
	undoStack: readonly SoundscaperProductionHistoryEntry[],
	redoStack: readonly SoundscaperProductionHistoryEntry[],
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions,
	dropped: number = droppedCount(history.dropped),
): SoundscaperProductionHistoryState {
	const present = revision.cloneProject(entry.project);
	const next = Number(history.present.revision) + 1;
	if (!Number.isSafeInteger(next)) throw new RangeError(`${revision.label} history revision overflowed.`);
	present.revision = next;
	present.updatedAt = timestamp(options.now);
	revision.validateProject(present);
	return { limit: history.limit, present, undoStack, redoStack, dropped };
}

function validateStack(
	value: readonly SoundscaperProductionHistoryEntry[] | undefined,
	name: string,
	limit: number,
	projectId: string,
	revision: SoundscaperProductionHistoryRevision,
): void {
	if (!Array.isArray(value) || value.length > limit) {
		throw new RangeError(`${revision.label} history ${name} is invalid.`);
	}
	for (const entry of value) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new TypeError(`${revision.label} history ${name} entry is invalid.`);
		}
		revision.validateProject(entry.project);
		if (entry.project.id !== projectId) {
			throw new RangeError(`Every ${revision.label} history snapshot must have the present project ID.`);
		}
		revision.snapshotCommand(entry.command);
	}
}

function cloneEntry(
	entry: SoundscaperProductionHistoryEntry,
	revision: SoundscaperProductionHistoryRevision,
): SoundscaperProductionHistoryEntry {
	return {
		project: revision.cloneProject(entry.project),
		command: revision.snapshotCommand(entry.command),
	};
}

/** A history written before the count existed simply has not dropped anything yet. */
function droppedCount(value: unknown): number {
	if (value === undefined) return 0;
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('A Soundscaper production history dropped count must be a non-negative safe integer.');
	}
	return Number(value);
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError('A Soundscaper production history limit must be a positive safe integer.');
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid production history timestamp is required.');
	return date.toISOString();
}
