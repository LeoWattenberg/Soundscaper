/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	applyFramescaperProjectCommandV18,
	type FramescaperProjectCommandOptionsV18,
} from './editor-project-v18-commands.ts';
import {
	cloneFramescaperProjectV18,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';

export interface FramescaperProjectHistoryEntryV18 {
	readonly project: FramescaperProjectV18;
	readonly command: AudioEditorCommand;
}

export interface FramescaperProjectHistoryV18 {
	readonly limit: number;
	readonly present: FramescaperProjectV18;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV18[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV18[];
}

export function createFramescaperProjectHistoryV18(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV18 | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV18 {
	assertFramescaperProjectV18Profile(profile);
	validateFramescaperProjectV18(profile, project);
	const limit = options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT;
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('V18 history limit must be a positive safe integer.');
	return {
		limit,
		present: cloneFramescaperProjectV18(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV18(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV18 | unknown,
): history is FramescaperProjectHistoryV18 {
	assertFramescaperProjectV18Profile(profile);
	if (!history || typeof history !== 'object' || Array.isArray(history)) {
		throw new TypeError('A Framescaper V18 project history is required.');
	}
	const value = history as Partial<FramescaperProjectHistoryV18>;
	if (!Number.isSafeInteger(value.limit) || Number(value.limit) < 1) {
		throw new RangeError('V18 history limit must be a positive safe integer.');
	}
	validateFramescaperProjectV18(profile, value.present);
	const projectId = value.present?.id;
	for (const [name, stack] of [['undoStack', value.undoStack], ['redoStack', value.redoStack]] as const) {
		if (!Array.isArray(stack)) throw new TypeError(`V18 history ${name} must be an array.`);
		if (stack.length > Number(value.limit)) throw new RangeError(`V18 history ${name} exceeds its limit.`);
		for (const [index, entry] of stack.entries()) {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
				throw new TypeError(`V18 history ${name}[${String(index)}] must be an entry.`);
			}
			validateFramescaperProjectV18(profile, entry.project);
			if (entry.project.id !== projectId) throw new RangeError('Every V18 history snapshot must belong to the present project.');
			if (!entry.command || typeof entry.command !== 'object' || typeof entry.command.type !== 'string') {
				throw new TypeError('Every V18 history entry requires a command.');
			}
		}
	}
	return true;
}

export function cloneFramescaperProjectHistoryV18(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV18 | unknown,
): FramescaperProjectHistoryV18 {
	validateFramescaperProjectHistoryV18(profile, history);
	const valid = history as FramescaperProjectHistoryV18;
	return {
		limit: valid.limit,
		present: cloneFramescaperProjectV18(profile, valid.present),
		undoStack: valid.undoStack.map((entry) => ({
			project: cloneFramescaperProjectV18(profile, entry.project),
			command: structuredClone(entry.command),
		})),
		redoStack: valid.redoStack.map((entry) => ({
			project: cloneFramescaperProjectV18(profile, entry.project),
			command: structuredClone(entry.command),
		})),
	};
}

export function executeFramescaperProjectCommandV18(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV18 | unknown,
	command: AudioEditorCommand,
	options: FramescaperProjectCommandOptionsV18 = {},
): FramescaperProjectHistoryV18 {
	validateFramescaperProjectHistoryV18(profile, history);
	const valid = history as FramescaperProjectHistoryV18;
	const present = applyFramescaperProjectCommandV18(profile, valid.present, command, options);
	return {
		limit: valid.limit,
		present,
		undoStack: [...valid.undoStack, { project: valid.present, command: structuredClone(command) }].slice(-valid.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV18(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV18 | unknown,
	options: FramescaperProjectCommandOptionsV18 = {},
): FramescaperProjectHistoryV18 {
	validateFramescaperProjectHistoryV18(profile, history);
	const valid = history as FramescaperProjectHistoryV18;
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	return restore(profile, valid, entry, valid.undoStack.slice(0, -1), [
		...valid.redoStack,
		{ project: valid.present, command: entry.command },
	].slice(-valid.limit), options);
}

export function redoFramescaperProjectCommandV18(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV18 | unknown,
	options: FramescaperProjectCommandOptionsV18 = {},
): FramescaperProjectHistoryV18 {
	validateFramescaperProjectHistoryV18(profile, history);
	const valid = history as FramescaperProjectHistoryV18;
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	return restore(profile, valid, entry, [
		...valid.undoStack,
		{ project: valid.present, command: entry.command },
	].slice(-valid.limit), valid.redoStack.slice(0, -1), options);
}

function restore(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV18,
	entry: FramescaperProjectHistoryEntryV18,
	undoStack: readonly FramescaperProjectHistoryEntryV18[],
	redoStack: readonly FramescaperProjectHistoryEntryV18[],
	options: FramescaperProjectCommandOptionsV18,
): FramescaperProjectHistoryV18 {
	const present = cloneFramescaperProjectV18(profile, entry.project) as unknown as Record<string, unknown>;
	present.revision = Number(history.present.revision) + 1;
	present.updatedAt = timestamp(options.now);
	validateFramescaperProjectV18(profile, present);
	return { limit: history.limit, present: present as FramescaperProjectV18, undoStack, redoStack };
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid V18 history timestamp is required.');
	return date.toISOString();
}
