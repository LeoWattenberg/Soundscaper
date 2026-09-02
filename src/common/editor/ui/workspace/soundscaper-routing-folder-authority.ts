/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerEdgeV21, MixerGraphV21 } from '../../mixer-graph-v21.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface RoutingFolderAuthority {
	readonly canonicalEdgeIds: ReadonlySet<string>;
	readonly ownedFolderIds: ReadonlySet<string>;
}

export function isSoundscaperFolderOwnedRoutingNode(
	projectValue: unknown,
	collection: string,
	id: string,
): boolean {
	return collection === 'groups' && routingFolderAuthority(projectValue).ownedFolderIds.has(id);
}

export function isSoundscaperFolderOwnedRoutingEdge(
	projectValue: unknown,
	edge: Pick<MixerEdgeV21, 'id'>,
): boolean {
	return routingFolderAuthority(projectValue).canonicalEdgeIds.has(edge.id);
}

export function assertSoundscaperRoutingNodeEditable(
	projectValue: unknown,
	collection: string,
	id: string,
): void {
	if (isSoundscaperFolderOwnedRoutingNode(projectValue, collection, id)) {
		throw new TypeError(`Mixer group ${id} is managed by its track folder and cannot be edited in the routing graph.`);
	}
}

export function assertSoundscaperRoutingEdgeEditable(
	projectValue: unknown,
	edge: Pick<MixerEdgeV21, 'id'>,
): void {
	if (isSoundscaperFolderOwnedRoutingEdge(projectValue, edge)) {
		throw new TypeError(`Mixer connection ${edge.id} is managed by the track-folder hierarchy and cannot be edited in the routing graph.`);
	}
}

export function validateSoundscaperRoutingFolderAuthority(
	projectValue: unknown,
	graph: MixerGraphV21,
): true {
	const project = record(projectValue);
	const baseline = record(project?.mixer);
	if (!baseline) return true;
	const authority = routingFolderAuthority(projectValue);
	const baselineGroups = records(baseline.groups);
	for (const id of authority.ownedFolderIds) {
		const previous = baselineGroups.find((group) => group.id === id);
		if (!previous) continue;
		const candidate = graph.groups.find((group) => group.id === id);
		if (!candidate || candidate.name !== previous.name || candidate.channelCount !== previous.channelCount) {
			throw new TypeError(`Mixer group ${id} is managed by its track folder and cannot be edited in the routing graph.`);
		}
	}
	const baselineEdges = records(baseline.edges);
	for (const id of authority.canonicalEdgeIds) {
		const previous = baselineEdges.find((edge) => edge.id === id);
		if (!previous) continue;
		const candidate = graph.edges.find((edge) => edge.id === id);
		if (!candidate || routingEdgeAuthorityKey(candidate) !== routingEdgeAuthorityKey(previous)) {
			throw new TypeError(`Mixer connection ${id} is managed by the track-folder hierarchy and cannot be edited in the routing graph.`);
		}
	}
	return true;
}

function routingFolderAuthority(projectValue: unknown): RoutingFolderAuthority {
	const project = record(projectValue);
	const audioTrackIds = records(project?.tracks).flatMap((track) => (
		track.type === 'audio' && typeof track.id === 'string' ? [track.id] : []
	));
	const folderIds = new Set(records(project?.trackFolders).flatMap((folder) => (
		typeof folder.id === 'string' ? [folder.id] : []
	)));
	const parentByFolder = new Map<string, string | null>();
	const parentByTrack = new Map<string, string | null>();
	for (const sequence of records(project?.sequences)) for (const node of records(sequence.trackNodes)) {
		if (typeof node.id !== 'string') continue;
		const parent = node.parentFolderId === null || node.parentFolderId === undefined
			? null : String(node.parentFolderId);
		if (node.kind === 'folder' && folderIds.has(node.id)) parentByFolder.set(node.id, parent);
		else if (node.kind === 'track') parentByTrack.set(node.id, parent);
	}
	const ownedFolderIds = new Set<string>();
	for (const trackId of audioTrackIds) {
		walkFolders(parentByTrack.get(trackId) ?? null, parentByFolder, ownedFolderIds);
	}
	const canonicalEdgeIds = new Set<string>();
	for (const trackId of audioTrackIds) {
		const parent = parentByTrack.get(trackId) ?? null;
		canonicalEdgeIds.add(assignmentId(
			{ kind: 'track', id: trackId },
			parent === null ? { kind: 'master' } : { kind: 'mixer-node', id: parent },
		));
	}
	for (const folderId of ownedFolderIds) {
		let parent = parentByFolder.get(folderId) ?? null;
		const seen = new Set<string>();
		while (parent !== null && !ownedFolderIds.has(parent) && !seen.has(parent)) {
			seen.add(parent);
			parent = parentByFolder.get(parent) ?? null;
		}
		canonicalEdgeIds.add(assignmentId(
			{ kind: 'mixer-node', id: folderId },
			parent === null ? { kind: 'master' } : { kind: 'mixer-node', id: parent },
		));
	}
	return { canonicalEdgeIds, ownedFolderIds };
}

function walkFolders(
	start: string | null,
	parents: ReadonlyMap<string, string | null>,
	result: Set<string>,
): void {
	let folderId = start;
	const seen = new Set<string>();
	while (folderId !== null && !seen.has(folderId)) {
		seen.add(folderId);
		result.add(folderId);
		folderId = parents.get(folderId) ?? null;
	}
}

function assignmentId(
	source: Readonly<{ kind: 'track' | 'mixer-node'; id: string }>,
	destination: Readonly<{ kind: 'master' } | { kind: 'mixer-node'; id: string }>,
): string {
	const destinationId = destination.kind === 'master' ? 'master' : `mixer-node:${destination.id}`;
	return `assignment:${source.kind}:${source.id}:${destinationId}`;
}

function routingEdgeAuthorityKey(edgeValue: unknown): string {
	const edge = record(edgeValue);
	return JSON.stringify([
		edge?.id, edge?.kind, edge?.source, edge?.destination,
		edge?.position, edge?.level, edge?.enabled, edge?.channelMap,
	]);
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function records(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((entry): entry is DataRecord => entry !== null) : [];
}
