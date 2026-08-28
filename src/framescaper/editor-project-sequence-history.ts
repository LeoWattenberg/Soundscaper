/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandSequence,
	type FramescaperProjectCommandOptionsSequence,
} from './editor-project-sequence-commands.ts';
import {
	cloneFramescaperProjectSequence,
	validateFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence.ts';
import type { FramescaperProjectCommandSequence } from './editor-project-sequence-subsequence.ts';

export interface FramescaperProjectHistoryEntrySequence {
	readonly project: FramescaperProjectSequence;
	readonly command: FramescaperProjectCommandSequence;
}

export interface FramescaperProjectHistorySequence {
	readonly limit: number;
	readonly present: FramescaperProjectSequence;
	readonly undoStack: readonly FramescaperProjectHistoryEntrySequence[];
	readonly redoStack: readonly FramescaperProjectHistoryEntrySequence[];
}

export function createFramescaperProjectHistorySequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectSequence | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistorySequence {
	assertFramescaperProjectSequenceProfile(profile);
	validateFramescaperProjectSequence(profile, project);
	const limit = options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT;
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('sequence history limit must be a positive safe integer.');
	return {
		limit,
		present: cloneFramescaperProjectSequence(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistorySequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
): history is FramescaperProjectHistorySequence {
	assertFramescaperProjectSequenceProfile(profile);
	if (!history || typeof history !== 'object' || Array.isArray(history)) {
		throw new TypeError('A Framescaper sequence project history is required.');
	}
	const value = history as Partial<FramescaperProjectHistorySequence>;
	if (!Number.isSafeInteger(value.limit) || Number(value.limit) < 1) {
		throw new RangeError('sequence history limit must be a positive safe integer.');
	}
	validateFramescaperProjectSequence(profile, value.present);
	const projectId = value.present?.id;
	for (const [name, stack] of [['undoStack', value.undoStack], ['redoStack', value.redoStack]] as const) {
		if (!Array.isArray(stack)) throw new TypeError(`sequence history ${name} must be an array.`);
		if (stack.length > Number(value.limit)) throw new RangeError(`sequence history ${name} exceeds its limit.`);
		for (const [index, entry] of stack.entries()) {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
				throw new TypeError(`sequence history ${name}[${String(index)}] must be an entry.`);
			}
			validateFramescaperProjectSequence(profile, entry.project);
			if (entry.project.id !== projectId) throw new RangeError('Every sequence history snapshot must belong to the present project.');
			if (!entry.command || typeof entry.command !== 'object' || typeof entry.command.type !== 'string') {
				throw new TypeError('Every sequence history entry requires a command.');
			}
		}
	}
	return true;
}

export function cloneFramescaperProjectHistorySequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
): FramescaperProjectHistorySequence {
	validateFramescaperProjectHistorySequence(profile, history);
	const valid = history as FramescaperProjectHistorySequence;
	return {
		limit: valid.limit,
		present: cloneFramescaperProjectSequence(profile, valid.present),
		undoStack: valid.undoStack.map((entry) => ({
			project: cloneFramescaperProjectSequence(profile, entry.project),
			command: structuredClone(entry.command),
		})),
		redoStack: valid.redoStack.map((entry) => ({
			project: cloneFramescaperProjectSequence(profile, entry.project),
			command: structuredClone(entry.command),
		})),
	};
}

export function executeFramescaperProjectCommandSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
	command: FramescaperProjectCommandSequence,
	options: FramescaperProjectCommandOptionsSequence = {},
): FramescaperProjectHistorySequence {
	validateFramescaperProjectHistorySequence(profile, history);
	const valid = history as FramescaperProjectHistorySequence;
	const present = applyFramescaperProjectCommandSequence(profile, valid.present, command, options);
	return {
		limit: valid.limit,
		present,
		undoStack: [...valid.undoStack, { project: valid.present, command: structuredClone(command) }].slice(-valid.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
	options: FramescaperProjectCommandOptionsSequence = {},
): FramescaperProjectHistorySequence {
	validateFramescaperProjectHistorySequence(profile, history);
	const valid = history as FramescaperProjectHistorySequence;
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	return restore(profile, valid, entry, valid.undoStack.slice(0, -1), [
		...valid.redoStack,
		{ project: valid.present, command: entry.command },
	].slice(-valid.limit), options);
}

export function redoFramescaperProjectCommandSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence | unknown,
	options: FramescaperProjectCommandOptionsSequence = {},
): FramescaperProjectHistorySequence {
	validateFramescaperProjectHistorySequence(profile, history);
	const valid = history as FramescaperProjectHistorySequence;
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	return restore(profile, valid, entry, [
		...valid.undoStack,
		{ project: valid.present, command: entry.command },
	].slice(-valid.limit), valid.redoStack.slice(0, -1), options);
}

function restore(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistorySequence,
	entry: FramescaperProjectHistoryEntrySequence,
	undoStack: readonly FramescaperProjectHistoryEntrySequence[],
	redoStack: readonly FramescaperProjectHistoryEntrySequence[],
	options: FramescaperProjectCommandOptionsSequence,
): FramescaperProjectHistorySequence {
	const present = cloneFramescaperProjectSequence(profile, entry.project) as unknown as Record<string, unknown>;
	present.revision = Number(history.present.revision) + 1;
	present.updatedAt = timestamp(options.now);
	validateFramescaperProjectSequence(profile, present);
	return { limit: history.limit, present: present as FramescaperProjectSequence, undoStack, redoStack };
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid sequence history timestamp is required.');
	return date.toISOString();
}
