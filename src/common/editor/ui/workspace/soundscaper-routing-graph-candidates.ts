/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateFolderMixerGraphV21 } from '../../folder-mixer-graph-v21.ts';
import {
	defaultMixerChannelMapV21,
	mixerNodeEffectsV21,
	normalizeMixerGraphV21,
	validateMixerGraphV21,
	type MixerEdgeKindV21,
	type MixerEdgeV21,
	type MixerEndpointV21,
	type MixerGraphV21,
	type MixerOutputRoleV21,
	type MixerStripV21,
	type MixerVcaV21,
} from '../../mixer-graph-v21.ts';
import type { ParameterAddress, StripRef } from '../../parameter-address.ts';
import { resolveTerminalChannelWidths } from '../../terminal-channel-widths.ts';
import { effectSupportsExplicitSidechain } from '../../effect-explicit-sidechain-capability.ts';
import { assertSoundscaperRoutingEdgeEditable, assertSoundscaperRoutingNodeEditable, validateSoundscaperRoutingFolderAuthority } from './soundscaper-routing-folder-authority.ts';

type DataRecord = Readonly<Record<string, unknown>>;
export type RoutingNodeCollection = 'groups' | 'sends' | 'cues';
export type RoutingAddItemKind = 'cue' | 'vca' | 'output';
export type RoutingSelection =
	| Readonly<{ kind: 'node'; collection: RoutingNodeCollection; id: string }>
	| Readonly<{ kind: 'track'; id: string }>
	| Readonly<{ kind: 'master'; id: 'master' }>
	| Readonly<{ kind: 'output'; id: string }>
	| Readonly<{ kind: 'vca'; id: string }>
	| Readonly<{ kind: 'edge'; id: string }>;

export interface RoutingGraphCandidate {
	readonly graph: MixerGraphV21;
	readonly selection: RoutingSelection;
	readonly addresses: readonly ParameterAddress[];
}

export interface RoutingEndpointOption<Endpoint> {
	readonly value: string;
	readonly label: string;
	readonly endpoint: Endpoint;
}

export interface RoutingNodeUpdate {
	readonly name: string;
	readonly channelCount: number;
}

export interface RoutingOutputUpdate extends RoutingNodeUpdate {
	readonly role: MixerOutputRoleV21;
}

export interface RoutingEdgeUpdate {
	readonly source: MixerEdgeV21['source'];
	readonly destination: MixerEdgeV21['destination'];
	readonly kind: MixerEdgeKindV21;
	readonly position: MixerEdgeV21['position'];
	readonly level: number;
	readonly enabled: boolean;
	readonly channelMap: readonly number[];
}

export interface RoutingVcaUpdate {
	readonly name: string;
	readonly gain: number;
	readonly mute: boolean;
	readonly members: readonly StripRef[];
}

export function validateSoundscaperRoutingGraphCandidate(
	projectValue: unknown,
	graphValue: unknown,
): MixerGraphV21 {
	const graph = normalizeMixerGraphV21(graphValue);
	const project = record(projectValue);
	const masterChannels = positiveInteger(project?.masterChannels, 2);
	const widths = resolveTerminalChannelWidths(projectValue as never, masterChannels).tracks;
	const tracks = records(project?.tracks).flatMap((track) => {
		if (track.type !== 'audio' || typeof track.id !== 'string' || track.id.length === 0) return [];
		return [{
			id: track.id,
			effects: records(track.effects),
			...(widths.has(track.id) ? { channelCount: widths.get(track.id) } : {}),
		}];
	});
	validateMixerGraphV21(graph, {
		audioTracks: tracks,
		masterEffects: records(record(project?.master)?.effects),
		masterChannels,
		strictChannelMapLength: true,
		mixerNodeEffects: mixerNodeEffectsV21(graph),
	});
	if (Array.isArray(project?.trackFolders) && Array.isArray(project?.sequences)) {
		validateFolderMixerGraphV21(projectValue as never, graph);
	}
	validateSoundscaperRoutingFolderAuthority(projectValue, graph);
	return graph;
}

