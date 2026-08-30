/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import {
	defaultMixerChannelMapV21,
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
	type MixerNodeKindV21,
	type MixerStripV21,
} from '../common/editor/mixer-graph-v21.ts';
import { resolveTerminalChannelWidths } from '../common/editor/terminal-channel-widths.ts';

type LegacyMixerCommandV21 = Extract<AudioEditorCommand, {
	readonly type: 'mixer/bus-add' | 'mixer/bus-update' | 'mixer/bus-remove' | 'mixer/route-update';
}>;

interface MixerSurfaceProjectV21 extends Readonly<Record<string, unknown>> {
	readonly masterChannels: number;
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly mixer: MixerGraphV21;
}

const STRIP_UPDATE_FIELDS = new Set([
	'name', 'color', 'gain', 'pan', 'mute', 'solo', 'collapsed', 'effectsActive',
]);

/**
 * Translate only the bounded flat mixer gestures still exposed by the shared
 * mixer panel. The result is always a complete baseline graph; no `routes` or strip
 * `envelope` compatibility document is ever created.
 */
export function applySoundscaperMixerSurfaceCommand(
	project: MixerSurfaceProjectV21,
	command: LegacyMixerCommandV21,
): MixerGraphV21 {
	const graph = normalizeMixerGraphV21(project.mixer);
	if (command.type === 'mixer/bus-add') return addBus(project, graph, command);
	if (command.type === 'mixer/bus-update') return updateBus(graph, command);
	if (command.type === 'mixer/bus-remove') return removeBus(project, graph, command);
	return updateRoute(project, graph, command);
}

function addBus(
	project: MixerSurfaceProjectV21,
	graph: MixerGraphV21,
	command: Extract<LegacyMixerCommandV21, { readonly type: 'mixer/bus-add' }>,
): MixerGraphV21 {
	const kind = busKind(command.busType);
	const collection = stripCollection(graph, kind);
	const value = dataRecord(command.bus, 'mixer bus');
	const id = stableId(value.id, 'mixer bus.id');
	if ([...graph.groups, ...graph.sends, ...graph.cues].some((strip) => strip.id === id)) {
		throw new RangeError(`Duplicate mixer node ID: ${id}.`);
	}
	const strip = normalizeAddedStrip(value, kind, collection.length, project.masterChannels);
	const assignment = nodeAssignment(strip, project.masterChannels);
	return normalizeMixerGraphV21({
		...graph,
		[`${kind}s`]: [...collection, strip],
		edges: [...graph.edges, assignment],
	});
}

function updateBus(
	graph: MixerGraphV21,
	command: Extract<LegacyMixerCommandV21, { readonly type: 'mixer/bus-update' }>,
): MixerGraphV21 {
	const kind = busKind(command.busType);
	const changes = dataRecord(command.changes, 'mixer bus changes');
	for (const key of Object.keys(changes)) {
		if (!STRIP_UPDATE_FIELDS.has(key)) {
			throw new RangeError(key === 'envelope'
				? 'V21 strip envelopes are owned by automation lanes.'
				: `Mixer node field cannot be updated from the shared surface: ${key}.`);
		}
	}
	const collection = stripCollection(graph, kind);
	if (!collection.some(({ id }) => id === command.busId)) {
		throw new ReferenceError(`Unknown ${kind} mixer node: ${command.busId}.`);
	}
	return normalizeMixerGraphV21({
		...graph,
		[`${kind}s`]: collection.map((strip) => strip.id === command.busId
			? { ...strip, ...structuredClone(changes), id: strip.id, effects: strip.effects }
			: strip),
	});
}

