/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMasteringSequenceRuntimeHandlers } from '../common/editor/commands/mastering-sequence-runtime.ts';
import { snapshotInertEditorCommand } from '../common/editor/commands/editor-command-snapshot.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import {
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
} from '../common/editor/project-schema-version.ts';
import { projectForCommandConsumers } from '../common/editor/project-current-runtime.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import {
	normalizeNativePluginEffect,
	type NativePluginRackEffect,
} from '../common/editor/native-plugin-effect.ts';
import {
	applySoundscaperProjectCommandV23,
	type SoundscaperProjectCommandOptionsV23,
} from './editor-project-v23-commands.ts';
import { normalizeSoundscaperNativePluginStatesV29 } from './editor-native-plugin-state-v29.ts';
import { reconcileSoundscaperProjectFeatureRequirementsV29 } from './editor-project-feature-requirements-v29.ts';
import {
	validateSoundscaperProjectV29,
	type SoundscaperProjectV29,
} from './editor-project-v29-validation.ts';

/**
 * Applying commands to an exact V29 document.
 *
 * **Mastering-sequence commands never reach the inherited command path.** That
 * path deliberately rebuilds `mixer` and `automationLanes` from the *previous*
 * project and reconciles feature requirements, discarding whatever a command
 * wrote to product-owned state. Product-owned state therefore gets an explicit
 * branch, exactly as automation lanes, the mixer graph and freeze already do —
 * falling through would not fail, it would silently drop the edit.
 *
 * **Every other command is lent to the V21 applier.** V29 adds one field that no
 * V21 command reads or writes, so borrowing gives V29 precisely V21's semantics
 * for the hundred-odd inherited commands instead of a second copy of them that
 * can drift. The field is detached for the borrowed pass and reattached
 * afterwards; the manifest is reconciled down first so it agrees with the state
 * V21 is about to validate, and reconciled back up after.
 */

export type SoundscaperProjectCommandOptionsV29 = SoundscaperProjectCommandOptionsV23;
type SoundscaperNativePluginStateMutationCommandV29 =
	| Readonly<{ readonly type: 'native-plugin-state/upsert'; readonly state: unknown }>
	| Readonly<{ readonly type: 'native-plugin-state/remove'; readonly instanceId: string }>;
export type SoundscaperNativePluginBindingCommandV29 = Readonly<{
	readonly type: 'native-plugin/bind';
	readonly operation: 'author' | 'restore';
	readonly trackId: string;
	readonly effect: unknown;
	readonly state: unknown;
}>;
export type SoundscaperNativePluginStateCommandV29 =
	| SoundscaperNativePluginStateMutationCommandV29
	| SoundscaperNativePluginBindingCommandV29;

const MASTERING_HANDLERS = createMasteringSequenceRuntimeHandlers();

export function snapshotSoundscaperProjectCommandV29(
	command: AudioEditorCommand | SoundscaperNativePluginStateCommandV29,
): AudioEditorCommand | SoundscaperNativePluginStateCommandV29 {
	return snapshotNativePluginStateCommand(command)
		?? snapshotInertEditorCommand(command as AudioEditorCommand, 'Soundscaper V29 command');
}

export function applySoundscaperProjectCommandV29(
	projectValue: SoundscaperProjectV29 | unknown,
	commandValue: AudioEditorCommand | SoundscaperNativePluginStateCommandV29,
	options: SoundscaperProjectCommandOptionsV29 = {},
): SoundscaperProjectV29 {
	validateSoundscaperProjectV29(projectValue);
	const project = projectValue as SoundscaperProjectV29;
	const command = snapshotSoundscaperProjectCommandV29(commandValue);
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
	command: AudioEditorCommand | SoundscaperNativePluginStateCommandV29,
): command is SoundscaperNativePluginStateMutationCommandV29 {
	if (command.type.startsWith('native-plugin-state/')) return true;
	return false;
}

function applyNativePluginStateCommand(
	project: SoundscaperProjectV29,
	command: SoundscaperNativePluginStateMutationCommandV29,
	options: SoundscaperProjectCommandOptionsV29,
): SoundscaperProjectV29 {
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	applyNativePluginStateTree(draft, command);
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	return finalize(draft, project, options);
}

