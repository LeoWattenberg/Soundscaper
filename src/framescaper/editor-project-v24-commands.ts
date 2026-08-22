/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../common/editor/project-validation-budget.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV24,
} from './editor-project-feature-requirements-v24.ts';
import {
	applyInheritedFramescaperProjectCommandV24,
} from './editor-project-v24-command-inheritance.ts';
import {
	applyFramescaperOwnedVisualCommandV24,
	isFramescaperOwnedVisualCommandTypeV24,
	snapshotFramescaperOwnedVisualCommandV24,
	type FramescaperOwnedVisualCommandV24,
} from './editor-project-v24-visual-command.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';
import {
	snapshotFramescaperProjectCommandV22,
	type FramescaperProjectCommandOptionsV22,
	type FramescaperProjectCommandV22,
} from './editor-project-v22-commands.ts';
import {
	normalizeFramescaperProjectVisualModelsV24,
	validateFramescaperProjectV24,
	type FramescaperProjectV24,
} from './editor-project-v24-validation.ts';

export type { FramescaperVideoVisualPresetSetCommandV24 } from './editor-project-v24-visual-command.ts';

export interface FramescaperProjectCommandBatchV24 {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandV24[];
}

export type FramescaperProjectCommandV24 =
	| FramescaperOwnedVisualCommandV24
	| FramescaperProjectCommandBatchV24
	| FramescaperProjectCommandV22;
export type FramescaperProjectCommandOptionsV24 = FramescaperProjectCommandOptionsV22;

interface SnapshotBudget {
	readonly active: Set<object>;
	count: number;
}

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

export function snapshotFramescaperProjectCommandV24(value: unknown): FramescaperProjectCommandV24 {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandV24(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV24 = {},
): FramescaperProjectV24 {
	assertFramescaperProjectV24CandidateProfile(profile);
	validateFramescaperProjectV24(profile, project);
	const command = snapshotFramescaperProjectCommandV24(commandValue);
	return applyNormalized(profile, project as FramescaperProjectV24, command, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandV24 {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS) throw new RangeError('Framescaper V24 command tree exceeds its limit.');
	if (depth > MAXIMUM_DEPTH) throw new RangeError('Framescaper V24 command tree exceeds its depth limit.');
	const type = commandType(value);
	if (isFramescaperOwnedVisualCommandTypeV24(type)) {
		return snapshotFramescaperOwnedVisualCommandV24(value);
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandV22(value);
	const record = readClosedDomainRecord(value, 'Framescaper V24 batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic V24 command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(record, 'commands', 'Framescaper V24 batch'),
		'Framescaper V24 batch.commands', 1, MAXIMUM_COMMANDS,
	);
	budget.active.add(record);
	try {
		return Object.freeze({
			type: 'batch' as const,
			commands: Object.freeze(commands.map((child) => snapshot(child, budget, depth + 1))),
		});
	} finally {
		budget.active.delete(record);
	}
}

function applyNormalized(
	profile: unknown,
	project: FramescaperProjectV24,
	command: FramescaperProjectCommandV24,
	options: FramescaperProjectCommandOptionsV24,
): FramescaperProjectV24 {
	if (isBatch(command)) return applyBatch(profile, project, command, options);
	if (!isFramescaperOwnedVisualCommandTypeV24(command.type)) {
		return applyInheritedFramescaperProjectCommandV24(profile, project, command, options);
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyFramescaperOwnedVisualCommandV24(draft, command as FramescaperOwnedVisualCommandV24);
	advanceBookkeeping(draft, project, options);
	normalizeFramescaperProjectVisualModelsV24(draft);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV24(profile, draft);
	validateFramescaperProjectV24(profile, draft);
	return draft as unknown as FramescaperProjectV24;
}

function isBatch(command: FramescaperProjectCommandV24): command is FramescaperProjectCommandBatchV24 {
	return command.type === 'batch' && Array.isArray(command.commands);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectV24,
	command: FramescaperProjectCommandBatchV24,
	options: FramescaperProjectCommandOptionsV24,
): FramescaperProjectV24 {
	let current = project;
	for (const child of command.commands) current = applyNormalized(profile, current, child, options);
	const draft = structuredClone(current) as unknown as Record<string, unknown>;
	advanceBookkeeping(draft, project, options);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV24(profile, draft);
	validateFramescaperProjectV24(profile, draft);
	return draft as unknown as FramescaperProjectV24;
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V24 command must be an object.');
	}
	const type = readClosedDomainField(
		value as Readonly<Record<string, unknown>>, 'type', 'Framescaper V24 command',
	);
	if (typeof type !== 'string') throw new TypeError('Framescaper V24 command.type must be a string.');
	return type;
}

function advanceBookkeeping(
	draft: Record<string, unknown>,
	project: FramescaperProjectV24,
	options: FramescaperProjectCommandOptionsV24,
): void {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V24 revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V24 timestamp is invalid.');
	return date.toISOString();
}
