/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact transient audio-only project scope for one selected Framescaper V15 sequence. */

import {
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
} from '../common/editor/mixer-graph-v21.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';

type DataRecord = Record<string, unknown>;

export interface FramescaperCompanionAudioProjectScopeV15 {
	/** Detached render input; it never aliases or mutates the persisted project. */
	readonly project: FramescaperProjectV28;
	/** Authored programme tracks owned by the selected sequence, sorted for binding. */
	readonly sequenceAudioTrackIds: readonly string[];
	/** Reserved for admitted silent controls; cross-sequence controls currently refuse. */
	readonly renderDependencyTrackIds: readonly string[];
}

/**
 * Narrow the ordinary mix planner to one sequence while retaining the selected
 * tracks' exact V21 mixer paths, shared buses, master, output, and automation.
 */
export function createFramescaperCompanionAudioProjectScopeV15(
	project: FramescaperProjectV28,
	sequenceId: string,
): FramescaperCompanionAudioProjectScopeV15 {
	const sequences = records(project.sequences, 'Framescaper sequences');
	const selected = uniqueRecordById(sequences, sequenceId, 'selected Framescaper sequence');
	const tracks = records(project.tracks, 'Framescaper tracks');
	const trackById = uniqueRecordsById(tracks, 'Framescaper track');
	assertExactSequenceTrackOwnership(sequences, trackById);

	const selectedTrackIds = strings(selected.trackIds, 'selected Framescaper sequence track IDs');
	const targetTracks = selectedTrackIds.map((trackId) => trackById.get(trackId)!)
		.filter((track) => track.type === 'audio');
	const sequenceAudioTrackIds = sortedIds(targetTracks, 'selected sequence audio track');
	if (sequenceAudioTrackIds.length === 0) {
		throw new RangeError('Selected Framescaper companion audio sequence has no audio tracks.');
	}

	const clipById = uniqueRecordsById(records(project.clips, 'Framescaper clips'), 'Framescaper clip');
	const clipOwners = clipOwnerIds(tracks);
	const renderClipIds = new Set<string>();
	for (const track of targetTracks) {
		const trackId = id(track, 'selected audio track');
		for (const clipId of strings(track.clipIds, `audio track ${trackId} clip IDs`)) {
			const clip = clipById.get(clipId);
			if (!clip || clip.kind !== 'audio') {
				throw new ReferenceError(`Companion audio track ${trackId} references non-audio clip ${clipId}.`);
			}
			if (clipOwners.get(clipId)?.length !== 1) {
				throw new RangeError(`Companion audio clip ${clipId} requires exactly one track owner.`);
			}
			renderClipIds.add(clipId);
		}
	}
	if (renderClipIds.size === 0) {
		throw new RangeError('Selected Framescaper companion audio sequence has no programme audio clips.');
	}

	const renderClips = [...renderClipIds].map((clipId) => clipById.get(clipId)!);
	const sourceIds = new Set(renderClips.map((clip) => idValue(clip.sourceId, 'audio clip source ID')));
	const sourceById = uniqueRecordsById(records(project.sources, 'Framescaper sources'), 'Framescaper source');
	for (const sourceId of sourceIds) {
		const source = sourceById.get(sourceId);
		if (!source || source.kind !== 'audio') {
			throw new ReferenceError(`Companion audio source ${sourceId} is not an audio source.`);
		}
	}

	const graphScope = selectedMixerGraph(normalizeMixerGraphV21(project.mixer), sequenceAudioTrackIds);
	const scoped = structuredClone(project) as unknown as DataRecord;
	scoped.tracks = targetTracks.map((track) => structuredClone(track));
	scoped.clips = renderClips.map((clip) => structuredClone(clip));
	scoped.sources = [...sourceIds].map((sourceId) => structuredClone(sourceById.get(sourceId)!));
	scoped.primarySequenceId = sequenceId;
	scoped.sequences = [{
		...structuredClone(selected),
		trackIds: [...sequenceAudioTrackIds],
		...(Array.isArray(selected.trackNodes) ? { trackNodes: [] } : {}),
	}];
	scoped.projectBin = { ...record(scoped.projectBin, 'Framescaper Project Bin'), clips: [] };
	scoped.trackFolders = [];
	scoped.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null };
	if (Array.isArray(scoped.timelineAnnotations)) {
		scoped.timelineAnnotations = records(scoped.timelineAnnotations, 'timeline annotations')
			.filter((annotation) => annotation.sequenceId === sequenceId);
	}
	scoped.mixer = graphScope.graph;
	scoped.automationLanes = records(scoped.automationLanes, 'automation lanes')
		.filter((lane) => laneSurvivesScope(lane, graphScope));

	return Object.freeze({
		project: deepFreeze(scoped) as unknown as FramescaperProjectV28,
		sequenceAudioTrackIds: Object.freeze(sequenceAudioTrackIds),
		renderDependencyTrackIds: Object.freeze([]),
	});
}

interface SelectedMixerGraphScope {
	readonly graph: MixerGraphV21;
	readonly edgeIds: ReadonlySet<string>;
	readonly stripKeys: ReadonlySet<string>;
}

