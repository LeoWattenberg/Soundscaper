/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import { AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../common/editor/project-validation-budget.ts';
import {
	applyFramescaperProjectCommandV27,
	snapshotFramescaperProjectCommandV27,
	type FramescaperProjectCommandOptionsV27,
	type FramescaperProjectCommandV27,
} from './editor-project-v27-commands.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { reconcileInheritedFramescaperProjectStateV27 } from './editor-project-v27-inherited-state.ts';
import { framescaperVideoSourceCharacteristicsV24ProjectionV25 } from './editor-project-v25-foundation.ts';
import {
	applyFramescaperProfessionalSourceCollectionCommandV25,
	isFramescaperProfessionalSourceCollectionCommandTypeV25,
	type FramescaperProfessionalSourceCollectionCommandV25,
} from './editor-project-v25-source-command.ts';
import {
	snapshotFramescaperProjectCommandV25,
	type FramescaperProfessionalSourceStateSetCommandV25,
} from './editor-project-v25-commands.ts';
import {
	snapshotFramescaperProjectCommandV26,
	type FramescaperOpenFxEffectSetCommandV26,
} from './editor-project-v26-commands.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import {
	normalizeFramescaperProjectNativeStateV28,
	validateFramescaperProjectV28,
} from './editor-project-v28-validation.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';

export interface FramescaperProjectCommandBatchV28 {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandV28[];
}

export type FramescaperProjectCommandV28 =
	| FramescaperOpenFxEffectSetCommandV26
	| FramescaperProfessionalSourceStateSetCommandV25
	| FramescaperProfessionalSourceCollectionCommandV25
	| FramescaperProjectCommandV27
	| FramescaperProjectCommandBatchV28;
export type FramescaperProjectCommandOptionsV28 = FramescaperProjectCommandOptionsV27;

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

interface SnapshotBudget { readonly active: Set<object>; count: number }
type NativeSourceAuthorityV28 = Readonly<Record<string, unknown>>;

export function snapshotFramescaperProjectCommandV28(value: unknown): FramescaperProjectCommandV28 {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandV28(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV28 = {},
): FramescaperProjectV28 {
	assertFramescaperProjectV28Profile(profile);
	validateFramescaperProjectV28(profile, projectValue);
	return applyNormalized(
		profile, projectValue as FramescaperProjectV28,
		snapshotFramescaperProjectCommandV28(commandValue), options,
	);
}

function snapshot(
	value: unknown, budget: SnapshotBudget, depth: number,
): FramescaperProjectCommandV28 {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS || depth > MAXIMUM_DEPTH) {
		throw new RangeError('Framescaper V28 command tree exceeds its bounded budget.');
	}
	const type = commandType(value);
	if (type === 'openfx-effect/set') {
		return snapshotFramescaperProjectCommandV26(value) as FramescaperOpenFxEffectSetCommandV26;
	}
	if (type === 'video-source/professional-state-set'
		|| isFramescaperProfessionalSourceCollectionCommandTypeV25(type)) {
		return snapshotFramescaperProjectCommandV25(value) as
			FramescaperProfessionalSourceStateSetCommandV25 | FramescaperProfessionalSourceCollectionCommandV25;
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandV27(value);
	const record = readClosedDomainRecord(value, 'Framescaper V28 batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic V28 command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(record, 'commands', 'Framescaper V28 batch'),
		'Framescaper V28 batch.commands', 1, MAXIMUM_COMMANDS,
	);
	budget.active.add(record);
	try {
		return Object.freeze({
			type: 'batch', commands: Object.freeze(commands.map((child) => snapshot(child, budget, depth + 1))),
		});
	} finally { budget.active.delete(record); }
}

function applyNormalized(
	profile: unknown,
	project: FramescaperProjectV28,
	command: FramescaperProjectCommandV28,
	options: FramescaperProjectCommandOptionsV28,
): FramescaperProjectV28 {
	if (isBatch(command)) return applyBatch(profile, project, command.commands, options);
	if (isOpenFxCommand(command)) return applyOpenFx(profile, project, command, options);
	if (isProfessionalStateCommand(command)) {
		return applyProfessionalState(profile, project, command, options);
	}
	if (isFramescaperProfessionalSourceCollectionCommandTypeV25(command.type)) {
		const draft = structuredClone(project) as unknown as Record<string, unknown>;
		applyFramescaperProfessionalSourceCollectionCommandV25(
			draft, command as FramescaperProfessionalSourceCollectionCommandV25,
		);
		reconcileInheritedFramescaperProjectStateV27(draft);
		return finalize(profile, project, draft, options);
	}
	return applyInherited(profile, project, command as FramescaperProjectCommandV27, options);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectV28,
	commands: readonly FramescaperProjectCommandV28[],
	options: FramescaperProjectCommandOptionsV28,
): FramescaperProjectV28 {
	let current = project;
	let inherited: FramescaperProjectCommandV27[] = [];
	// Preserve V27 batch atomicity across adjacent inherited children while V28
	// commands continue to advance and validate their own native authority.
	const flushInherited = (): void => {
		if (inherited.length === 0) return;
		const command: FramescaperProjectCommandV27 = inherited.length === 1
			? inherited[0]!
			: { type: 'batch', commands: inherited };
		current = applyInherited(profile, current, command, options);
		inherited = [];
	};
	for (const child of commands) {
		if (!isBatch(child) && !isV28OwnedCommand(child)) {
			inherited.push(child as FramescaperProjectCommandV27);
			continue;
		}
		flushInherited();
		current = applyNormalized(profile, current, child, options);
	}
	flushInherited();
	return current;
}

function applyInherited(
	profile: unknown,
	project: FramescaperProjectV28,
	command: FramescaperProjectCommandV27,
	options: FramescaperProjectCommandOptionsV28,
): FramescaperProjectV28 {
	const nativeState = new Map<string, NativeSourceAuthorityV28>(records(project.sources, 'sources')
		.filter(({ kind }) => kind === 'video')
		.map((source) => [String(source.id), snapshotNativeSourceV28(source)]));
	const projectedCommand = projectInheritedCommandV28(command);
	for (const [id, state] of projectedCommand.nativeState) nativeState.set(id, state);
	const applied = applyFramescaperProjectCommandV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV27FoundationShapeV28(project), projectedCommand.command, options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion = 28;
	applied.sources = records(applied.sources, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		return restoreNativeSourceV28(source, nativeState.get(String(source.id)));
	});
	applied.ofxEffects = structuredClone(project.ofxEffects);
	normalizeFramescaperProjectNativeStateV28(profile, applied);
	validateFramescaperProjectV28(profile, applied);
	return applied as unknown as FramescaperProjectV28;
}

