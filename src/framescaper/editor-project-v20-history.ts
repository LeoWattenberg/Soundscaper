/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from './editor-project-feature-requirements-v20.ts';
import {
	applyFramescaperProjectCommandV20,
	snapshotFramescaperProjectCommandV20,
	type FramescaperProjectCommandOptionsV20,
	type FramescaperProjectCommandV20,
} from './editor-project-v20-commands.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import {
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20-validation.ts';
import {
	admitFramescaperProjectHistoryV20Structure,
} from './editor-project-v20-history-admission.ts';

export interface FramescaperProjectHistoryEntryV20 {
	readonly project: FramescaperProjectV20;
	readonly command: FramescaperProjectCommandV20;
}

export interface FramescaperProjectHistoryV20 {
	readonly limit: number;
	readonly present: FramescaperProjectV20;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV20[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV20[];
}

const HISTORY_FIELDS = Object.freeze(['limit', 'present', 'undoStack', 'redoStack']);
const ENTRY_FIELDS = Object.freeze(['project', 'command']);

export function createFramescaperProjectHistoryV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: FramescaperProjectV20 | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV20 {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectV20(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: snapshotProject(profile, project as FramescaperProjectV20),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV20(
	profile: FramescaperProjectV20Profile | unknown,
	history: FramescaperProjectHistoryV20 | unknown,
): history is FramescaperProjectHistoryV20 {
	assertFramescaperProjectV20Profile(profile);
	admitFramescaperProjectHistoryV20Structure(history);
	const value = readClosedDomainRecord(history, 'Framescaper V20 project history', HISTORY_FIELDS);
	const limit = historyLimit(readClosedDomainField(value, 'limit', 'Framescaper V20 project history'));
	const present = readClosedDomainField(value, 'present', 'Framescaper V20 project history');
	validateFramescaperProjectV20(profile, present);
	const projectId = (present as FramescaperProjectV20).id;
	validateStack(
		profile,
		readClosedDomainField(value, 'undoStack', 'Framescaper V20 project history'),
		'undoStack',
		limit,
		projectId,
	);
	validateStack(
		profile,
		readClosedDomainField(value, 'redoStack', 'Framescaper V20 project history'),
		'redoStack',
		limit,
		projectId,
	);
	return true;
}

export function cloneFramescaperProjectHistoryV20(
	profile: FramescaperProjectV20Profile | unknown,
	history: FramescaperProjectHistoryV20 | unknown,
): FramescaperProjectHistoryV20 {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectHistoryV20(profile, history);
	const valid = history as FramescaperProjectHistoryV20;
	return {
		limit: valid.limit,
		present: snapshotProject(profile, valid.present),
		undoStack: valid.undoStack.map((entry) => snapshotEntry(profile, entry)),
		redoStack: valid.redoStack.map((entry) => snapshotEntry(profile, entry)),
	};
}

export function executeFramescaperProjectCommandV20(
	profile: FramescaperProjectV20Profile | unknown,
	history: FramescaperProjectHistoryV20 | unknown,
	command: FramescaperProjectCommandV20,
	options: FramescaperProjectCommandOptionsV20 = {},
): FramescaperProjectHistoryV20 {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectHistoryV20(profile, history);
	const valid = history as FramescaperProjectHistoryV20;
	const normalized = snapshotFramescaperProjectCommandV20(command);
	const present = applyFramescaperProjectCommandV20(profile, valid.present, normalized, options);
	return {
		limit: valid.limit,
		present,
		undoStack: [...valid.undoStack, {
			project: snapshotProject(profile, valid.present),
			command: normalized,
		}].slice(-valid.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV20(
	profile: FramescaperProjectV20Profile | unknown,
	history: FramescaperProjectHistoryV20 | unknown,
	options: FramescaperProjectCommandOptionsV20 = {},
): FramescaperProjectHistoryV20 {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectHistoryV20(profile, history);
	const valid = history as FramescaperProjectHistoryV20;
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	return restore(profile, valid, entry, valid.undoStack.slice(0, -1), [
		...valid.redoStack,
		{
			project: snapshotProject(profile, valid.present),
			command: snapshotFramescaperProjectCommandV20(entry.command),
		},
	].slice(-valid.limit), options);
}

export function redoFramescaperProjectCommandV20(
	profile: FramescaperProjectV20Profile | unknown,
	history: FramescaperProjectHistoryV20 | unknown,
	options: FramescaperProjectCommandOptionsV20 = {},
): FramescaperProjectHistoryV20 {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectHistoryV20(profile, history);
	const valid = history as FramescaperProjectHistoryV20;
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	return restore(profile, valid, entry, [
		...valid.undoStack,
		{
			project: snapshotProject(profile, valid.present),
			command: snapshotFramescaperProjectCommandV20(entry.command),
		},
	].slice(-valid.limit), valid.redoStack.slice(0, -1), options);
}

function restore(
	profile: FramescaperProjectV20Profile,
	history: FramescaperProjectHistoryV20,
	entry: FramescaperProjectHistoryEntryV20,
	undoStack: readonly FramescaperProjectHistoryEntryV20[],
	redoStack: readonly FramescaperProjectHistoryEntryV20[],
	options: FramescaperProjectCommandOptionsV20,
): FramescaperProjectHistoryV20 {
	const present = snapshotProject(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = history.present.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V20 project revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV20(profile, present);
	validateFramescaperProjectV20(profile, present);
	return {
		limit: history.limit,
		present: present as FramescaperProjectV20,
		undoStack,
		redoStack,
	};
}

function validateStack(
	profile: FramescaperProjectV20Profile,
	value: unknown,
	name: 'undoStack' | 'redoStack',
	limit: number,
	projectId: string,
): void {
	const stack = readClosedDomainArray(value, `Framescaper V20 history ${name}`, 0, limit);
	for (const [index, item] of stack.entries()) {
		const entryName = `Framescaper V20 history ${name}[${String(index)}]`;
		const entry = readClosedDomainRecord(item, entryName, ENTRY_FIELDS);
		const project = readClosedDomainField(entry, 'project', entryName);
		validateFramescaperProjectV20(profile, project);
		if ((project as FramescaperProjectV20).id !== projectId) {
			throw new RangeError('Every V20 history snapshot must belong to the present project.');
		}
		snapshotFramescaperProjectCommandV20(
			readClosedDomainField(entry, 'command', entryName),
		);
	}
}

function snapshotEntry(
	profile: FramescaperProjectV20Profile,
	entry: FramescaperProjectHistoryEntryV20,
): FramescaperProjectHistoryEntryV20 {
	return {
		project: snapshotProject(profile, entry.project),
		command: snapshotFramescaperProjectCommandV20(entry.command),
	};
}


function historyLimit(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)
		|| value < 1 || value > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(
			`V20 history limit must be a safe integer from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`,
		);
	}
	return value;
}

function snapshotProject(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
): FramescaperProjectV20 {
	validateFramescaperProjectV20(profile, project);
	const snapshot = structuredClone(project) as FramescaperProjectV20;
	validateFramescaperProjectV20(profile, snapshot);
	return snapshot;
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid V20 history timestamp is required.');
	return date.toISOString();
}
