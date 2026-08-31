/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMasteringSequenceRuntimeHandlers } from '../common/editor/commands/mastering-sequence-runtime.ts';
import {
	applyAssistanceAssetUpsertCommandV1,
	hasAssistanceAssetUpsertCommandTypeV1,
	snapshotAssistanceAssetUpsertCommandV1,
	type AssistanceAssetUpsertCommandV1,
} from '../common/editor/assistance/assistance-asset-command-v1.ts';
import { snapshotInertEditorCommand } from '../common/editor/commands/editor-command-snapshot.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { projectForCommandConsumers } from '../common/editor/project-current-runtime.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import {
	normalizeNativePluginEffect,
	type NativePluginRackEffect,
} from '../common/editor/native-plugin-effect.ts';
import {
	SOUNDSCAPER_NATIVE_PLUGIN_FEATURE_PREFIX,
	SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX,
} from './editor-native-plugin-playback.ts';
import {
	applySoundscaperProjectFoundationCommand,
	type SoundscaperProjectCommandOptions as SoundscaperProjectFoundationCommandOptions,
} from './editor-project-command-foundation.ts';
import { normalizeSoundscaperNativePluginStates } from './editor-native-plugin-state.ts';
import { reconcileSoundscaperProjectFeatureRequirements } from './editor-project-feature-requirements.ts';
import {
	validateSoundscaperProject,
	type SoundscaperProject,
} from './editor-project-validation.ts';

/**
 * Applying commands to an exact baseline document.
 *
 * **Mastering-sequence commands never reach the inherited command path.** That
 * path deliberately rebuilds `mixer` and `automationLanes` from the *previous*
 * project and reconciles feature requirements, discarding whatever a command
 * wrote to product-owned state. Product-owned state therefore gets an explicit
 * branch, exactly as automation lanes, the mixer graph and freeze already do —
 * falling through would not fail, it would silently drop the edit.
 *
 * **Every other command is lent to the baseline applier.** baseline adds one field that no
 * baseline command reads or writes, so borrowing gives baseline precisely baseline's semantics
 * for the hundred-odd inherited commands instead of a second copy of them that
 * can drift. The field is detached for the borrowed pass and reattached
 * afterwards; the manifest is reconciled down first so it agrees with the state
 * baseline is about to validate, and reconciled back up after.
 */

export type SoundscaperProjectCommandOptions = SoundscaperProjectFoundationCommandOptions;
type SoundscaperNativePluginStateMutationCommand =
	| Readonly<{ readonly type: 'native-plugin-state/upsert'; readonly state: unknown }>
	| Readonly<{ readonly type: 'native-plugin-state/remove'; readonly instanceId: string }>;
export type SoundscaperNativePluginBindingCommand = Readonly<{
	readonly type: 'native-plugin/bind';
	readonly operation: 'author' | 'restore';
	readonly trackId: string;
	readonly effect: unknown;
	readonly state: unknown;
}>;
export type SoundscaperNativePluginStateCommand =
	| SoundscaperNativePluginStateMutationCommand
	| SoundscaperNativePluginBindingCommand;
export type SoundscaperProjectCommand =
	| AudioEditorCommand
	| SoundscaperNativePluginStateCommand
	| AssistanceAssetUpsertCommandV1;

const MASTERING_HANDLERS = createMasteringSequenceRuntimeHandlers();

export function snapshotSoundscaperProjectCommand(
	command: SoundscaperProjectCommand,
): SoundscaperProjectCommand {
	if (hasAssistanceAssetUpsertCommandTypeV1(command)) {
		return snapshotAssistanceAssetUpsertCommandV1(command);
	}
	return snapshotNativePluginStateCommand(command)
		?? snapshotInertEditorCommand(command as AudioEditorCommand, 'Soundscaper command');
}

export function applySoundscaperProjectCommand(
	projectValue: SoundscaperProject | unknown,
	commandValue: SoundscaperProjectCommand,
	options: SoundscaperProjectCommandOptions = {},
): SoundscaperProject {
	validateSoundscaperProject(projectValue);
	const project = projectValue as SoundscaperProject;
	const command = snapshotSoundscaperProjectCommand(commandValue);
	if (hasAssistanceAssetUpsertCommandTypeV1(command)) {
		return applyAssistanceCommand(project, command, options);
	}
	if (command.type === 'native-plugin/bind') {
		return applyNativePluginBindingCommand(project, command, options);
	}
	if (commandTouchesNativePluginStates(command)) return applyNativePluginStateCommand(project, command, options);
	if (commandTouchesMasteringSequences(command)) {
		return applyMasteringSequenceCommand(project, command, options);
	}
	return applyInheritedCommand(project, command, options);
}

