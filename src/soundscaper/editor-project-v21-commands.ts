/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import { normalizeAutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import {
	createAudioProductionRuntimeHandlers,
} from '../common/editor/commands/audio-production.ts';
import { snapshotInertEditorCommand } from '../common/editor/commands/editor-command-snapshot.ts';
import {
	createEditorCommandMutationTransaction,
	type EditorCommandMutationTransaction,
} from '../common/editor/commands/mutation-transaction.ts';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { reconcileFolderMixerGraphV21 } from '../common/editor/folder-mixer-graph-v21.ts';
import type {
	MixerEdgeV21,
	MixerGraphV21,
	MixerStripV21,
} from '../common/editor/mixer-graph-v21.ts';
import { defaultMixerChannelMapV21, normalizeMixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import { cloneProject } from '../common/editor/project.js';
import {
	preparePersistedProjectCommandDraft,
	projectForCommandConsumers,
} from '../common/editor/project-current-runtime.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import { resolveTerminalChannelWidths } from '../common/editor/terminal-channel-widths.ts';
import {
	cloneSoundscaperProjectV21,
	type SoundscaperProjectV21,
} from './editor-project-v21.ts';
import { preserveAutomationLanesAfterInheritedCommandV21 } from './editor-automation-edit-preservation-v21.ts';
import { applySoundscaperMixerSurfaceCommandV21 } from './editor-project-v21-mixer-surface.ts';
import { reconcileSoundscaperProjectFeatureRequirementsV21 } from './editor-project-feature-requirements-v21.ts';
import { validateSoundscaperProjectV21 } from './editor-project-v21-validation.ts';

export interface SoundscaperProjectCommandOptionsV21 {
	readonly now?: Date | string;
}

const PRODUCTION_HANDLERS = createAudioProductionRuntimeHandlers();

/** Snapshot the exhaustive shared protocol before it enters V21 history. */
export function snapshotSoundscaperProjectCommandV21(command: AudioEditorCommand): AudioEditorCommand {
	return snapshotInertEditorCommand(
		command,
		'Soundscaper V21 command',
	) as AudioEditorCommand;
}

/**
 * Apply one exact V21 transaction. Shared editorial commands use the common
 * resolved-coordinate projection without changing schema or dropping product
 * authority; the complete V21 document is reconciled before publication.
 */
export function applySoundscaperProjectCommandV21(
	projectValue: SoundscaperProjectV21 | unknown,
	commandValue: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV21 = {},
): SoundscaperProjectV21 {
	validateSoundscaperProjectV21(projectValue);
	const project = projectValue as SoundscaperProjectV21;
	const command = snapshotSoundscaperProjectCommandV21(commandValue);
	const working = cloneSoundscaperProjectV21(project);
	const transaction = createEditorCommandMutationTransaction(
		project,
		projectForCommandConsumers(working as unknown as Record<string, unknown>),
	);
	const applied = applyCommandTree(working, command, options, transaction, true);
	if (JSON.stringify(applied) === JSON.stringify(project)) return project;
	const draft = structuredClone(applied) as Record<string, unknown>;
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) {
		throw new RangeError('Soundscaper V21 project revision overflowed.');
	}
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
	stripAudioFreezeRequirements(draft);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV21(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProjectV21(draft);
	transaction.assertPersistedResult(draft);
	return draft as SoundscaperProjectV21;
}

function applyCommandTree(
	project: SoundscaperProjectV21,
	command: AudioEditorCommand,
	options: SoundscaperProjectCommandOptionsV21,
	transaction: Readonly<EditorCommandMutationTransaction>,
	validateResult: boolean,
): SoundscaperProjectV21 {
	if (command.type === 'batch') {
		let result = project;
		for (const child of command.commands) {
			result = applyCommandTree(result, child, options, transaction, false);
		}
		return finalizeIntermediate(
			result as unknown as Record<string, unknown>,
			validateResult,
		);
	}
	if (command.type === 'automation-lane/set' || command.type === 'mixer-graph/set'
		|| command.type === 'audio-freeze/install' || command.type === 'audio-freeze/remove'
		|| command.type === 'audio-freeze/commit') {
		const draft = structuredClone(project) as unknown as Record<string, unknown>;
		if (command.type === 'automation-lane/set') {
			PRODUCTION_HANDLERS['automation-lane/set'](draft, command);
		} else if (command.type === 'mixer-graph/set') {
			PRODUCTION_HANDLERS['mixer-graph/set'](draft, command);
			draft.automationLanes = reconcileLanesAfterInheritedCommand(project.automationLanes, draft);
		} else if (command.type === 'audio-freeze/install') {
			PRODUCTION_HANDLERS['audio-freeze/install'](draft, command);
		} else if (command.type === 'audio-freeze/remove') {
			PRODUCTION_HANDLERS['audio-freeze/remove'](draft, command);
		} else {
			PRODUCTION_HANDLERS['audio-freeze/commit'](draft, command);
		}
		return finalizeIntermediate(draft, validateResult);
	}
	if (command.type.startsWith('mixer/')) {
		const draft = structuredClone(project) as unknown as Record<string, unknown>;
		draft.mixer = applySoundscaperMixerSurfaceCommandV21(project, command as Extract<AudioEditorCommand, {
			readonly type: 'mixer/bus-add' | 'mixer/bus-update' | 'mixer/bus-remove' | 'mixer/route-update';
		}>);
		draft.automationLanes = reconcileLanesAfterInheritedCommand(project.automationLanes, draft);
		return finalizeIntermediate(draft, validateResult);
	}
	assertNoLegacyEnvelopeCommand(command);
	const projection = projectForCommandConsumers(
		project as unknown as Record<string, unknown>,
	) as Record<string, unknown>;
	const commanded = cloneProject(projection as never) as unknown as Record<string, unknown>;
	transaction.mutate(commanded, command);
	stripLegacyMixerCommandTransients(commanded);
	preparePersistedProjectCommandDraft(commanded, project as unknown as Record<string, unknown>);
	const elevated = elevateInheritedCommandResult(project, commanded, command, validateResult);
	const result = command.type === 'track/add' && command.productionDuplicate
		? duplicateTrackAutomation(project, elevated, command, validateResult)
		: elevated;
	return result;
}

function stripLegacyMixerCommandTransients(project: Record<string, unknown>): void {
	delete dataRecord(project.mixer, 'project.mixer').routes;
}

/** Exact V21 authority with only inherited resolved-coordinate transients. */
export function soundscaperProjectForCommandConsumersV21(
	projectValue: SoundscaperProjectV21 | unknown,
): Record<string, unknown> {
	validateSoundscaperProjectV21(projectValue);
	return projectForCommandConsumers(
		projectValue as SoundscaperProjectV21 & Record<string, unknown>,
	) as Record<string, unknown>;
}

function assertNoLegacyEnvelopeCommand(command: AudioEditorCommand): void {
	if ((command.type === 'track/update' || command.type === 'master/update')
		&& Object.hasOwn(command.changes, 'envelope')) {
		throw new RangeError('Legacy strip envelopes are unavailable under V21 automation-lane authority.');
	}
}

function elevateInheritedCommandResult(
	previous: SoundscaperProjectV21,
	commanded: Record<string, unknown>,
	command: AudioEditorCommand,
	validateResult: boolean,
): SoundscaperProjectV21 {
	commanded.schemaVersion = 21;
	const previousTrackById = new Map(recordArray(previous.tracks, 'previous project.tracks')
		.map((track) => [String(track.id), track]));
	const tracks = recordArray(commanded.tracks, 'project.tracks').map((track) => {
		const result = { ...track };
		if (result.type === 'audio') {
			delete result.envelope;
			const prior = previousTrackById.get(String(result.id));
			if (prior && Object.hasOwn(prior, 'audioFreeze')) {
				result.audioFreeze = structuredClone(prior.audioFreeze);
			}
		}
		return result;
	});
	commanded.tracks = tracks;
	const master = { ...dataRecord(commanded.master, 'project.master') };
	delete master.envelope;
	commanded.master = master;
	const commandMixer = dataRecord(commanded.mixer, 'project.mixer');
	commanded.mixer = reconcileGraphAfterInheritedCommand(previous, commandMixer, commanded);
	commanded.automationLanes = preserveAutomationLanesAfterInheritedCommandV21(
		previous,
		commanded,
		command,
		reconcileLanesAfterInheritedCommand(previous.automationLanes, commanded),
	);
	commanded.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		commanded,
		commanded.featureRequirements as never,
	);
	return finalizeIntermediate(commanded, validateResult);
}

function reconcileGraphAfterInheritedCommand(
	previousProject: SoundscaperProjectV21,
	commandMixer: Record<string, unknown>,
	project: Record<string, unknown>,
): MixerGraphV21 {
	const previous = previousProject.mixer;
	const commandedStripById = new Map(
		[...recordArray(commandMixer.groups, 'command mixer.groups'),
			...recordArray(commandMixer.sends, 'command mixer.sends')]
			.map((strip) => [String(strip.id), strip]),
	);
	const updateStrip = (strip: MixerStripV21): MixerStripV21 => {
		const commanded = commandedStripById.get(strip.id);
		if (!commanded) return strip;
		return {
			...strip,
			name: String(commanded.name), color: String(commanded.color), gain: Number(commanded.gain),
			pan: Number(commanded.pan), mute: Boolean(commanded.mute), solo: Boolean(commanded.solo),
			collapsed: Boolean(commanded.collapsed), effectsActive: Boolean(commanded.effectsActive),
			effects: structuredClone(recordArray(commanded.effects, `command mixer strip ${strip.id}.effects`)),
		};
	};
	const audioTracks = recordArray(project.tracks, 'project.tracks')
		.filter((track) => track.type === 'audio');
	const audioTrackIds = new Set(audioTracks.map((track) => String(track.id)));
	const masterChannels = Number(project.masterChannels);
	const outputs = previous.outputs.map((output) => output.role === 'main'
		? { ...output, channelCount: masterChannels }
		: output);
	const outputWidths = new Map(outputs.map((output) => [output.id, output.channelCount]));
	const previousOutputWidths = new Map(previous.outputs.map((output) => [output.id, output.channelCount]));
	const trackWidths = resolveTerminalChannelWidths(project as never, masterChannels).tracks;
	const previousMasterChannels = Number(previousProject.masterChannels);
	const previousTrackWidths = resolveTerminalChannelWidths(
		previousProject as never,
		previousMasterChannels,
	).tracks;
	const effectsByTrack = new Map(audioTracks.map((track) => [
		String(track.id), new Set(recordArray(track.effects, `track ${String(track.id)}.effects`).map((effect) => String(effect.id))),
	]));
	const masterEffects = new Set(recordArray(
		dataRecord(project.master, 'project.master').effects,
		'project.master.effects',
	).map((effect) => String(effect.id)));
	const groups = previous.groups.map(updateStrip);
	const sends = previous.sends.map(updateStrip);
	const cues = previous.cues.map(updateStrip);
	const nodeEffects = new Map([...groups, ...sends, ...cues].map((strip) => [
		strip.id, new Set(strip.effects.map((effect) => String(effect.id))),
	]));
	const nodeWidths = new Map([...groups, ...sends, ...cues].map((strip) => [
		strip.id, strip.channelCount,
	]));
	const previousNodeWidths = new Map([
		...previous.groups, ...previous.sends, ...previous.cues,
	].map((strip) => [strip.id, strip.channelCount]));
	const edgeIsLive = (edge: MixerEdgeV21): boolean => {
		if (edge.source.kind === 'track' && !audioTrackIds.has(edge.source.id)) return false;
		if (edge.destination.kind !== 'effect-sidechain') return true;
		const { strip, effectId } = edge.destination;
		if (strip.kind === 'track') return effectsByTrack.get(strip.id)?.has(effectId) ?? false;
		if (strip.kind === 'mixer-node') return nodeEffects.get(strip.id)?.has(effectId) ?? false;
		return masterEffects.has(effectId);
	};
	const edges = previous.edges.filter(edgeIsLive).map((edge) => {
		const clone = structuredClone(edge);
		let sourceChannels: number;
		let destinationChannels: number;
		let previousSourceChannels: number;
		let previousDestinationChannels: number;
		if (clone.source.kind === 'track' && canonicalTrackAssignment(clone)) {
			sourceChannels = trackWidths.get(clone.source.id) ?? masterChannels;
			destinationChannels = clone.destination.kind === 'mixer-node'
				? nodeWidths.get(clone.destination.id) ?? masterChannels
				: masterChannels;
			previousSourceChannels = previousTrackWidths.get(clone.source.id)
				?? previousMasterChannels;
			previousDestinationChannels = clone.destination.kind === 'mixer-node'
				? previousNodeWidths.get(clone.destination.id) ?? previousMasterChannels
				: previousMasterChannels;
		} else if (canonicalMasterOutputAssignment(clone)) {
			sourceChannels = masterChannels;
			destinationChannels = outputWidths.get(clone.destination.id) ?? masterChannels;
			previousSourceChannels = previousMasterChannels;
			previousDestinationChannels = previousOutputWidths.get(clone.destination.id)
				?? previousMasterChannels;
		} else return clone;
		if (sourceChannels === previousSourceChannels
			&& destinationChannels === previousDestinationChannels) return clone;
		return {
			...clone,
			channelMap: defaultMixerChannelMapV21(sourceChannels, destinationChannels),
		};
	});
	for (const trackId of audioTrackIds) {
		if (edges.some((edge) => edge.source.kind === 'track' && edge.source.id === trackId && edge.enabled
			&& edge.kind !== 'sidechain')) continue;
		edges.push(defaultTrackAssignment(
			trackId,
			trackWidths.get(trackId) ?? masterChannels,
			masterChannels,
		));
	}
	const vcas = previous.vcas.map((vca) => ({
		...vca,
		members: vca.members.filter((member) => member.kind !== 'track' || audioTrackIds.has(member.id)),
	}));
	return reconcileFolderMixerGraphV21(project as never, normalizeMixerGraphV21({
		...previous, groups, sends, cues, vcas, outputs, edges,
	}));
}

function canonicalTrackAssignment(edge: MixerEdgeV21): boolean {
	if (edge.kind !== 'assignment' || edge.source.kind !== 'track'
		|| edge.destination.kind === 'effect-sidechain' || edge.destination.kind === 'output') return false;
	const destination = edge.destination.kind === 'master'
		? 'master'
		: `mixer-node:${edge.destination.id}`;
	return edge.id === `assignment:track:${edge.source.id}:${destination}`;
}

function canonicalMasterOutputAssignment(edge: MixerEdgeV21): edge is MixerEdgeV21 & {
	readonly source: { readonly kind: 'master' };
	readonly destination: { readonly kind: 'output'; readonly id: string };
} {
	return edge.kind === 'assignment' && edge.source.kind === 'master'
		&& edge.destination.kind === 'output'
		&& edge.id === `assignment:master:output:${edge.destination.id}`;
}

function defaultTrackAssignment(
	trackId: string,
	sourceChannelCount: number,
	destinationChannelCount: number,
): MixerEdgeV21 {
	return {
		id: `assignment:track:${trackId}:master`, kind: 'assignment',
		source: { kind: 'track', id: trackId }, destination: { kind: 'master' },
		position: 'post-fader', level: 1, enabled: true,
		channelMap: defaultMixerChannelMapV21(sourceChannelCount, destinationChannelCount),
	};
}

function reconcileLanesAfterInheritedCommand(
	lanes: readonly AutomationLaneV21[],
	project: Record<string, unknown>,
): readonly AutomationLaneV21[] {
	const graph = normalizeMixerGraphV21(project.mixer);
	const edgeIds = new Set(graph.edges.map(({ id }) => id));
	const tracks = new Map(recordArray(project.tracks, 'project.tracks').map((track) => [String(track.id), track]));
	const nodes = new Map([...graph.groups, ...graph.sends, ...graph.cues].map((node) => [node.id, node]));
	const master = dataRecord(project.master, 'project.master');
	return lanes.filter((lane) => {
		if (lane.address.kind === 'edge') return edgeIds.has(lane.address.edgeId);
		const strip = lane.address.strip;
		const owner = strip.kind === 'master' ? master
			: strip.kind === 'track' ? tracks.get(strip.id) : nodes.get(strip.id);
		if (!owner) return false;
		if (lane.address.kind !== 'effect') return true;
		const effectId = lane.address.effectId;
		return recordArray(owner.effects, `automation owner ${lane.id}.effects`)
			.some((effect) => effect.id === effectId);
	});
}

function duplicateTrackAutomation(
	previous: SoundscaperProjectV21,
	project: SoundscaperProjectV21,
	command: Extract<AudioEditorCommand, { readonly type: 'track/add' }>,
	validateResult: boolean,
): SoundscaperProjectV21 {
	const duplicate = productionDuplicate(command.productionDuplicate);
	const targetTrackId = stableCommandId(dataRecord(command.track, 'duplicated track').id, 'duplicated track ID');
	if (targetTrackId === duplicate.sourceTrackId
		|| !previous.tracks.some(({ id }) => id === duplicate.sourceTrackId)
		|| previous.tracks.some(({ id }) => id === targetTrackId)) {
		throw new RangeError('Track duplication identities do not describe one new track.');
	}
	const effectIdBySource = new Map(duplicate.effectIds.map(({ sourceId, targetId }) => [sourceId, targetId]));
	const copies = previous.automationLanes.flatMap((lane): readonly AutomationLaneV21[] => {
		const address = lane.address;
		if ((address.kind !== 'strip' && address.kind !== 'effect')
			|| address.strip.kind !== 'track'
			|| address.strip.id !== duplicate.sourceTrackId) return [];
		if (address.kind === 'effect' && !effectIdBySource.has(address.effectId)) return [];
		const mappedAddress = address.kind === 'strip'
			? { ...address, strip: { kind: 'track' as const, id: targetTrackId } }
			: {
				...address,
				strip: { kind: 'track' as const, id: targetTrackId },
				effectId: effectIdBySource.get(address.effectId)!,
			};
		return [normalizeAutomationLaneV21({
			...structuredClone(lane),
			id: duplicateIdentity('lane', lane.id, targetTrackId),
			address: mappedAddress,
			points: lane.points.map((point) => ({
				...structuredClone(point),
				id: duplicateIdentity('point', `${lane.id}\u0000${point.id}`, targetTrackId),
			})),
		})];
	});
	if (copies.length === 0) return project;
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	draft.automationLanes = [...project.automationLanes, ...copies];
	return finalizeIntermediate(draft, validateResult);
}

function productionDuplicate(value: unknown): Readonly<{
	readonly sourceTrackId: string;
	readonly effectIds: readonly Readonly<{ readonly sourceId: string; readonly targetId: string }>[];
}> {
	const record = dataRecord(value, 'production track duplication');
	if (Reflect.ownKeys(record).some((key) => key !== 'sourceTrackId' && key !== 'effectIds')) {
		throw new TypeError('Production track duplication contains an unsupported field.');
	}
	const sourceTrackId = stableCommandId(record.sourceTrackId, 'production duplicate source track');
	if (!Array.isArray(record.effectIds)) throw new TypeError('Production duplicate effectIds must be an array.');
	const sourceIds = new Set<string>();
	const targetIds = new Set<string>();
	const effectIds = record.effectIds.map((value, index) => {
		const entry = dataRecord(value, `production duplicate effectIds[${String(index)}]`);
		if (Reflect.ownKeys(entry).some((key) => key !== 'sourceId' && key !== 'targetId')) {
			throw new TypeError('Production duplicate effect mapping contains an unsupported field.');
		}
		const sourceId = stableCommandId(entry.sourceId, 'production duplicate source effect');
		const targetId = stableCommandId(entry.targetId, 'production duplicate target effect');
		if (sourceIds.has(sourceId) || targetIds.has(targetId)) {
			throw new RangeError('Production duplicate effect mappings must be one-to-one.');
		}
		sourceIds.add(sourceId);
		targetIds.add(targetId);
		return Object.freeze({ sourceId, targetId });
	});
	return Object.freeze({ sourceTrackId, effectIds: Object.freeze(effectIds) });
}

const DUPLICATE_ID_ENCODER = new TextEncoder();

function duplicateIdentity(kind: 'lane' | 'point', sourceId: string, targetTrackId: string): string {
	return `${kind}-${bytesToHex(sha256(DUPLICATE_ID_ENCODER.encode(
		`soundscaper-v21-track-duplicate\u0000${sourceId}\u0000${targetTrackId}`,
	)))}`;
}

function finalizeIntermediate(
	value: Record<string, unknown>,
	validateResult = true,
): SoundscaperProjectV21 {
	stripAudioFreezeRequirements(value);
	value.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		value,
		value.featureRequirements as never,
	);
	value.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV21(
		value,
		value.featureRequirements as never,
	);
	if (validateResult) validateSoundscaperProjectV21(value);
	return value as SoundscaperProjectV21;
}

function stripAudioFreezeRequirements(project: Record<string, unknown>): void {
	const manifest = dataRecord(project.featureRequirements, 'project.featureRequirements');
	project.featureRequirements = {
		...manifest,
		requirements: recordArray(
			manifest.requirements,
			'project.featureRequirements.requirements',
		).filter(({ featureId }) => featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze),
	};
}

function timestamp(value: Date | string | undefined): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid V21 command timestamp is required.');
	return date.toISOString();
}

function recordArray(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function stableCommandId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be nonempty.`);
	return value;
}
