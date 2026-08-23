/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../common/editor/project-validation-budget.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV27,
} from './editor-project-feature-requirements-v27.ts';
import {
	snapshotFramescaperProjectCommandV24,
	type FramescaperProjectCommandBatchV24,
	type FramescaperProjectCommandOptionsV24,
	type FramescaperProjectCommandV24,
} from './editor-project-v24-commands.ts';
import { applyInheritedFramescaperProjectCommandV27 } from './editor-project-v27-command-inheritance.ts';
import {
	applyFramescaperOwnedFinishingCommandV27,
	isFramescaperOwnedFinishingCommandTypeV27,
	snapshotFramescaperOwnedFinishingCommandV27,
	type FramescaperOwnedFinishingCommandV27,
} from './editor-project-v27-finishing-command.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	normalizeFramescaperProjectFinishingStateV27,
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27-validation.ts';

type FramescaperInheritedProjectCommandV27 = Exclude<
	FramescaperProjectCommandV24,
	FramescaperProjectCommandBatchV24
>;

export interface FramescaperProjectCommandBatchV27 {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandV27[];
}

export type FramescaperProjectCommandV27 =
	| FramescaperOwnedFinishingCommandV27
	| FramescaperProjectCommandBatchV27
	| FramescaperInheritedProjectCommandV27;
export type FramescaperProjectCommandOptionsV27 = FramescaperProjectCommandOptionsV24;

interface SnapshotBudget {
	readonly active: Set<object>;
	count: number;
}

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

export function snapshotFramescaperProjectCommandV27(value: unknown): FramescaperProjectCommandV27 {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandV27(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV27 = {},
): FramescaperProjectV27 {
	assertFramescaperProjectV27Profile(profile);
	validateFramescaperProjectV27(profile, project);
	const command = snapshotFramescaperProjectCommandV27(commandValue);
	return applyNormalized(profile, project as FramescaperProjectV27, command, options);
}

function snapshot(
	value: unknown,
	budget: SnapshotBudget,
	depth: number,
): FramescaperProjectCommandV27 {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS) throw new RangeError('Framescaper V27 command tree exceeds its limit.');
	if (depth > MAXIMUM_DEPTH) throw new RangeError('Framescaper V27 command tree exceeds its depth limit.');
	const type = commandType(value);
	if (isFramescaperOwnedFinishingCommandTypeV27(type)) {
		return snapshotFramescaperOwnedFinishingCommandV27(value);
	}
	if (type !== 'batch') {
		return snapshotFramescaperProjectCommandV24(value) as FramescaperInheritedProjectCommandV27;
	}
	const record = readClosedDomainRecord(value, 'Framescaper V27 batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic V27 command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(record, 'commands', 'Framescaper V27 batch'),
		'Framescaper V27 batch.commands', 1, MAXIMUM_COMMANDS,
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
	project: FramescaperProjectV27,
	command: FramescaperProjectCommandV27,
	options: FramescaperProjectCommandOptionsV27,
): FramescaperProjectV27 {
	if (isBatch(command)) return applyBatch(profile, project, command, options);
	if (!isFramescaperOwnedFinishingCommandTypeV27(command.type)) {
		return applyInheritedFramescaperProjectCommandV27(profile, project, command, options);
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyFramescaperOwnedFinishingCommandV27(
		draft,
		command as FramescaperOwnedFinishingCommandV27,
	);
	advanceBookkeeping(draft, project, options);
	normalizeFramescaperProjectFinishingStateV27(draft);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(profile, draft);
	validateFramescaperProjectV27(profile, draft);
	return draft as unknown as FramescaperProjectV27;
}

function isBatch(command: FramescaperProjectCommandV27): command is FramescaperProjectCommandBatchV27 {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectV27,
	command: FramescaperProjectCommandBatchV27,
	options: FramescaperProjectCommandOptionsV27,
): FramescaperProjectV27 {
	let current = project;
	let inheritedSegment: FramescaperInheritedProjectCommandV27[] = [];
	const flushInheritedSegment = (): void => {
		if (inheritedSegment.length === 0) return;
		const inherited = inheritedSegment.length === 1
			? inheritedSegment[0]!
			: Object.freeze({
				type: 'batch' as const,
				commands: Object.freeze([...inheritedSegment]),
			});
		current = applyInheritedFramescaperProjectCommandV27(
			profile, current, inherited, options,
		);
		inheritedSegment = [];
	};
	for (const child of command.commands) {
		if (!isBatch(child) && !isFramescaperOwnedFinishingCommandTypeV27(child.type)) {
			inheritedSegment.push(child as FramescaperInheritedProjectCommandV27);
			continue;
		}
		flushInheritedSegment();
		current = applyNormalized(profile, current, child, options);
	}
	flushInheritedSegment();
	const draft = structuredClone(current) as unknown as Record<string, unknown>;
	advanceBookkeeping(draft, project, options);
	normalizeFramescaperProjectFinishingStateV27(draft);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(profile, draft);
	validateFramescaperProjectV27(profile, draft);
	return draft as unknown as FramescaperProjectV27;
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V27 command must be an object.');
	}
	const type = readClosedDomainField(
		value as Readonly<Record<string, unknown>>, 'type', 'Framescaper V27 command',
	);
	if (typeof type !== 'string') throw new TypeError('Framescaper V27 command.type must be a string.');
	return type;
}

function advanceBookkeeping(
	draft: Record<string, unknown>,
	project: FramescaperProjectV27,
	options: FramescaperProjectCommandOptionsV27,
): void {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V27 revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V27 timestamp is invalid.');
	return date.toISOString();
}
