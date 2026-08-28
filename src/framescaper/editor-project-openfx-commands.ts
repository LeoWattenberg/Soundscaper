/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { assertOfxEffectStateV26, type OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../common/editor/project-validation-budget.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsOpenFx,
} from './editor-project-feature-requirements-openfx.ts';
import { assertFramescaperProjectOpenFxCandidateProfile } from './editor-domain-runtime-profile.ts';
import { FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	applyFramescaperProjectCommandProfessionalMedia,
	snapshotFramescaperProjectCommandProfessionalMedia,
	type FramescaperProjectCommandOptionsProfessionalMedia,
	type FramescaperProjectCommandProfessionalMedia,
} from './editor-project-professional-media-commands.ts';
import {
	framescaperProjectProfessionalMediaFoundationOpenFx,
	validateFramescaperProjectOpenFx,
	type FramescaperProjectOpenFx,
} from './editor-project-openfx-validation.ts';

export interface FramescaperOpenFxEffectSetCommandOpenFx {
	readonly type: 'openfx-effect/set';
	readonly instanceId: string;
	readonly expectedEffect: OfxEffectStateV26 | null;
	readonly effect: OfxEffectStateV26 | null;
}

export interface FramescaperProjectCommandBatchOpenFx {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandOpenFx[];
}

export type FramescaperProjectCommandOpenFx =
	| FramescaperOpenFxEffectSetCommandOpenFx
	| FramescaperProjectCommandBatchOpenFx
	| FramescaperProjectCommandProfessionalMedia;
export type FramescaperProjectCommandOptionsOpenFx = FramescaperProjectCommandOptionsProfessionalMedia;

interface SnapshotBudget { readonly active: Set<object>; count: number }

const COMMAND_FIELDS = Object.freeze(['type', 'instanceId', 'expectedEffect', 'effect']);
const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

