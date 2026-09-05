/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	cloneEditorProjectHistory,
	collapseEditorProjectHistory,
	createEditorProjectHistory,
	executeEditorProjectCommand,
	redoEditorProjectCommand,
	rollbackEditorProjectHistory,
	undoEditorProjectCommand,
	validateEditorProjectHistory,
	type EditorProjectHistoryRevision,
	type EditorProjectHistoryState,
} from '../common/editor/project-history-mechanics.ts';

/**
 * Undo history for a Soundscaper production revision.
 *
 * The stack mechanics live in src/common/editor/project-history-mechanics.ts,
 * shared with every other document a product edits. What this module supplies is
 * the Soundscaper reading of them: the production document carries the macro
 * depth correction, so it counts what the limit dropped, and a command that
 * leaves the document identical is not worth an undo entry.
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

type Mechanics = EditorProjectHistoryRevision<AudioEditorCommand, SoundscaperProductionCommandOptions>;

/** The production reading of the shared mechanics. */
function mechanics(revision: SoundscaperProductionHistoryRevision): Mechanics {
	return {
		label: revision.label,
		tracksDropped: true,
		suppressNoOpCommands: true,
		validateProject: (project) => { revision.validateProject(project); },
		cloneProject: (project) => revision.cloneProject(project),
		snapshotCommand: (command) => revision.snapshotCommand(command as AudioEditorCommand),
		applyCommand: (project, command, options) => revision.applyCommand(project, command, options),
	};
}

const asProduction = (
	state: EditorProjectHistoryState<AudioEditorCommand>,
): SoundscaperProductionHistoryState => state as unknown as SoundscaperProductionHistoryState;

export function createSoundscaperProductionHistory(
	project: unknown,
	revision: SoundscaperProductionHistoryRevision,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProductionHistoryState {
	return asProduction(createEditorProjectHistory(
		project, mechanics(revision), AUDIO_EDITOR_HISTORY_LIMIT, options,
	));
}

export function validateSoundscaperProductionHistory(
	history: SoundscaperProductionHistoryState | unknown,
	revision: SoundscaperProductionHistoryRevision,
): history is SoundscaperProductionHistoryState {
	validateEditorProjectHistory(history, mechanics(revision));
	return true;
}

export function cloneSoundscaperProductionHistory(
	history: SoundscaperProductionHistoryState | unknown,
	revision: SoundscaperProductionHistoryRevision,
): SoundscaperProductionHistoryState {
	return asProduction(cloneEditorProjectHistory(history, mechanics(revision)));
}

export function executeSoundscaperProductionCommand(
	history: SoundscaperProductionHistoryState | unknown,
	command: AudioEditorCommand,
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions = {},
): SoundscaperProductionHistoryState {
	return asProduction(executeEditorProjectCommand(history, command, mechanics(revision), options));
}

export function undoSoundscaperProductionCommand(
	history: SoundscaperProductionHistoryState | unknown,
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions = {},
): SoundscaperProductionHistoryState {
	return asProduction(undoEditorProjectCommand(history, mechanics(revision), options));
}

export function redoSoundscaperProductionCommand(
	history: SoundscaperProductionHistoryState | unknown,
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions = {},
): SoundscaperProductionHistoryState {
	return asProduction(redoEditorProjectCommand(history, mechanics(revision), options));
}

export function collapseSoundscaperProductionHistory(
	history: SoundscaperProductionHistoryState | unknown,
	depth: number,
	command: AudioEditorCommand,
	revision: SoundscaperProductionHistoryRevision,
): SoundscaperProductionHistoryState {
	return asProduction(collapseEditorProjectHistory(history, depth, command, mechanics(revision)));
}

export function rollbackSoundscaperProductionHistory(
	history: SoundscaperProductionHistoryState | unknown,
	depth: number,
	revision: SoundscaperProductionHistoryRevision,
	options: SoundscaperProductionCommandOptions = {},
): SoundscaperProductionHistoryState {
	return asProduction(rollbackEditorProjectHistory(history, depth, mechanics(revision), options));
}
