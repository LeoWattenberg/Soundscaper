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
	applySoundscaperProjectCommandV21,
	snapshotSoundscaperProjectCommandV21,
	type SoundscaperProjectCommandOptionsV21,
} from './editor-project-v21-commands.ts';
import { cloneSoundscaperProjectV21, type SoundscaperProjectV21 } from './editor-project-v21.ts';
import { validateSoundscaperProjectV21 } from './editor-project-v21-validation.ts';

export interface SoundscaperProjectHistoryEntryV21 {
	readonly project: SoundscaperProjectV21;
	readonly command: AudioEditorCommand;
}

export interface SoundscaperProjectHistoryV21 {
	readonly limit: number;
	readonly present: SoundscaperProjectV21;
	readonly undoStack: readonly SoundscaperProjectHistoryEntryV21[];
	readonly redoStack: readonly SoundscaperProjectHistoryEntryV21[];
}

const asV21 = (state: SoundscaperProductionHistoryState): SoundscaperProjectHistoryV21 => (
	state as unknown as SoundscaperProjectHistoryV21
);

/** V21's history: the shared production stack bound to V21's document authority. */
const V21: SoundscaperProductionHistoryRevision = {
	label: 'Soundscaper V21',
	validateProject: (project) => { validateSoundscaperProjectV21(project); },
	cloneProject: (project) => cloneSoundscaperProjectV21(project) as unknown as Record<string, unknown>,
	snapshotCommand: snapshotSoundscaperProjectCommandV21,
	applyCommand: (project, command, options) => (
		applySoundscaperProjectCommandV21(project, command, options) as unknown as Record<string, unknown>
	),
};

export function createSoundscaperProjectHistoryV21(
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProjectHistoryV21 {
	return asV21(createSoundscaperProductionHistory(project, V21, options));
}

export function validateSoundscaperProjectHistoryV21(
	history: SoundscaperProjectHistoryV21 | unknown,
): history is SoundscaperProjectHistoryV21 {
	validateSoundscaperProductionHistory(history, V21);
	return true;
}

export function cloneSoundscaperProjectHistoryV21(
	history: SoundscaperProjectHistoryV21 | unknown,
): SoundscaperProjectHistoryV21 {
	return asV21(cloneSoundscaperProductionHistory(history, V21));
}

export function executeSoundscaperProjectCommandV21(
	history: SoundscaperProjectHistoryV21 | unknown,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV21 = {},
): SoundscaperProjectHistoryV21 {
	return asV21(executeSoundscaperProductionCommand(history, command, V21, options));
}

export function undoSoundscaperProjectCommandV21(
	history: SoundscaperProjectHistoryV21 | unknown,
	options: SoundscaperProjectCommandOptionsV21 = {},
): SoundscaperProjectHistoryV21 {
	return asV21(undoSoundscaperProductionCommand(history, V21, options));
}

export function redoSoundscaperProjectCommandV21(
	history: SoundscaperProjectHistoryV21 | unknown,
	options: SoundscaperProjectCommandOptionsV21 = {},
): SoundscaperProjectHistoryV21 {
	return asV21(redoSoundscaperProductionCommand(history, V21, options));
}