function projectInheritedCommandV28(command: FramescaperProjectCommandV27): Readonly<{
	command: FramescaperProjectCommandV27;
	nativeState: ReadonlyMap<string, NativeSourceAuthorityV28>;
}> {
	const projected = structuredClone(command) as unknown as Record<string, unknown>;
	const nativeState = new Map<string, NativeSourceAuthorityV28>();
	projectInheritedCommandNodeV28(projected, nativeState);
	return Object.freeze({ command: projected as unknown as FramescaperProjectCommandV27, nativeState });
}

function projectInheritedCommandNodeV28(
	command: Record<string, unknown>,
	nativeState: Map<string, NativeSourceAuthorityV28>,
): void {
	if (command.type === 'batch') {
		for (const child of records(command.commands, 'V28 inherited command batch')) {
			projectInheritedCommandNodeV28(child, nativeState);
		}
		return;
	}
	if (command.type !== 'source/add') return;
	const source = record(command.source, 'V28 source admission');
	if (source.kind !== 'video') return;
	const id = String(source.id);
	nativeState.set(id, snapshotNativeSourceV28(source));
	delete source.imageSequence;
	source.characteristics = framescaperVideoSourceCharacteristicsV24ProjectionV25(source);
}

function snapshotNativeSourceV28(source: Record<string, unknown>): NativeSourceAuthorityV28 {
	const snapshot = structuredClone(source);
	if (!Object.hasOwn(snapshot, 'imageSequence')) snapshot.imageSequence = null;
	return Object.freeze(snapshot);
}

/** Restore native facts only while the inherited command left their foundation authority intact. */
function restoreNativeSourceV28(
	source: Record<string, unknown>,
	native: NativeSourceAuthorityV28 | undefined,
): Record<string, unknown> {
	if (!native) return { ...source, imageSequence: null };
	const characteristicsUnchanged = same(
		source.characteristics,
		framescaperVideoSourceCharacteristicsV24ProjectionV25(native),
	);
	return {
		...source,
		characteristics: structuredClone(
			characteristicsUnchanged ? native.characteristics : source.characteristics,
		),
		imageSequence: characteristicsUnchanged && imageSequenceAuthorityUnchanged(native, source)
			? restoreImageSequenceV28(native.imageSequence, source.name)
			: null,
	};
}

