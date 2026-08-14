/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	mixerNodeEffectsV21,
	normalizeMixerGraphV21,
	validateMixerGraphV21,
	type MixerEdgeV21,
	type MixerEffectSidechainEndpointV21,
	type MixerGraphV21,
	type MixerOutputV21,
	type MixerStripV21,
	type MixerVcaV21,
} from '../mixer-graph-v21.ts';
import type { StripRef } from '../parameter-address.ts';

type DataRecord = Readonly<Record<string, unknown>>;
export type SoundscaperRoutingNodeCollection = 'groups' | 'sends' | 'cues';
export type SoundscaperRoutingSource = MixerEdgeV21['source'];
export type SoundscaperRoutingDestination = MixerEdgeV21['destination'];

export interface SoundscaperRoutingEndpointOption<Endpoint> {
	readonly value: string;
	readonly label: string;
	readonly endpoint: Endpoint;
}

export interface SoundscaperRoutingEditorModel {
	readonly graph: MixerGraphV21 | null;
	readonly validationError: string | null;
	readonly canApply: boolean;
	readonly sourceEndpoints: readonly SoundscaperRoutingEndpointOption<SoundscaperRoutingSource>[];
	readonly destinationEndpoints: readonly SoundscaperRoutingEndpointOption<SoundscaperRoutingDestination>[];
	readonly vcaMembers: readonly SoundscaperRoutingEndpointOption<StripRef>[];
}

export type SoundscaperRoutingGraphEdit =
	| Readonly<{
		type: 'node/set';
		collection: SoundscaperRoutingNodeCollection;
		previousId: string | null;
		node: MixerStripV21;
	}>
	| Readonly<{
		type: 'node/remove';
		collection: SoundscaperRoutingNodeCollection;
		id: string;
	}>
	| Readonly<{ type: 'output/set'; previousId: string | null; output: MixerOutputV21 }>
	| Readonly<{ type: 'output/remove'; id: string }>
	| Readonly<{ type: 'edge/set'; previousId: string | null; edge: MixerEdgeV21 }>
	| Readonly<{ type: 'edge/remove'; id: string }>
	| Readonly<{ type: 'vca/set'; previousId: string | null; vca: MixerVcaV21 }>
	| Readonly<{ type: 'vca/remove'; id: string }>;

export interface SoundscaperRoutingGraphEditResult {
	readonly text: string;
	readonly validationError: string | null;
}

/** Build the bounded, read-only projection used by the lazy routing overlay. */
export function createSoundscaperRoutingEditorModel(
	projectValue: unknown,
	draft: string,
): SoundscaperRoutingEditorModel {
	let graph: MixerGraphV21 | null = null;
	let validationError: string | null = null;
	try {
		graph = normalizeMixerGraphV21(parseDocument(draft));
		validationError = validateGraph(projectValue, graph);
	} catch (error) {
		validationError = errorMessage(error);
	}
	const project = record(projectValue);
	const sourceEndpoints = graph ? sourceEndpointOptions(project, graph) : Object.freeze([]);
	const destinationEndpoints = graph ? destinationEndpointOptions(project, graph) : Object.freeze([]);
	const vcaMembers = graph ? vcaMemberOptions(project, graph) : Object.freeze([]);
	return Object.freeze({
		graph,
		validationError,
		canApply: graph !== null && validationError === null,
		sourceEndpoints,
		destinationEndpoints,
		vcaMembers,
	});
}

