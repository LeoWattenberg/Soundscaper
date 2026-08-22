/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV24,
} from './editor-project-feature-requirements-v24.ts';
import {
	applyFramescaperProjectCommandV24,
	snapshotFramescaperProjectCommandV24,
	type FramescaperProjectCommandOptionsV24,
	type FramescaperProjectCommandV24,
} from './editor-project-v24-commands.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';
import {
	cloneFramescaperProjectV24,
	type FramescaperProjectV24,
} from './editor-project-v24.ts';
import { validateFramescaperProjectV24 } from './editor-project-v24-validation.ts';

export interface FramescaperProjectHistoryEntryV24 {
	readonly project: FramescaperProjectV24;
	readonly command: FramescaperProjectCommandV24;
}

export interface FramescaperProjectHistoryV24 {
	readonly limit: number;
	readonly present: FramescaperProjectV24;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV24[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV24[];
}

export function createFramescaperProjectHistoryV24(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV24 {
	assertFramescaperProjectV24CandidateProfile(profile);
	validateFramescaperProjectV24(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectV24(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV24(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryV24 {
	assertFramescaperProjectV24CandidateProfile(profile);
	const candidate = historyRecord(history);
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectV24(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectV24).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`V24 ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = entryRecord(entry);
			validateFramescaperProjectV24(profile, item.project);
			if ((item.project as FramescaperProjectV24).id !== projectId) {
				throw new RangeError('Every V24 history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandV24(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandV24(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV24 = {},
): FramescaperProjectHistoryV24 {
	validateFramescaperProjectHistoryV24(profile, history);
	const current = history as FramescaperProjectHistoryV24;
	const normalized = snapshotFramescaperProjectCommandV24(command);
	const present = applyFramescaperProjectCommandV24(profile, current.present, normalized, options);
	return {
		limit: current.limit,
		present,
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)]
			.slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV24(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV24 = {},
): FramescaperProjectHistoryV24 {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandV24(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV24 = {},
): FramescaperProjectHistoryV24 {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsV24,
): FramescaperProjectHistoryV24 {
	validateFramescaperProjectHistoryV24(profile, history);
	const current = history as FramescaperProjectHistoryV24;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectV24(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V24 revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV24(profile, present);
	validateFramescaperProjectV24(profile, present);
	const oppositeEntry = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit,
		present: present as unknown as FramescaperProjectV24,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, oppositeEntry].slice(-current.limit),
	} : {
		limit: current.limit,
		present: present as unknown as FramescaperProjectV24,
		undoStack: [...current.undoStack, oppositeEntry].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectV24,
	command: FramescaperProjectCommandV24,
): FramescaperProjectHistoryEntryV24 {
	return {
		project: cloneFramescaperProjectV24(profile, project),
		command: snapshotFramescaperProjectCommandV24(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper V24 history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V24 history timestamp is invalid.');
	return date.toISOString();
}

function historyRecord(value: unknown): Record<string, unknown> {
	return exactRecord(value, ['limit', 'present', 'undoStack', 'redoStack'], 'V24 history');
}

function entryRecord(value: unknown): Record<string, unknown> {
	return exactRecord(value, ['project', 'command'], 'V24 history entry');
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be exact.`);
	}
	return value as Record<string, unknown>;
}
