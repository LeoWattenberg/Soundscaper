/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import {
	applyFramescaperProjectCommandV30,
	snapshotFramescaperProjectCommandV30,
	type FramescaperProjectCommandOptionsV30,
	type FramescaperProjectCommandV30,
} from './editor-project-v30-commands.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';
import {
	cloneFramescaperProjectV30,
	type FramescaperProjectV30,
} from './editor-project-v30.ts';
import { validateFramescaperProjectV30 } from './editor-project-v30-validation.ts';

export interface FramescaperProjectHistoryEntryV30 {
	readonly project: FramescaperProjectV30;
	readonly command: FramescaperProjectCommandV30;
}

export interface FramescaperProjectHistoryV30 {
	readonly limit: number;
	readonly present: FramescaperProjectV30;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV30[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV30[];
}

export function createFramescaperProjectHistoryV30(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV30 {
	assertFramescaperProjectV30Profile(profile);
	validateFramescaperProjectV30(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectV30(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV30(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryV30 {
	assertFramescaperProjectV30Profile(profile);
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'V30 history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectV30(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectV30).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`V30 ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'V30 history entry');
			validateFramescaperProjectV30(profile, item.project);
			if ((item.project as FramescaperProjectV30).id !== projectId) {
				throw new RangeError('Every V30 history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandV30(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandV30(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV30 = {},
): FramescaperProjectHistoryV30 {
	validateFramescaperProjectHistoryV30(profile, history);
	const current = history as FramescaperProjectHistoryV30;
	const normalized = snapshotFramescaperProjectCommandV30(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommandV30(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)].slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV30(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV30 = {},
): FramescaperProjectHistoryV30 {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandV30(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV30 = {},
): FramescaperProjectHistoryV30 {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsV30,
): FramescaperProjectHistoryV30 {
	validateFramescaperProjectHistoryV30(profile, history);
	const current = history as FramescaperProjectHistoryV30;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectV30(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V30 revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV30(profile, present);
	validateFramescaperProjectV30(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit, present: present as unknown as FramescaperProjectV30,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit, present: present as unknown as FramescaperProjectV30,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectV30,
	command: FramescaperProjectCommandV30,
): FramescaperProjectHistoryEntryV30 {
	return {
		project: cloneFramescaperProjectV30(profile, project),
		command: snapshotFramescaperProjectCommandV30(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper V30 history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V30 history timestamp is invalid.');
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
