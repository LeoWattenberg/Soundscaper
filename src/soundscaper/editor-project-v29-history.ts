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
	applySoundscaperProjectCommandV29,
	snapshotSoundscaperProjectCommandV29,
	type SoundscaperNativePluginStateCommandV29,
	type SoundscaperProjectCommandOptionsV29,
} from './editor-project-v29-commands.ts';
import { cloneSoundscaperProjectV29, type SoundscaperProjectV29 } from './editor-project-v29.ts';
import { validateSoundscaperProjectV29 } from './editor-project-v29-validation.ts';

export interface SoundscaperProjectHistoryEntryV29 {
	readonly project: SoundscaperProjectV29;
	readonly command: AudioEditorCommand | SoundscaperNativePluginStateCommandV29;
}

export interface SoundscaperProjectHistoryV29 {
	readonly limit: number;
	readonly present: SoundscaperProjectV29;
	readonly undoStack: readonly SoundscaperProjectHistoryEntryV29[];
	readonly redoStack: readonly SoundscaperProjectHistoryEntryV29[];
}

const asV29 = (state: SoundscaperProductionHistoryState): SoundscaperProjectHistoryV29 => (
	state as unknown as SoundscaperProjectHistoryV29
);

/** V29's history: the same production stack bound to V29's document authority. */
const V29: SoundscaperProductionHistoryRevision = {
	label: 'Soundscaper V29',
	validateProject: (project) => { validateSoundscaperProjectV29(project); },
	cloneProject: (project) => cloneSoundscaperProjectV29(project) as unknown as Record<string, unknown>,
	snapshotCommand: (command) => snapshotSoundscaperProjectCommandV29(command) as AudioEditorCommand,
	applyCommand: (project, command, options) => (
		applySoundscaperProjectCommandV29(project, command, options) as unknown as Record<string, unknown>
	),
};

export function createSoundscaperProjectHistoryV29(
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProjectHistoryV29 {
	return asV29(createSoundscaperProductionHistory(project, V29, options));
}

export function validateSoundscaperProjectHistoryV29(
	history: SoundscaperProjectHistoryV29 | unknown,
): history is SoundscaperProjectHistoryV29 {
	validateSoundscaperProductionHistory(history, V29);
	return true;
}

export function cloneSoundscaperProjectHistoryV29(
	history: SoundscaperProjectHistoryV29 | unknown,
): SoundscaperProjectHistoryV29 {
	return asV29(cloneSoundscaperProductionHistory(history, V29));
}

export function executeSoundscaperProjectCommandV29(
	history: SoundscaperProjectHistoryV29 | unknown,
	command: AudioEditorCommand | SoundscaperNativePluginStateCommandV29,
	options: SoundscaperProjectCommandOptionsV29 = {},
): SoundscaperProjectHistoryV29 {
	return asV29(executeSoundscaperProductionCommand(history, command as AudioEditorCommand, V29, options));
}

export function undoSoundscaperProjectCommandV29(
	history: SoundscaperProjectHistoryV29 | unknown,
	options: SoundscaperProjectCommandOptionsV29 = {},
): SoundscaperProjectHistoryV29 {
	return asV29(undoSoundscaperProductionCommand(history, V29, options));
}

export function redoSoundscaperProjectCommandV29(
	history: SoundscaperProjectHistoryV29 | unknown,
	options: SoundscaperProjectCommandOptionsV29 = {},
): SoundscaperProjectHistoryV29 {
	return asV29(redoSoundscaperProductionCommand(history, V29, options));
}
