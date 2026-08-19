/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import {
	createDefaultMixerGraphV21,
	normalizeMixerGraphV21,
	type MixerGraphV21,
} from '../mixer-graph-v21.ts';
import { isSoundscaperProductionProjectSchema } from '../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../terminal-channel-widths.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';
import type { AudioBufferLike } from './source-audio.ts';
import {
	findControllerClip,
	findControllerClipTrack,
	findControllerSource,
	findControllerTrack,
	type ControllerEffect,
	type ControllerProject,
	type ControllerSource,
	type ControllerTrack,
	type MutableControllerProject,
} from './track-domain-types.ts';

export interface MixRenderPlan {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly tailFrames: number;
	readonly preRollFrames: number;
	readonly outputFrames: number;
	readonly outputBytes: number;
	readonly streamToStorage: boolean;
}

export interface MixRenderCommit {
	readonly type: 'mix-render';
	readonly command: Extract<AudioEditorCommand, { readonly type: 'batch' }>;
	readonly trackId: string;
	readonly clipId: string;
}

export function selectAudioTracksForMix(
	project: ControllerProject,
	selectedTrackId: string | null,
	selectedClipId: string | null,
): ControllerTrack[] {
	const selectionIds = new Set((project.selection?.trackIds || []).filter((trackId) => (
		findControllerTrack(project, trackId)?.type === 'audio'
	)));
	if (!selectionIds.size) {
		const focusedTrack = findControllerTrack(project, selectedTrackId);
		if (focusedTrack?.type === 'audio') selectionIds.add(focusedTrack.id);
	}
	if (!selectionIds.size && selectedClipId) {
		const clipTrack = findControllerClipTrack(project, selectedClipId);
		if (clipTrack?.type === 'audio') selectionIds.add(clipTrack.id);
	}
	return project.tracks.filter((track) => track.type === 'audio' && selectionIds.has(track.id));
}

export function createMixRenderPlan(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	tailFrames: number,
	memoryLimitBytes: number,
): MixRenderPlan | null {
	const clips = targetTracks.flatMap((track) => track.clipIds
		.map((clipId) => findControllerClip(project, clipId))
		.filter((clip): clip is NonNullable<typeof clip> => Boolean(clip)));
	if (!targetTracks.length || !clips.length) return null;
	const startFrame = Math.min(...clips.map((clip) => clip.timelineStartFrame));
	const endFrame = Math.max(...clips.map((clip) => clip.timelineStartFrame + clip.durationFrames));
	const preRollFrames = Math.min(startFrame, project.sampleRate * 10);
	const outputFrames = endFrame - startFrame + tailFrames;
	const outputBytes = outputFrames * 2 * Float32Array.BYTES_PER_ELEMENT;
	const processingBytes = (outputFrames + preRollFrames) * 2 * Float32Array.BYTES_PER_ELEMENT * 3;
	return Object.freeze({
		startFrame,
		endFrame,
		tailFrames,
		preRollFrames,
		outputFrames,
		outputBytes,
		streamToStorage: processingBytes > memoryLimitBytes,
	});
}

export function createMixRenderSnapshot(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
): MutableControllerProject {
	if (isSoundscaperProductionProjectSchema(project.schemaVersion)) {
		return createMixRenderSnapshotV21(project, targetTracks);
	}
	const mediaProject = projectTrackFolderMediaStateV12(project);
	const snapshot = inheritTrackFolderMediaStateProjectionV12(
		mediaProject,
		cloneProject(mediaProject),
	);
	const targetIds = new Set(targetTracks.map((track) => track.id));
	const multipleTracks = targetTracks.length > 1;
	const relevantBusIds = multipleTracks ? mixRenderBusIds(snapshot, targetIds) : new Set<string>();
	const relevantBuses = [...snapshot.mixer.groups, ...snapshot.mixer.sends]
		.filter((bus) => relevantBusIds.has(bus.id));
	const controlTrackIds = new Set(targetTracks
		.flatMap((track) => track.effectsActive === false ? [] : track.effects || [])
		.concat(relevantBuses.flatMap((bus) => bus.effectsActive === false ? [] : bus.effects || []))
		.filter(isActiveAutoDuckEffect)
		.map((effect) => String(effect.context?.controlTrackId || ''))
		.filter((trackId) => findControllerTrack(snapshot, trackId)?.type === 'audio'));
	const renderTrackIds = new Set([...targetIds, ...controlTrackIds]);
	snapshot.tracks = snapshot.tracks
		.filter((track) => track.type === 'audio' && renderTrackIds.has(track.id))
		.map((track) => targetIds.has(track.id)
			? { ...track, mute: false, solo: false }
			: { ...track, gain: 0, pan: 0, mute: false, solo: false, effects: [], envelope: [] });
	const clipIds = new Set(snapshot.tracks.flatMap((track) => track.clipIds));
	snapshot.clips = snapshot.clips.filter((clip) => clipIds.has(clip.id));
	const sourceIds = new Set(snapshot.clips.map((clip) => clip.sourceId));
	snapshot.sources = snapshot.sources.filter((source) => sourceIds.has(source.id));
	snapshot.selection = {
		startFrame: 0,
		endFrame: 0,
		trackIds: [],
		clipIds: [],
		frequencyRange: null,
	};
	if (!multipleTracks) {
		snapshot.mixer = { groups: [], sends: [], routes: {} };
		return snapshot;
	}
	const routes: MutableControllerProject['mixer']['routes'] = {};
	for (const trackId of renderTrackIds) {
		const route = snapshot.mixer.routes[trackId];
		if (!route) continue;
		routes[trackId] = {
			...route,
			groupId: route.groupId && relevantBusIds.has(route.groupId) ? route.groupId : null,
			sends: Object.fromEntries(Object.entries(route.sends || {})
				.filter(([sendId]) => relevantBusIds.has(sendId))),
		};
	}
	snapshot.mixer = {
		groups: snapshot.mixer.groups.filter((bus) => relevantBusIds.has(bus.id)),
		sends: snapshot.mixer.sends.filter((bus) => relevantBusIds.has(bus.id)),
		routes,
	};
	return snapshot;
}

