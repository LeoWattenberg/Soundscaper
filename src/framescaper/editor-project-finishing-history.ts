/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsFinishing,
} from './editor-project-feature-requirements-finishing.ts';
import {
	applyFramescaperProjectCommandFinishing,
	snapshotFramescaperProjectCommandFinishing,
	type FramescaperProjectCommandOptionsFinishing,
	type FramescaperProjectCommandFinishing,
} from './editor-project-finishing-commands.ts';
import { assertFramescaperProjectFinishingProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing.ts';
import { validateFramescaperProjectFinishing } from './editor-project-finishing-validation.ts';

export interface FramescaperProjectHistoryEntryFinishing {
	readonly project: FramescaperProjectFinishing;
	readonly command: FramescaperProjectCommandFinishing;
}

export interface FramescaperProjectHistoryFinishing {
	readonly limit: number;
	readonly present: FramescaperProjectFinishing;
	readonly undoStack: readonly FramescaperProjectHistoryEntryFinishing[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryFinishing[];
}

export function createFramescaperProjectHistoryFinishing(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	validateFramescaperProjectFinishing(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectFinishing(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryFinishing(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'finishing history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectFinishing(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectFinishing).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`finishing ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'finishing history entry');
			validateFramescaperProjectFinishing(profile, item.project);
			if ((item.project as FramescaperProjectFinishing).id !== projectId) {
				throw new RangeError('Every finishing history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandFinishing(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandFinishing(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsFinishing = {},
): FramescaperProjectHistoryFinishing {
	validateFramescaperProjectHistoryFinishing(profile, history);
	const current = history as FramescaperProjectHistoryFinishing;
	const normalized = snapshotFramescaperProjectCommandFinishing(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommandFinishing(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)].slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandFinishing(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsFinishing = {},
): FramescaperProjectHistoryFinishing {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandFinishing(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsFinishing = {},
): FramescaperProjectHistoryFinishing {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsFinishing,
): FramescaperProjectHistoryFinishing {
	validateFramescaperProjectHistoryFinishing(profile, history);
	const current = history as FramescaperProjectHistoryFinishing;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectFinishing(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper finishing revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsFinishing(profile, present);
	validateFramescaperProjectFinishing(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit, present: present as unknown as FramescaperProjectFinishing,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit, present: present as unknown as FramescaperProjectFinishing,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectFinishing,
	command: FramescaperProjectCommandFinishing,
): FramescaperProjectHistoryEntryFinishing {
	return {
		project: cloneFramescaperProjectFinishing(profile, project),
		command: snapshotFramescaperProjectCommandFinishing(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper finishing history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper finishing history timestamp is invalid.');
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
