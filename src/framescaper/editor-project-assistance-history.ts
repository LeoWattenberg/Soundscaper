/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsAssistance,
} from './editor-project-feature-requirements-assistance.ts';
import {
	applyFramescaperProjectCommandAssistance,
	snapshotFramescaperProjectCommandAssistance,
	type FramescaperProjectCommandOptionsAssistance,
	type FramescaperProjectCommandAssistance,
} from './editor-project-assistance-commands.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectAssistance,
	validateFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from './editor-project-assistance.ts';

export interface FramescaperProjectHistoryEntryAssistance {
	readonly project: FramescaperProjectAssistance;
	readonly command: FramescaperProjectCommandAssistance;
}

export interface FramescaperProjectHistoryAssistance {
	readonly limit: number;
	readonly present: FramescaperProjectAssistance;
	readonly undoStack: readonly FramescaperProjectHistoryEntryAssistance[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryAssistance[];
}

export function createFramescaperProjectHistoryAssistance(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	validateFramescaperProjectAssistance(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectAssistance(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryAssistance(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryAssistance {
	assertFramescaperProjectAssistanceProfile(profile);
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'assistance history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectAssistance(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectAssistance).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`assistance ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'assistance history entry');
			validateFramescaperProjectAssistance(profile, item.project);
			if ((item.project as FramescaperProjectAssistance).id !== projectId) {
				throw new RangeError('Every assistance history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandAssistance(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandAssistance(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsAssistance = {},
): FramescaperProjectHistoryAssistance {
	validateFramescaperProjectHistoryAssistance(profile, history);
	const current = history as FramescaperProjectHistoryAssistance;
	const normalized = snapshotFramescaperProjectCommandAssistance(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommandAssistance(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)].slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandAssistance(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsAssistance = {},
): FramescaperProjectHistoryAssistance {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandAssistance(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsAssistance = {},
): FramescaperProjectHistoryAssistance {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsAssistance,
): FramescaperProjectHistoryAssistance {
	validateFramescaperProjectHistoryAssistance(profile, history);
	const current = history as FramescaperProjectHistoryAssistance;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectAssistance(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper assistance revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsAssistance(profile, present);
	validateFramescaperProjectAssistance(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit,
		present: present as unknown as FramescaperProjectAssistance,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit,
		present: present as unknown as FramescaperProjectAssistance,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectAssistance,
	command: FramescaperProjectCommandAssistance,
): FramescaperProjectHistoryEntryAssistance {
	return {
		project: cloneFramescaperProjectAssistance(profile, project),
		command: snapshotFramescaperProjectCommandAssistance(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper assistance history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper assistance history timestamp is invalid.');
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