export function mixRenderBusIds(
	project: ControllerProject,
	targetIds: ReadonlySet<string>,
): Set<string> {
	const ids = new Set<string>();
	for (const trackId of targetIds) {
		const route = project.mixer.routes[trackId];
		if (route?.groupId) ids.add(route.groupId);
		for (const [sendId, gain] of Object.entries(route?.sends || {})) {
			if (Number(gain) > 0) ids.add(sendId);
		}
	}
	return ids;
}

export function mixRenderTailFrames(
	targetTracks: readonly ControllerTrack[],
	snapshot: ControllerProject,
	sampleRate: number,
	rackTailFrames: (effects: readonly ControllerEffect[], sampleRate: number, maximumSeconds: number) => number,
): number {
	const trackTail = Math.max(0, ...targetTracks.map((track) => (
		track.effectsActive === false ? 0 : rackTailFrames(track.effects || [], sampleRate, 10)
	)));
	const busTail = targetTracks.length > 1
		? Math.max(0, ...mixerStrips(snapshot)
			.map((bus) => bus.effectsActive === false ? 0 : rackTailFrames(bus.effects || [], sampleRate, 10)))
		: 0;
	return Math.min(sampleRate * 10, trackTail + busTail);
}

export function mixRenderOutputChannelCount(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	snapshot: ControllerProject,
	rendered: AudioBufferLike,
	isFixedStereoEffect: (type: string) => boolean,
): 1 | 2 {
	const allSourcesMono = targetTracks.every((track) => track.clipIds.every((clipId) => {
		const clip = findControllerClip(project, clipId);
		return findControllerSource(project, clip?.sourceId)?.channelCount === 1;
	}));
	const allTracksCentered = targetTracks.every((track) => Number(track.pan ?? 0) === 0);
	if (!allSourcesMono || !allTracksCentered) return 2;
	const buses = mixerStrips(snapshot);
	if (buses.some((bus) => Number(bus.pan ?? 0) !== 0)) return 2;
	const effects = targetTracks
		.flatMap((track) => track.effectsActive === false ? [] : track.effects || [])
		.concat(buses.flatMap((bus) => bus.effectsActive === false ? [] : bus.effects || []))
		.filter((effect) => effect.enabled !== false && effect.bypassed !== true);
	if (effects.some((effect) => isFixedStereoEffect(effect.type))) return 2;
	if (rendered.numberOfChannels < 2) return 1;
	const left = rendered.getChannelData(0);
	const right = rendered.getChannelData(1);
	if (left.length !== right.length) return 2;
	for (let frame = 0; frame < left.length; frame += 1) {
		if (left[frame] !== right[frame]) return 2;
	}
	return 1;
}

