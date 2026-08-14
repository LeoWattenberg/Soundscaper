/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeMixerGraphV21,
	type MixerEdgeV21,
	type MixerGraphV21,
	type MixerStripV21,
} from './mixer-graph-v21.ts'

interface FolderMixerProjectV21 {
	readonly masterChannels: number
	readonly tracks: readonly { readonly id?: unknown; readonly type?: unknown }[]
	readonly trackFolders: readonly { readonly id?: unknown; readonly name?: unknown }[]
	readonly sequences: readonly { readonly trackNodes?: unknown }[]
}

interface FolderMixerAuthorityV21 {
	readonly audioTrackIds: readonly string[]
	readonly folderOrder: readonly string[]
	readonly folderNames: ReadonlyMap<string, string>
	readonly folderIds: ReadonlySet<string>
	readonly owningFolders: ReadonlySet<string>
	readonly parentByFolder: ReadonlyMap<string, string | null>
	readonly parentByTrack: ReadonlyMap<string, string | null>
}

/**
 * Reconcile only folder-owned V21 groups and canonical assignment edges.
 * Authored parallel routes keep their independent IDs; the deterministic
 * `assignment:*` identity remains the hierarchy authority.
 */
export function reconcileFolderMixerGraphV21(
	project: FolderMixerProjectV21,
	graphValue: MixerGraphV21,
): MixerGraphV21 {
	const graph = normalizeMixerGraphV21(graphValue)
	const authority = deriveAuthority(project)
	const existingById = new Map(graph.groups.map((group) => [group.id, group]))
	const ordinaryGroups = graph.groups.filter((group) => !authority.folderIds.has(group.id))
	const folderGroups = authority.folderOrder
		.filter((folderId) => authority.owningFolders.has(folderId))
		.map((folderId) => folderStrip(
			existingById.get(folderId),
			folderId,
			authority.folderNames.get(folderId) ?? folderId,
			project.masterChannels,
		))
	const retainedNodeIds = new Set([
		...ordinaryGroups.map(({ id }) => id),
		...folderGroups.map(({ id }) => id),
		...graph.sends.map(({ id }) => id),
		...graph.cues.map(({ id }) => id),
	])
	const desiredAssignments: MixerEdgeV21[] = []
	for (const trackId of authority.audioTrackIds) {
		const parentId = authority.parentByTrack.get(trackId) ?? null
		desiredAssignments.push(folderAssignment(
			{ kind: 'track', id: trackId },
			parentId === null ? { kind: 'master' } : { kind: 'mixer-node', id: parentId },
		))
	}
	for (const folderId of authority.folderOrder) {
		if (!authority.owningFolders.has(folderId)) continue
		let parentId = authority.parentByFolder.get(folderId) ?? null
		while (parentId !== null && !authority.owningFolders.has(parentId)) {
			parentId = authority.parentByFolder.get(parentId) ?? null
		}
		desiredAssignments.push(folderAssignment(
			{ kind: 'mixer-node', id: folderId },
			parentId === null ? { kind: 'master' } : { kind: 'mixer-node', id: parentId },
		))
	}
	const desiredAssignmentIds = new Set(desiredAssignments.map(({ id }) => id))
	const edges = graph.edges.filter((edge) => (
		edgeEndpointsRetained(edge, retainedNodeIds)
		&& (!isCanonicalFolderAssignment(edge, authority) || desiredAssignmentIds.has(edge.id))
	))
	const retainedEdgeIds = new Set(edges.map(({ id }) => id))
	const groupedTrackIds = new Set(edges.flatMap((edge) => (
		edge.kind === 'assignment' && edge.enabled
			&& edge.source.kind === 'track' && edge.destination.kind === 'mixer-node'
			? [edge.source.id]
			: []
	)))
	for (const assignment of desiredAssignments) {
		if (retainedEdgeIds.has(assignment.id)) continue
		// A track the user routed into a group already reaches the mix through it, so the
		// folder fallback to master would double its signal rather than restore it.
		if (assignment.source.kind === 'track' && assignment.destination.kind === 'master'
			&& groupedTrackIds.has(assignment.source.id)) continue
		edges.push(assignment)
	}
	const vcas = graph.vcas.map((vca) => Object.freeze({
		...vca,
		members: Object.freeze(vca.members.filter((member) => (
			member.kind !== 'mixer-node' || retainedNodeIds.has(member.id)
		))),
	}))
	return normalizeMixerGraphV21({
		...graph,
		groups: [...ordinaryGroups, ...folderGroups],
		vcas,
		edges,
	})
}

