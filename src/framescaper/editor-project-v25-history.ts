/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV25,
} from './editor-project-feature-requirements-v25.ts';
import {
	applyFramescaperProjectCommandV25,
	createFramescaperProfessionalMediaClipboardPasteCommandV25,
	snapshotFramescaperProjectCommandV25,
	type FramescaperProjectCommandOptionsV25,
	type FramescaperProjectCommandV25,
} from './editor-project-v25-commands.ts';
import { assertFramescaperProjectV25CandidateProfile } from './editor-project-runtime-profile-v25.ts';
import {
	cloneFramescaperProjectV25,
	type FramescaperProjectV25,
} from './editor-project-v25.ts';
import { validateFramescaperProjectV25 } from './editor-project-v25-validation.ts';

export interface FramescaperProjectHistoryEntryV25 {
	readonly project: FramescaperProjectV25;
	readonly command: FramescaperProjectCommandV25;
}

export interface FramescaperProjectHistoryV25 {
	readonly limit: number;
	readonly present: FramescaperProjectV25;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV25[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV25[];
}

export function createFramescaperProjectHistoryV25(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV25 {
	assertFramescaperProjectV25CandidateProfile(profile);
	validateFramescaperProjectV25(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectV25(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV25(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryV25 {
	assertFramescaperProjectV25CandidateProfile(profile);
	const candidate = historyRecord(history);
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectV25(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectV25).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`V25 ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = entryRecord(entry);
			validateFramescaperProjectV25(profile, item.project);
			if ((item.project as FramescaperProjectV25).id !== projectId) {
				throw new RangeError('Every V25 history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandV25(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandV25(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV25 = {},
): FramescaperProjectHistoryV25 {
	validateFramescaperProjectHistoryV25(profile, history);
	const current = history as FramescaperProjectHistoryV25;
	const normalized = snapshotFramescaperProjectCommandV25(command);
	const present = applyFramescaperProjectCommandV25(profile, current.present, normalized, options);
	return {
		limit: current.limit,
		present,
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)]
			.slice(-current.limit),
		redoStack: [],
	};
}

/** Paste admitted V9 sources through the same atomic history boundary as authored commands. */
export function executeFramescaperProfessionalMediaClipboardPasteV25(
	profile: unknown,
	history: unknown,
	clipboardValue: unknown,
	options: FramescaperProjectCommandOptionsV25 & Readonly<{
		sourceIdMap: ReadonlyMap<string, string>;
	}>,
): FramescaperProjectHistoryV25 {
	const command = createFramescaperProfessionalMediaClipboardPasteCommandV25(
		clipboardValue, { sourceIdMap: options.sourceIdMap },
	);
	return executeFramescaperProjectCommandV25(profile, history, command, { now: options.now });
}

export function undoFramescaperProjectCommandV25(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV25 = {},
): FramescaperProjectHistoryV25 {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandV25(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV25 = {},
): FramescaperProjectHistoryV25 {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsV25,
): FramescaperProjectHistoryV25 {
	validateFramescaperProjectHistoryV25(profile, history);
	const current = history as FramescaperProjectHistoryV25;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectV25(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V25 revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV25(profile, present);
	validateFramescaperProjectV25(profile, present);
	const oppositeEntry = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit,
		present: present as unknown as FramescaperProjectV25,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, oppositeEntry].slice(-current.limit),
	} : {
		limit: current.limit,
		present: present as unknown as FramescaperProjectV25,
		undoStack: [...current.undoStack, oppositeEntry].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectV25,
	command: FramescaperProjectCommandV25,
): FramescaperProjectHistoryEntryV25 {
	return {
		project: cloneFramescaperProjectV25(profile, project),
		command: snapshotFramescaperProjectCommandV25(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper V25 history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V25 history timestamp is invalid.');
	return date.toISOString();
}

function historyRecord(value: unknown): Record<string, unknown> {
	return exactRecord(value, ['limit', 'present', 'undoStack', 'redoStack'], 'V25 history');
}

function entryRecord(value: unknown): Record<string, unknown> {
	return exactRecord(value, ['project', 'command'], 'V25 history entry');
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be exact.`);
	}
	return value as Record<string, unknown>;
}