export function prepareMixRenderCommit(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	source: ControllerSource,
	options: Readonly<{
		startFrame: number;
		mixName: string;
		createId(prefix: string): string;
	}>,
): MixRenderCommit {
	if (!targetTracks.length) throw new TypeError('At least one target track is required.');
	const targetIds = new Set(targetTracks.map((track) => track.id));
	const bottomTrack = targetTracks[targetTracks.length - 1]!;
	const singleTrack = targetTracks.length === 1;
	const trackId = singleTrack ? bottomTrack.id : options.createId('mixed-track');
	const clipId = options.createId('mixed-clip');
	const commands: AudioEditorCommand[] = [createAddSourceCommand(source)];
	if (singleTrack) {
		const resetChanges: Record<string, unknown> = {
			gain: 1, pan: 0, mute: false, solo: false, armed: false,
		};
		if (!isSoundscaperProductionProjectSchema(project.schemaVersion)) resetChanges.envelope = [];
		commands.push(
			...v21StripLaneRemovalCommands(project, trackId),
			...bottomTrack.clipIds.map((clipIdToRemove): AudioEditorCommand => ({
				type: 'clip/remove', clipId: clipIdToRemove,
			})),
			...(bottomTrack.effects || []).map((effect): AudioEditorCommand => ({
				type: 'effect/remove', scope: 'track', trackId, effectId: effect.id,
			})),
			{
				type: 'track/update', trackId,
				changes: resetChanges,
			},
		);
	} else {
		const bottomIndex = project.tracks.findIndex((track) => track.id === bottomTrack.id);
		const insertIndex = project.tracks.slice(0, bottomIndex).filter((track) => !targetIds.has(track.id)).length;
		const mixedTrack: Record<string, unknown> = {
			...bottomTrack,
			id: trackId,
			name: options.mixName,
			gain: 1,
			pan: 0,
			mute: false,
			solo: false,
			armed: false,
			effects: [],
			clipIds: [],
			opaqueExtensions: {},
		};
		if (!isSoundscaperProductionProjectSchema(project.schemaVersion)) mixedTrack.envelope = [];
		commands.push(
			...targetTracks.map((track): AudioEditorCommand => ({ type: 'track/remove', trackId: track.id })),
			{
				...createAddTrackCommand(mixedTrack),
				index: insertIndex,
			},
		);
	}
	commands.push(
		createAddClipCommand(trackId, {
			id: clipId,
			sourceId: source.id,
			title: options.mixName,
			timelineStartFrame: options.startFrame,
			sourceStartFrame: 0,
			sourceDurationFrames: source.frameCount,
			durationFrames: source.frameCount,
		}),
		{
			type: 'selection/set',
			startFrame: project.selection?.startFrame || 0,
			endFrame: project.selection?.endFrame || 0,
			trackIds: [trackId],
			clipIds: [],
			frequencyRange: null,
		},
	);
	const command: Extract<AudioEditorCommand, { readonly type: 'batch' }> = { type: 'batch', commands };
	return Object.freeze({
		type: 'mix-render',
		command,
		trackId,
		clipId,
	});
}

function isActiveAutoDuckEffect(effect: ControllerEffect): boolean {
	return effect.type === 'audacity-auto-duck' && effect.enabled !== false && effect.bypassed !== true;
}

interface MutableMixRenderProjectV21 extends MutableControllerProject {
	mixer: MutableControllerProject['mixer'] & MixerGraphV21;
	automationLanes: unknown[];
	masterChannels: number;
}