function selectedMixerGraph(
	graph: MixerGraphV21,
	trackIds: readonly string[],
): SelectedMixerGraphScope {
	const reachable = new Set(trackIds.map((trackId) => `track:${trackId}`));
	const includedEdgeIds = new Set<string>();
	const includedOutputIds = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of graph.edges) {
			if (!edge.enabled || edge.kind === 'sidechain' || !reachable.has(endpointKey(edge.source))) continue;
			if (!includedEdgeIds.has(edge.id)) {
				includedEdgeIds.add(edge.id);
				changed = true;
			}
			if (edge.destination.kind === 'output') {
				includedOutputIds.add(edge.destination.id);
			} else if (edge.destination.kind !== 'effect-sidechain') {
				const destination = endpointKey(edge.destination);
				if (!reachable.has(destination)) {
					reachable.add(destination);
					changed = true;
				}
			}
		}
	}
	for (const edge of graph.edges) {
		if (!edge.enabled || edge.kind !== 'sidechain'
			|| edge.destination.kind !== 'effect-sidechain'
			|| !reachable.has(stripKey(edge.destination.strip))) continue;
		if (!reachable.has(endpointKey(edge.source))) {
			throw new RangeError(
				`Selected companion audio has a cross-sequence sidechain dependency at edge ${edge.id}.`,
			);
		}
		includedEdgeIds.add(edge.id);
	}
	const nodeIds = new Set([...reachable].flatMap((key) => (
		key.startsWith('mixer-node:') ? [key.slice('mixer-node:'.length)] : []
	)));
	const outputs = graph.outputs.filter((output) => includedOutputIds.has(output.id));
	if (outputs.filter(({ role }) => role === 'main').length !== 1) {
		throw new RangeError('Selected companion audio mixer paths do not reach exactly one main output.');
	}
	const strips = new Set([...reachable].filter((key) => (
		key === 'master' || key.startsWith('track:') || key.startsWith('mixer-node:')
	)));
	const scoped = normalizeMixerGraphV21({
		schemaVersion: graph.schemaVersion,
		groups: graph.groups.filter(({ id }) => nodeIds.has(id)),
		sends: graph.sends.filter(({ id }) => nodeIds.has(id)),
		cues: graph.cues.filter(({ id }) => nodeIds.has(id)),
		vcas: graph.vcas.flatMap((vca) => {
			const members = vca.members.filter((member) => strips.has(stripKey(member)));
			return members.length === 0 ? [] : [{ ...vca, members }];
		}),
		outputs,
		edges: graph.edges.filter(({ id }) => includedEdgeIds.has(id)),
	});
	return Object.freeze({ graph: scoped, edgeIds: includedEdgeIds, stripKeys: strips });
}

function laneSurvivesScope(lane: DataRecord, scope: SelectedMixerGraphScope): boolean {
	const address = record(lane.address, 'automation lane address');
	if (address.kind === 'edge') return scope.edgeIds.has(idValue(address.edgeId, 'automation edge ID'));
	if (address.kind !== 'strip' && address.kind !== 'effect') return false;
	return scope.stripKeys.has(stripKey(record(address.strip, 'automation strip')));
}

function assertExactSequenceTrackOwnership(
	sequences: readonly DataRecord[],
	trackById: ReadonlyMap<string, DataRecord>,
): void {
	const ownerByTrackId = new Map<string, string>();
	for (const sequence of sequences) {
		const sequenceId = id(sequence, 'Framescaper sequence');
		for (const trackId of strings(sequence.trackIds, `sequence ${sequenceId} track IDs`)) {
			if (!trackById.has(trackId)) throw new ReferenceError(`Sequence ${sequenceId} track ${trackId} is missing.`);
			if (ownerByTrackId.has(trackId)) {
				throw new RangeError(`Framescaper track ${trackId} has ambiguous sequence ownership.`);
			}
			ownerByTrackId.set(trackId, sequenceId);
		}
	}
	for (const trackId of trackById.keys()) if (!ownerByTrackId.has(trackId)) {
		throw new ReferenceError(`Framescaper track ${trackId} has no sequence owner.`);
	}
}

function endpointKey(endpoint: MixerEdgeV21['source'] | Exclude<MixerEdgeV21['destination'], { kind: 'effect-sidechain' | 'output' }>): string {
	return endpoint.kind === 'master' ? 'master' : `${endpoint.kind}:${endpoint.id}`;
}

function stripKey(strip: DataRecord | Readonly<{ kind: string; id?: string }>): string {
	if (strip.kind === 'master') return 'master';
	return `${String(strip.kind)}:${idValue(strip.id, 'mixer strip ID')}`;
}

function clipOwnerIds(tracks: readonly DataRecord[]): ReadonlyMap<string, readonly string[]> {
	const result = new Map<string, string[]>();
	for (const track of tracks) for (const clipId of strings(track.clipIds, 'track clip IDs')) {
		const owners = result.get(clipId) ?? [];
		owners.push(id(track, 'clip owner track'));
		result.set(clipId, owners);
	}
	return result;
}

function uniqueRecordById(values: readonly DataRecord[], targetId: string, name: string): DataRecord {
	const matches = values.filter((value) => id(value, name) === targetId);
	if (matches.length !== 1) throw new ReferenceError(`${name} ${targetId} must exist exactly once.`);
	return matches[0]!;
}

function uniqueRecordsById(values: readonly DataRecord[], name: string): ReadonlyMap<string, DataRecord> {
	const result = new Map<string, DataRecord>();
	for (const value of values) {
		const valueId = id(value, name);
		if (result.has(valueId)) throw new RangeError(`Duplicate ${name} ID ${valueId}.`);
		result.set(valueId, value);
	}
	return result;
}

function sortedIds(values: readonly DataRecord[], name: string): string[] {
	return values.map((value) => id(value, name)).sort((left, right) => left.localeCompare(right));
}

function strings(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry) => idValue(entry, name));
}

function records(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => record(entry, `${name}[${String(index)}]`));
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function id(value: DataRecord, name: string): string {
	return idValue(value.id, `${name} ID`);
}

function idValue(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} is invalid.`);
	return value;
}

function deepFreeze(value: unknown): unknown {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Array.isArray(value)
		? value : Object.values(value as DataRecord)) deepFreeze(child);
	return Object.freeze(value);
}