export function addSoundscaperRoutingItem(
	project: unknown,
	graphValue: MixerGraphV21,
	kind: RoutingAddItemKind,
): RoutingGraphCandidate {
	const graph = normalizeMixerGraphV21(graphValue);
	if (kind === 'vca') {
		const id = nextIdentifier('vca', allIds(graph));
		return candidate(project, { ...graph, vcas: [...graph.vcas, {
			id, name: nextName('VCA', graph.vcas), gain: 1, mute: false, members: [],
		}] }, { kind: 'vca', id }, stripAddresses({ kind: 'master' }).slice(0, 0));
	}
	if (kind === 'output') {
		const id = nextIdentifier('output', allIds(graph));
		const masterChannels = positiveInteger(record(project)?.masterChannels, 2);
		const output = {
			id, name: nextName('Output', graph.outputs), role: 'auxiliary' as const,
			channelCount: masterChannels,
		};
		const edgeId = uniqueEdgeId(graph, { kind: 'master' }, { kind: 'output', id });
		return candidate(project, {
			...graph,
			outputs: [...graph.outputs, output],
			edges: [...graph.edges, {
				id: edgeId, kind: 'assignment' as const,
				source: { kind: 'master' as const }, destination: { kind: 'output' as const, id },
				position: 'post-fader' as const, level: 1, enabled: true,
				channelMap: defaultMixerChannelMapV21(masterChannels, masterChannels),
			}],
		}, { kind: 'output', id }, [edgeAddress(edgeId)]);
	}
	const id = nextIdentifier('cue', allIds(graph));
	const channelCount = positiveInteger(record(project)?.masterChannels, 2);
	return candidate(project, {
		...graph,
		cues: [...graph.cues, defaultStrip(id, nextName('Cue', graph.cues), channelCount)],
	}, { kind: 'node', collection: 'cues', id }, stripAddresses({ kind: 'mixer-node', id }));
}

export function connectSoundscaperRoutingEdge(
	project: unknown,
	graphValue: MixerGraphV21,
	source: MixerEdgeV21['source'],
	destination: MixerEdgeV21['destination'],
): RoutingGraphCandidate {
	const graph = normalizeMixerGraphV21(graphValue);
	const id = uniqueEdgeId(graph, source, destination);
	const edge = defaultEdge(project, graph, id, source, destination);
	return candidate(project, { ...graph, edges: [...graph.edges, edge] }, { kind: 'edge', id }, [edgeAddress(id)]);
}

export function rewireSoundscaperRoutingEdge(
	project: unknown,
	graphValue: MixerGraphV21,
	edgeId: string,
	source: MixerEdgeV21['source'],
	destination: MixerEdgeV21['destination'],
): RoutingGraphCandidate {
	const graph = normalizeMixerGraphV21(graphValue);
	const existing = requiredEntry(graph.edges, edgeId, 'routing edge');
	assertSoundscaperRoutingEdgeEditable(project, existing);
	const defaults = defaultEdge(project, graph, edgeId, source, destination);
	const edge: MixerEdgeV21 = {
		...existing,
		kind: defaults.kind,
		source: defaults.source,
		destination: defaults.destination,
		channelMap: defaults.channelMap,
	};
	return candidate(project, replaceEntry(graph, 'edges', edgeId, edge), { kind: 'edge', id: edgeId }, [edgeAddress(edgeId)]);
}

export function updateSoundscaperRoutingEdge(
	project: unknown,
	graphValue: MixerGraphV21,
	edgeId: string,
	update: RoutingEdgeUpdate,
): RoutingGraphCandidate {
	const graph = normalizeMixerGraphV21(graphValue);
	assertSoundscaperRoutingEdgeEditable(project, requiredEntry(graph.edges, edgeId, 'routing edge'));
	const edge: MixerEdgeV21 = { id: edgeId, ...update };
	return candidate(project, replaceEntry(graph, 'edges', edgeId, edge), { kind: 'edge', id: edgeId }, [edgeAddress(edgeId)]);
}

export function updateSoundscaperRoutingNode(
	project: unknown,
	graphValue: MixerGraphV21,
	collection: RoutingNodeCollection,
	id: string,
	update: RoutingNodeUpdate,
): RoutingGraphCandidate {
	const graph = normalizeMixerGraphV21(graphValue);
	assertSoundscaperRoutingNodeEditable(project, collection, id);
	const oldNode = requiredEntry(graph[collection], id, 'mixer node');
	const node = { ...oldNode, name: update.name, channelCount: update.channelCount };
	const graphWithNode = replaceEntry(graph, collection, id, node);
	const edges = resizeDefaultIncidentMaps(project, graph, graphWithNode, { kind: 'mixer-node', id });
	return candidate(project, { ...graphWithNode, edges }, { kind: 'node', collection, id }, stripAddresses({ kind: 'mixer-node', id }));
}