function commandTouchesNativePluginStates(
	command: AudioEditorCommand | SoundscaperNativePluginStateCommand,
): command is SoundscaperNativePluginStateMutationCommand {
	if (command.type.startsWith('native-plugin-state/')) return true;
	return false;
}

function applyNativePluginStateCommand(
	project: SoundscaperProject,
	command: SoundscaperNativePluginStateMutationCommand,
	options: SoundscaperProjectCommandOptions,
): SoundscaperProject {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyNativePluginStateTree(draft, command);
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	return finalize(draft, project, options);
}

function applyNativePluginStateTree(
	draft: Record<string, unknown>,
	command: SoundscaperNativePluginStateMutationCommand,
): void {
	const values = normalizeSoundscaperNativePluginStates(draft.nativePluginStates);
	if (command.type === 'native-plugin-state/upsert') {
		const state = normalizeSoundscaperNativePluginStates([
			(command as unknown as { readonly state: unknown }).state,
		])[0];
		draft.nativePluginStates = normalizeSoundscaperNativePluginStates([
			...values.filter((entry) => entry.instanceId !== state.instanceId), state,
		]);
		return;
	}
	if (command.type === 'native-plugin-state/remove') {
		const instanceId = (command as unknown as { readonly instanceId: unknown }).instanceId;
		if (typeof instanceId !== 'string' || !instanceId) throw new TypeError('A native plug-in instance ID is required.');
		draft.nativePluginStates = normalizeSoundscaperNativePluginStates(
			values.filter((entry) => entry.instanceId !== instanceId),
		);
		return;
	}
}

function snapshotNativePluginStateCommand(
	value: AudioEditorCommand | SoundscaperNativePluginStateCommand,
): SoundscaperNativePluginStateCommand | null {
	if (value?.type === 'native-plugin/bind') {
		const operation = value.operation;
		if (operation !== 'author' && operation !== 'restore') {
			throw new TypeError('A native plug-in binding operation must be author or restore.');
		}
		if (typeof value.trackId !== 'string' || !value.trackId) {
			throw new TypeError('A native plug-in binding track ID is required.');
		}
		return Object.freeze({
			type: value.type,
			operation,
			trackId: value.trackId,
			effect: normalizeNativePluginEffect(value.effect),
			state: nativePluginState(value.state),
		});
	}
	if (value?.type === 'native-plugin-state/upsert') {
		return Object.freeze({ type: value.type, state: structuredClone(value.state) });
	}
	if (value?.type === 'native-plugin-state/remove') {
		if (typeof value.instanceId !== 'string' || !value.instanceId) {
			throw new TypeError('A native plug-in instance ID is required.');
		}
		return Object.freeze({ type: value.type, instanceId: value.instanceId });
	}
	return null;
}

/**
 * Applies the two document mutations through one detached inherited result.
 * The inherited pass owns the sole revision increment; state is reconciled on
 * that result before publication, so an exception can never expose half a bind.
 */
function applyNativePluginBindingCommand(
	project: SoundscaperProject,
	command: SoundscaperNativePluginBindingCommand,
	options: SoundscaperProjectCommandOptions,
): SoundscaperProject {
	const effect = normalizeNativePluginEffect(command.effect);
	const state = nativePluginState(command.state);
	assertNativePluginBinding(effect, state);
	if (command.operation === 'restore') assertRestoredEffectIdentity(project, command.trackId, effect);
	const rackCommand = command.operation === 'author'
		? {
			type: 'effect/add', scope: 'track', trackId: command.trackId,
			effect,
		}
		: {
			type: 'effect/update', scope: 'track', trackId: command.trackId,
			effectId: effect.id,
			changes: {
				enabled: effect.enabled,
				bypassed: effect.bypassed,
				params: effect.params,
				context: effect.context,
			},
		};
	const applied = applySoundscaperProjectFoundationCommand(
		project,
		rackCommand as AudioEditorCommand,
		options,
	);
	const draft = structuredClone(applied) as unknown as Record<string, unknown>;
	applyNativePluginStateTree(draft, { type: 'native-plugin-state/upsert', state });
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	if (applied === project) return finalize(draft, project, options);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProject(draft);
	return draft as unknown as SoundscaperProject;
}

function nativePluginState(value: unknown) {
	const state = normalizeSoundscaperNativePluginStates([value])[0];
	if (!state) throw new TypeError('A native plug-in project state is required.');
	return state;
}

function assertNativePluginBinding(
	effect: NativePluginRackEffect,
	state: ReturnType<typeof nativePluginState>,
): void {
	if (effect.params.instanceId !== state.instanceId
		|| effect.context.format !== state.format
		|| effect.context.stablePluginId !== state.stablePluginId
		|| effect.context.binarySha256 !== state.binarySha256) {
		throw new TypeError('The native plug-in rack slot and project state must share one exact identity.');
	}
	if (effect.enabled !== state.enabled
		|| effect.bypassed !== state.bypassed
		|| effect.params.latencyFrames !== state.latencySamples) {
		throw new TypeError('The native plug-in rack slot and project state must share one exact runtime projection.');
	}
}