export function snapshotFramescaperProjectCommandOpenFx(value: unknown): FramescaperProjectCommandOpenFx {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandOpenFx(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsOpenFx = {},
): FramescaperProjectOpenFx {
	assertFramescaperProjectOpenFxCandidateProfile(profile);
	validateFramescaperProjectOpenFx(profile, project);
	const command = snapshotFramescaperProjectCommandOpenFx(commandValue);
	return applyNormalized(profile, project as FramescaperProjectOpenFx, command, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandOpenFx {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS) throw new RangeError('Framescaper openFx command tree exceeds its limit.');
	if (depth > MAXIMUM_DEPTH) throw new RangeError('Framescaper openFx command tree exceeds its depth limit.');
	const type = commandType(value);
	if (type === 'openfx-effect/set') return snapshotEffect(value);
	if (type !== 'batch') return snapshotFramescaperProjectCommandProfessionalMedia(value);
	const record = readClosedDomainRecord(value, 'Framescaper openFx batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic openFx command batches are unsupported.');
	const commands = readClosedDomainArray(
		field(record, 'commands'), 'Framescaper openFx batch.commands', 1, MAXIMUM_COMMANDS,
	);
	budget.active.add(record);
	try {
		return Object.freeze({ type: 'batch' as const,
			commands: Object.freeze(commands.map((child) => snapshot(child, budget, depth + 1))) });
	} finally {
		budget.active.delete(record);
	}
}

function snapshotEffect(value: unknown): FramescaperOpenFxEffectSetCommandOpenFx {
	const command = readClosedDomainRecord(value, 'Framescaper openFx command', COMMAND_FIELDS);
	const instanceId = stableId(field(command, 'instanceId'));
	const expectedEffect = optionalEffect(field(command, 'expectedEffect'));
	const effect = optionalEffect(field(command, 'effect'));
	if (expectedEffect === null && effect === null) {
		throw new RangeError('A openFx OpenFX command must add, replace, or remove an effect.');
	}
	for (const candidate of [expectedEffect, effect]) {
		if (candidate !== null && candidate.instanceId !== instanceId) {
			throw new RangeError('A openFx OpenFX command cannot change effect instance identity.');
		}
	}
	return Object.freeze({ type: 'openfx-effect/set', instanceId, expectedEffect, effect });
}

function applyNormalized(
	profile: unknown,
	project: FramescaperProjectOpenFx,
	command: FramescaperProjectCommandOpenFx,
	options: FramescaperProjectCommandOptionsOpenFx,
): FramescaperProjectOpenFx {
	if (isBatch(command)) return applyBatch(profile, project, command, options);
	if (!isEffectCommand(command)) return applyInherited(profile, project, command, options);
	const current = project.ofxEffects.find(({ instanceId }) => instanceId === command.instanceId) ?? null;
	if (!same(current, command.expectedEffect)) throw new Error('The expected openFx OpenFX effect is stale.');
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const effects = draft.ofxEffects as OfxEffectStateV26[];
	const index = effects.findIndex(({ instanceId }) => instanceId === command.instanceId);
	if (command.effect === null) effects.splice(index, 1);
	else if (index < 0) effects.push(command.effect);
	else effects[index] = command.effect;
	advanceBookkeeping(draft, project, options);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsOpenFx(profile, draft);
	validateFramescaperProjectOpenFx(profile, draft);
	return draft as unknown as FramescaperProjectOpenFx;
}

function isBatch(command: FramescaperProjectCommandOpenFx): command is FramescaperProjectCommandBatchOpenFx {
	return command.type === 'batch' && Array.isArray(command.commands);
}

function isEffectCommand(
	command: FramescaperProjectCommandOpenFx,
): command is FramescaperOpenFxEffectSetCommandOpenFx {
	return command.type === 'openfx-effect/set' && Object.hasOwn(command, 'expectedEffect');
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectOpenFx,
	command: FramescaperProjectCommandBatchOpenFx,
	options: FramescaperProjectCommandOptionsOpenFx,
): FramescaperProjectOpenFx {
	let current = project;
	for (const child of command.commands) current = applyNormalized(profile, current, child, options);
	const draft = structuredClone(current) as unknown as Record<string, unknown>;
	advanceBookkeeping(draft, project, options);
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsOpenFx(profile, draft);
	validateFramescaperProjectOpenFx(profile, draft);
	return draft as unknown as FramescaperProjectOpenFx;
}

function applyInherited(
	profile: unknown,
	project: FramescaperProjectOpenFx,
	command: FramescaperProjectCommandProfessionalMedia,
	options: FramescaperProjectCommandOptionsOpenFx,
): FramescaperProjectOpenFx {
	const foundation = framescaperProjectProfessionalMediaFoundationOpenFx(profile, project);
	const applied = applyFramescaperProjectCommandProfessionalMedia(
		FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE, foundation, command, options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion =  1;
	applied.ofxEffects = structuredClone(project.ofxEffects);
	applied.featureRequirements = reconcileFramescaperProjectFeatureRequirementsOpenFx(profile, applied);
	validateFramescaperProjectOpenFx(profile, applied);
	return applied as unknown as FramescaperProjectOpenFx;
}

function optionalEffect(value: unknown): OfxEffectStateV26 | null {
	if (value === null) return null;
	const snapshot = structuredClone(value) as unknown;
	assertOfxEffectStateV26(snapshot);
	return deepFreeze(snapshot);
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Framescaper openFx command must be an object.');
	const type = field(value as Readonly<Record<string, unknown>>, 'type');
	if (typeof type !== 'string') throw new TypeError('Framescaper openFx command.type must be a string.');
	return type;
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(record, name, 'Framescaper openFx command');
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('Framescaper openFx instanceId must be a stable ID.');
	return value;
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function advanceBookkeeping(
	draft: Record<string, unknown>, project: FramescaperProjectOpenFx, options: FramescaperProjectCommandOptionsOpenFx,
): void {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper openFx revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper openFx timestamp is invalid.');
	return date.toISOString();
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
