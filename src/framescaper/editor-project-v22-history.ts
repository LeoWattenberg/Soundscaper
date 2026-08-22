/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import { reconcileFramescaperProjectFeatureRequirementsV22 } from './editor-project-feature-requirements-v22.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';
import {
	applyFramescaperProjectCommandV22,
	snapshotFramescaperProjectCommandV22,
	type FramescaperProjectCommandOptionsV22,
	type FramescaperProjectCommandV22,
} from './editor-project-v22-commands.ts';
import {
	cloneFramescaperProjectV22,
	type FramescaperProjectV22,
} from './editor-project-v22.ts';
import { validateFramescaperProjectV22 } from './editor-project-v22-validation.ts';

export interface FramescaperProjectHistoryEntryV22 {
	readonly project: FramescaperProjectV22;
	readonly command: FramescaperProjectCommandV22;
}

export interface FramescaperProjectHistoryV22 {
	readonly limit: number;
	readonly present: FramescaperProjectV22;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV22[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV22[];
}

export function createFramescaperProjectHistoryV22(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	validateFramescaperProjectV22(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectV22(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV22(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	const candidate = historyRecord(history);
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectV22(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectV22).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`V22 ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = entryRecord(entry);
			validateFramescaperProjectV22(profile, item.project);
			if ((item.project as FramescaperProjectV22).id !== projectId) {
				throw new RangeError('Every V22 history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandV22(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandV22(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV22 = {},
): FramescaperProjectHistoryV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	validateFramescaperProjectHistoryV22(profile, history);
	const current = history as FramescaperProjectHistoryV22;
	const normalized = snapshotFramescaperProjectCommandV22(command);
	const present = applyFramescaperProjectCommandV22(profile, current.present, normalized, options);
	return {
		limit: current.limit,
		present,
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)]
			.slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV22(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV22 = {},
): FramescaperProjectHistoryV22 {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandV22(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV22 = {},
): FramescaperProjectHistoryV22 {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsV22,
): FramescaperProjectHistoryV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	validateFramescaperProjectHistoryV22(profile, history);
	const current = history as FramescaperProjectHistoryV22;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectV22(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = current.present.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V22 revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV22(profile, present);
	validateFramescaperProjectV22(profile, present);
	const oppositeEntry = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit,
		present: present as FramescaperProjectV22,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, oppositeEntry].slice(-current.limit),
	} : {
		limit: current.limit,
		present: present as FramescaperProjectV22,
		undoStack: [...current.undoStack, oppositeEntry].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectV22,
	command: FramescaperProjectCommandV22,
): FramescaperProjectHistoryEntryV22 {
	return {
		project: cloneFramescaperProjectV22(profile, project),
		command: snapshotFramescaperProjectCommandV22(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper V22 history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: unknown): string {
	const date = value === undefined ? new Date() : new Date(String(value));
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V22 history timestamp is invalid.');
	return date.toISOString();
}

function historyRecord(value: unknown): Record<string, unknown> {
	return exactRecord(value, ['limit', 'present', 'undoStack', 'redoStack'], 'V22 history');
}

function entryRecord(value: unknown): Record<string, unknown> {
	return exactRecord(value, ['project', 'command'], 'V22 history entry');
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be exact.`);
	}
	return value as Record<string, unknown>;
}