function imageSequenceAuthorityUnchanged(
	before: NativeSourceAuthorityV28,
	after: Readonly<Record<string, unknown>>,
): boolean {
	return ['id', 'storageKey', 'contentSha256', 'sourceFrameCount', 'frameRate']
		.every((field) => same(before[field], after[field]));
}

function restoreImageSequenceV28(value: unknown, name: unknown): unknown {
	if (value === undefined || value === null) return null;
	const restored = structuredClone(record(value, 'V28 image-sequence authority'));
	// A source/update rename changes only the user-facing label. V25 binds the
	// descriptor label to its owner, so advance that binding without discarding
	// the unchanged inventory, source-pack, frame, or characteristics authority.
	restored.name = structuredClone(name);
	return restored;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function applyOpenFx(
	profile: unknown, project: FramescaperProjectV28,
	command: FramescaperOpenFxEffectSetCommandV26, options: FramescaperProjectCommandOptionsV28,
): FramescaperProjectV28 {
	const current = project.ofxEffects.find(({ instanceId }) => instanceId === command.instanceId) ?? null;
	if (JSON.stringify(current) !== JSON.stringify(command.expectedEffect)) {
		throw new Error('The expected V28 OpenFX effect is stale.');
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const effects = draft.ofxEffects as OfxEffectStateV26[];
	const index = effects.findIndex(({ instanceId }) => instanceId === command.instanceId);
	if (command.effect === null) effects.splice(index, 1);
	else if (index < 0) effects.push(command.effect);
	else effects[index] = command.effect;
	return finalize(profile, project, draft, options);
}

function applyProfessionalState(
	profile: unknown, project: FramescaperProjectV28,
	command: FramescaperProfessionalSourceStateSetCommandV25, options: FramescaperProjectCommandOptionsV28,
): FramescaperProjectV28 {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const source = records(draft.sources, 'sources').find(({ id, kind }) => (
		id === command.sourceId && kind === 'video'
	));
	if (!source) throw new ReferenceError(`Framescaper V28 video source ${command.sourceId} does not exist.`);
	const current = {
		characteristics: source.characteristics,
		imageSequence: source.imageSequence,
		proxyAttachment: source.proxyAttachment,
	};
	if (JSON.stringify(current) !== JSON.stringify(command.expectedState)) {
		throw new Error('The expected V28 professional source state is stale.');
	}
	Object.assign(source, structuredClone(command.state));
	return finalize(profile, project, draft, options);
}

function finalize(
	profile: unknown, prior: FramescaperProjectV28, draft: Record<string, unknown>,
	options: FramescaperProjectCommandOptionsV28,
): FramescaperProjectV28 {
	const revision = Number(prior.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V28 revision overflowed.');
	draft.revision = revision;
	const date = options.now === undefined ? new Date() : new Date(options.now);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V28 timestamp is invalid.');
	draft.updatedAt = date.toISOString();
	normalizeFramescaperProjectNativeStateV28(profile, draft);
	validateFramescaperProjectV28(profile, draft);
	return draft as unknown as FramescaperProjectV28;
}

function isBatch(command: FramescaperProjectCommandV28): command is FramescaperProjectCommandBatchV28 {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}
function isOpenFxCommand(
	command: FramescaperProjectCommandV28,
): command is FramescaperOpenFxEffectSetCommandV26 {
	return command.type === 'openfx-effect/set' && Object.hasOwn(command, 'expectedEffect');
}
function isProfessionalStateCommand(
	command: FramescaperProjectCommandV28,
): command is FramescaperProfessionalSourceStateSetCommandV25 {
	return command.type === 'video-source/professional-state-set' && Object.hasOwn(command, 'expectedState');
}
function isV28OwnedCommand(command: FramescaperProjectCommandV28): boolean {
	return isOpenFxCommand(command) || isProfessionalStateCommand(command)
		|| isFramescaperProfessionalSourceCollectionCommandTypeV25(command.type);
}
function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Framescaper V28 command must be an object.');
	const type = readClosedDomainField(value as Record<string, unknown>, 'type', 'Framescaper V28 command');
	if (typeof type !== 'string') throw new TypeError('Framescaper V28 command.type must be a string.');
	return type;
}
function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${name}[${String(index)}] must be an object.`);
		return item as Record<string, unknown>;
	});
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