export function updateSoundscaperRoutingOutput(
	project: unknown,
	graphValue: MixerGraphV21,
	id: string,
	update: RoutingOutputUpdate,
): RoutingGraphCandidate {
	const graph = normalizeMixerGraphV21(graphValue);
	const previous = requiredEntry(graph.outputs, id, 'mixer output');
	const outputs = graph.outputs.map((output) => ({
		...output,
		...(output.id === id ? update : {}),
		...(update.role === 'main' && output.id !== id && output.role === 'main'
			? { role: 'auxiliary' as const } : {}),
	}));
	if (previous.role === 'main' && update.role !== 'main'
		&& !outputs.some((output) => output.role === 'main')) {
		throw new TypeError('The mixer graph must keep exactly one main output. Promote another output instead.');
	}
	const graphWithOutput = { ...graph, outputs };
	const edges = resizeDefaultIncidentMaps(project, graph, graphWithOutput, { kind: 'output', id });
	return candidate(project, { ...graphWithOutput, edges }, { kind: 'output', id }, []);
}

export function updateSoundscaperRoutingVca(
	project: unknown,
	graphValue: MixerGraphV21,
	id: string,
	update: RoutingVcaUpdate,
): RoutingGraphCandidate {
	const graph = normalizeMixerGraphV21(graphValue);
	requiredEntry(graph.vcas, id, 'VCA');
	const vca: MixerVcaV21 = { id, ...update };
	return candidate(project, replaceEntry(graph, 'vcas', id, vca), { kind: 'vca', id }, stripAddressesForMembers(vca.members));
}

export function removeSoundscaperRoutingItem(
	project: unknown,
	graphValue: MixerGraphV21,
	selection: RoutingSelection,
): RoutingGraphCandidate {
	const graph = normalizeMixerGraphV21(graphValue);
	if (selection.kind === 'track' || selection.kind === 'master') {
		throw new TypeError(`${selection.kind === 'track' ? 'Tracks' : 'The master'} cannot be deleted from the routing graph.`);
	}
	if (selection.kind === 'edge') {
		assertSoundscaperRoutingEdgeEditable(project, requiredEntry(graph.edges, selection.id, 'routing edge'));
		return candidate(project, { ...graph, edges: graph.edges.filter(({ id }) => id !== selection.id) }, selection, [edgeAddress(selection.id)]);
	}
	if (selection.kind === 'vca') {
		requiredEntry(graph.vcas, selection.id, 'VCA');
		return candidate(project, { ...graph, vcas: graph.vcas.filter(({ id }) => id !== selection.id) }, selection, []);
	}
	if (selection.kind === 'output') {
		requiredEntry(graph.outputs, selection.id, 'mixer output');
		return candidate(project, {
			...graph,
			outputs: graph.outputs.filter(({ id }) => id !== selection.id),
			edges: graph.edges.filter((edge) => !(edge.destination.kind === 'output' && edge.destination.id === selection.id)),
		}, selection, incidentEdgeAddresses(graph, { kind: 'output', id: selection.id }));
	}
	const nodes = graph[selection.collection];
	assertSoundscaperRoutingNodeEditable(project, selection.collection, selection.id);
	requiredEntry(nodes, selection.id, 'mixer node');
	const strip: StripRef = { kind: 'mixer-node', id: selection.id };
	return candidate(project, {
		...graph,
		[selection.collection]: nodes.filter(({ id }) => id !== selection.id),
		edges: graph.edges.filter((edge) => !edgeTouchesStrip(edge, strip)),
		vcas: graph.vcas.map((vca) => ({
			...vca,
			members: vca.members.filter((member) => !stripEqual(member, strip)),
		})),
	}, selection, [...stripAddresses(strip), ...incidentEdgeAddresses(graph, strip)]);
}

export function routingSourceOptions(
	projectValue: unknown,
	graph: MixerGraphV21,
): readonly RoutingEndpointOption<MixerEdgeV21['source']>[] {
	const options: RoutingEndpointOption<MixerEdgeV21['source']>[] = [];
	for (const track of audioTracks(projectValue)) options.push(endpointOption(
		{ kind: 'track', id: track.id }, `Track: ${track.name}`,
	));
	for (const [collection, label] of NODE_COLLECTIONS) for (const node of graph[collection]) {
		options.push(endpointOption({ kind: 'mixer-node', id: node.id }, `${label}: ${node.name || node.id}`));
	}
	options.push(endpointOption({ kind: 'master' }, 'Master'));
	return options;
}

