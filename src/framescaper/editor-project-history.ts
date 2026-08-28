/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	applyFramescaperProjectCommand,
	snapshotFramescaperProjectCommand,
	type FramescaperProjectCommand,
	type FramescaperProjectCommandOptions,
} from './editor-project-commands.ts';
import {
	cloneFramescaperProject,
	validateFramescaperProject,
	type FramescaperProject,
} from './editor-project.ts';

export interface FramescaperProjectHistoryEntry {
	readonly project: FramescaperProject;
	readonly command: FramescaperProjectCommand;
}

export interface FramescaperProjectHistory {
	readonly limit: number;
	readonly present: FramescaperProject;
	readonly undoStack: readonly FramescaperProjectHistoryEntry[];
	readonly redoStack: readonly FramescaperProjectHistoryEntry[];
}

export function createFramescaperProjectHistory(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistory {
	validateFramescaperProject(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProject(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistory(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistory {
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProject(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProject).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) {
			throw new RangeError(`Framescaper ${name} exceeds its limit.`);
		}
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'history entry');
			validateFramescaperProject(profile, item.project);
			if ((item.project as FramescaperProject).id !== projectId) {
				throw new RangeError('Every Framescaper history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommand(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommand(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptions = {},
): FramescaperProjectHistory {
	validateFramescaperProjectHistory(profile, history);
	const current = history as FramescaperProjectHistory;
	const normalized = snapshotFramescaperProjectCommand(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommand(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)]
			.slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommand(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptions = {},
): FramescaperProjectHistory {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommand(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptions = {},
): FramescaperProjectHistory {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptions,
): FramescaperProjectHistory {
	validateFramescaperProjectHistory(profile, history);
	const current = history as FramescaperProjectHistory;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProject(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	validateFramescaperProject(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit,
		present: present as unknown as FramescaperProject,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit,
		present: present as unknown as FramescaperProject,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProject,
	command: FramescaperProjectCommand,
): FramescaperProjectHistoryEntry {
	return {
		project: cloneFramescaperProject(profile, project),
		command: snapshotFramescaperProjectCommand(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(
			`Framescaper history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`,
		);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper history timestamp is invalid.');
	return date.toISOString();
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Framescaper ${name} must be an object.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => (
		typeof key !== 'string' || !fields.includes(key)
	))) throw new TypeError(`Framescaper ${name} must be exact.`);
	return value as Record<string, unknown>;
}