/** Validate the folder authority split after V21 lifts the single-bus-layer limit. */
export function validateFolderMixerGraphV21(
	project: FolderMixerProjectV21,
	graph: MixerGraphV21,
): true {
	const audioTrackIds = new Set(project.tracks
		.filter((track) => track.type === 'audio')
		.map((track) => String(track.id)))
	const folderNames = new Map(project.trackFolders.map((folder) => [
		String(folder.id),
		String(folder.name),
	]))
	const parentByFolder = new Map<string, string | null>()
	const parentByTrack = new Map<string, string | null>()
	for (const sequence of project.sequences) {
		if (!Array.isArray(sequence.trackNodes)) throw new TypeError('V21 sequence.trackNodes must be an array')
		for (const value of sequence.trackNodes) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				throw new TypeError('V21 sequence track node must be an object')
			}
			const node = value as Readonly<Record<string, unknown>>
			const id = String(node.id)
			const parent = node.parentFolderId === null ? null : String(node.parentFolderId)
			if (node.kind === 'folder') parentByFolder.set(id, parent)
			else if (node.kind === 'track') parentByTrack.set(id, parent)
		}
	}
	const owningFolders = new Set<string>()
	for (const trackId of audioTrackIds) {
		let folderId = parentByTrack.get(trackId) ?? null
		const seen = new Set<string>()
		while (folderId !== null) {
			if (seen.has(folderId)) throw new RangeError('V21 folder hierarchy contains a cycle')
			seen.add(folderId)
			owningFolders.add(folderId)
			folderId = parentByFolder.get(folderId) ?? null
		}
	}
	const groupById = new Map(graph.groups.map((group) => [group.id, group]))
	for (const folderId of owningFolders) {
		const group = groupById.get(folderId)
		if (!group) throw new ReferenceError(`Track folder ${folderId} contains audio and must own a V21 group`)
		if (group.name !== folderNames.get(folderId)) {
			throw new RangeError(`V21 group ${folderId} must mirror its track folder name`)
		}
		if (group.mute || group.solo) {
			throw new RangeError(`V21 group ${folderId} must leave mute and solo authority to its folder`)
		}
	}
	for (const group of graph.groups) {
		if (folderNames.has(group.id) && !owningFolders.has(group.id)) {
			throw new RangeError(`V21 group ${group.id} names a folder that owns no audio bus`)
		}
	}
	for (const node of [...graph.sends, ...graph.cues]) {
		if (folderNames.has(node.id)) throw new RangeError(`V21 ${node.id} reuses a track folder ID`)
	}
	for (const vca of graph.vcas) {
		if (folderNames.has(vca.id)) throw new RangeError(`V21 VCA ${vca.id} reuses a track folder ID`)
	}
	const hasAssignment = (sourceKind: 'track' | 'mixer-node', sourceId: string, destinationId: string): boolean => (
		graph.edges.some((edge) => (
			edge.enabled
			&& edge.kind === 'assignment'
			&& edge.source.kind === sourceKind
			&& edge.source.id === sourceId
			&& edge.destination.kind === 'mixer-node'
			&& edge.destination.id === destinationId
		))
	)
	for (const trackId of audioTrackIds) {
		const folderId = parentByTrack.get(trackId) ?? null
		if (folderId !== null && !hasAssignment('track', trackId, folderId)) {
			throw new RangeError(`Audio track ${trackId} must feed its owning V21 folder group ${folderId}`)
		}
	}
	for (const folderId of owningFolders) {
		let parent = parentByFolder.get(folderId) ?? null
		while (parent !== null && !owningFolders.has(parent)) parent = parentByFolder.get(parent) ?? null
		if (parent !== null && !hasAssignment('mixer-node', folderId, parent)) {
			throw new RangeError(`Nested V21 folder group ${folderId} must feed parent group ${parent}`)
		}
	}
	return true
}