export function routingDestinationOptions(
	projectValue: unknown,
	graph: MixerGraphV21,
): readonly RoutingEndpointOption<MixerEdgeV21['destination']>[] {
	const options: RoutingEndpointOption<MixerEdgeV21['destination']>[] = [];
	for (const [collection, label] of NODE_COLLECTIONS) for (const node of graph[collection]) {
		options.push(endpointOption({ kind: 'mixer-node' as const, id: node.id }, `${label}: ${node.name || node.id}`));
	}
	options.push(endpointOption({ kind: 'master' as const }, 'Master'));
	for (const output of graph.outputs) options.push(endpointOption(
		{ kind: 'output' as const, id: output.id }, `Output: ${output.name || output.id}`,
	));
	for (const track of audioTracks(projectValue)) pushSidechains(options, { kind: 'track', id: track.id }, `Track ${track.name}`, track.effects);
	const master = record(record(projectValue)?.master);
	pushSidechains(options, { kind: 'master' }, 'Master', records(master?.effects));
	for (const [collection, label] of NODE_COLLECTIONS) for (const node of graph[collection]) {
		pushSidechains(options, { kind: 'mixer-node', id: node.id }, `${label} ${node.name || node.id}`, node.effects);
	}
	return options;
}

export function routingVcaMemberOptions(
	projectValue: unknown,
	graph: MixerGraphV21,
): readonly RoutingEndpointOption<StripRef>[] {
	return routingSourceOptions(projectValue, graph).map(({ value, label, endpoint }) => ({
		value, label, endpoint,
	}));
}

export function routingEndpointValue(endpoint: MixerEdgeV21['source'] | MixerEdgeV21['destination'] | StripRef): string {
	return JSON.stringify(endpoint);
}

export function routingEndpointLabel(
	options: readonly RoutingEndpointOption<unknown>[],
	endpoint: unknown,
): string {
	return options.find(({ value }) => value === routingEndpointValue(endpoint as never))?.label
		?? routingEndpointValue(endpoint as never);
}

export function routingSelectionAddresses(
	selection: RoutingSelection,
): readonly ParameterAddress[] {
	if (selection.kind === 'edge') return [edgeAddress(selection.id)];
	if (selection.kind === 'track') return stripAddresses({ kind: 'track', id: selection.id });
	if (selection.kind === 'node') return stripAddresses({ kind: 'mixer-node', id: selection.id });
	if (selection.kind === 'master') return stripAddresses({ kind: 'master' });
	return [];
}

export function routingDeleteSummary(graph: MixerGraphV21, selection: RoutingSelection): string {
	if (selection.kind === 'edge') return 'Delete this connection?';
	if (selection.kind === 'track' || selection.kind === 'master') return 'This strip is owned by the project and cannot be deleted here.';
	if (selection.kind === 'vca') return `Delete this VCA and its ${requiredEntry(graph.vcas, selection.id, 'VCA').members.length} memberships?`;
	const strip = selection.kind === 'node' ? { kind: 'mixer-node' as const, id: selection.id } : null;
	const incident = selection.kind === 'output'
		? graph.edges.filter((edge) => edge.destination.kind === 'output' && edge.destination.id === selection.id).length
		: graph.edges.filter((edge) => strip && edgeTouchesStrip(edge, strip)).length;
	return `Delete this ${selection.kind === 'output' ? 'output' : 'node'} and ${incident} incident connections?`;
}

function candidate(
	project: unknown,
	graphValue: unknown,
	selection: RoutingSelection,
	addresses: readonly ParameterAddress[],
): RoutingGraphCandidate {
	return Object.freeze({
		graph: validateSoundscaperRoutingGraphCandidate(project, graphValue),
		selection: Object.freeze(selection),
		addresses: Object.freeze(addresses),
	});
}

function defaultEdge(
	project: unknown,
	graph: MixerGraphV21,
	id: string,
	source: MixerEdgeV21['source'],
	destination: MixerEdgeV21['destination'],
): MixerEdgeV21 {
	const sourceChannels = endpointWidth(project, graph, source);
	const destinationChannels = destination.kind === 'effect-sidechain'
		? endpointWidth(project, graph, destination.strip)
		: endpointWidth(project, graph, destination);
	return {
		id,
		kind: semanticEdgeKind(graph, destination),
		source,
		destination,
		position: 'post-fader',
		level: 1,
		enabled: true,
		channelMap: defaultMixerChannelMapV21(sourceChannels, destinationChannels),
	};
}