/** Apply one focused edit to the local draft and revalidate the resulting full graph. */
export function editSoundscaperRoutingGraph(
	project: unknown,
	draft: string,
	edit: SoundscaperRoutingGraphEdit,
): SoundscaperRoutingGraphEditResult {
	const graph = normalizeMixerGraphV21(parseDocument(draft));
	const collections = {
		groups: [...graph.groups],
		sends: [...graph.sends],
		cues: [...graph.cues],
		vcas: [...graph.vcas],
		outputs: [...graph.outputs],
		edges: [...graph.edges],
	};
	if (edit.type === 'node/set') {
		collections[edit.collection] = setEntry(
			collections[edit.collection], edit.previousId, edit.node, `${edit.collection} mixer node`,
		);
	} else if (edit.type === 'node/remove') {
		collections[edit.collection] = removeEntry(
			collections[edit.collection], edit.id, `${edit.collection} mixer node`,
		);
	} else if (edit.type === 'output/set') {
		collections.outputs = setEntry(collections.outputs, edit.previousId, edit.output, 'mixer output');
	} else if (edit.type === 'output/remove') {
		collections.outputs = removeEntry(collections.outputs, edit.id, 'mixer output');
	} else if (edit.type === 'edge/set') {
		collections.edges = setEntry(collections.edges, edit.previousId, edit.edge, 'routing edge');
	} else if (edit.type === 'edge/remove') {
		collections.edges = removeEntry(collections.edges, edit.id, 'routing edge');
	} else if (edit.type === 'vca/set') {
		collections.vcas = setEntry(collections.vcas, edit.previousId, edit.vca, 'VCA');
	} else {
		collections.vcas = removeEntry(collections.vcas, edit.id, 'VCA');
	}
	const next = normalizeMixerGraphV21({ schemaVersion: graph.schemaVersion, ...collections });
	return Object.freeze({
		text: JSON.stringify(next, null, '\t'),
		validationError: validateGraph(project, next),
	});
}

function parseDocument(text: string): unknown {
	if (!text.trim()) throw new SyntaxError('The canonical mixer graph document is empty.');
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new SyntaxError('The canonical mixer graph document must be valid JSON.', { cause: error });
	}
}

function validateGraph(projectValue: unknown, graph: MixerGraphV21): string | null {
	try {
		const project = record(projectValue);
		const tracks = records(own(project, 'tracks'))
			.filter((track) => own(track, 'type') === 'audio')
			.flatMap((track) => {
				const id = text(own(track, 'id'));
				return id ? [Object.freeze({ id, effects: effectRecords(own(track, 'effects')) })] : [];
			});
		validateMixerGraphV21(graph, {
			audioTracks: Object.freeze(tracks),
			masterEffects: effectRecords(own(record(own(project, 'master')), 'effects')),
			masterChannels: positiveInteger(own(project, 'masterChannels'), 2),
			mixerNodeEffects: mixerNodeEffectsV21(graph),
		});
		return null;
	} catch (error) {
		return errorMessage(error);
	}
}

function sourceEndpointOptions(
	project: DataRecord | null,
	graph: MixerGraphV21,
): readonly SoundscaperRoutingEndpointOption<SoundscaperRoutingSource>[] {
	const options: SoundscaperRoutingEndpointOption<SoundscaperRoutingSource>[] = [];
	for (const track of records(own(project, 'tracks'))) {
		if (own(track, 'type') !== 'audio') continue;
		const id = text(own(track, 'id'));
		if (!id) continue;
		options.push(endpointOption(
			{ kind: 'track' as const, id }, `Track: ${text(own(track, 'name')) ?? id}`,
		));
	}
	for (const [collection, label] of NODE_COLLECTION_LABELS) {
		for (const node of graph[collection]) {
			options.push(endpointOption({ kind: 'mixer-node' as const, id: node.id }, `${label}: ${node.name || node.id}`));
		}
	}
	options.push(endpointOption({ kind: 'master' as const }, 'Master'));
	return Object.freeze(options);
}

function destinationEndpointOptions(
	project: DataRecord | null,
	graph: MixerGraphV21,
): readonly SoundscaperRoutingEndpointOption<SoundscaperRoutingDestination>[] {
	const options: SoundscaperRoutingEndpointOption<SoundscaperRoutingDestination>[] = [];
	for (const [collection, label] of NODE_COLLECTION_LABELS) {
		for (const node of graph[collection]) {
			options.push(endpointOption({ kind: 'mixer-node' as const, id: node.id }, `${label}: ${node.name || node.id}`));
		}
	}
	options.push(endpointOption({ kind: 'master' as const }, 'Master'));
	for (const output of graph.outputs) {
		options.push(endpointOption({ kind: 'output' as const, id: output.id }, `Output: ${output.name || output.id}`));
	}
	for (const target of sidechainTargets(project, graph)) options.push(target);
	return Object.freeze(options);
}

