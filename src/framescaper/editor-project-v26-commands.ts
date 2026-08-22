/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { assertOfxEffectStateV26, type OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../common/editor/project-validation-budget.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV26,
} from './editor-project-feature-requirements-v26.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v25.ts';
import {
	applyFramescaperProjectCommandV25,
	snapshotFramescaperProjectCommandV25,
	type FramescaperProjectCommandOptionsV25,
	type FramescaperProjectCommandV25,
} from './editor-project-v25-commands.ts';
import {
	framescaperProjectV25FoundationV26,
	validateFramescaperProjectV26,
	type FramescaperProjectV26,
} from './editor-project-v26-validation.ts';

export interface FramescaperOpenFxEffectSetCommandV26 {
	readonly type: 'openfx-effect/set';
	readonly instanceId: string;
	readonly expectedEffect: OfxEffectStateV26 | null;
	readonly effect: OfxEffectStateV26 | null;
}

export interface FramescaperProjectCommandBatchV26 {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandV26[];
}

export type FramescaperProjectCommandV26 =
	| FramescaperOpenFxEffectSetCommandV26
	| FramescaperProjectCommandBatchV26
	| FramescaperProjectCommandV25;
export type FramescaperProjectCommandOptionsV26 = FramescaperProjectCommandOptionsV25;

interface SnapshotBudget { readonly active: Set<object>; count: number }

const COMMAND_FIELDS = Object.freeze(['type', 'instanceId', 'expectedEffect', 'effect']);
const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

export function snapshotFramescaperProjectCommandV26(value: unknown): FramescaperProjectCommandV26 {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandV26(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV26 = {},
): FramescaperProjectV26 {
	assertFramescaperProjectV26CandidateProfile(profile);
	validateFramescaperProjectV26(profile, project);
	const command = snapshotFramescaperProjectCommandV26(commandValue);
	return applyNormalized(profile, project as FramescaperProjectV26, command, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandV26 {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS) throw new RangeError('Framescaper V26 command tree exceeds its limit.');
	if (depth > MAXIMUM_DEPTH) throw new RangeError('Framescaper V26 command tree exceeds its depth limit.');
	const type = commandType(value);
	if (type === 'openfx-effect/set') return snapshotEffect(value);
	if (type !== 'batch') return snapshotFramescaperProjectCommandV25(value);
	const record = readClosedDomainRecord(value, 'Framescaper V26 batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic V26 command batches are unsupported.');
	const commands = readClosedDomainArray(
		field(record, 'commands'), 'Framescaper V26 batch.commands', 1, MAXIMUM_COMMANDS,
	);
	budget.active.add(record);
	try {
		return Object.freeze({ type: 'batch' as const,
			commands: Object.freeze(commands.map((child) => snapshot(child, budget, depth + 1))) });
	} finally {
		budget.active.delete(record);
	}
}

function snapshotEffect(value: unknown): FramescaperOpenFxEffectSetCommandV26 {
	const command = readClosedDomainRecord(value, 'Framescaper V26 command', COMMAND_FIELDS);
	const instanceId = stableId(field(command, 'instanceId'));
	const expectedEffect = optionalEffect(field(command, 'expectedEffect'));
	const effect = optionalEffect(field(command, 'effect'));
	if (expectedEffect === null && effect === null) {
		throw new RangeError('A V26 OpenFX command must add, replace, or remove an effect.');
	}
	for (const candidate of [expectedEffect, effect]) {
		if (candidate !== null && candidate.instanceId !== instanceId) {
			throw new RangeError('A V26 OpenFX command cannot change effect instance identity.');
		}
	}
	return Object.freeze({ type: 'openfx-effect/set', instanceId, expectedEffect, effect });
}

function applyNormalized(
	profile: unknown,
	project: FramescaperProjectV26,
	command: FramescaperProjectCommandV26,
	options: FramescaperProjectCommandOptionsV26,
): FramescaperProjectV26 {
	if (isBatch(command)) return applyBatch(profile, project, command, options);
	if (!isEffectCommand(command)) return applyInherited(profile, project, command, options);
	const current = project.ofxEffects.find(({ instanceId }) => instanceId === command.instanceId) ?? null;
	if (!same(current, command.expectedEffect)) throw new Error('The expected V26 OpenFX effect is stale.');
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const effects = draft.ofxEffects as OfxEffectStateV26[];
	const index = effects.findIndex(({ instanceId }) => instanceId === command.instanceId);
	if (command.effect === null) effects.splice(index, 1);
	else if (index < 0) effects.push(command.effect);
	else effects[index] = command.effect;
	advanceBookkeeping(draft, project, options);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV26(profile, draft);
	validateFramescaperProjectV26(profile, draft);
	return draft as unknown as FramescaperProjectV26;
}

function isBatch(command: FramescaperProjectCommandV26): command is FramescaperProjectCommandBatchV26 {
	return command.type === 'batch' && Array.isArray(command.commands);
}

function isEffectCommand(
	command: FramescaperProjectCommandV26,
): command is FramescaperOpenFxEffectSetCommandV26 {
	return command.type === 'openfx-effect/set' && Object.hasOwn(command, 'expectedEffect');
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectV26,
	command: FramescaperProjectCommandBatchV26,
	options: FramescaperProjectCommandOptionsV26,
): FramescaperProjectV26 {
	let current = project;
	for (const child of command.commands) current = applyNormalized(profile, current, child, options);
	const draft = structuredClone(current) as unknown as Record<string, unknown>;
	advanceBookkeeping(draft, project, options);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV26(profile, draft);
	validateFramescaperProjectV26(profile, draft);
	return draft as unknown as FramescaperProjectV26;
}

function applyInherited(
	profile: unknown,
	project: FramescaperProjectV26,
	command: FramescaperProjectCommandV25,
	options: FramescaperProjectCommandOptionsV26,
): FramescaperProjectV26 {
	const foundation = framescaperProjectV25FoundationV26(profile, project);
	const applied = applyFramescaperProjectCommandV25(
		FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE, foundation, command, options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion = 26;
	applied.ofxEffects = structuredClone(project.ofxEffects);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV26(profile, applied);
	validateFramescaperProjectV26(profile, applied);
	return applied as unknown as FramescaperProjectV26;
}

function optionalEffect(value: unknown): OfxEffectStateV26 | null {
	if (value === null) return null;
	const snapshot = structuredClone(value) as unknown;
	assertOfxEffectStateV26(snapshot);
	return deepFreeze(snapshot);
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Framescaper V26 command must be an object.');
	const type = field(value as Readonly<Record<string, unknown>>, 'type');
	if (typeof type !== 'string') throw new TypeError('Framescaper V26 command.type must be a string.');
	return type;
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(record, name, 'Framescaper V26 command');
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('Framescaper V26 instanceId must be a stable ID.');
	return value;
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function advanceBookkeeping(
	draft: Record<string, unknown>, project: FramescaperProjectV26, options: FramescaperProjectCommandOptionsV26,
): void {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V26 revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V26 timestamp is invalid.');
	return date.toISOString();
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
