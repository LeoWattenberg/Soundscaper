/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_HISTORY_LIMIT } from '../common/editor/history.js';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsRetime,
} from './editor-project-feature-requirements-retime.ts';
import {
	applyFramescaperProjectCommandRetime,
	snapshotFramescaperProjectCommandRetime,
	type FramescaperProjectCommandOptionsRetime,
	type FramescaperProjectCommandRetime,
} from './editor-project-retime-commands.ts';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectRetime,
	type FramescaperProjectRetime,
} from './editor-project-retime-validation.ts';
import {
	admitFramescaperProjectHistoryRetimeStructure,
} from './editor-project-retime-history-admission.ts';

export interface FramescaperProjectHistoryEntryRetime {
	readonly project: FramescaperProjectRetime;
	readonly command: FramescaperProjectCommandRetime;
}

export interface FramescaperProjectHistoryRetime {
	readonly limit: number;
	readonly present: FramescaperProjectRetime;
	readonly undoStack: readonly FramescaperProjectHistoryEntryRetime[];
	readonly redoStack: readonly FramescaperProjectHistoryEntryRetime[];
}

const HISTORY_FIELDS = Object.freeze(['limit', 'present', 'undoStack', 'redoStack']);
const ENTRY_FIELDS = Object.freeze(['project', 'command']);

export function createFramescaperProjectHistoryRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | unknown,
	options: Readonly<{ limit?: number }> = {},
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectRetime(profile, project);
	return {
		limit: historyLimit(options.limit ?? AUDIO_EDITOR_HISTORY_LIMIT),
		present: snapshotProject(profile, project as FramescaperProjectRetime),
		undoStack: [],
		redoStack: [],
	};
}

export function validateFramescaperProjectHistoryRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
): history is FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	admitFramescaperProjectHistoryRetimeStructure(history);
	const value = readClosedDomainRecord(history, 'Framescaper retime project history', HISTORY_FIELDS);
	const limit = historyLimit(readClosedDomainField(value, 'limit', 'Framescaper retime project history'));
	const present = readClosedDomainField(value, 'present', 'Framescaper retime project history');
	validateFramescaperProjectRetime(profile, present);
	const projectId = (present as FramescaperProjectRetime).id;
	validateStack(
		profile,
		readClosedDomainField(value, 'undoStack', 'Framescaper retime project history'),
		'undoStack',
		limit,
		projectId,
	);
	validateStack(
		profile,
		readClosedDomainField(value, 'redoStack', 'Framescaper retime project history'),
		'redoStack',
		limit,
		projectId,
	);
	return true;
}

export function cloneFramescaperProjectHistoryRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectHistoryRetime(profile, history);
	const valid = history as FramescaperProjectHistoryRetime;
	return {
		limit: valid.limit,
		present: snapshotProject(profile, valid.present),
		undoStack: valid.undoStack.map((entry) => snapshotEntry(profile, entry)),
		redoStack: valid.redoStack.map((entry) => snapshotEntry(profile, entry)),
	};
}

export function executeFramescaperProjectCommandRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
	command: FramescaperProjectCommandRetime,
	options: FramescaperProjectCommandOptionsRetime = {},
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectHistoryRetime(profile, history);
	const valid = history as FramescaperProjectHistoryRetime;
	const normalized = snapshotFramescaperProjectCommandRetime(command);
	const present = applyFramescaperProjectCommandRetime(profile, valid.present, normalized, options);
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

export function undoFramescaperProjectCommandRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
	options: FramescaperProjectCommandOptionsRetime = {},
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectHistoryRetime(profile, history);
	const valid = history as FramescaperProjectHistoryRetime;
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	return restore(profile, valid, entry, valid.undoStack.slice(0, -1), [
		...valid.redoStack,
		{
			project: snapshotProject(profile, valid.present),
			command: snapshotFramescaperProjectCommandRetime(entry.command),
		},
	].slice(-valid.limit), options);
}

export function redoFramescaperProjectCommandRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	history: FramescaperProjectHistoryRetime | unknown,
	options: FramescaperProjectCommandOptionsRetime = {},
): FramescaperProjectHistoryRetime {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectHistoryRetime(profile, history);
	const valid = history as FramescaperProjectHistoryRetime;
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	return restore(profile, valid, entry, [
		...valid.undoStack,
		{
			project: snapshotProject(profile, valid.present),
			command: snapshotFramescaperProjectCommandRetime(entry.command),
		},
	].slice(-valid.limit), valid.redoStack.slice(0, -1), options);
}

function restore(
	profile: FramescaperProjectRetimeProfile,
	history: FramescaperProjectHistoryRetime,
	entry: FramescaperProjectHistoryEntryRetime,
	undoStack: readonly FramescaperProjectHistoryEntryRetime[],
	redoStack: readonly FramescaperProjectHistoryEntryRetime[],
	options: FramescaperProjectCommandOptionsRetime,
): FramescaperProjectHistoryRetime {
	const present = snapshotProject(profile, entry.project) as unknown as Record<string, unknown>;
	const revision = history.present.revision + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper retime project revision overflowed.');
	present.revision = revision;
	present.updatedAt = timestamp(options.now);
	present.featureRequirements = reconcileFramescaperProjectFeatureRequirementsRetime(profile, present);
	validateFramescaperProjectRetime(profile, present);
	return {
		limit: history.limit,
		present: present as FramescaperProjectRetime,
		undoStack,
		redoStack,
	};
}

function validateStack(
	profile: FramescaperProjectRetimeProfile,
	value: unknown,
	name: 'undoStack' | 'redoStack',
	limit: number,
	projectId: string,
): void {
	const stack = readClosedDomainArray(value, `Framescaper retime history ${name}`, 0, limit);
	for (const [index, item] of stack.entries()) {
		const entryName = `Framescaper retime history ${name}[${String(index)}]`;
		const entry = readClosedDomainRecord(item, entryName, ENTRY_FIELDS);
		const project = readClosedDomainField(entry, 'project', entryName);
		validateFramescaperProjectRetime(profile, project);
		if ((project as FramescaperProjectRetime).id !== projectId) {
			throw new RangeError('Every retime history snapshot must belong to the present project.');
		}
		snapshotFramescaperProjectCommandRetime(
			readClosedDomainField(entry, 'command', entryName),
		);
	}
}

function snapshotEntry(
	profile: FramescaperProjectRetimeProfile,
	entry: FramescaperProjectHistoryEntryRetime,
): FramescaperProjectHistoryEntryRetime {
	return {
		project: snapshotProject(profile, entry.project),
		command: snapshotFramescaperProjectCommandRetime(entry.command),
	};
}


function historyLimit(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)
		|| value < 1 || value > AUDIO_EDITOR_HISTORY_LIMIT) {
		throw new RangeError(
			`retime history limit must be a safe integer from 1 through ${String(AUDIO_EDITOR_HISTORY_LIMIT)}.`,
		);
	}
	return value;
}

function snapshotProject(
	profile: FramescaperProjectRetimeProfile,
	project: FramescaperProjectRetime,
): FramescaperProjectRetime {
	validateFramescaperProjectRetime(profile, project);
	const snapshot = structuredClone(project) as FramescaperProjectRetime;
	validateFramescaperProjectRetime(profile, snapshot);
	return snapshot;
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid retime history timestamp is required.');
	return date.toISOString();
}
