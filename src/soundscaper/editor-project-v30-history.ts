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
	applySoundscaperProjectCommandV30,
	snapshotSoundscaperProjectCommandV30,
	type SoundscaperNativePluginStateCommandV30,
	type SoundscaperProjectCommandOptionsV30,
} from './editor-project-v30-commands.ts';
import { cloneSoundscaperProjectV30, type SoundscaperProjectV30 } from './editor-project-v30.ts';
import { validateSoundscaperProjectV30 } from './editor-project-v30-validation.ts';

export interface SoundscaperProjectHistoryEntryV30 {
	readonly project: SoundscaperProjectV30;
	readonly command: AudioEditorCommand | SoundscaperNativePluginStateCommandV30;
}

export interface SoundscaperProjectHistoryV30 {
	readonly limit: number;
	readonly present: SoundscaperProjectV30;
	readonly undoStack: readonly SoundscaperProjectHistoryEntryV30[];
	readonly redoStack: readonly SoundscaperProjectHistoryEntryV30[];
}

const asV30 = (state: SoundscaperProductionHistoryState): SoundscaperProjectHistoryV30 => (
	state as unknown as SoundscaperProjectHistoryV30
);

/** V30's history: the same production stack bound to V30's document authority. */
const V30: SoundscaperProductionHistoryRevision = {
	label: 'Soundscaper V30',
	validateProject: (project) => { validateSoundscaperProjectV30(project); },
	cloneProject: (project) => cloneSoundscaperProjectV30(project) as unknown as Record<string, unknown>,
	snapshotCommand: (command) => snapshotSoundscaperProjectCommandV30(command) as AudioEditorCommand,
	applyCommand: (project, command, options) => (
		applySoundscaperProjectCommandV30(project, command, options) as unknown as Record<string, unknown>
	),
};

export function createSoundscaperProjectHistoryV30(
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProjectHistoryV30 {
	return asV30(createSoundscaperProductionHistory(project, V30, options));
}

export function validateSoundscaperProjectHistoryV30(
	history: SoundscaperProjectHistoryV30 | unknown,
): history is SoundscaperProjectHistoryV30 {
	validateSoundscaperProductionHistory(history, V30);
	return true;
}

export function cloneSoundscaperProjectHistoryV30(
	history: SoundscaperProjectHistoryV30 | unknown,
): SoundscaperProjectHistoryV30 {
	return asV30(cloneSoundscaperProductionHistory(history, V30));
}

export function executeSoundscaperProjectCommandV30(
	history: SoundscaperProjectHistoryV30 | unknown,
	command: AudioEditorCommand | SoundscaperNativePluginStateCommandV30,
	options: SoundscaperProjectCommandOptionsV30 = {},
): SoundscaperProjectHistoryV30 {
	return asV30(executeSoundscaperProductionCommand(history, command as AudioEditorCommand, V30, options));
}

export function undoSoundscaperProjectCommandV30(
	history: SoundscaperProjectHistoryV30 | unknown,
	options: SoundscaperProjectCommandOptionsV30 = {},
): SoundscaperProjectHistoryV30 {
	return asV30(undoSoundscaperProductionCommand(history, V30, options));
}

export function redoSoundscaperProjectCommandV30(
	history: SoundscaperProjectHistoryV30 | unknown,
	options: SoundscaperProjectCommandOptionsV30 = {},
): SoundscaperProjectHistoryV30 {
	return asV30(redoSoundscaperProductionCommand(history, V30, options));
}
