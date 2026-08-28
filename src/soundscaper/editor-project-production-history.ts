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
}

export function createSoundscaperProductionHistory(
	project: unknown,
	revision: SoundscaperProductionHistoryRevision,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProductionHistoryState {
	revision.validateProject(project);
	const limit = historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT);
	return { limit, present: revision.cloneProject(project), undoStack: [], redoStack: [] };
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
	return {
		limit: valid.limit,
		present,
		undoStack: [...valid.undoStack, {
			project: revision.cloneProject(valid.present), command: normalized,
		}].slice(-valid.limit),
		redoStack: [],
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
	return restore(valid, entry, [
		...valid.undoStack,
		{ project: revision.cloneProject(valid.present), command: revision.snapshotCommand(entry.command) },
	].slice(-valid.limit), valid.redoStack.slice(0, -1), revision, options);
}

function restore(
	history: SoundscaperProductionHistoryState,
	entry: SoundscaperProductionHistoryEntry,
	undoStack: readonly SoundscaperProductionHistoryEntry[],
	redoStack: readonly SoundscaperProductionHistoryEntry[],
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions,
): SoundscaperProductionHistoryState {
	const present = revision.cloneProject(entry.project);
	const next = Number(history.present.revision) + 1;
	if (!Number.isSafeInteger(next)) throw new RangeError(`${revision.label} history revision overflowed.`);
	present.revision = next;
	present.updatedAt = timestamp(options.now);
	revision.validateProject(present);
	return { limit: history.limit, present, undoStack, redoStack };
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