function deriveAuthority(project: FolderMixerProjectV21): FolderMixerAuthorityV21 {
	const audioTrackIds = project.tracks
		.filter((track) => track.type === 'audio')
		.map((track) => String(track.id))
	const folderNames = new Map(project.trackFolders.map((folder) => [
		String(folder.id),
		String(folder.name),
	]))
	const folderOrder: string[] = []
	const parentByFolder = new Map<string, string | null>()
	const parentByTrack = new Map<string, string | null>()
	for (const sequence of project.sequences) {
		if (!Array.isArray(sequence.trackNodes)) throw new TypeError('V21 sequence.trackNodes must be an array')
		for (const value of sequence.trackNodes) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				throw new TypeError('V21 sequence track node must be an object')
			}
			const node = value as Readonly<Record<string, unknown>>
			const id = String(node.id)
			const parent = node.parentFolderId === null ? null : String(node.parentFolderId)
			if (node.kind === 'folder') {
				if (!parentByFolder.has(id)) folderOrder.push(id)
				parentByFolder.set(id, parent)
			} else if (node.kind === 'track') parentByTrack.set(id, parent)
		}
	}
	const owningFolders = new Set<string>()
	for (const trackId of audioTrackIds) {
		let folderId = parentByTrack.get(trackId) ?? null
		const seen = new Set<string>()
		while (folderId !== null) {
			if (seen.has(folderId)) throw new RangeError('V21 folder hierarchy contains a cycle')
			seen.add(folderId)
			owningFolders.add(folderId)
			folderId = parentByFolder.get(folderId) ?? null
		}
	}
	return Object.freeze({
		audioTrackIds: Object.freeze(audioTrackIds),
		folderOrder: Object.freeze(folderOrder),
		folderNames,
		folderIds: new Set(folderNames.keys()),
		owningFolders,
		parentByFolder,
		parentByTrack,
	})
}

function folderStrip(
	existing: MixerStripV21 | undefined,
	id: string,
	name: string,
	channelCount: number,
): MixerStripV21 {
	return Object.freeze({
		id,
		name,
		color: existing?.color ?? '#4f87c8',
		gain: existing?.gain ?? 1,
		pan: existing?.pan ?? 0,
		mute: false,
		solo: false,
		collapsed: existing?.collapsed ?? true,
		effectsActive: existing?.effectsActive ?? true,
		effects: existing?.effects ?? Object.freeze([]),
		channelCount: existing?.channelCount ?? channelCount,
	})
}

function folderAssignment(
	source: MixerEdgeV21['source'],
	destination: Exclude<MixerEdgeV21['destination'], { readonly kind: 'effect-sidechain' }>,
): MixerEdgeV21 {
	const sourceId = source.kind === 'master' ? 'master' : `${source.kind}:${source.id}`
	const destinationId = destination.kind === 'master'
		? 'master'
		: `${destination.kind}:${destination.id}`
	return Object.freeze({
		id: `assignment:${sourceId}:${destinationId}`,
		kind: 'assignment',
		source: Object.freeze(source),
		destination: Object.freeze(destination),
		position: 'post-fader',
		level: 1,
		enabled: true,
		channelMap: Object.freeze([]),
	})
}

function isCanonicalFolderAssignment(
	edge: MixerEdgeV21,
	authority: FolderMixerAuthorityV21,
): boolean {
	if (edge.kind !== 'assignment' || edge.destination.kind === 'effect-sidechain') return false
	if (edge.source.kind === 'track' && authority.audioTrackIds.includes(edge.source.id)) {
		// Folder authority owns a track's route to master or to a folder bus. A route to
		// an ordinary group is the user's own mix routing, which the legacy mixer surface
		// authors under this same identity, so claiming it would discard their assignment.
		if (edge.destination.kind === 'mixer-node' && !authority.folderIds.has(edge.destination.id)) {
			return false
		}
		return edge.id === folderAssignment(edge.source, edge.destination).id
	}
	if (edge.source.kind === 'mixer-node' && authority.folderIds.has(edge.source.id)) {
		return edge.id === folderAssignment(edge.source, edge.destination).id
	}
	return false
}

function edgeEndpointsRetained(edge: MixerEdgeV21, retainedNodeIds: ReadonlySet<string>): boolean {
	if (edge.source.kind === 'mixer-node' && !retainedNodeIds.has(edge.source.id)) return false
	if (edge.destination.kind === 'mixer-node' && !retainedNodeIds.has(edge.destination.id)) return false
	if (edge.destination.kind === 'effect-sidechain'
		&& edge.destination.strip.kind === 'mixer-node'
		&& !retainedNodeIds.has(edge.destination.strip.id)) return false
	return true
}
