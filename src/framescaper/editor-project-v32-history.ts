/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV32,
} from './editor-project-feature-requirements-v32.ts';
import {
	applyFramescaperProjectCommandV32,
	snapshotFramescaperProjectCommandV32,
	type FramescaperProjectCommandOptionsV32,
	type FramescaperProjectCommandV32,
} from './editor-project-v32-commands.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import {
	cloneFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32.ts';
import { validateFramescaperProjectV32 } from './editor-project-v32-validation.ts';

export interface FramescaperProjectHistoryEntryV32 {
	readonly project: FramescaperProjectV32;
	readonly command: FramescaperProjectCommandV32;
}

export interface FramescaperProjectHistoryV32 {
	readonly limit: number;
	readonly present: FramescaperProjectV32;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV32[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV32[];
}

export function createFramescaperProjectHistoryV32(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV32 {
	assertFramescaperProjectV32Profile(profile);
	validateFramescaperProjectV32(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectV32(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV32(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryV32 {
	assertFramescaperProjectV32Profile(profile);
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'V32 history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectV32(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectV32).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`V32 ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'V32 history entry');
			validateFramescaperProjectV32(profile, item.project);
			if ((item.project as FramescaperProjectV32).id !== projectId) {
				throw new RangeError('Every V32 history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandV32(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandV32(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsV32 = {},
): FramescaperProjectHistoryV32 {
	validateFramescaperProjectHistoryV32(profile, history);
	const current = history as FramescaperProjectHistoryV32;
	const normalized = snapshotFramescaperProjectCommandV32(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommandV32(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)].slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV32(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV32 = {},
): FramescaperProjectHistoryV32 {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandV32(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsV32 = {},
): FramescaperProjectHistoryV32 {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsV32,
): FramescaperProjectHistoryV32 {
	validateFramescaperProjectHistoryV32(profile, history);
	const current = history as FramescaperProjectHistoryV32;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectV32(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V32 revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV32(profile, present);
	validateFramescaperProjectV32(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit, present: present as unknown as FramescaperProjectV32,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit, present: present as unknown as FramescaperProjectV32,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectV32,
	command: FramescaperProjectCommandV32,
): FramescaperProjectHistoryEntryV32 {
	return {
		project: cloneFramescaperProjectV32(profile, project),
		command: snapshotFramescaperProjectCommandV32(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper V32 history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V32 history timestamp is invalid.');
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