function semanticEdgeKind(graph: MixerGraphV21, destination: MixerEdgeV21['destination']): MixerEdgeKindV21 {
	if (destination.kind === 'effect-sidechain') return 'sidechain';
	if (destination.kind === 'mixer-node' && graph.sends.some(({ id }) => id === destination.id)) return 'send';
	return 'assignment';
}

function endpointWidth(
	projectValue: unknown,
	graph: MixerGraphV21,
	endpoint: MixerEndpointV21 | StripRef,
): number {
	const project = record(projectValue);
	const masterChannels = positiveInteger(project?.masterChannels, 2);
	if (endpoint.kind === 'master') return masterChannels;
	if (endpoint.kind === 'output') return graph.outputs.find(({ id }) => id === endpoint.id)?.channelCount ?? masterChannels;
	if (endpoint.kind === 'mixer-node') {
		return [...graph.groups, ...graph.sends, ...graph.cues].find(({ id }) => id === endpoint.id)?.channelCount ?? masterChannels;
	}
	return resolveTerminalChannelWidths(projectValue as never, masterChannels).tracks.get(endpoint.id) ?? masterChannels;
}

function resizeDefaultIncidentMaps(
	project: unknown,
	before: MixerGraphV21,
	after: MixerGraphV21,
	endpoint: MixerEndpointV21,
): readonly MixerEdgeV21[] {
	return before.edges.map((edge) => {
		const incident = endpointEqual(edge.source, endpoint)
			|| (edge.destination.kind !== 'effect-sidechain' && endpointEqual(edge.destination, endpoint))
			|| (edge.destination.kind === 'effect-sidechain' && stripEqual(edge.destination.strip, endpoint as StripRef));
		if (!incident) return edge;
		const oldSourceWidth = endpointWidth(project, before, edge.source);
		const oldDestinationWidth = edge.destination.kind === 'effect-sidechain'
			? endpointWidth(project, before, edge.destination.strip)
			: endpointWidth(project, before, edge.destination);
		const oldDefault = defaultMixerChannelMapV21(oldSourceWidth, oldDestinationWidth);
		if (!numberArraysEqual(edge.channelMap, oldDefault)) return edge;
		const newSourceWidth = endpointWidth(project, after, edge.source);
		const newDestinationWidth = edge.destination.kind === 'effect-sidechain'
			? endpointWidth(project, after, edge.destination.strip)
			: endpointWidth(project, after, edge.destination);
		return { ...edge, channelMap: defaultMixerChannelMapV21(newSourceWidth, newDestinationWidth) };
	});
}

function replaceEntry<
	Collection extends RoutingNodeCollection | 'edges' | 'outputs' | 'vcas',
	Entry extends { readonly id: string },
>(graph: MixerGraphV21, collection: Collection, id: string, entry: Entry): MixerGraphV21 {
	return {
		...graph,
		[collection]: graph[collection].map((candidate) => candidate.id === id ? entry : candidate),
	};
}

function requiredEntry<Entry extends { readonly id: string }>(
	entries: readonly Entry[],
	id: string,
	label: string,
): Entry {
	const entry = entries.find((candidate) => candidate.id === id);
	if (!entry) throw new RangeError(`The ${label} ${id} no longer exists.`);
	return entry;
}

function defaultStrip(id: string, name: string, channelCount: number): MixerStripV21 {
	return {
		id, name, color: '', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount,
	};
}

function uniqueEdgeId(
	graph: MixerGraphV21,
	source: MixerEdgeV21['source'],
	destination: MixerEdgeV21['destination'],
): string {
	const base = `route:${endpointToken(source)}:${endpointToken(destination)}`;
	const ids = new Set(graph.edges.map(({ id }) => id));
	if (!ids.has(base)) return base;
	let suffix = 2;
	while (ids.has(`${base}:${suffix}`)) suffix += 1;
	return `${base}:${suffix}`;
}

function endpointToken(endpoint: MixerEdgeV21['source'] | MixerEdgeV21['destination']): string {
	if (endpoint.kind === 'master') return 'master';
	if (endpoint.kind === 'effect-sidechain') {
		return `sidechain-${endpointToken(endpoint.strip)}-${safeToken(endpoint.effectId)}`;
	}
	return `${endpoint.kind}-${safeToken(endpoint.id)}`;
}