function assertRestoredEffectIdentity(
	project: SoundscaperProject,
	trackId: string,
	effect: NativePluginRackEffect,
): void {
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	if (!track || track.type !== 'audio') throw new ReferenceError(`Unknown audio track: ${trackId}.`);
	const currentValue = track.effects.find((candidate) => candidate.id === effect.id);
	if (!currentValue) throw new ReferenceError(`Unknown effect: ${effect.id}.`);
	const current = normalizeNativePluginEffect(currentValue);
	if (current.params.instanceId !== effect.params.instanceId
		|| current.context.format !== effect.context.format
		|| current.context.stablePluginId !== effect.context.stablePluginId
		|| current.context.binarySha256 !== effect.context.binarySha256) {
		throw new TypeError('A restored native plug-in rack binding changed identity.');
	}
}

/** The shared command projection consumers read, gated on exact baseline authority. */
export function soundscaperProjectForCommandConsumers(
	projectValue: SoundscaperProject | unknown,
): Record<string, unknown> {
	validateSoundscaperProject(projectValue);
	return projectForCommandConsumers(
		projectValue as SoundscaperProject & Record<string, unknown>,
	) as Record<string, unknown>;
}

function commandTouchesMasteringSequences(command: AudioEditorCommand): boolean {
	if (command.type.startsWith('mastering-sequence/')) return true;
	if (command.type !== 'batch') return false;
	const children = (command as unknown as { readonly commands?: readonly AudioEditorCommand[] }).commands;
	return Array.isArray(children) && children.some(commandTouchesMasteringSequences);
}

function applyMasteringSequenceCommand(
	project: SoundscaperProject,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptions,
): SoundscaperProject {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyMasteringSequenceTree(draft, command);
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	return finalize(draft, project, options);
}

function applyMasteringSequenceTree(draft: Record<string, unknown>, command: AudioEditorCommand): void {
	if (command.type === 'batch') {
		const children = (command as unknown as { readonly commands?: readonly AudioEditorCommand[] }).commands;
		for (const child of children ?? []) applyMasteringSequenceTree(draft, child);
		return;
	}
	if (!command.type.startsWith('mastering-sequence/')) {
		// A batch mixing product-owned and inherited commands would need both paths
		// in one transaction, and neither path can be run twice safely.
		throw new RangeError('A mastering-sequence batch cannot also contain inherited commands.');
	}
	const handler = MASTERING_HANDLERS[command.type as keyof typeof MASTERING_HANDLERS];
	if (typeof handler !== 'function') {
		throw new RangeError(`Unknown mastering-sequence command ${command.type}.`);
	}
	handler(draft as never, command as never);
}

function applyInheritedCommand(
	project: SoundscaperProject,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptions,
): SoundscaperProject {
	const applied = applySoundscaperProjectFoundationCommand(project, command, options);
	assertNoNewNativePluginRackBindings(project, applied);
	assertNoNewSidechainsIntoFrozenRacks(project, applied);
	const retainedInstanceIds = nativePluginRackInstanceIds(applied);
	const removedInstanceIds = new Set([...nativePluginRackInstanceIds(project)]
		.filter((instanceId) => !retainedInstanceIds.has(instanceId)));
	if (removedInstanceIds.size === 0) return applied;
	const retainedStates = applied.nativePluginStates.filter(({ instanceId }) => (
		!removedInstanceIds.has(instanceId)
	));
	if (retainedStates.length === applied.nativePluginStates.length) return applied;
	const draft = structuredClone(applied) as unknown as Record<string, unknown>;
	draft.nativePluginStates = normalizeSoundscaperNativePluginStates(retainedStates);
	stripNativePluginRequirements(draft);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProject(draft);
	return draft as unknown as SoundscaperProject;
}

function assertNoNewSidechainsIntoFrozenRacks(
	previous: SoundscaperProject,
	next: SoundscaperProject,
): void {
	const frozenTrackIds = new Set(next.tracks
		.filter((track) => track.type === 'audio' && track.audioFreeze !== undefined)
		.map(({ id }) => id));
	if (frozenTrackIds.size === 0) return;
	const previousEdges = new Map(previous.mixer.edges.map((edge) => [edge.id, JSON.stringify(edge)]));
	for (const edge of next.mixer.edges) {
		if (!edge.enabled || edge.destination.kind !== 'effect-sidechain'
			|| previousEdges.get(edge.id) === JSON.stringify(edge)) continue;
		const strip = edge.destination.strip;
		if (strip.kind === 'track' && frozenTrackIds.has(strip.id)) {
			throw new RangeError(`Cannot route a sidechain into frozen track ${strip.id}.`);
		}
	}
}

