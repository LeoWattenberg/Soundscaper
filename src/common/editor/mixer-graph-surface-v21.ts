/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './commands/protocol.ts';
import { resolveTerminalChannelWidths } from './terminal-channel-widths.ts';
import {
	defaultMixerChannelMapV21,
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
	type MixerNodeKindV21,
	type MixerStripV21,
} from './mixer-graph-v21.ts';

export interface MixerTrackSurfaceRouteV21 {
	readonly groupId: string | null;
	readonly sends: Readonly<Record<string, number>>;
	readonly groupEditable: boolean;
	readonly editableSendIds: readonly string[];
}

export interface MixerTrackSurfaceWidthsV21 {
	readonly sourceChannels: number;
	readonly masterChannels: number;
}

/** Read the exact subset of V21 routing representable by the compact mixer. */
export function mixerTrackSurfaceRouteV21(
	graphValue: MixerGraphV21 | unknown,
	trackId: string,
	widths?: MixerTrackSurfaceWidthsV21,
): MixerTrackSurfaceRouteV21 {
	const graph = normalizeMixerGraphV21(graphValue);
	const assignments = graph.edges.filter((edge) => (
		edge.kind === 'assignment' && edge.source.kind === 'track' && edge.source.id === trackId
	));
	const assignment = assignments.length === 1
		&& isMixerTrackSurfaceAssignmentV21(graph, assignments[0]!, trackId, widths)
		? assignments[0]! : null;
	const groupId = assignment?.destination.kind === 'mixer-node'
		? assignment.destination.id : null;
	const sends: Record<string, number> = {};
	const editableSendIds: string[] = [];
	for (const send of graph.sends) {
		const matching = graph.edges.filter((edge) => (
			edge.kind === 'send'
			&& edge.source.kind === 'track' && edge.source.id === trackId
			&& edge.destination.kind === 'mixer-node' && edge.destination.id === send.id
		));
		if (matching.length === 0) {
			editableSendIds.push(send.id);
			continue;
		}
		if (matching.length !== 1
			|| !isMixerTrackSurfaceSendV21(graph, matching[0]!, trackId, send.id, widths)) continue;
		sends[send.id] = matching[0]!.level;
		editableSendIds.push(send.id);
	}
	return Object.freeze({
		groupId,
		sends: Object.freeze(sends),
		groupEditable: assignment !== null,
		editableSendIds: Object.freeze(editableSendIds),
	});
}

export function isMixerGraphV21Surface(value: unknown): value is MixerGraphV21 {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& (value as Readonly<Record<string, unknown>>).schemaVersion === 1
		&& Array.isArray((value as Readonly<Record<string, unknown>>).edges));
}

export function isMixerTrackSurfaceAssignmentV21(
	graph: MixerGraphV21,
	edge: MixerEdgeV21,
	trackId: string,
	widths?: MixerTrackSurfaceWidthsV21,
): boolean {
	if (edge.kind !== 'assignment'
		|| edge.source.kind !== 'track' || edge.source.id !== trackId
		|| (edge.destination.kind !== 'master' && edge.destination.kind !== 'mixer-node')
		|| edge.position !== 'post-fader' || edge.level !== 1 || !edge.enabled) return false;
	const destination = edge.destination;
	const destinationChannels = destination.kind === 'master'
		? widths?.masterChannels
		: graph.groups.find(({ id }) => id === destination.id)?.channelCount;
	if (destination.kind === 'mixer-node' && destinationChannels === undefined) return false;
	const suffix = destination.kind === 'master' ? 'master' : `mixer-node:${destination.id}`;
	return edge.id === `assignment:track:${trackId}:${suffix}`
		&& hasSurfaceChannelMap(edge, widths?.sourceChannels, destinationChannels);
}

export function isMixerTrackSurfaceSendV21(
	graph: MixerGraphV21,
	edge: MixerEdgeV21,
	trackId: string,
	sendId: string,
	widths?: MixerTrackSurfaceWidthsV21,
): boolean {
	const destinationChannels = graph.sends.find(({ id }) => id === sendId)?.channelCount;
	return destinationChannels !== undefined
		&& edge.kind === 'send'
		&& edge.source.kind === 'track' && edge.source.id === trackId
		&& edge.destination.kind === 'mixer-node' && edge.destination.id === sendId
		&& edge.id === sendEdgeId(trackId, sendId)
		&& edge.position === 'post-fader' && edge.enabled
		&& hasSurfaceChannelMap(edge, widths?.sourceChannels, destinationChannels);
}