function safeToken(value: string): string {
	return (value.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'item').slice(0, 56);
}

function nextIdentifier(prefix: string, used: ReadonlySet<string>): string {
	if (!used.has(prefix)) return prefix;
	let index = 2;
	while (used.has(`${prefix}-${index}`)) index += 1;
	return `${prefix}-${index}`;
}

function nextName(prefix: string, entries: readonly { readonly name: string }[]): string {
	return `${prefix} ${entries.length + 1}`;
}

function allIds(graph: MixerGraphV21): ReadonlySet<string> {
	return new Set([
		...graph.groups, ...graph.sends, ...graph.cues, ...graph.vcas, ...graph.outputs,
	].map(({ id }) => id));
}

function endpointOption<Endpoint extends Readonly<Record<string, unknown>>>(
	endpoint: Endpoint,
	label: string,
): RoutingEndpointOption<Endpoint> {
	return Object.freeze({ endpoint: Object.freeze(endpoint), value: routingEndpointValue(endpoint as never), label });
}

function pushSidechains(
	options: RoutingEndpointOption<MixerEdgeV21['destination']>[],
	strip: StripRef,
	stripLabel: string,
	effects: readonly DataRecord[],
): void {
	for (const effect of effects) if (typeof effect.id === 'string' && effect.id.length > 0
		&& effectSupportsExplicitSidechain(effect)) {
		options.push(endpointOption(
			{ kind: 'effect-sidechain' as const, strip, effectId: effect.id },
			`Sidechain: ${stripLabel} / ${String(effect.name ?? effect.type ?? effect.id)}`,
		));
	}
}

function audioTracks(projectValue: unknown): readonly { id: string; name: string; effects: readonly DataRecord[] }[] {
	return records(record(projectValue)?.tracks).flatMap((track) => (
		track.type === 'audio' && typeof track.id === 'string' && track.id.length > 0
			? [{ id: track.id, name: typeof track.name === 'string' && track.name ? track.name : track.id, effects: records(track.effects) }]
			: []
	));
}

function stripAddresses(strip: StripRef): readonly ParameterAddress[] {
	return ['gain', 'pan', 'mute'].map((parameterId) => ({
		kind: 'strip' as const, strip, parameterId: parameterId as 'gain' | 'pan' | 'mute',
	}));
}

function stripAddressesForMembers(members: readonly StripRef[]): readonly ParameterAddress[] {
	return members.flatMap(stripAddresses);
}

function edgeAddress(edgeId: string): ParameterAddress {
	return { kind: 'edge', edgeId, parameterId: 'level' };
}

function incidentEdgeAddresses(graph: MixerGraphV21, endpoint: MixerEndpointV21 | StripRef): readonly ParameterAddress[] {
	return graph.edges.filter((edge) => (
		endpointEqual(edge.source, endpoint)
		|| (edge.destination.kind !== 'effect-sidechain' && endpointEqual(edge.destination, endpoint))
		|| (edge.destination.kind === 'effect-sidechain' && stripEqual(edge.destination.strip, endpoint as StripRef))
	)).map(({ id }) => edgeAddress(id));
}

function edgeTouchesStrip(edge: MixerEdgeV21, strip: StripRef): boolean {
	return stripEqual(edge.source, strip)
		|| (edge.destination.kind !== 'output' && (
			edge.destination.kind === 'effect-sidechain'
				? stripEqual(edge.destination.strip, strip)
				: stripEqual(edge.destination, strip)
		));
}

function stripEqual(left: StripRef, right: StripRef): boolean {
	return left.kind === right.kind && (left.kind === 'master' || (right.kind !== 'master' && left.id === right.id));
}

function endpointEqual(left: MixerEndpointV21, right: MixerEndpointV21 | StripRef): boolean {
	if (left.kind !== right.kind) return false;
	return left.kind === 'master' || (right.kind !== 'master' && left.id === right.id);
}

function numberArraysEqual(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function records(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((entry): entry is DataRecord => entry !== null) : [];
}

function positiveInteger(value: unknown, fallback: number): number {
	return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 32 ? Number(value) : fallback;
}

const NODE_COLLECTIONS = [
	['groups', 'Group'], ['sends', 'Send'], ['cues', 'Cue'],
] as const satisfies readonly (readonly [RoutingNodeCollection, string])[];
