/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	applySoundscaperProjectCommandV21,
	snapshotSoundscaperProjectCommandV21,
	type SoundscaperProjectCommandOptionsV21,
} from './editor-project-v21-commands.ts';
import {
	cloneSoundscaperProjectV21,
	type SoundscaperProjectV21,
} from './editor-project-v21.ts';
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

export function createSoundscaperProjectHistoryV21(
	project: SoundscaperProjectV21 | unknown,
	options: Readonly<{ limit?: number }> = {},
): SoundscaperProjectHistoryV21 {
	validateSoundscaperProjectV21(project);
	const limit = historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT);
	return { limit, present: cloneSoundscaperProjectV21(project), undoStack: [], redoStack: [] };
}

export function validateSoundscaperProjectHistoryV21(
	history: SoundscaperProjectHistoryV21 | unknown,
): history is SoundscaperProjectHistoryV21 {
	if (!history || typeof history !== 'object' || Array.isArray(history)) {
		throw new TypeError('A Soundscaper V21 history is required.');
	}
	const value = history as Partial<SoundscaperProjectHistoryV21>;
	const limit = historyLimit(value.limit);
	validateSoundscaperProjectV21(value.present);
	const projectId = value.present!.id;
	validateStack(value.undoStack, 'undoStack', limit, projectId);
	validateStack(value.redoStack, 'redoStack', limit, projectId);
	return true;
}

export function cloneSoundscaperProjectHistoryV21(
	history: SoundscaperProjectHistoryV21 | unknown,
): SoundscaperProjectHistoryV21 {
	validateSoundscaperProjectHistoryV21(history);
	const valid = history as SoundscaperProjectHistoryV21;
	return {
		limit: valid.limit,
		present: cloneSoundscaperProjectV21(valid.present),
		undoStack: valid.undoStack.map(cloneEntry),
		redoStack: valid.redoStack.map(cloneEntry),
	};
}

export function executeSoundscaperProjectCommandV21(
	history: SoundscaperProjectHistoryV21 | unknown,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV21 = {},
): SoundscaperProjectHistoryV21 {
	validateSoundscaperProjectHistoryV21(history);
	const valid = history as SoundscaperProjectHistoryV21;
	const normalized = snapshotSoundscaperProjectCommandV21(command);
	const present = applySoundscaperProjectCommandV21(valid.present, normalized, options);
	if (present === valid.present) return valid;
	return {
		limit: valid.limit,
		present,
		undoStack: [...valid.undoStack, {
			project: cloneSoundscaperProjectV21(valid.present), command: normalized,
		}].slice(-valid.limit),
		redoStack: [],
	};
}

export function undoSoundscaperProjectCommandV21(
	history: SoundscaperProjectHistoryV21 | unknown,
	options: SoundscaperProjectCommandOptionsV21 = {},
): SoundscaperProjectHistoryV21 {
	validateSoundscaperProjectHistoryV21(history);
	const valid = history as SoundscaperProjectHistoryV21;
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	return restore(valid, entry, valid.undoStack.slice(0, -1), [
		...valid.redoStack,
		{ project: cloneSoundscaperProjectV21(valid.present), command: entry.command },
	].slice(-valid.limit), options);
}

export function redoSoundscaperProjectCommandV21(
	history: SoundscaperProjectHistoryV21 | unknown,
	options: SoundscaperProjectCommandOptionsV21 = {},
): SoundscaperProjectHistoryV21 {
	validateSoundscaperProjectHistoryV21(history);
	const valid = history as SoundscaperProjectHistoryV21;
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	return restore(valid, entry, [
		...valid.undoStack,
		{ project: cloneSoundscaperProjectV21(valid.present), command: entry.command },
	].slice(-valid.limit), valid.redoStack.slice(0, -1), options);
}

function restore(
	history: SoundscaperProjectHistoryV21,
	entry: SoundscaperProjectHistoryEntryV21,
	undoStack: readonly SoundscaperProjectHistoryEntryV21[],
	redoStack: readonly SoundscaperProjectHistoryEntryV21[],
	options: SoundscaperProjectCommandOptionsV21,
): SoundscaperProjectHistoryV21 {
	const present = cloneSoundscaperProjectV21(entry.project) as unknown as Record<string, unknown>;
	const revision = Number(history.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Soundscaper V21 history revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	validateSoundscaperProjectV21(present);
	return {
		limit: history.limit, present: present as SoundscaperProjectV21, undoStack, redoStack,
	};
}

function validateStack(
	value: readonly SoundscaperProjectHistoryEntryV21[] | undefined,
	name: string,
	limit: number,
	projectId: string,
): void {
	if (!Array.isArray(value) || value.length > limit) {
		throw new RangeError(`Soundscaper V21 history ${name} is invalid.`);
	}
	for (const entry of value) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new TypeError(`Soundscaper V21 history ${name} entry is invalid.`);
		}
		validateSoundscaperProjectV21(entry.project);
		if (entry.project.id !== projectId) {
			throw new RangeError('Every Soundscaper V21 history snapshot must have the present project ID.');
		}
		snapshotSoundscaperProjectCommandV21(entry.command);
	}
}

function cloneEntry(entry: SoundscaperProjectHistoryEntryV21): SoundscaperProjectHistoryEntryV21 {
	return {
		project: cloneSoundscaperProjectV21(entry.project),
		command: snapshotSoundscaperProjectCommandV21(entry.command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError('Soundscaper V21 history limit must be a positive safe integer.');
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid V21 history timestamp is required.');
	return date.toISOString();
}
