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
} from './editor-project-production-history.ts';
import {
	applySoundscaperProjectCommandV23,
	snapshotSoundscaperProjectCommandV23,
	type SoundscaperProjectCommandOptionsV23,
} from './editor-project-v23-commands.ts';
import { cloneSoundscaperProjectV23, type SoundscaperProjectV23 } from './editor-project-v23.ts';
import { validateSoundscaperProjectV23 } from './editor-project-v23-validation.ts';

export interface SoundscaperProjectHistoryEntryV23 {
	readonly project: SoundscaperProjectV23;
	readonly command: AudioEditorCommand;
}

export interface SoundscaperProjectHistoryV23 {
	readonly limit: number;
	readonly present: SoundscaperProjectV23;
	readonly undoStack: readonly SoundscaperProjectHistoryEntryV23[];
	readonly redoStack: readonly SoundscaperProjectHistoryEntryV23[];
}

const asV23 = (state: SoundscaperProductionHistoryState): SoundscaperProjectHistoryV23 => (
	state as unknown as SoundscaperProjectHistoryV23
);

/** V23's history: the same production stack bound to V23's document authority. */
const V23: SoundscaperProductionHistoryRevision = {
	label: 'Soundscaper V23',
	validateProject: (project) => { validateSoundscaperProjectV23(project); },
	cloneProject: (project) => cloneSoundscaperProjectV23(project) as unknown as Record<string, unknown>,
	snapshotCommand: snapshotSoundscaperProjectCommandV23,
	applyCommand: (project, command, options) => (
		applySoundscaperProjectCommandV23(project, command, options) as unknown as Record<string, unknown>
	),
};

export function createSoundscaperProjectHistoryV23(
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProjectHistoryV23 {
	return asV23(createSoundscaperProductionHistory(project, V23, options));
}

export function validateSoundscaperProjectHistoryV23(
	history: SoundscaperProjectHistoryV23 | unknown,
): history is SoundscaperProjectHistoryV23 {
	validateSoundscaperProductionHistory(history, V23);
	return true;
}

export function cloneSoundscaperProjectHistoryV23(
	history: SoundscaperProjectHistoryV23 | unknown,
): SoundscaperProjectHistoryV23 {
	return asV23(cloneSoundscaperProductionHistory(history, V23));
}

export function executeSoundscaperProjectCommandV23(
	history: SoundscaperProjectHistoryV23 | unknown,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV23 = {},
): SoundscaperProjectHistoryV23 {
	return asV23(executeSoundscaperProductionCommand(history, command, V23, options));
}

export function undoSoundscaperProjectCommandV23(
	history: SoundscaperProjectHistoryV23 | unknown,
	options: SoundscaperProjectCommandOptionsV23 = {},
): SoundscaperProjectHistoryV23 {
	return asV23(undoSoundscaperProductionCommand(history, V23, options));
}

export function redoSoundscaperProjectCommandV23(
	history: SoundscaperProjectHistoryV23 | unknown,
	options: SoundscaperProjectCommandOptionsV23 = {},
): SoundscaperProjectHistoryV23 {
	return asV23(redoSoundscaperProductionCommand(history, V23, options));
}
