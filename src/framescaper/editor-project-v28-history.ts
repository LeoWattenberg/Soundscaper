/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV28,
} from './editor-project-feature-requirements-v28.ts';
import {
	applyFramescaperProjectCommandV28,
	snapshotFramescaperProjectCommandV28,
	type FramescaperProjectCommandOptionsV28,
	type FramescaperProjectCommandV28,
} from './editor-project-v28-commands.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import {
	cloneFramescaperProjectV28,
	type FramescaperProjectV28,
} from './editor-project-v28.ts';
import { validateFramescaperProjectV28 } from './editor-project-v28-validation.ts';

export interface FramescaperProjectHistoryEntryV28 {
	readonly project: FramescaperProjectV28;
	readonly command: FramescaperProjectCommandV28;
}

export interface FramescaperProjectHistoryV28 {
	readonly limit: number;
	readonly present: FramescaperProjectV28;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV28[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV28[];
}

export function createFramescaperProjectHistoryV28(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV28 {
	assertFramescaperProjectV28Profile(profile);
	validateFramescaperProjectV28(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectV28(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV28(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryV28 {
	assertFramescaperProjectV28Profile(profile);
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'V28 history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectV28(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectV28).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`V28 ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'V28 history entry');
			validateFramescaperProjectV28(profile, item.project);
			if ((item.project as FramescaperProjectV28).id !== projectId) {
				throw new RangeError('Every V28 history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandV28(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandV28(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV28 = {},
): FramescaperProjectHistoryV28 {
	validateFramescaperProjectHistoryV28(profile, history);
	const current = history as FramescaperProjectHistoryV28;
	const normalized = snapshotFramescaperProjectCommandV28(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommandV28(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)].slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV28(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV28 = {},
): FramescaperProjectHistoryV28 {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandV28(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV28 = {},
): FramescaperProjectHistoryV28 {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsV28,
): FramescaperProjectHistoryV28 {
	validateFramescaperProjectHistoryV28(profile, history);
	const current = history as FramescaperProjectHistoryV28;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectV28(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V28 revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV28(profile, present);
	validateFramescaperProjectV28(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit, present: present as unknown as FramescaperProjectV28,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit, present: present as unknown as FramescaperProjectV28,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectV28,
	command: FramescaperProjectCommandV28,
): FramescaperProjectHistoryEntryV28 {
	return {
		project: cloneFramescaperProjectV28(profile, project),
		command: snapshotFramescaperProjectCommandV28(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper V28 history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V28 history timestamp is invalid.');
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
