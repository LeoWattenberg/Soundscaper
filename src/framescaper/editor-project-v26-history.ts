/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV26,
} from './editor-project-feature-requirements-v26.ts';
import {
	applyFramescaperProjectCommandV26,
	snapshotFramescaperProjectCommandV26,
	type FramescaperProjectCommandOptionsV26,
	type FramescaperProjectCommandV26,
} from './editor-project-v26-commands.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';
import {
	cloneFramescaperProjectV26,
	type FramescaperProjectV26,
} from './editor-project-v26.ts';
import { validateFramescaperProjectV26 } from './editor-project-v26-validation.ts';

export interface FramescaperProjectHistoryEntryV26 {
	readonly project: FramescaperProjectV26;
	readonly command: FramescaperProjectCommandV26;
}

export interface FramescaperProjectHistoryV26 {
	readonly limit: number;
	readonly present: FramescaperProjectV26;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV26[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV26[];
}

export function createFramescaperProjectHistoryV26(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV26 {
	assertFramescaperProjectV26CandidateProfile(profile);
	validateFramescaperProjectV26(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectV26(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV26(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryV26 {
	assertFramescaperProjectV26CandidateProfile(profile);
	const candidate = historyRecord(history);
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectV26(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectV26).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`V26 ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = entryRecord(entry);
			validateFramescaperProjectV26(profile, item.project);
			if ((item.project as FramescaperProjectV26).id !== projectId) {
				throw new RangeError('Every V26 history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandV26(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandV26(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV26 = {},
): FramescaperProjectHistoryV26 {
	validateFramescaperProjectHistoryV26(profile, history);
	const current = history as FramescaperProjectHistoryV26;
	const normalized = snapshotFramescaperProjectCommandV26(command);
	const present = applyFramescaperProjectCommandV26(profile, current.present, normalized, options);
	return {
		limit: current.limit,
		present,
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)]
			.slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV26(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV26 = {},
): FramescaperProjectHistoryV26 {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandV26(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV26 = {},
): FramescaperProjectHistoryV26 {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsV26,
): FramescaperProjectHistoryV26 {
	validateFramescaperProjectHistoryV26(profile, history);
	const current = history as FramescaperProjectHistoryV26;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectV26(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V26 revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV26(profile, present);
	validateFramescaperProjectV26(profile, present);
	const oppositeEntry = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit,
		present: present as unknown as FramescaperProjectV26,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, oppositeEntry].slice(-current.limit),
	} : {
		limit: current.limit,
		present: present as unknown as FramescaperProjectV26,
		undoStack: [...current.undoStack, oppositeEntry].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectV26,
	command: FramescaperProjectCommandV26,
): FramescaperProjectHistoryEntryV26 {
	return {
		project: cloneFramescaperProjectV26(profile, project),
		command: snapshotFramescaperProjectCommandV26(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper V26 history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V26 history timestamp is invalid.');
	return date.toISOString();
}

function historyRecord(value: unknown): Record<string, unknown> {
	return exactRecord(value, ['limit', 'present', 'undoStack', 'redoStack'], 'V26 history');
}

function entryRecord(value: unknown): Record<string, unknown> {
	return exactRecord(value, ['project', 'command'], 'V26 history entry');
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be exact.`);
	}
	return value as Record<string, unknown>;
}
