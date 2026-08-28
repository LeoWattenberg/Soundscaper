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
	reconcileFramescaperProjectFeatureRequirementsFinishing,
} from './editor-project-feature-requirements-finishing.ts';
import {
	snapshotFramescaperProjectCommandVisual,
	type FramescaperProjectCommandBatchVisual,
	type FramescaperProjectCommandOptionsVisual,
	type FramescaperProjectCommandVisual,
} from './editor-project-visual-commands.ts';
import { applyInheritedFramescaperProjectCommandFinishing } from './editor-project-finishing-command-inheritance.ts';
import {
	applyFramescaperOwnedFinishingCommandFinishing,
	isFramescaperOwnedFinishingCommandTypeFinishing,
	snapshotFramescaperOwnedFinishingCommandFinishing,
	type FramescaperOwnedFinishingCommandFinishing,
} from './editor-project-finishing-finishing-command.ts';
import { assertFramescaperProjectFinishingProfile } from './editor-domain-runtime-profile.ts';
import {
	normalizeFramescaperProjectFinishingStateFinishing,
	validateFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing-validation.ts';
import {
	isFramescaperVideoProxyDetachCommandRetime,
	snapshotFramescaperVideoProxyDetachCommandRetime,
	type FramescaperVideoProxyDetachCommandRetime,
} from './editor-video-proxy-command-retime.ts';

type FramescaperInheritedProjectCommandFinishing = Exclude<
	FramescaperProjectCommandVisual,
	FramescaperProjectCommandBatchVisual
>;

export interface FramescaperProjectCommandBatchFinishing {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandFinishing[];
}

export type FramescaperProjectCommandFinishing =
	| FramescaperOwnedFinishingCommandFinishing
	| FramescaperVideoProxyDetachCommandRetime
	| FramescaperProjectCommandBatchFinishing
	| FramescaperInheritedProjectCommandFinishing;
export type FramescaperProjectCommandOptionsFinishing = FramescaperProjectCommandOptionsVisual;

interface SnapshotBudget {
	readonly active: Set<object>;
	count: number;
}

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

export function snapshotFramescaperProjectCommandFinishing(value: unknown): FramescaperProjectCommandFinishing {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

/** Build the exact inherited detach wire admitted by selected finishing history. */
export function createFramescaperVideoProxyDetachCommandFinishing(
	sourceId: string,
	expectedAttachment: unknown,
): Readonly<FramescaperVideoProxyDetachCommandRetime> {
	return snapshotFramescaperVideoProxyDetachCommandRetime({
		type: 'framescaper/video-proxy-detach', sourceId, expectedAttachment,
	});
}

export function applyFramescaperProjectCommandFinishing(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsFinishing = {},
): FramescaperProjectFinishing {
	assertFramescaperProjectFinishingProfile(profile);
	validateFramescaperProjectFinishing(profile, project);
	const command = snapshotFramescaperProjectCommandFinishing(commandValue);
	return applyNormalized(profile, project as FramescaperProjectFinishing, command, options);
}

function snapshot(
	value: unknown,
	budget: SnapshotBudget,
	depth: number,
): FramescaperProjectCommandFinishing {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS) throw new RangeError('Framescaper finishing command tree exceeds its limit.');
	if (depth > MAXIMUM_DEPTH) throw new RangeError('Framescaper finishing command tree exceeds its depth limit.');
	const type = commandType(value);
	if (isFramescaperVideoProxyDetachCommandRetime(value)) {
		return snapshotFramescaperVideoProxyDetachCommandRetime(value);
	}
	if (isFramescaperOwnedFinishingCommandTypeFinishing(type)) {
		return snapshotFramescaperOwnedFinishingCommandFinishing(value);
	}
	if (type !== 'batch') {
		return snapshotFramescaperProjectCommandVisual(value) as FramescaperInheritedProjectCommandFinishing;
	}
	const record = readClosedDomainRecord(value, 'Framescaper finishing batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic finishing command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(record, 'commands', 'Framescaper finishing batch'),
		'Framescaper finishing batch.commands', 1, MAXIMUM_COMMANDS,
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
	project: FramescaperProjectFinishing,
	command: FramescaperProjectCommandFinishing,
	options: FramescaperProjectCommandOptionsFinishing,
): FramescaperProjectFinishing {
	if (isBatch(command)) return applyBatch(profile, project, command, options);
	if (!isFramescaperOwnedFinishingCommandTypeFinishing(command.type)) {
		return applyInheritedFramescaperProjectCommandFinishing(profile, project, command, options);
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyFramescaperOwnedFinishingCommandFinishing(
		draft,
		command as FramescaperOwnedFinishingCommandFinishing,
	);
	return finalizeDraft(profile, project, draft, options);
}

function isBatch(command: FramescaperProjectCommandFinishing): command is FramescaperProjectCommandBatchFinishing {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectFinishing,
	command: FramescaperProjectCommandBatchFinishing,
	options: FramescaperProjectCommandOptionsFinishing,
): FramescaperProjectFinishing {
	let current = project;
	let inheritedSegment: FramescaperInheritedProjectCommandFinishing[] = [];
	let ownedSegment: FramescaperOwnedFinishingCommandFinishing[] = [];
	const flushInheritedSegment = (): void => {
		if (inheritedSegment.length === 0) return;
		const inherited = inheritedSegment.length === 1
			? inheritedSegment[0]!
			: Object.freeze({
				type: 'batch' as const,
				commands: Object.freeze([...inheritedSegment]),
			});
		current = applyInheritedFramescaperProjectCommandFinishing(
			profile, current, inherited, options,
		);
		inheritedSegment = [];
	};
	const flushOwnedSegment = (): void => {
		if (ownedSegment.length === 0) return;
		const draft = structuredClone(current) as unknown as Record<string, unknown>;
		for (const owned of ownedSegment) applyFramescaperOwnedFinishingCommandFinishing(draft, owned);
		current = finalizeDraft(profile, current, draft, options);
		ownedSegment = [];
	};
	for (const child of command.commands) {
		if (!isBatch(child) && !isFramescaperOwnedFinishingCommandTypeFinishing(child.type)) {
			flushOwnedSegment();
			inheritedSegment.push(child as FramescaperInheritedProjectCommandFinishing);
			continue;
		}
		flushInheritedSegment();
		if (!isBatch(child)) {
			ownedSegment.push(child as FramescaperOwnedFinishingCommandFinishing);
			continue;
		}
		flushOwnedSegment();
		current = applyNormalized(profile, current, child, options);
	}
	flushInheritedSegment();
	flushOwnedSegment();
	const draft = structuredClone(current) as unknown as Record<string, unknown>;
	return finalizeDraft(profile, project, draft, options);
}

function finalizeDraft(
	profile: unknown,
	prior: FramescaperProjectFinishing,
	draft: Record<string, unknown>,
	options: FramescaperProjectCommandOptionsFinishing,
): FramescaperProjectFinishing {
	advanceBookkeeping(draft, prior, options);
	normalizeFramescaperProjectFinishingStateFinishing(draft);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsFinishing(profile, draft);
	validateFramescaperProjectFinishing(profile, draft);
	return draft as unknown as FramescaperProjectFinishing;
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper finishing command must be an object.');
	}
	const type = readClosedDomainField(
		value as Readonly<Record<string, unknown>>, 'type', 'Framescaper finishing command',
	);
	if (typeof type !== 'string') throw new TypeError('Framescaper finishing command.type must be a string.');
	return type;
}

function advanceBookkeeping(
	draft: Record<string, unknown>,
	project: FramescaperProjectFinishing,
	options: FramescaperProjectCommandOptionsFinishing,
): void {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper finishing revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper finishing timestamp is invalid.');
	return date.toISOString();
}
