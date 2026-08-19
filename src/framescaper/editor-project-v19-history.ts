/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV19,
} from './editor-project-feature-requirements-v19.ts';
import {
	applyFramescaperProjectCommandV19,
	snapshotFramescaperProjectCommandV19,
	type FramescaperProjectCommandOptionsV19,
	type FramescaperProjectCommandV19,
} from './editor-project-v19-commands.ts';
import { cloneFramescaperProjectV19 } from './editor-project-v19.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import {
	validateFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19-validation.ts';

export interface FramescaperProjectHistoryEntryV19 {
	readonly project: FramescaperProjectV19;
	readonly command: FramescaperProjectCommandV19;
}

export interface FramescaperProjectHistoryV19 {
	readonly limit: number;
	readonly present: FramescaperProjectV19;
	readonly undoStack: readonly FramescaperProjectHistoryEntryV19[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryV19[];
}

const HISTORY_FIELDS = Object.freeze(['limit', 'present', 'undoStack', 'redoStack']);
const ENTRY_FIELDS = Object.freeze(['project', 'command']);

export function createFramescaperProjectHistoryV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV19 | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryV19 {
	assertFramescaperProjectV19Profile(profile);
	validateFramescaperProjectV19(profile, project);
	const limit = historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT);
	return {
		limit,
		present: cloneFramescaperProjectV19(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryV19(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV19 | unknown,
): history is FramescaperProjectHistoryV19 {
	assertFramescaperProjectV19Profile(profile);
	const value = readClosedDomainRecord(history, 'Framescaper V19 project history', HISTORY_FIELDS);
	const limit = historyLimit(readClosedDomainField(value, 'limit', 'Framescaper V19 project history'));
	const present = readClosedDomainField(value, 'present', 'Framescaper V19 project history');
	validateFramescaperProjectV19(profile, present);
	const projectId = (present as FramescaperProjectV19).id;
	validateStack(
		profile,
		readClosedDomainField(value, 'undoStack', 'Framescaper V19 project history'),
		'undoStack',
		limit,
		projectId,
	);
	validateStack(
		profile,
		readClosedDomainField(value, 'redoStack', 'Framescaper V19 project history'),
		'redoStack',
		limit,
		projectId,
	);
	return true;
}

export function cloneFramescaperProjectHistoryV19(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV19 | unknown,
): FramescaperProjectHistoryV19 {
	validateFramescaperProjectHistoryV19(profile, history);
	const valid = history as FramescaperProjectHistoryV19;
	return {
		limit: valid.limit,
		present: cloneFramescaperProjectV19(profile, valid.present),
		undoStack: valid.undoStack.map((entry) => snapshotEntry(profile, entry)),
		redoStack: valid.redoStack.map((entry) => snapshotEntry(profile, entry)),
	};
}

export function executeFramescaperProjectCommandV19(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV19 | unknown,
	command: FramescaperProjectCommandV19,
	options: FramescaperProjectCommandOptionsV19 = {},
): FramescaperProjectHistoryV19 {
	validateFramescaperProjectHistoryV19(profile, history);
	const valid = history as FramescaperProjectHistoryV19;
	const normalized = snapshotFramescaperProjectCommandV19(command);
	const present = applyFramescaperProjectCommandV19(profile, valid.present, normalized, options);
	return {
		limit: valid.limit,
		present,
		undoStack: [...valid.undoStack, {
			project: cloneFramescaperProjectV19(profile, valid.present),
			command: normalized,
		}].slice(-valid.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandV19(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV19 | unknown,
	options: FramescaperProjectCommandOptionsV19 = {},
): FramescaperProjectHistoryV19 {
	validateFramescaperProjectHistoryV19(profile, history);
	const valid = history as FramescaperProjectHistoryV19;
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	return restore(profile, valid, entry, valid.undoStack.slice(0, -1), [
		...valid.redoStack,
		{
			project: cloneFramescaperProjectV19(profile, valid.present),
			command: snapshotFramescaperProjectCommandV19(entry.command),
		},
	].slice(-valid.limit), options);
}

export function redoFramescaperProjectCommandV19(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV19 | unknown,
	options: FramescaperProjectCommandOptionsV19 = {},
): FramescaperProjectHistoryV19 {
	validateFramescaperProjectHistoryV19(profile, history);
	const valid = history as FramescaperProjectHistoryV19;
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	return restore(profile, valid, entry, [
		...valid.undoStack,
		{
			project: cloneFramescaperProjectV19(profile, valid.present),
			command: snapshotFramescaperProjectCommandV19(entry.command),
		},
	].slice(-valid.limit), valid.redoStack.slice(0, -1), options);
}

function restore(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryV19,
	entry: FramescaperProjectHistoryEntryV19,
	undoStack: readonly FramescaperProjectHistoryEntryV19[],
	redoStack: readonly FramescaperProjectHistoryEntryV19[],
	options: FramescaperProjectCommandOptionsV19,
): FramescaperProjectHistoryV19 {
	const present = cloneFramescaperProjectV19(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = history.present.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V19 project revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(profile, present);
	validateFramescaperProjectV19(profile, present);
	return {
		limit: history.limit,
		present: present as FramescaperProjectV19,
		undoStack,
		redoStack,
	};
}

function validateStack(
	profile: EditorProjectRuntimeProfile | unknown,
	value: unknown,
	name: 'undoStack' | 'redoStack',
	limit: number,
	projectId: string,
): void {
	const stack = readClosedDomainArray(value, `Framescaper V19 history ${name}`, 0, limit);
	for (const [index, item] of stack.entries()) {
		const entryName = `Framescaper V19 history ${name}[${String(index)}]`;
		const entry = readClosedDomainRecord(item, entryName, ENTRY_FIELDS);
		const project = readClosedDomainField(entry, 'project', entryName);
		validateFramescaperProjectV19(profile, project);
		if ((project as FramescaperProjectV19).id !== projectId) {
			throw new RangeError('Every V19 history snapshot must belong to the present project.');
		}
		snapshotFramescaperProjectCommandV19(
			readClosedDomainField(entry, 'command', entryName) as FramescaperProjectCommandV19,
		);
	}
}

function snapshotEntry(
	profile: EditorProjectRuntimeProfile | unknown,
	entry: FramescaperProjectHistoryEntryV19,
): FramescaperProjectHistoryEntryV19 {
	return {
		project: cloneFramescaperProjectV19(profile, entry.project),
		command: snapshotFramescaperProjectCommandV19(entry.command),
	};
}

function historyLimit(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError('V19 history limit must be a positive safe integer.');
	}
	return value;
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid V19 history timestamp is required.');
	return date.toISOString();
}
