/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsComposition,
} from './editor-project-feature-requirements-composition.ts';
import {
	applyFramescaperProjectCommandComposition,
	snapshotFramescaperProjectCommandComposition,
	type FramescaperProjectCommandOptionsComposition,
	type FramescaperProjectCommandComposition,
} from './editor-project-composition-commands.ts';
import { cloneFramescaperProjectComposition } from './editor-project-composition.ts';
import { assertFramescaperProjectCompositionProfile } from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectComposition,
	type FramescaperProjectComposition,
} from './editor-project-composition-validation.ts';

export interface FramescaperProjectHistoryEntryComposition {
	readonly project: FramescaperProjectComposition;
	readonly command: FramescaperProjectCommandComposition;
}

export interface FramescaperProjectHistoryComposition {
	readonly limit: number;
	readonly present: FramescaperProjectComposition;
	readonly undoStack: readonly FramescaperProjectHistoryEntryComposition[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryComposition[];
}

const HISTORY_FIELDS = Object.freeze(['limit', 'present', 'undoStack', 'redoStack']);
const ENTRY_FIELDS = Object.freeze(['project', 'command']);

export function createFramescaperProjectHistoryComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectComposition | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryComposition {
	assertFramescaperProjectCompositionProfile(profile);
	validateFramescaperProjectComposition(profile, project);
	const limit = historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT);
	return {
		limit,
		present: cloneFramescaperProjectComposition(profile, project),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
): history is FramescaperProjectHistoryComposition {
	assertFramescaperProjectCompositionProfile(profile);
	const value = readClosedDomainRecord(history, 'Framescaper composition project history', HISTORY_FIELDS);
	const limit = historyLimit(readClosedDomainField(value, 'limit', 'Framescaper composition project history'));
	const present = readClosedDomainField(value, 'present', 'Framescaper composition project history');
	validateFramescaperProjectComposition(profile, present);
	const projectId = (present as FramescaperProjectComposition).id;
	validateStack(
		profile,
		readClosedDomainField(value, 'undoStack', 'Framescaper composition project history'),
		'undoStack',
		limit,
		projectId,
	);
	validateStack(
		profile,
		readClosedDomainField(value, 'redoStack', 'Framescaper composition project history'),
		'redoStack',
		limit,
		projectId,
	);
	return true;
}

export function cloneFramescaperProjectHistoryComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
): FramescaperProjectHistoryComposition {
	validateFramescaperProjectHistoryComposition(profile, history);
	const valid = history as FramescaperProjectHistoryComposition;
	return {
		limit: valid.limit,
		present: cloneFramescaperProjectComposition(profile, valid.present),
		undoStack: valid.undoStack.map((entry) => snapshotEntry(profile, entry)),
		redoStack: valid.redoStack.map((entry) => snapshotEntry(profile, entry)),
	};
}

export function executeFramescaperProjectCommandComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
	command: FramescaperProjectCommandComposition,
	options: FramescaperProjectCommandOptionsComposition = {},
): FramescaperProjectHistoryComposition {
	validateFramescaperProjectHistoryComposition(profile, history);
	const valid = history as FramescaperProjectHistoryComposition;
	const normalized = snapshotFramescaperProjectCommandComposition(command);
	const present = applyFramescaperProjectCommandComposition(profile, valid.present, normalized, options);
	return {
		limit: valid.limit,
		present,
		undoStack: [...valid.undoStack, {
			project: cloneFramescaperProjectComposition(profile, valid.present),
			command: normalized,
		}].slice(-valid.limit),
		redoStack: [],
	};
}

export function undoFramescaperProjectCommandComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
	options: FramescaperProjectCommandOptionsComposition = {},
): FramescaperProjectHistoryComposition {
	validateFramescaperProjectHistoryComposition(profile, history);
	const valid = history as FramescaperProjectHistoryComposition;
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	return restore(profile, valid, entry, valid.undoStack.slice(0, -1), [
		...valid.redoStack,
		{
			project: cloneFramescaperProjectComposition(profile, valid.present),
			command: snapshotFramescaperProjectCommandComposition(entry.command),
		},
	].slice(-valid.limit), options);
}

export function redoFramescaperProjectCommandComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition | unknown,
	options: FramescaperProjectCommandOptionsComposition = {},
): FramescaperProjectHistoryComposition {
	validateFramescaperProjectHistoryComposition(profile, history);
	const valid = history as FramescaperProjectHistoryComposition;
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	return restore(profile, valid, entry, [
		...valid.undoStack,
		{
			project: cloneFramescaperProjectComposition(profile, valid.present),
			command: snapshotFramescaperProjectCommandComposition(entry.command),
		},
	].slice(-valid.limit), valid.redoStack.slice(0, -1), options);
}

function restore(
	profile: EditorProjectRuntimeProfile | unknown,
	history: FramescaperProjectHistoryComposition,
	entry: FramescaperProjectHistoryEntryComposition,
	undoStack: readonly FramescaperProjectHistoryEntryComposition[],
	redoStack: readonly FramescaperProjectHistoryEntryComposition[],
	options: FramescaperProjectCommandOptionsComposition,
): FramescaperProjectHistoryComposition {
	const present = cloneFramescaperProjectComposition(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = history.present.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper composition project revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsComposition(profile, present);
	validateFramescaperProjectComposition(profile, present);
	return {
		limit: history.limit,
		present: present as FramescaperProjectComposition,
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
	const stack = readClosedDomainArray(value, `Framescaper composition history ${name}`, 0, limit);
	for (const [index, item] of stack.entries()) {
		const entryName = `Framescaper composition history ${name}[${String(index)}]`;
		const entry = readClosedDomainRecord(item, entryName, ENTRY_FIELDS);
		const project = readClosedDomainField(entry, 'project', entryName);
		validateFramescaperProjectComposition(profile, project);
		if ((project as FramescaperProjectComposition).id !== projectId) {
			throw new RangeError('Every composition history snapshot must belong to the present project.');
		}
		snapshotFramescaperProjectCommandComposition(
			readClosedDomainField(entry, 'command', entryName) as FramescaperProjectCommandComposition,
		);
	}
}

function snapshotEntry(
	profile: EditorProjectRuntimeProfile | unknown,
	entry: FramescaperProjectHistoryEntryComposition,
): FramescaperProjectHistoryEntryComposition {
	return {
		project: cloneFramescaperProjectComposition(profile, entry.project),
		command: snapshotFramescaperProjectCommandComposition(entry.command),
	};
}

function historyLimit(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError('composition history limit must be a positive safe integer.');
	}
	return value;
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid composition history timestamp is required.');
	return date.toISOString();
}
