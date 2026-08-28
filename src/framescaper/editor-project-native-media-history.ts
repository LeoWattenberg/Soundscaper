/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsNativeMedia,
} from './editor-project-feature-requirements-native-media.ts';
import {
	applyFramescaperProjectCommandNativeMedia,
	snapshotFramescaperProjectCommandNativeMedia,
	type FramescaperProjectCommandOptionsNativeMedia,
	type FramescaperProjectCommandNativeMedia,
} from './editor-project-native-media-commands.ts';
import { assertFramescaperProjectNativeMediaProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectNativeMedia,
	type FramescaperProjectNativeMedia,
} from './editor-project-native-media.ts';
import { validateFramescaperProjectNativeMedia } from './editor-project-native-media-validation.ts';

export interface FramescaperProjectHistoryEntryNativeMedia {
	readonly project: FramescaperProjectNativeMedia;
	readonly command: FramescaperProjectCommandNativeMedia;
}

export interface FramescaperProjectHistoryNativeMedia {
	readonly limit: number;
	readonly present: FramescaperProjectNativeMedia;
	readonly undoStack: readonly FramescaperProjectHistoryEntryNativeMedia[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryNativeMedia[];
}

export function createFramescaperProjectHistoryNativeMedia(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	validateFramescaperProjectNativeMedia(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectNativeMedia(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryNativeMedia(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'nativeMedia history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectNativeMedia(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectNativeMedia).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`nativeMedia ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'nativeMedia history entry');
			validateFramescaperProjectNativeMedia(profile, item.project);
			if ((item.project as FramescaperProjectNativeMedia).id !== projectId) {
				throw new RangeError('Every nativeMedia history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandNativeMedia(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandNativeMedia(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsNativeMedia = {},
): FramescaperProjectHistoryNativeMedia {
	validateFramescaperProjectHistoryNativeMedia(profile, history);
	const current = history as FramescaperProjectHistoryNativeMedia;
	const normalized = snapshotFramescaperProjectCommandNativeMedia(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommandNativeMedia(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)].slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandNativeMedia(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsNativeMedia = {},
): FramescaperProjectHistoryNativeMedia {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandNativeMedia(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsNativeMedia = {},
): FramescaperProjectHistoryNativeMedia {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsNativeMedia,
): FramescaperProjectHistoryNativeMedia {
	validateFramescaperProjectHistoryNativeMedia(profile, history);
	const current = history as FramescaperProjectHistoryNativeMedia;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectNativeMedia(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper nativeMedia revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsNativeMedia(profile, present);
	validateFramescaperProjectNativeMedia(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit, present: present as unknown as FramescaperProjectNativeMedia,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit, present: present as unknown as FramescaperProjectNativeMedia,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectNativeMedia,
	command: FramescaperProjectCommandNativeMedia,
): FramescaperProjectHistoryEntryNativeMedia {
	return {
		project: cloneFramescaperProjectNativeMedia(profile, project),
		command: snapshotFramescaperProjectCommandNativeMedia(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper nativeMedia history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper nativeMedia history timestamp is invalid.');
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
