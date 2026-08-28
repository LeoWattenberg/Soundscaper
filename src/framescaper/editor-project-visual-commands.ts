/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../common/editor/project-validation-budget.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsVisual,
} from './editor-project-feature-requirements-visual.ts';
import {
	applyInheritedFramescaperProjectCommandVisual,
} from './editor-project-visual-command-inheritance.ts';
import {
	applyFramescaperOwnedVisualCommandVisual,
	isFramescaperOwnedVisualCommandTypeVisual,
	snapshotFramescaperOwnedVisualCommandVisual,
	type FramescaperOwnedVisualCommandVisual,
} from './editor-project-visual-visual-command.ts';
import { assertFramescaperProjectVisualCandidateProfile } from './editor-domain-runtime-profile.ts';
import {
	snapshotFramescaperProjectCommandTransitions,
	type FramescaperProjectCommandOptionsTransitions,
	type FramescaperProjectCommandTransitions,
} from './editor-project-transitions-commands.ts';
import {
	normalizeFramescaperProjectVisualModelsVisual,
	validateFramescaperProjectVisual,
	type FramescaperProjectVisual,
} from './editor-project-visual-validation.ts';

export type { FramescaperVideoVisualPresetSetCommandVisual } from './editor-project-visual-visual-command.ts';

export interface FramescaperProjectCommandBatchVisual {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandVisual[];
}

export type FramescaperProjectCommandVisual =
	| FramescaperOwnedVisualCommandVisual
	| FramescaperProjectCommandBatchVisual
	| FramescaperProjectCommandTransitions;
export type FramescaperProjectCommandOptionsVisual = FramescaperProjectCommandOptionsTransitions;

interface SnapshotBudget {
	readonly active: Set<object>;
	count: number;
}

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

export function snapshotFramescaperProjectCommandVisual(value: unknown): FramescaperProjectCommandVisual {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandVisual(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsVisual = {},
): FramescaperProjectVisual {
	assertFramescaperProjectVisualCandidateProfile(profile);
	validateFramescaperProjectVisual(profile, project);
	const command = snapshotFramescaperProjectCommandVisual(commandValue);
	return applyNormalized(profile, project as FramescaperProjectVisual, command, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandVisual {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS) throw new RangeError('Framescaper visual command tree exceeds its limit.');
	if (depth > MAXIMUM_DEPTH) throw new RangeError('Framescaper visual command tree exceeds its depth limit.');
	const type = commandType(value);
	if (isFramescaperOwnedVisualCommandTypeVisual(type)) {
		return snapshotFramescaperOwnedVisualCommandVisual(value);
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandTransitions(value);
	const record = readClosedDomainRecord(value, 'Framescaper visual batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic visual command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(record, 'commands', 'Framescaper visual batch'),
		'Framescaper visual batch.commands', 1, MAXIMUM_COMMANDS,
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
	project: FramescaperProjectVisual,
	command: FramescaperProjectCommandVisual,
	options: FramescaperProjectCommandOptionsVisual,
): FramescaperProjectVisual {
	if (isBatch(command)) return applyBatch(profile, project, command, options);
	if (!isFramescaperOwnedVisualCommandTypeVisual(command.type)) {
		return applyInheritedFramescaperProjectCommandVisual(profile, project, command, options);
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyFramescaperOwnedVisualCommandVisual(draft, command as FramescaperOwnedVisualCommandVisual);
	advanceBookkeeping(draft, project, options);
	normalizeFramescaperProjectVisualModelsVisual(draft);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsVisual(profile, draft);
	validateFramescaperProjectVisual(profile, draft);
	return draft as unknown as FramescaperProjectVisual;
}

function isBatch(command: FramescaperProjectCommandVisual): command is FramescaperProjectCommandBatchVisual {
	return command.type === 'batch' && Array.isArray(command.commands);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectVisual,
	command: FramescaperProjectCommandBatchVisual,
	options: FramescaperProjectCommandOptionsVisual,
): FramescaperProjectVisual {
	let current = project;
	let inheritedSegment: FramescaperProjectCommandVisual[] = [];
	const flushInheritedSegment = (): void => {
		if (inheritedSegment.length === 0) return;
		const inherited = inheritedSegment.length === 1
			? inheritedSegment[0]!
			: Object.freeze({
				type: 'batch' as const,
				commands: Object.freeze([...inheritedSegment]),
			});
		current = applyInheritedFramescaperProjectCommandVisual(
			profile, current, inherited, options,
		);
		inheritedSegment = [];
	};
	for (const child of command.commands) {
		if (canJoinInheritedBatchSegment(child)) {
			inheritedSegment.push(child);
			continue;
		}
		flushInheritedSegment();
		current = applyNormalized(profile, current, child, options);
	}
	flushInheritedSegment();
	const draft = structuredClone(current) as unknown as Record<string, unknown>;
	advanceBookkeeping(draft, project, options);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsVisual(profile, draft);
	validateFramescaperProjectVisual(profile, draft);
	return draft as unknown as FramescaperProjectVisual;
}

function canJoinInheritedBatchSegment(command: FramescaperProjectCommandVisual): boolean {
	if (isBatch(command) || isFramescaperOwnedVisualCommandTypeVisual(command.type)) return false;
	// composition composition and transitions transition commands own validation boundaries.
	// Foundation commands stay grouped so temporarily incomplete media pairs are
	// never exposed to validation between children of one atomic transaction.
	return command.type !== 'video-composition/set' && command.type !== 'video-transition/set';
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper visual command must be an object.');
	}
	const type = readClosedDomainField(
		value as Readonly<Record<string, unknown>>, 'type', 'Framescaper visual command',
	);
	if (typeof type !== 'string') throw new TypeError('Framescaper visual command.type must be a string.');
	return type;
}

function advanceBookkeeping(
	draft: Record<string, unknown>,
	project: FramescaperProjectVisual,
	options: FramescaperProjectCommandOptionsVisual,
): void {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper visual revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper visual timestamp is invalid.');
	return date.toISOString();
}