function removeBus(
	project: MixerSurfaceProjectV21,
	graph: MixerGraphV21,
	command: Extract<LegacyMixerCommandV21, { readonly type: 'mixer/bus-remove' }>,
): MixerGraphV21 {
	const kind = busKind(command.busType);
	const collection = stripCollection(graph, kind);
	if (!collection.some(({ id }) => id === command.busId)) {
		throw new ReferenceError(`Unknown ${kind} mixer node: ${command.busId}.`);
	}
	const widths = resolveTerminalChannelWidths(project as never, project.masterChannels).tracks;
	const reroutedTracks = new Map<string, boolean>();
	for (const edge of graph.edges) {
		if (edge.kind === 'assignment' && edge.source.kind === 'track'
			&& edge.destination.kind === 'mixer-node' && edge.destination.id === command.busId) {
			reroutedTracks.set(
				edge.source.id,
				(reroutedTracks.get(edge.source.id) ?? false) || edge.enabled,
			);
		}
	}
	const edges = graph.edges.filter((edge) => !edgeTouchesNode(edge, command.busId));
	for (const [trackId, enabled] of reroutedTracks) {
		const fallback = trackAssignment(
			trackId,
			{ kind: 'master' },
			widths.get(trackId) ?? project.masterChannels,
			project.masterChannels,
			enabled,
		);
		if (!edges.some(({ id }) => id === fallback.id)) edges.push(fallback);
	}
	return normalizeMixerGraphV21({
		...graph,
		[`${kind}s`]: collection.filter(({ id }) => id !== command.busId),
		vcas: graph.vcas.map((vca) => ({
			...vca,
			members: vca.members.filter((member) => (
				member.kind !== 'mixer-node' || member.id !== command.busId
			)),
		})),
		edges,
	});
}

function updateRoute(
	project: MixerSurfaceProjectV21,
	graph: MixerGraphV21,
	command: Extract<LegacyMixerCommandV21, { readonly type: 'mixer/route-update' }>,
): MixerGraphV21 {
	const track = project.tracks.find(({ id }) => id === command.trackId);
	if (!track) throw new ReferenceError(`Unknown track: ${command.trackId}.`);
	if (track.type !== 'audio') throw new RangeError('Only audio tracks can be routed through the mixer.');
	const changes = dataRecord(command.changes, 'mixer route changes');
	for (const key of Object.keys(changes)) {
		if (key !== 'groupId' && key !== 'sends') throw new RangeError(`Mixer route field cannot be updated: ${key}.`);
	}
	const widths = resolveTerminalChannelWidths(project as never, project.masterChannels).tracks;
	const sourceChannels = widths.get(command.trackId) ?? project.masterChannels;
	let edges = [...graph.edges];
	if (Object.hasOwn(changes, 'groupId')) {
		const noncanonical = edges.filter((edge) => edge.kind === 'assignment'
			&& edge.source.kind === 'track' && edge.source.id === command.trackId
			&& !isCanonicalTrackAssignment(edge));
		if (noncanonical.length > 0) {
			throw new RangeError('This track has advanced assignment edges; edit it in the routing graph.');
		}
		edges = edges.filter((edge) => !(edge.kind === 'assignment'
			&& edge.source.kind === 'track' && edge.source.id === command.trackId
			&& isCanonicalTrackAssignment(edge)));
		const groupId = nullableId(changes.groupId, 'mixer route groupId');
		const destination = groupId === null
			? { kind: 'master' as const }
			: { kind: 'mixer-node' as const, id: requireStrip(graph.groups, groupId, 'group').id };
		const destinationChannels = groupId === null
			? project.masterChannels
			: requireStrip(graph.groups, groupId, 'group').channelCount;
		edges.push(trackAssignment(command.trackId, destination, sourceChannels, destinationChannels));
	}
	if (Object.hasOwn(changes, 'sends')) {
		const sends = dataRecord(changes.sends, 'mixer route sends');
		for (const [sendId, requestedLevel] of Object.entries(sends)) {
			const send = requireStrip(graph.sends, sendId, 'send');
			const matching = edges.filter((edge) => edge.kind === 'send'
				&& edge.source.kind === 'track' && edge.source.id === command.trackId
				&& edge.destination.kind === 'mixer-node' && edge.destination.id === sendId);
			if (matching.some((edge) => edge.id !== sendEdgeId(command.trackId, sendId))) {
				throw new RangeError('This track has advanced send edges; edit it in the routing graph.');
			}
			edges = edges.filter((edge) => !matching.includes(edge));
			if (requestedLevel === null) continue;
			edges.push({
				id: sendEdgeId(command.trackId, sendId), kind: 'send',
				source: { kind: 'track', id: command.trackId },
				destination: { kind: 'mixer-node', id: sendId },
				position: 'post-fader', level: Number(requestedLevel), enabled: true,
				channelMap: defaultMixerChannelMapV21(sourceChannels, send.channelCount),
			});
		}
	}
	return normalizeMixerGraphV21({ ...graph, edges });
}