function vcaMemberOptions(
	project: DataRecord | null,
	graph: MixerGraphV21,
): readonly SoundscaperRoutingEndpointOption<StripRef>[] {
	const options: SoundscaperRoutingEndpointOption<StripRef>[] = [];
	for (const track of records(own(project, 'tracks'))) {
		if (own(track, 'type') !== 'audio') continue;
		const id = text(own(track, 'id'));
		if (id) options.push(endpointOption(
			{ kind: 'track' as const, id }, `Track: ${text(own(track, 'name')) ?? id}`,
		));
	}
	for (const [collection, label] of NODE_COLLECTION_LABELS) {
		for (const node of graph[collection]) {
			options.push(endpointOption({ kind: 'mixer-node' as const, id: node.id }, `${label}: ${node.name || node.id}`));
		}
	}
	options.push(endpointOption({ kind: 'master' as const }, 'Master'));
	return Object.freeze(options);
}

function sidechainTargets(
	project: DataRecord | null,
	graph: MixerGraphV21,
): readonly SoundscaperRoutingEndpointOption<MixerEffectSidechainEndpointV21>[] {
	const targets: SoundscaperRoutingEndpointOption<MixerEffectSidechainEndpointV21>[] = [];
	for (const track of records(own(project, 'tracks'))) {
		if (own(track, 'type') !== 'audio') continue;
		const id = text(own(track, 'id'));
		if (!id) continue;
		pushEffectTargets(targets, { kind: 'track', id }, `Track ${text(own(track, 'name')) ?? id}`, own(track, 'effects'));
	}
	pushEffectTargets(targets, { kind: 'master' }, 'Master', own(record(own(project, 'master')), 'effects'));
	for (const [collection, label] of NODE_COLLECTION_LABELS) {
		for (const node of graph[collection]) {
			pushEffectTargets(targets, { kind: 'mixer-node', id: node.id }, `${label} ${node.name || node.id}`, node.effects);
		}
	}
	return Object.freeze(targets);
}

function pushEffectTargets(
	targets: SoundscaperRoutingEndpointOption<MixerEffectSidechainEndpointV21>[],
	strip: StripRef,
	stripLabel: string,
	effectsValue: unknown,
): void {
	for (const effect of effectRecords(effectsValue)) {
		const effectId = text(own(effect, 'id'));
		if (!effectId) continue;
		targets.push(endpointOption(
			{ kind: 'effect-sidechain' as const, strip, effectId },
			`Sidechain: ${stripLabel} / ${effectId}`,
		));
	}
}

function endpointOption<Endpoint extends Readonly<Record<string, unknown>>>(
	endpoint: Endpoint,
	label: string,
): SoundscaperRoutingEndpointOption<Endpoint> {
	const frozenEndpoint = Object.freeze(endpoint);
	return Object.freeze({ value: JSON.stringify(frozenEndpoint), label, endpoint: frozenEndpoint });
}

function setEntry<T extends { readonly id: string }>(
	entries: readonly T[],
	previousId: string | null,
	entry: T,
	name: string,
): T[] {
	if (previousId === null) return [...entries, entry];
	const index = entries.findIndex(({ id }) => id === previousId);
	if (index < 0) throw new RangeError(`The ${name} ${previousId} no longer exists.`);
	const next = [...entries];
	next[index] = entry;
	return next;
}

function removeEntry<T extends { readonly id: string }>(entries: readonly T[], id: string, name: string): T[] {
	const index = entries.findIndex((entry) => entry.id === id);
	if (index < 0) throw new RangeError(`The ${name} ${id} no longer exists.`);
	return entries.filter((_entry, entryIndex) => entryIndex !== index);
}

function effectRecords(value: unknown): readonly DataRecord[] {
	return Object.freeze(records(value));
}

function records(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((item): item is DataRecord => item !== null) : [];
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function own(value: DataRecord | null, key: string): unknown {
	if (!value) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown, fallback: number): number {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const NODE_COLLECTION_LABELS: readonly (readonly [SoundscaperRoutingNodeCollection, string])[] = Object.freeze([
	Object.freeze(['groups', 'Group'] as const),
	Object.freeze(['sends', 'Send'] as const),
	Object.freeze(['cues', 'Cue'] as const),
]);
