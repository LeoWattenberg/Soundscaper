/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	reconcileFramescaperProjectFeatureRequirementsTimelineImage,
} from './editor-project-feature-requirements-timeline-image.ts';
import {
	applyFramescaperProjectCommandTimelineImage,
	snapshotFramescaperProjectCommandTimelineImage,
	type FramescaperProjectCommandOptionsTimelineImage,
	type FramescaperProjectCommandTimelineImage,
} from './editor-project-timeline-image-commands.ts';
import { assertFramescaperProjectTimelineImageProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectTimelineImage,
	type FramescaperProjectTimelineImage,
} from './editor-project-timeline-image.ts';
import { validateFramescaperProjectTimelineImage } from './editor-project-timeline-image-validation.ts';

export interface FramescaperProjectHistoryEntryTimelineImage {
	readonly project: FramescaperProjectTimelineImage;
	readonly command: FramescaperProjectCommandTimelineImage;
}

export interface FramescaperProjectHistoryTimelineImage {
	readonly limit: number;
	readonly present: FramescaperProjectTimelineImage;
	readonly undoStack: readonly FramescaperProjectHistoryEntryTimelineImage[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryTimelineImage[];
}

export function createFramescaperProjectHistoryTimelineImage(
	profile: unknown,
	project: unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	validateFramescaperProjectTimelineImage(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: cloneFramescaperProjectTimelineImage(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryTimelineImage(
	profile: unknown,
	history: unknown,
): history is FramescaperProjectHistoryTimelineImage {
	assertFramescaperProjectTimelineImageProfile(profile);
	const candidate = exactRecord(history, ['limit', 'present', 'undoStack', 'redoStack'], 'timelineImage history');
	const limit = historyLimit(candidate.limit);
	validateFramescaperProjectTimelineImage(profile, candidate.present);
	const projectId = String((candidate.present as FramescaperProjectTimelineImage).id);
	for (const [name, value] of [['undoStack', candidate.undoStack], ['redoStack', candidate.redoStack]] as const) {
		if (!Array.isArray(value) || value.length > limit) throw new RangeError(`timelineImage ${name} exceeds its limit.`);
		for (const entry of value) {
			const item = exactRecord(entry, ['project', 'command'], 'timelineImage history entry');
			validateFramescaperProjectTimelineImage(profile, item.project);
			if ((item.project as FramescaperProjectTimelineImage).id !== projectId) {
				throw new RangeError('Every timelineImage history entry must belong to the present project.');
			}
			snapshotFramescaperProjectCommandTimelineImage(item.command);
		}
	}
	return true;
}

export function executeFramescaperProjectCommandTimelineImage(
	profile: unknown,
	history: unknown,
	command: unknown,
	options: FramescaperProjectCommandOptionsTimelineImage = {},
): FramescaperProjectHistoryTimelineImage {
	validateFramescaperProjectHistoryTimelineImage(profile, history);
	const current = history as FramescaperProjectHistoryTimelineImage;
	const normalized = snapshotFramescaperProjectCommandTimelineImage(command);
	return {
		limit: current.limit,
		present: applyFramescaperProjectCommandTimelineImage(profile, current.present, normalized, options),
		undoStack: [...current.undoStack, snapshotEntry(profile, current.present, normalized)].slice(-current.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandTimelineImage(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsTimelineImage = {},
): FramescaperProjectHistoryTimelineImage {
	return restore(profile, history, 'undo', options);
}

export function redoFramescaperProjectCommandTimelineImage(
	profile: unknown,
	history: unknown,
	options: FramescaperProjectCommandOptionsTimelineImage = {},
): FramescaperProjectHistoryTimelineImage {
	return restore(profile, history, 'redo', options);
}

function restore(
	profile: unknown,
	history: unknown,
	direction: 'undo' | 'redo',
	options: FramescaperProjectCommandOptionsTimelineImage,
): FramescaperProjectHistoryTimelineImage {
	validateFramescaperProjectHistoryTimelineImage(profile, history);
	const current = history as FramescaperProjectHistoryTimelineImage;
	const source = direction === 'undo' ? current.undoStack : current.redoStack;
	if (source.length === 0) return current;
	const entry = source.at(-1)!;
	const present = cloneFramescaperProjectTimelineImage(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = Number(current.present.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper timelineImage revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsTimelineImage(profile, present);
	validateFramescaperProjectTimelineImage(profile, present);
	const opposite = snapshotEntry(profile, current.present, entry.command);
	return direction === 'undo' ? {
		limit: current.limit, present: present as unknown as FramescaperProjectTimelineImage,
		undoStack: current.undoStack.slice(0, -1),
		redoStack: [...current.redoStack, opposite].slice(-current.limit),
	} : {
		limit: current.limit, present: present as unknown as FramescaperProjectTimelineImage,
		undoStack: [...current.undoStack, opposite].slice(-current.limit),
		redoStack: current.redoStack.slice(0, -1),
	};
}

function snapshotEntry(
	profile: unknown,
	project: FramescaperProjectTimelineImage,
	command: FramescaperProjectCommandTimelineImage,
): FramescaperProjectHistoryEntryTimelineImage {
	return {
		project: cloneFramescaperProjectTimelineImage(profile, project),
		command: snapshotFramescaperProjectCommandTimelineImage(command),
	};
}

function historyLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(`Framescaper timelineImage history limit must be from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`);
	}
	return Number(value);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper timelineImage history timestamp is invalid.');
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
