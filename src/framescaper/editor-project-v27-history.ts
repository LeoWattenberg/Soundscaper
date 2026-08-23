/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV27,
} from './editor-project-feature-requirements-v27.ts';
import {
	applyFramescaperProjectCommandV27,
	snapshotFramescaperProjectCommandV27,
	type FramescaperProjectCommandOptionsV27,
	type FramescaperProjectCommandV27,
} from './editor-project-v27-commands.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	cloneFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27.ts';
import { validateFramescaperProjectV27 } from './editor-project-v27-validation.ts';

export interface FramescaperProjectHistoryEntryV27 {
	readonly project: FramescaperProjectV27;
	readonly command: FramescaperProjectCommandV27;
}

export interface FramescaperProjectHistoryV27 {
	readonly limit: number;
	readonly present: FramescaperProjectV27;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV27[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV27[];
}

export function createFramescaperProjectHistoryV27(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV27 {
	assertFramescaperProjectV27Profile(profile);
	validateFramescaperProjectV27(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectV27(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV27(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryV27 {
	assertFramescaperProjectV27Profile(profile);
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'V27 history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectV27(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectV27).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`V27 ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'V27 history entry');
			validateFramescaperProjectV27(profile, item.project);
			if ((item.project as FramescaperProjectV27).id !== projectId) {
				throw new RangeError('Every V27 history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandV27(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandV27(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV27 = {},
): FramescaperProjectHistoryV27 {
	validateFramescaperProjectHistoryV27(profile, history);
	const current = history as FramescaperProjectHistoryV27;
	const normalized = snapshotFramescaperProjectCommandV27(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommandV27(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)].slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV27(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV27 = {},
): FramescaperProjectHistoryV27 {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandV27(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV27 = {},
): FramescaperProjectHistoryV27 {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsV27,
): FramescaperProjectHistoryV27 {
	validateFramescaperProjectHistoryV27(profile, history);
	const current = history as FramescaperProjectHistoryV27;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectV27(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V27 revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(profile, present);
	validateFramescaperProjectV27(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit, present: present as unknown as FramescaperProjectV27,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit, present: present as unknown as FramescaperProjectV27,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectV27,
	command: FramescaperProjectCommandV27,
): FramescaperProjectHistoryEntryV27 {
	return {
		project: cloneFramescaperProjectV27(profile, project),
		command: snapshotFramescaperProjectCommandV27(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper V27 history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V27 history timestamp is invalid.');
	return date.toISOString();
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be exact.`);
	}
	return value as Record<string, unknown>;
}
