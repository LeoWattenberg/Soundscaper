/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import {
	createSoundscaperProductionHistory,
	cloneSoundscaperProductionHistory,
	executeSoundscaperProductionCommand,
	redoSoundscaperProductionCommand,
	undoSoundscaperProductionCommand,
	validateSoundscaperProductionHistory,
	type SoundscaperProductionHistoryRevision,
	type SoundscaperProductionHistoryState,
	collapseSoundscaperProductionHistory,
	rollbackSoundscaperProductionHistory,
} from './editor-project-production-history.ts';
import {
	applySoundscaperProjectCommand,
	snapshotSoundscaperProjectCommand,
	type SoundscaperProjectCommand,
	type SoundscaperProjectCommandOptions,
} from './editor-project-commands.ts';
import { cloneSoundscaperProject, type SoundscaperProject } from './editor-project.ts';
import { validateSoundscaperProject } from './editor-project-validation.ts';

export interface SoundscaperProjectHistoryEntry {
	readonly project: SoundscaperProject;
	readonly command: SoundscaperProjectCommand;
}

export interface SoundscaperProjectHistory {
	readonly limit: number;
	readonly present: SoundscaperProject;
	readonly undoStack: readonly SoundscaperProjectHistoryEntry[];
	readonly redoStack: readonly SoundscaperProjectHistoryEntry[];
}

const asBaseline = (state: SoundscaperProductionHistoryState): SoundscaperProjectHistory => (
	state as unknown as SoundscaperProjectHistory
);

/** Soundscaper history bound to the baseline document authority. */
const BASELINE: SoundscaperProductionHistoryRevision = {
	label: 'Soundscaper',
	validateProject: (project) => { validateSoundscaperProject(project); },
	cloneProject: (project) => cloneSoundscaperProject(project) as unknown as Record<string, unknown>,
	snapshotCommand: (command) => snapshotSoundscaperProjectCommand(command) as AudioEditorCommand,
	applyCommand: (project, command, options) => (
		applySoundscaperProjectCommand(project, command, options) as unknown as Record<string, unknown>
	),
};

export function createSoundscaperProjectHistory(
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProjectHistory {
	return asBaseline(createSoundscaperProductionHistory(project, BASELINE, options));
}

export function validateSoundscaperProjectHistory(
	history: SoundscaperProjectHistory | unknown,
): history is SoundscaperProjectHistory {
	validateSoundscaperProductionHistory(history, BASELINE);
	return true;
}

export function cloneSoundscaperProjectHistory(
	history: SoundscaperProjectHistory | unknown,
): SoundscaperProjectHistory {
	return asBaseline(cloneSoundscaperProductionHistory(history, BASELINE));
}

export function executeSoundscaperProjectCommand(
	history: SoundscaperProjectHistory | unknown,
	command: SoundscaperProjectCommand,
	options: SoundscaperProjectCommandOptions = {},
): SoundscaperProjectHistory {
	return asBaseline(executeSoundscaperProductionCommand(history, command as AudioEditorCommand, BASELINE, options));
}

export function undoSoundscaperProjectCommand(
	history: SoundscaperProjectHistory | unknown,
	options: SoundscaperProjectCommandOptions = {},
): SoundscaperProjectHistory {
	return asBaseline(undoSoundscaperProductionCommand(history, BASELINE, options));
}

export function redoSoundscaperProjectCommand(
	history: SoundscaperProjectHistory | unknown,
	options: SoundscaperProjectCommandOptions = {},
): SoundscaperProjectHistory {
	return asBaseline(redoSoundscaperProductionCommand(history, BASELINE, options));
}

export function collapseSoundscaperProjectHistory(
	history: SoundscaperProjectHistory | unknown,
	depth: number,
	command: Parameters<typeof collapseSoundscaperProductionHistory>[2],
): SoundscaperProjectHistory {
	return asBaseline(collapseSoundscaperProductionHistory(history, depth, command, BASELINE));
}

export function rollbackSoundscaperProjectHistory(
	history: SoundscaperProjectHistory | unknown,
	depth: number,
	options: SoundscaperProjectCommandOptions = {},
): SoundscaperProjectHistory {
	return asBaseline(rollbackSoundscaperProductionHistory(history, depth, BASELINE, options));
}