function assertNoNewNativePluginRackBindings(
	previous: SoundscaperProject,
	next: SoundscaperProject,
): void {
	const previousSlots = nativePluginRackSlots(previous);
	for (const slot of nativePluginRackSlots(next)) {
		if (!previousSlots.has(slot)) {
			throw new RangeError('A native plug-in rack slot requires the atomic native plug-in binding command.');
		}
	}
}

function nativePluginRackSlots(project: SoundscaperProject): ReadonlySet<string> {
	const slots = new Set<string>();
	const collect = (scope: string, ownerValue: unknown): void => {
		if (!ownerValue || typeof ownerValue !== 'object' || Array.isArray(ownerValue)) return;
		const owner = ownerValue as Readonly<Record<string, unknown>>;
		if (!Array.isArray(owner.effects)) return;
		for (const effectValue of owner.effects) {
			if (!effectValue || typeof effectValue !== 'object' || Array.isArray(effectValue)) continue;
			const effect = effectValue as Readonly<Record<string, unknown>>;
			if (effect.type !== 'native-plugin') continue;
			slots.add(JSON.stringify([scope, owner.id ?? null, effect.id]));
		}
	};
	for (const track of project.tracks) collect('track', track);
	collect('master', project.master);
	for (const [kind, owners] of [
		['group', project.mixer.groups],
		['send', project.mixer.sends],
		['cue', project.mixer.cues],
	] as const) for (const owner of owners) collect(kind, owner);
	return slots;
}

function nativePluginRackInstanceIds(project: SoundscaperProject): ReadonlySet<string> {
	const instanceIds = new Set<string>();
	const collect = (ownerValue: unknown): void => {
		if (!ownerValue || typeof ownerValue !== 'object' || Array.isArray(ownerValue)) return;
		const owner = ownerValue as Readonly<Record<string, unknown>>;
		if (!Array.isArray(owner.effects)) return;
		for (const effect of owner.effects) {
			if (!effect || typeof effect !== 'object' || Array.isArray(effect)
				|| (effect as Readonly<Record<string, unknown>>).type !== 'native-plugin') continue;
			instanceIds.add(normalizeNativePluginEffect(effect).params.instanceId);
		}
	};
	for (const track of project.tracks) collect(track);
	collect(project.master);
	for (const owners of [project.mixer.groups, project.mixer.sends, project.mixer.cues]) {
		for (const owner of owners) collect(owner);
	}
	return instanceIds;
}

function applyAssistanceCommand(
	project: SoundscaperProject,
	command: AssistanceAssetUpsertCommandV1,
	options: SoundscaperProjectCommandOptions,
): SoundscaperProject {
	const assistanceAssets = applyAssistanceAssetUpsertCommandV1(project.assistanceAssets, command);
	if (command.commands.length > 0) {
		const childCommand: AudioEditorCommand = command.commands.length === 1
			? command.commands[0]!
			: { type: 'batch', commands: command.commands };
		const applied = applyInheritedCommand(project, childCommand, options);
		if (applied !== project) {
			const draft = structuredClone(applied) as unknown as Record<string, unknown>;
			draft.assistanceAssets = assistanceAssets;
			draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
				draft,
				draft.featureRequirements as never,
			);
			draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirements(
				draft,
				draft.featureRequirements as never,
			);
			validateSoundscaperProject(draft);
			return draft as unknown as SoundscaperProject;
		}
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	draft.assistanceAssets = assistanceAssets;
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	return finalize(draft, project, options);
}

function finalize(
	draft: Record<string, unknown>,
	project: SoundscaperProject,
	options: SoundscaperProjectCommandOptions,
): SoundscaperProject {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) {
		throw new RangeError('Soundscaper project revision overflowed.');
	}
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	stripNativePluginRequirements(draft);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProject(draft);
	return draft as unknown as SoundscaperProject;
}

function stripNativePluginRequirements(draft: Record<string, unknown>): void {
	const manifest = draft.featureRequirements as SoundscaperProject['featureRequirements'];
	draft.featureRequirements = {
		...manifest,
		requirements: manifest.requirements.filter(({ id, featureId }) => (
			!id.startsWith(SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX)
			&& !featureId.startsWith(SOUNDSCAPER_NATIVE_PLUGIN_FEATURE_PREFIX)
		)),
	};
}

function timestamp(now: Date | string | undefined): string {
	if (typeof now === 'string') return new Date(now).toISOString();
	return (now ?? new Date()).toISOString();
}
