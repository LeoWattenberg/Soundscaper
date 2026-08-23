/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAutomationLaneV21,
	type AutomationLaneV21,
} from '../common/editor/automation-lane-v21.ts';
import {
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
	type MixerStripV21,
} from '../common/editor/mixer-graph-v21.ts';
import type { StripRef } from '../common/editor/parameter-address.ts';
import {
	createDefaultFramescaperAudioFinishingV27,
	normalizeFramescaperAudioFinishingV27,
	type FramescaperAudioFinishingV27,
} from './editor-audio-finishing-v27.ts';

/**
 * Reconcile only references invalidated by an inherited structural edit. The
 * selected V27 mixer is authored state: unrelated nodes, routes, output names,
 * VCA membership, and automation must never disappear because one track did.
 */
export function reconcileFramescaperAudioFinishingV27(
	project: Readonly<Record<string, unknown>>,
	value: Readonly<{ readonly automationLanes: unknown; readonly mixer: unknown }>,
): FramescaperAudioFinishingV27 {
	const mixer = normalizeMixerGraphV21(value.mixer);
	const refs = projectReferences(project, mixer);
	const edges = mixer.edges.filter((edge) => edgeExists(edge, refs));
	addRoutesForNewTracks(project, edges);
	const edgeIds = new Set(edges.map(({ id }) => id));
	const reconciledMixer = normalizeMixerGraphV21({
		...mixer,
		vcas: mixer.vcas.map((vca) => ({
			...vca,
			members: vca.members.filter((member) => stripExists(member, refs)),
		})),
		edges,
	});
	const automationLanes = automationArray(value.automationLanes)
		.map((lane) => normalizeAutomationLaneV21(lane))
		.filter((lane) => laneExists(lane, edgeIds, refs));
	return normalizeFramescaperAudioFinishingV27(project, {
		automationLanes,
		mixer: reconciledMixer,
	});
}

interface ProjectAudioReferencesV27 {
	readonly tracks: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
	readonly nodes: ReadonlyMap<string, MixerStripV21>;
	readonly outputs: ReadonlySet<string>;
	readonly master: Readonly<Record<string, unknown>>;
}

function projectReferences(
	project: Readonly<Record<string, unknown>>,
	mixer: MixerGraphV21,
): ProjectAudioReferencesV27 {
	return Object.freeze({
		tracks: new Map(records(project.tracks, 'project.tracks')
			.filter(({ type }) => type === 'audio')
			.map((track) => [id(track, 'audio track'), track])),
		nodes: new Map([...mixer.groups, ...mixer.sends, ...mixer.cues]
			.map((node) => [node.id, node])),
		outputs: new Set(mixer.outputs.map(({ id: outputId }) => outputId)),
		master: record(project.master, 'project.master'),
	});
}

function edgeExists(edge: MixerEdgeV21, refs: ProjectAudioReferencesV27): boolean {
	if (!endpointExists(edge.source, refs)) return false;
	const destination = edge.destination;
	if (destination.kind === 'effect-sidechain') {
		return stripExists(destination.strip, refs)
			&& effectExists(destination.strip, destination.effectId, refs);
	}
	return endpointExists(destination, refs);
}

function endpointExists(
	endpoint: Exclude<MixerEdgeV21['destination'], { readonly kind: 'effect-sidechain' }>
		| MixerEdgeV21['source'],
	refs: ProjectAudioReferencesV27,
): boolean {
	if (endpoint.kind === 'master') return true;
	if (endpoint.kind === 'track') return refs.tracks.has(endpoint.id);
	if (endpoint.kind === 'mixer-node') return refs.nodes.has(endpoint.id);
	return refs.outputs.has(endpoint.id);
}

function stripExists(strip: StripRef, refs: ProjectAudioReferencesV27): boolean {
	if (strip.kind === 'master') return true;
	return strip.kind === 'track' ? refs.tracks.has(strip.id) : refs.nodes.has(strip.id);
}

function effectExists(
	strip: StripRef,
	effectId: string,
	refs: ProjectAudioReferencesV27,
): boolean {
	const owner = strip.kind === 'master' ? refs.master
		: strip.kind === 'track' ? refs.tracks.get(strip.id) : refs.nodes.get(strip.id);
	return owner !== undefined && records(owner.effects, 'audio finishing effects')
		.some(({ id: candidateId }) => candidateId === effectId);
}

function laneExists(
	lane: AutomationLaneV21,
	edgeIds: ReadonlySet<string>,
	refs: ProjectAudioReferencesV27,
): boolean {
	if (lane.address.kind === 'edge') return edgeIds.has(lane.address.edgeId);
	if (!stripExists(lane.address.strip, refs)) return false;
	return lane.address.kind !== 'effect'
		|| effectExists(lane.address.strip, lane.address.effectId, refs);
}

function addRoutesForNewTracks(
	project: Readonly<Record<string, unknown>>,
	edges: MixerEdgeV21[],
): void {
	const routedTrackIds = new Set(edges.flatMap((edge) => (
		edge.source.kind === 'track' ? [edge.source.id] : []
	)));
	const defaults = createDefaultFramescaperAudioFinishingV27(project).mixer.edges;
	for (const edge of defaults) {
		if (edge.source.kind !== 'track' || routedTrackIds.has(edge.source.id)) continue;
		edges.push(edge);
		routedTrackIds.add(edge.source.id);
	}
}

function automationArray(value: unknown): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError('V27 automation lanes must be an array.');
	return value;
}

function id(value: Readonly<Record<string, unknown>>, name: string): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError(`${name}.id must be non-empty.`);
	return value.id;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown, name: string): Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