function createMixRenderSnapshotV21(
	authored: ControllerProject,
	targetTracks: readonly ControllerTrack[],
): MutableControllerProject {
	// Flatten folder state and inherit that projection before narrowing, exactly
	// as the pre-production branch above does. The snapshot keeps the authored
	// folders and sequence nodes, so an unprojected one describes a hierarchy the
	// engine cannot reconcile with the tracks the mix actually renders.
	const project = projectTrackFolderMediaStateV12(authored);
	const snapshot = inheritTrackFolderMediaStateProjectionV12(
		project,
		cloneProject(project),
	) as MutableMixRenderProjectV21;
	const targetIds = new Set(targetTracks.map(({ id }) => id));
	snapshot.tracks = snapshot.tracks
		.filter((track) => track.type === 'audio' && targetIds.has(track.id))
		.map((track) => {
			const result = { ...track, mute: false, solo: false } as Record<string, unknown>;
			delete result.envelope;
			return result as unknown as ControllerTrack;
		});
	const clipIds = new Set(snapshot.tracks.flatMap((track) => track.clipIds));
	snapshot.clips = snapshot.clips.filter((clip) => clipIds.has(clip.id));
	const sourceIds = new Set(snapshot.clips.map((clip) => clip.sourceId));
	snapshot.sources = snapshot.sources.filter((source) => sourceIds.has(source.id));
	snapshot.selection = {
		...snapshot.selection,
		startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null,
	};
	const graph = normalizeMixerGraphV21(snapshot.mixer);
	if (targetTracks.length === 1) {
		const widths = resolveTerminalChannelWidths(snapshot as never, snapshot.masterChannels).tracks;
		snapshot.mixer = createDefaultMixerGraphV21([{
			id: targetTracks[0]!.id,
			channelCount: widths.get(targetTracks[0]!.id) ?? snapshot.masterChannels,
		}], snapshot.masterChannels) as MutableMixRenderProjectV21['mixer'];
		snapshot.automationLanes = snapshot.automationLanes.filter((lane) => (
			laneTargetsTrack(lane, targetTracks[0]!.id)
		));
		return snapshot;
	}
	const edges = graph.edges.filter((edge) => {
		if (edge.source.kind === 'track' && !targetIds.has(edge.source.id)) return false;
		return edge.destination.kind !== 'effect-sidechain'
			|| edge.destination.strip.kind !== 'track'
			|| targetIds.has(edge.destination.strip.id);
	});
	const edgeIds = new Set(edges.map(({ id }) => id));
	snapshot.mixer = normalizeMixerGraphV21({
		...graph,
		vcas: graph.vcas.map((vca) => ({
			...vca,
			members: vca.members.filter((member) => member.kind !== 'track' || targetIds.has(member.id)),
		})),
		edges,
	}) as MutableMixRenderProjectV21['mixer'];
	const nodeIds = new Set([
		...snapshot.mixer.groups.map(({ id }) => id),
		...snapshot.mixer.sends.map(({ id }) => id),
		...snapshot.mixer.cues.map(({ id }) => id),
	]);
	snapshot.automationLanes = snapshot.automationLanes.filter((lane) => (
		laneSurvivesMixSnapshot(lane, targetIds, nodeIds, edgeIds)
	));
	return snapshot;
}

function mixerStrips(project: ControllerProject): readonly ControllerMixerStrip[] {
	const mixer = project.mixer as unknown as Readonly<Record<string, unknown>>;
	const cues = Array.isArray(mixer.cues) ? mixer.cues as readonly ControllerMixerStrip[] : [];
	return [...project.mixer.groups, ...project.mixer.sends, ...cues];
}

type ControllerMixerStrip = ControllerProject['mixer']['groups'][number];

function v21StripLaneRemovalCommands(
	project: ControllerProject,
	trackId: string,
): AudioEditorCommand[] {
	if (!isSoundscaperProductionProjectSchema(project.schemaVersion)) return [];
	const lanes = (project as unknown as Readonly<Record<string, unknown>>).automationLanes;
	if (!Array.isArray(lanes)) throw new TypeError('A V21 mix render requires automationLanes.');
	return lanes.flatMap((lane): AudioEditorCommand[] => {
		if (!laneTargetsTrackStrip(lane, trackId)) return [];
		const record = dataRecord(lane, 'automation lane');
		return [{
			type: 'automation-lane/set',
			laneId: String(record.id),
			expected: record,
			lane: null,
		}];
	});
}

function laneTargetsTrack(value: unknown, trackId: string): boolean {
	const lane = dataRecord(value, 'automation lane');
	const address = dataRecord(lane.address, 'automation lane address');
	if (address.kind !== 'strip' && address.kind !== 'effect') return false;
	const strip = dataRecord(address.strip, 'automation lane strip');
	return strip.kind === 'track' && strip.id === trackId;
}

function laneTargetsTrackStrip(value: unknown, trackId: string): boolean {
	const lane = dataRecord(value, 'automation lane');
	const address = dataRecord(lane.address, 'automation lane address');
	if (address.kind !== 'strip') return false;
	const strip = dataRecord(address.strip, 'automation lane strip');
	return strip.kind === 'track' && strip.id === trackId;
}

function laneSurvivesMixSnapshot(
	value: unknown,
	trackIds: ReadonlySet<string>,
	nodeIds: ReadonlySet<string>,
	edgeIds: ReadonlySet<string>,
): boolean {
	const lane = dataRecord(value, 'automation lane');
	const address = dataRecord(lane.address, 'automation lane address');
	if (address.kind === 'edge') return edgeIds.has(String(address.edgeId));
	if (address.kind !== 'strip' && address.kind !== 'effect') return false;
	const strip = dataRecord(address.strip, 'automation lane strip');
	if (strip.kind === 'master') return true;
	if (strip.kind === 'track') return trackIds.has(String(strip.id));
	return strip.kind === 'mixer-node' && nodeIds.has(String(strip.id));
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function cloneProject(project: ControllerProject): MutableControllerProject {
	if (typeof structuredClone === 'function') return structuredClone(project) as MutableControllerProject;
	return JSON.parse(JSON.stringify(project)) as MutableControllerProject;
}
