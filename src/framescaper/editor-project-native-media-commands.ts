/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import { AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../common/editor/project-validation-budget.ts';
import { videoSourceCharacteristicsCarryProfessionalFields } from '../common/editor/video-source-characteristics-consumer.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../common/editor/video-source-professional-characteristics-v25.ts';
import { mergeVideoSourceProfessionalCharacteristicsForReprobe } from '../common/editor/video-source-upgrade.ts';
import {
	applyFramescaperProjectCommandFinishing,
	snapshotFramescaperProjectCommandFinishing,
	type FramescaperProjectCommandOptionsFinishing,
	type FramescaperProjectCommandFinishing,
} from './editor-project-finishing-commands.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { reconcileInheritedFramescaperProjectStateFinishing } from './editor-project-finishing-inherited-state.ts';
import {
	framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia,
	framescaperVideoSourceRateProfessionalMedia,
} from './editor-project-professional-media-foundation.ts';
import {
	applyFramescaperProfessionalSourceCollectionCommandProfessionalMedia,
	isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia,
	type FramescaperProfessionalSourceCollectionCommandProfessionalMedia,
} from './editor-project-professional-media-source-command.ts';
import {
	snapshotFramescaperProjectCommandProfessionalMedia,
	type FramescaperProfessionalSourceStateSetCommandProfessionalMedia,
} from './editor-project-professional-media-commands.ts';
import {
	snapshotFramescaperProjectCommandOpenFx,
	type FramescaperOpenFxEffectSetCommandOpenFx,
} from './editor-project-openfx-commands.ts';
import { assertFramescaperProjectNativeMediaProfile } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import {
	normalizeFramescaperProjectNativeStateNativeMedia,
	validateFramescaperProjectNativeMedia,
} from './editor-project-native-media-validation.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

export interface FramescaperProjectCommandBatchNativeMedia {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandNativeMedia[];
}

export type FramescaperProjectCommandNativeMedia =
	| FramescaperOpenFxEffectSetCommandOpenFx
	| FramescaperProfessionalSourceStateSetCommandProfessionalMedia
	| FramescaperProfessionalSourceCollectionCommandProfessionalMedia
	| FramescaperProjectCommandFinishing
	| FramescaperProjectCommandBatchNativeMedia;
export type FramescaperProjectCommandOptionsNativeMedia = FramescaperProjectCommandOptionsFinishing;

const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

interface SnapshotBudget { readonly active: Set<object>; count: number }
type NativeSourceAuthorityNativeMedia = Readonly<Record<string, unknown>>;

export function snapshotFramescaperProjectCommandNativeMedia(value: unknown): FramescaperProjectCommandNativeMedia {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function applyFramescaperProjectCommandNativeMedia(
	profile: unknown,
	projectValue: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsNativeMedia = {},
): FramescaperProjectNativeMedia {
	assertFramescaperProjectNativeMediaProfile(profile);
	validateFramescaperProjectNativeMedia(profile, projectValue);
	return applyNormalized(
		profile, projectValue as FramescaperProjectNativeMedia,
		snapshotFramescaperProjectCommandNativeMedia(commandValue), options,
	);
}

function snapshot(
	value: unknown, budget: SnapshotBudget, depth: number,
): FramescaperProjectCommandNativeMedia {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS || depth > MAXIMUM_DEPTH) {
		throw new RangeError('Framescaper nativeMedia command tree exceeds its bounded budget.');
	}
	const type = commandType(value);
	if (type === 'openfx-effect/set') {
		return snapshotFramescaperProjectCommandOpenFx(value) as FramescaperOpenFxEffectSetCommandOpenFx;
	}
	if (type === 'video-source/professional-state-set'
		|| isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia(type)) {
		return snapshotFramescaperProjectCommandProfessionalMedia(value) as
			FramescaperProfessionalSourceStateSetCommandProfessionalMedia | FramescaperProfessionalSourceCollectionCommandProfessionalMedia;
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandFinishing(value);
	const record = readClosedDomainRecord(value, 'Framescaper nativeMedia batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic nativeMedia command batches are unsupported.');
	const commands = readClosedDomainArray(
		readClosedDomainField(record, 'commands', 'Framescaper nativeMedia batch'),
		'Framescaper nativeMedia batch.commands', 1, MAXIMUM_COMMANDS,
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
	project: FramescaperProjectNativeMedia,
	command: FramescaperProjectCommandNativeMedia,
	options: FramescaperProjectCommandOptionsNativeMedia,
): FramescaperProjectNativeMedia {
	if (isBatch(command)) return applyBatch(profile, project, command.commands, options);
	if (isOpenFxCommand(command)) return applyOpenFx(profile, project, command, options);
	if (isProfessionalStateCommand(command)) {
		return applyProfessionalState(profile, project, command, options);
	}
	if (isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia(command.type)) {
		const draft = structuredClone(project) as unknown as Record<string, unknown>;
		applyFramescaperProfessionalSourceCollectionCommandProfessionalMedia(
			draft, command as FramescaperProfessionalSourceCollectionCommandProfessionalMedia,
		);
		reconcileInheritedFramescaperProjectStateFinishing(draft);
		return finalize(profile, project, draft, options);
	}
	return applyInherited(profile, project, command as FramescaperProjectCommandFinishing, options);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectNativeMedia,
	commands: readonly FramescaperProjectCommandNativeMedia[],
	options: FramescaperProjectCommandOptionsNativeMedia,
): FramescaperProjectNativeMedia {
	let current = project;
	let inherited: FramescaperProjectCommandFinishing[] = [];
	// Preserve finishing batch atomicity across adjacent inherited children while nativeMedia
	// commands continue to advance and validate their own native authority.
	const flushInherited = (): void => {
		if (inherited.length === 0) return;
		const command: FramescaperProjectCommandFinishing = inherited.length === 1
			? inherited[0]!
			: { type: 'batch', commands: inherited };
		current = applyInherited(profile, current, command, options);
		inherited = [];
	};
	for (const child of commands) {
		if (!isBatch(child) && !isNativeMediaOwnedCommand(child)) {
			inherited.push(child as FramescaperProjectCommandFinishing);
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
	project: FramescaperProjectNativeMedia,
	command: FramescaperProjectCommandFinishing,
	options: FramescaperProjectCommandOptionsNativeMedia,
): FramescaperProjectNativeMedia {
	const nativeState = new Map<string, NativeSourceAuthorityNativeMedia>(records(project.sources, 'sources')
		.filter(({ kind }) => kind === 'video')
		.map((source) => [String(source.id), snapshotNativeSourceNativeMedia(source)]));
	const projectedCommand = projectInheritedCommandNativeMedia(command, nativeState);
	for (const [id, state] of projectedCommand.nativeState) nativeState.set(id, state);
	const applied = applyFramescaperProjectCommandFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		framescaperProjectFinishingFoundationShapeNativeMedia(project), projectedCommand.command, options,
	) as unknown as Record<string, unknown>;
	applied.schemaVersion =  1;
	applied.sources = records(applied.sources, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		return restoreNativeSourceNativeMedia(source, nativeState.get(String(source.id)));
	});
	applied.ofxEffects = structuredClone(project.ofxEffects);
	normalizeFramescaperProjectNativeStateNativeMedia(profile, applied);
	validateFramescaperProjectNativeMedia(profile, applied);
	return applied as unknown as FramescaperProjectNativeMedia;
}

function projectInheritedCommandNativeMedia(
	command: FramescaperProjectCommandFinishing,
	inheritedNativeState: ReadonlyMap<string, NativeSourceAuthorityNativeMedia>,
): Readonly<{
	command: FramescaperProjectCommandFinishing;
	nativeState: ReadonlyMap<string, NativeSourceAuthorityNativeMedia>;
}> {
	const projected = structuredClone(command) as unknown as Record<string, unknown>;
	const nativeState = new Map<string, NativeSourceAuthorityNativeMedia>();
	projectInheritedCommandNodeNativeMedia(projected, nativeState, inheritedNativeState);
	return Object.freeze({ command: projected as unknown as FramescaperProjectCommandFinishing, nativeState });
}

function projectInheritedCommandNodeNativeMedia(
	command: Record<string, unknown>,
	nativeState: Map<string, NativeSourceAuthorityNativeMedia>,
	inheritedNativeState: ReadonlyMap<string, NativeSourceAuthorityNativeMedia>,
): void {
	if (command.type === 'batch') {
		for (const child of records(command.commands, 'nativeMedia inherited command batch')) {
			projectInheritedCommandNodeNativeMedia(child, nativeState, inheritedNativeState);
		}
		return;
	}
	if (command.type === 'source/add') {
		const source = record(command.source, 'nativeMedia source admission');
		if (source.kind !== 'video') return;
		const id = String(source.id);
		nativeState.set(id, snapshotNativeSourceNativeMedia(source));
		delete source.imageSequence;
		source.characteristics = framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia(source);
		return;
	}
	if (command.type !== 'source/reprobe' || typeof command.sourceId !== 'string') return;
	projectInheritedReprobeNativeMedia(command, nativeState, inheritedNativeState);
}

function projectInheritedReprobeNativeMedia(
	command: Record<string, unknown>,
	nativeState: Map<string, NativeSourceAuthorityNativeMedia>,
	inheritedNativeState: ReadonlyMap<string, NativeSourceAuthorityNativeMedia>,
): void {
	const sourceId = String(command.sourceId);
	const prior = nativeState.get(sourceId) ?? inheritedNativeState.get(sourceId);
	if (!prior?.characteristics) return;
	const changes = record(command.changes, 'nativeMedia inherited source re-probe changes');
	const resulting = { ...structuredClone(prior), ...changes };
	if (Object.hasOwn(changes, 'characteristics')) {
		const requested = changes.characteristics;
		const inherited = inheritedReprobeCharacteristicsNativeMedia(prior, resulting, requested);
		if (videoSourceCharacteristicsCarryProfessionalFields(requested)) {
			const claimed = normalizeVideoSourceCharacteristicsV25(requested, {
				rate: framescaperVideoSourceRateProfessionalMedia(resulting),
			});
			if (!same(claimed, inherited)) {
				throw new RangeError('A source re-probe cannot change professional source characteristics.');
			}
		}
		resulting.characteristics = inherited;
		changes.characteristics = framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia(resulting);
	}
	if (!same(resulting.characteristics, prior.characteristics)
		|| !imageSequenceAuthorityUnchanged(prior, resulting)) resulting.imageSequence = null;
	nativeState.set(sourceId, snapshotNativeSourceNativeMedia(resulting));
}

function inheritedReprobeCharacteristicsNativeMedia(
	prior: NativeSourceAuthorityNativeMedia,
	resulting: Readonly<Record<string, unknown>>,
	requested: unknown,
): ReturnType<typeof normalizeVideoSourceCharacteristicsV25> {
	const visual = framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia({
		...resulting,
		characteristics: requested,
	});
	const rate = framescaperVideoSourceRateProfessionalMedia(resulting);
	if (!rate) throw new RangeError('A source re-probe requires a positive video frame rate.');
	return mergeVideoSourceProfessionalCharacteristicsForReprobe(
		visual,
		prior.characteristics,
		rate,
	);
}

function snapshotNativeSourceNativeMedia(source: Record<string, unknown>): NativeSourceAuthorityNativeMedia {
	const snapshot = structuredClone(source);
	if (!Object.hasOwn(snapshot, 'imageSequence')) snapshot.imageSequence = null;
	return Object.freeze(snapshot);
}

/** Restore native facts only while the inherited command left their foundation authority intact. */
function restoreNativeSourceNativeMedia(
	source: Record<string, unknown>,
	native: NativeSourceAuthorityNativeMedia | undefined,
): Record<string, unknown> {
	if (!native) return { ...source, imageSequence: null };
	const characteristicsUnchanged = same(
		source.characteristics,
		framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia(native),
	);
	return {
		...source,
		characteristics: structuredClone(
			characteristicsUnchanged ? native.characteristics : source.characteristics,
		),
		imageSequence: characteristicsUnchanged && imageSequenceAuthorityUnchanged(native, source)
			? restoreImageSequenceNativeMedia(native.imageSequence, source.name)
			: null,
	};
}

function imageSequenceAuthorityUnchanged(
	before: NativeSourceAuthorityNativeMedia,
	after: Readonly<Record<string, unknown>>,
): boolean {
	return ['id', 'storageKey', 'contentSha256', 'sourceFrameCount', 'frameRate']
		.every((field) => same(before[field], after[field]));
}

function restoreImageSequenceNativeMedia(value: unknown, name: unknown): unknown {
	if (value === undefined || value === null) return null;
	const restored = structuredClone(record(value, 'nativeMedia image-sequence authority'));
	// A source/update rename changes only the user-facing label. professionalMedia binds the
	// descriptor label to its owner, so advance that binding without discarding
	// the unchanged inventory, source-pack, frame, or characteristics authority.
	restored.name = structuredClone(name);
	return restored;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function applyOpenFx(
	profile: unknown, project: FramescaperProjectNativeMedia,
	command: FramescaperOpenFxEffectSetCommandOpenFx, options: FramescaperProjectCommandOptionsNativeMedia,
): FramescaperProjectNativeMedia {
	const current = project.ofxEffects.find(({ instanceId }) => instanceId === command.instanceId) ?? null;
	if (JSON.stringify(current) !== JSON.stringify(command.expectedEffect)) {
		throw new Error('The expected nativeMedia OpenFX effect is stale.');
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const effects = draft.ofxEffects as OfxEffectStateV26[];
	const index = effects.findIndex(({ instanceId }) => instanceId === command.instanceId);
	if (command.effect === null) {
		if (index < 0) throw new ReferenceError(`The nativeMedia OpenFX effect ${command.instanceId} is missing.`);
		effects.splice(index, 1);
	}
	else if (index < 0) effects.push(command.effect);
	else effects[index] = command.effect;
	return finalize(profile, project, draft, options);
}

function applyProfessionalState(
	profile: unknown, project: FramescaperProjectNativeMedia,
	command: FramescaperProfessionalSourceStateSetCommandProfessionalMedia, options: FramescaperProjectCommandOptionsNativeMedia,
): FramescaperProjectNativeMedia {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const source = records(draft.sources, 'sources').find(({ id, kind }) => (
		id === command.sourceId && kind === 'video'
	));
	if (!source) throw new ReferenceError(`Framescaper nativeMedia video source ${command.sourceId} does not exist.`);
	const current = {
		characteristics: source.characteristics,
		imageSequence: source.imageSequence,
		proxyAttachment: source.proxyAttachment,
	};
	if (JSON.stringify(current) !== JSON.stringify(command.expectedState)) {
		throw new Error('The expected nativeMedia professional source state is stale.');
	}
	Object.assign(source, structuredClone(command.state));
	return finalize(profile, project, draft, options);
}

function finalize(
	profile: unknown, prior: FramescaperProjectNativeMedia, draft: Record<string, unknown>,
	options: FramescaperProjectCommandOptionsNativeMedia,
): FramescaperProjectNativeMedia {
	const revision = Number(prior.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper nativeMedia revision overflowed.');
	draft.revision = revision;
	const date = options.now === undefined ? new Date() : new Date(options.now);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper nativeMedia timestamp is invalid.');
	draft.updatedAt = date.toISOString();
	normalizeFramescaperProjectNativeStateNativeMedia(profile, draft);
	validateFramescaperProjectNativeMedia(profile, draft);
	return draft as unknown as FramescaperProjectNativeMedia;
}

function isBatch(command: FramescaperProjectCommandNativeMedia): command is FramescaperProjectCommandBatchNativeMedia {
	return command.type === 'batch' && 'commands' in command && Array.isArray(command.commands);
}
function isOpenFxCommand(
	command: FramescaperProjectCommandNativeMedia,
): command is FramescaperOpenFxEffectSetCommandOpenFx {
	return command.type === 'openfx-effect/set' && Object.hasOwn(command, 'expectedEffect');
}
function isProfessionalStateCommand(
	command: FramescaperProjectCommandNativeMedia,
): command is FramescaperProfessionalSourceStateSetCommandProfessionalMedia {
	return command.type === 'video-source/professional-state-set' && Object.hasOwn(command, 'expectedState');
}
function isNativeMediaOwnedCommand(command: FramescaperProjectCommandNativeMedia): boolean {
	return isOpenFxCommand(command) || isProfessionalStateCommand(command)
		|| isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia(command.type);
}
function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Framescaper nativeMedia command must be an object.');
	const type = readClosedDomainField(value as Record<string, unknown>, 'type', 'Framescaper nativeMedia command');
	if (typeof type !== 'string') throw new TypeError('Framescaper nativeMedia command.type must be a string.');
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