function normalizeAddedStrip(
	value: Record<string, unknown>,
	kind: 'group' | 'send',
	index: number,
	channelCount: number,
): MixerStripV21 {
	const label = kind === 'group' ? 'Group' : 'Send';
	const name = typeof value.name === 'string' && value.name.trim().length > 0
		? value.name.trim() : `${label} ${String(index + 1)}`;
	return {
		id: stableId(value.id, 'mixer bus.id'), name,
		color: typeof value.color === 'string' && value.color.length > 0
			? value.color : kind === 'send' ? '#8c6fd1' : '#4f87c8',
		gain: value.gain === undefined ? 1 : Number(value.gain),
		pan: value.pan === undefined ? 0 : Number(value.pan),
		mute: Boolean(value.mute), solo: Boolean(value.solo),
		collapsed: value.collapsed === undefined ? true : Boolean(value.collapsed),
		effectsActive: value.effectsActive !== false,
		effects: Array.isArray(value.effects) ? structuredClone(value.effects) : [],
		channelCount,
	};
}

function nodeAssignment(strip: MixerStripV21, masterChannels: number): MixerEdgeV21 {
	return {
		id: `assignment:mixer-node:${strip.id}:master`, kind: 'assignment',
		source: { kind: 'mixer-node', id: strip.id }, destination: { kind: 'master' },
		position: 'post-fader', level: 1, enabled: true,
		channelMap: defaultMixerChannelMapV21(strip.channelCount, masterChannels),
	};
}

function trackAssignment(
	trackId: string,
	destination: { readonly kind: 'master' } | { readonly kind: 'mixer-node'; readonly id: string },
	sourceChannels: number,
	destinationChannels: number,
	enabled = true,
): MixerEdgeV21 {
	const suffix = destination.kind === 'master' ? 'master' : `mixer-node:${destination.id}`;
	return {
		id: `assignment:track:${trackId}:${suffix}`, kind: 'assignment',
		source: { kind: 'track', id: trackId }, destination,
		position: 'post-fader', level: 1, enabled,
		channelMap: defaultMixerChannelMapV21(sourceChannels, destinationChannels),
	};
}

function edgeTouchesNode(edge: MixerEdgeV21, nodeId: string): boolean {
	if (edge.source.kind === 'mixer-node' && edge.source.id === nodeId) return true;
	if (edge.destination.kind === 'mixer-node' && edge.destination.id === nodeId) return true;
	return edge.destination.kind === 'effect-sidechain'
		&& edge.destination.strip.kind === 'mixer-node'
		&& edge.destination.strip.id === nodeId;
}

function isCanonicalTrackAssignment(edge: MixerEdgeV21): boolean {
	if (edge.kind !== 'assignment' || edge.source.kind !== 'track'
		|| (edge.destination.kind !== 'master' && edge.destination.kind !== 'mixer-node')) return false;
	const suffix = edge.destination.kind === 'master' ? 'master' : `mixer-node:${edge.destination.id}`;
	return edge.id === `assignment:track:${edge.source.id}:${suffix}`;
}

function sendEdgeId(trackId: string, sendId: string): string {
	return `send:track:${trackId}:mixer-node:${sendId}`;
}

function stripCollection(graph: MixerGraphV21, kind: 'group' | 'send'): readonly MixerStripV21[] {
	return kind === 'group' ? graph.groups : graph.sends;
}

function requireStrip(
	collection: readonly MixerStripV21[],
	id: string,
	kind: MixerNodeKindV21,
): MixerStripV21 {
	const strip = collection.find((candidate) => candidate.id === id);
	if (!strip) throw new ReferenceError(`Unknown ${kind} mixer node: ${id}.`);
	return strip;
}

function busKind(value: unknown): 'group' | 'send' {
	if (value !== 'group' && value !== 'send') throw new RangeError(`Unsupported mixer bus type: ${String(value)}.`);
	return value;
}

function nullableId(value: unknown, name: string): string | null {
	if (value === null || value === '') return null;
	return stableId(value, name);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be nonempty.`);
	return value;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