function sendEdgeId(trackId: string, sendId: string): string {
	return `send:track:${trackId}:mixer-node:${sendId}`;
}

function hasSurfaceChannelMap(
	edge: MixerEdgeV21,
	sourceChannels: number | undefined,
	destinationChannels: number | undefined,
): boolean {
	if (sourceChannels === undefined || destinationChannels === undefined) return true;
	const expected = defaultMixerChannelMapV21(sourceChannels, destinationChannels);
	return edge.channelMap.length === expected.length
		&& edge.channelMap.every((channel, index) => channel === expected[index]);
}

export type LegacyMixerCommandV21 = Extract<AudioEditorCommand, {
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
const STRIP_ADD_FIELDS = new Set([
	'id', 'name', 'color', 'gain', 'pan', 'mute', 'solo', 'collapsed', 'effectsActive', 'effects',
]);

/**
 * Translate only the bounded flat mixer gestures still exposed by the shared
 * mixer panel. The result is always a complete baseline graph; no `routes` or strip
 * `envelope` compatibility document is ever created.
 */
export function applyMixerSurfaceCommandV21(
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
	if (graph.groups.some((strip) => strip.id === id) || graph.sends.some((strip) => strip.id === id)
		|| graph.cues.some((strip) => strip.id === id)) {
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
	const reroutedSources = new Map<string, Readonly<{
		readonly source:
			| Readonly<{ readonly kind: 'track'; readonly id: string }>
			| Readonly<{ readonly kind: 'mixer-node'; readonly id: string }>;
		readonly enabled: boolean;
	}>>();
	for (const edge of graph.edges) {
		if (edge.kind !== 'assignment' || edge.destination.kind !== 'mixer-node'
			|| edge.destination.id !== command.busId
			|| (edge.source.kind !== 'track' && edge.source.kind !== 'mixer-node')) continue;
		const key = `${edge.source.kind}:${edge.source.id}`;
		const prior = reroutedSources.get(key);
		reroutedSources.set(key, Object.freeze({
			source: edge.source,
			enabled: (prior?.enabled ?? false) || edge.enabled,
		}));
	}
	const edges = graph.edges.filter((edge) => !edgeTouchesNode(edge, command.busId));
	const nodes = new Map([...graph.groups, ...graph.sends, ...graph.cues].map((node) => [node.id, node]));
	for (const { source, enabled } of reroutedSources.values()) {
		const fallback = source.kind === 'track'
			? trackAssignment(
				source.id,
				{ kind: 'master' },
				widths.get(source.id) ?? project.masterChannels,
				project.masterChannels,
				enabled,
			)
			: { ...nodeAssignment(nodes.get(source.id)!, project.masterChannels), enabled };
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
	const surfaceWidths = { sourceChannels, masterChannels: project.masterChannels };
	let edges = [...graph.edges];
	if (Object.hasOwn(changes, 'groupId')) {
		const assignments = edges.filter((edge) => edge.kind === 'assignment'
			&& edge.source.kind === 'track' && edge.source.id === command.trackId);
		if (assignments.length > 1 || assignments.some((edge) => (
			!isMixerTrackSurfaceAssignmentV21(graph, edge, command.trackId, surfaceWidths)
		))) {
			throw new RangeError('This track has advanced assignment edges; edit it in the routing graph.');
		}
		edges = edges.filter((edge) => !(edge.kind === 'assignment'
			&& edge.source.kind === 'track' && edge.source.id === command.trackId
			&& isMixerTrackSurfaceAssignmentV21(graph, edge, command.trackId, surfaceWidths)));
		const groupId = nullableId(changes.groupId, 'mixer route groupId');
		const group = groupId === null ? null : requireStrip(graph.groups, groupId, 'group');
		const destination = group === null
			? { kind: 'master' as const }
			: { kind: 'mixer-node' as const, id: group.id };
		const destinationChannels = group === null
			? project.masterChannels
			: group.channelCount;
		edges.push(trackAssignment(command.trackId, destination, sourceChannels, destinationChannels));
	}
	if (Object.hasOwn(changes, 'sends')) {
		const sends = dataRecord(changes.sends, 'mixer route sends');
		for (const [sendId, requestedLevel] of Object.entries(sends)) {
			const send = requireStrip(graph.sends, sendId, 'send');
			const matching = edges.filter((edge) => edge.kind === 'send'
				&& edge.source.kind === 'track' && edge.source.id === command.trackId
				&& edge.destination.kind === 'mixer-node' && edge.destination.id === sendId);
			if (matching.length > 1 || matching.some((edge) => (
				!isMixerTrackSurfaceSendV21(graph, edge, command.trackId, sendId, surfaceWidths)
			))) {
				throw new RangeError('This track has advanced send edges; edit it in the routing graph.');
			}
			if (matching.length) edges = edges.filter((edge) => !matching.includes(edge));
			if (requestedLevel === null) continue;
			if (typeof requestedLevel !== 'number') {
				throw new TypeError('A mixer send level must be a canonical number or null.');
			}
			edges.push({
				id: sendEdgeId(command.trackId, sendId), kind: 'send',
				source: { kind: 'track', id: command.trackId },
				destination: { kind: 'mixer-node', id: sendId },
				position: 'post-fader', level: requestedLevel, enabled: true,
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
	for (const key of Object.keys(value)) {
		if (!STRIP_ADD_FIELDS.has(key)) {
			throw new RangeError(key === 'envelope'
				? 'V21 strip envelopes are owned by automation lanes.'
				: `Mixer bus field cannot be added from the shared surface: ${key}.`);
		}
	}
	const label = kind === 'group' ? 'Group' : 'Send';
	const name = optionalText(value, 'name', `${label} ${String(index + 1)}`).trim()
		|| `${label} ${String(index + 1)}`;
	return {
		id: stableId(value.id, 'mixer bus.id'), name,
		color: optionalText(value, 'color', kind === 'send' ? '#8c6fd1' : '#4f87c8')
			|| (kind === 'send' ? '#8c6fd1' : '#4f87c8'),
		gain: optionalNumber(value, 'gain', 1),
		pan: optionalNumber(value, 'pan', 0),
		mute: optionalBoolean(value, 'mute', false),
		solo: optionalBoolean(value, 'solo', false),
		collapsed: optionalBoolean(value, 'collapsed', true),
		effectsActive: optionalBoolean(value, 'effectsActive', true),
		effects: optionalEffects(value),
		channelCount,
	};
}

function optionalText(value: Record<string, unknown>, field: string, fallback: string): string {
	if (!Object.hasOwn(value, field)) return fallback;
	if (typeof value[field] !== 'string') throw new TypeError(`Mixer bus ${field} must be text.`);
	return value[field];
}

function optionalNumber(value: Record<string, unknown>, field: string, fallback: number): number {
	if (!Object.hasOwn(value, field)) return fallback;
	if (typeof value[field] !== 'number') throw new TypeError(`Mixer bus ${field} must be a canonical number.`);
	return value[field];
}

function optionalBoolean(value: Record<string, unknown>, field: string, fallback: boolean): boolean {
	if (!Object.hasOwn(value, field)) return fallback;
	if (typeof value[field] !== 'boolean') throw new TypeError(`Mixer bus ${field} must be boolean.`);
	return value[field];
}

function optionalEffects(value: Record<string, unknown>): readonly Readonly<Record<string, unknown>>[] {
	if (!Object.hasOwn(value, 'effects')) return [];
	if (!Array.isArray(value.effects)) throw new TypeError('Mixer bus effects must be an array.');
	return structuredClone(value.effects) as readonly Readonly<Record<string, unknown>>[];
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

/** Admit exactly the existing compact mixer commands to the canonical graph. */
export function isMixerSurfaceCommandV21(command: Readonly<{ readonly type: string }>): command is LegacyMixerCommandV21 {
	return command.type === 'mixer/bus-add' || command.type === 'mixer/bus-update'
		|| command.type === 'mixer/bus-remove' || command.type === 'mixer/route-update';
}