function applyNativePluginStateTree(
	draft: Record<string, unknown>,
	command: SoundscaperNativePluginStateMutationCommandV29,
): void {
	const values = normalizeSoundscaperNativePluginStatesV29(draft.nativePluginStates);
	if (command.type === 'native-plugin-state/upsert') {
		const state = normalizeSoundscaperNativePluginStatesV29([
			(command as unknown as { readonly state: unknown }).state,
		])[0];
		draft.nativePluginStates = normalizeSoundscaperNativePluginStatesV29([
			...values.filter((entry) => entry.instanceId !== state.instanceId), state,
		]);
		return;
	}
	if (command.type === 'native-plugin-state/remove') {
		const instanceId = (command as unknown as { readonly instanceId: unknown }).instanceId;
		if (typeof instanceId !== 'string' || !instanceId) throw new TypeError('A native plug-in instance ID is required.');
		draft.nativePluginStates = normalizeSoundscaperNativePluginStatesV29(
			values.filter((entry) => entry.instanceId !== instanceId),
		);
		return;
	}
}

function snapshotNativePluginStateCommand(
	value: AudioEditorCommand | SoundscaperNativePluginStateCommandV29,
): SoundscaperNativePluginStateCommandV29 | null {
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
	project: SoundscaperProjectV29,
	command: SoundscaperNativePluginBindingCommandV29,
	options: SoundscaperProjectCommandOptionsV29,
): SoundscaperProjectV29 {
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
	const applied = applyInheritedCommand(project, rackCommand as AudioEditorCommand, options);
	const draft = structuredClone(applied) as unknown as Record<string, unknown>;
	applyNativePluginStateTree(draft, { type: 'native-plugin-state/upsert', state });
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	if (applied === project) return finalize(draft, project, options);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV29(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProjectV29(draft);
	return draft as unknown as SoundscaperProjectV29;
}

function nativePluginState(value: unknown) {
	const state = normalizeSoundscaperNativePluginStatesV29([value])[0];
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
	project: SoundscaperProjectV29,
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

/** The shared command projection consumers read, gated on exact V29 authority. */
export function soundscaperProjectForCommandConsumersV29(
	projectValue: SoundscaperProjectV29 | unknown,
): Record<string, unknown> {
	validateSoundscaperProjectV29(projectValue);
	return projectForCommandConsumers(
		projectValue as SoundscaperProjectV29 & Record<string, unknown>,
	) as Record<string, unknown>;
}

function commandTouchesMasteringSequences(command: AudioEditorCommand): boolean {
	if (command.type.startsWith('mastering-sequence/')) return true;
	if (command.type !== 'batch') return false;
	const children = (command as unknown as { readonly commands?: readonly AudioEditorCommand[] }).commands;
	return Array.isArray(children) && children.some(commandTouchesMasteringSequences);
}

function applyMasteringSequenceCommand(
	project: SoundscaperProjectV29,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV29,
): SoundscaperProjectV29 {
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
	project: SoundscaperProjectV29,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV29,
): SoundscaperProjectV29 {
	const borrowed = structuredClone(project) as unknown as Record<string, unknown>;
	const pluginStates = borrowed.nativePluginStates;
	delete borrowed.nativePluginStates;
	borrowed.schemaVersion = SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION;
	borrowed.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		borrowed,
		borrowed.featureRequirements as never,
	);
	const applied = applySoundscaperProjectCommandV23(
		borrowed, command, options,
	) as unknown as Record<string, unknown>;
	const draft = structuredClone(applied) as Record<string, unknown>;
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION;
	draft.nativePluginStates = normalizeSoundscaperNativePluginStatesV29(pluginStates);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV29(
		draft,
		draft.featureRequirements as never,
	);
	// The borrowed pass already refused a no-op by returning its input unchanged,
	// so an unchanged result here means the command changed nothing at all.
	if (JSON.stringify(draft) === JSON.stringify(project)) return project;
	validateSoundscaperProjectV29(draft);
	return draft as unknown as SoundscaperProjectV29;
}

function finalize(
	draft: Record<string, unknown>,
	project: SoundscaperProjectV29,
	options: SoundscaperProjectCommandOptionsV29,
): SoundscaperProjectV29 {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) {
		throw new RangeError('Soundscaper V29 project revision overflowed.');
	}
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV29(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProjectV29(draft);
	return draft as unknown as SoundscaperProjectV29;
}

function timestamp(now: Date | string | undefined): string {
	if (typeof now === 'string') return new Date(now).toISOString();
	return (now ?? new Date()).toISOString();
}
