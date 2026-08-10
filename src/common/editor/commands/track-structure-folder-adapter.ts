/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	insertTrackNodeV12,
	moveTrackNodeV12,
	resolveTrackNodeSpanV12,
	trackNodeLaneGroupsV12,
	type MutableHierarchySequenceV12,
	type MutableTrackNodeV12,
} from '../track-hierarchy-mutation-v12.ts';
import { FOLDER_AWARE_TRACK_STRUCTURE_EDIT } from './command-projection-transients.ts';

/**
 * Adapts the legacy flat-index track commands onto the folder hierarchy.
 * Project track order is the hierarchy preorder, so "insert at flat position
 * N" generalizes exactly to "insert beside the track currently at preorder
 * position N, under that track's own parent folder" — a stereo split placed
 * next to a foldered track lands inside the same folder, adjacent, without
 * any caller knowing folders exist.
 */

interface FolderedTrackProject extends Record<PropertyKey, unknown> {
	trackFolders?: readonly Readonly<{ readonly id?: unknown }>[];
	tracks: readonly Readonly<{ readonly id?: unknown; readonly laneGroupId?: unknown }>[];
	sequences: MutableHierarchySequenceV12[];
	primarySequenceId?: unknown;
}

export interface ExplicitTrackPlacement {
	readonly sequenceId?: string;
	readonly parentFolderId?: string | null;
	readonly parentIndex?: number;
}

export function hasNonemptyFolderHierarchy(project: object): boolean {
	const folders = (project as FolderedTrackProject).trackFolders;
	return Array.isArray(folders) && folders.length > 0;
}

/** Register a hierarchy node for a track the flat handler just appended. */
export function folderAwareInsertTrackNode(
	project: object,
	trackId: string,
	flatIndex: number | null | undefined,
	placement: ExplicitTrackPlacement,
): void {
	const candidate = markFolderAware(project);
	const node: MutableTrackNodeV12 = { kind: 'track', id: trackId, parentFolderId: null };
	if (placement.sequenceId !== undefined) {
		insertTrackNodeV12(candidate.sequences, {
			sequenceId: placement.sequenceId,
			node,
			parentFolderId: placement.parentFolderId ?? null,
			index: placement.parentIndex ?? Number.MAX_SAFE_INTEGER,
		});
		return;
	}
	const neighbor = flatIndex == null ? undefined : candidate.tracks[flatIndex];
	if (neighbor === undefined || String(neighbor.id) === trackId) {
		insertTrackNodeV12(candidate.sequences, {
			sequenceId: String(candidate.primarySequenceId),
			node,
			parentFolderId: null,
			index: Number.MAX_SAFE_INTEGER,
		});
		return;
	}
	const location = locateTrackNode(candidate.sequences, String(neighbor.id));
	insertTrackNodeV12(candidate.sequences, {
		sequenceId: location.sequence.id,
		node,
		parentFolderId: location.node.parentFolderId,
		index: directChildrenBefore(
			location.sequence.trackNodes,
			location.node.parentFolderId,
			location.nodeIndex,
		),
	});
}

/** Drop the hierarchy nodes of tracks the flat handler already removed. */
export function folderAwareRemoveTrackNodes(project: object, trackIds: readonly string[]): void {
	const candidate = markFolderAware(project);
	const removed = new Set(trackIds.map(String));
	for (const sequence of candidate.sequences) {
		if (!sequence.trackNodes.some((node) => removed.has(node.id))) continue;
		sequence.trackNodes = sequence.trackNodes.filter((node) => !removed.has(node.id));
		if (Array.isArray(sequence.trackIds)) {
			sequence.trackIds = sequence.trackIds.filter((id) => !removed.has(String(id)));
		}
	}
}

/**
 * Reorder one track (with its lane partner) to a flat destination, adopting
 * the destination neighbor's parent folder. Moving down inserts after the
 * neighbor's structural block, moving up inserts before it, mirroring the
 * legacy flat block semantics.
 */
export function folderAwareReorderTrack(
	project: object,
	trackId: string,
	flatIndex: number,
): void {
	const candidate = markFolderAware(project);
	const fromIndex = candidate.tracks.findIndex((track) => String(track.id) === trackId);
	const neighbor = candidate.tracks[flatIndex];
	if (neighbor === undefined) throw new RangeError('Track destination is out of bounds.');
	const laneGroups = trackNodeLaneGroupsV12(candidate.tracks);
	const source = locateTrackNode(candidate.sequences, trackId);
	const destination = locateTrackNode(candidate.sequences, String(neighbor.id));
	if (source.sequence.id !== destination.sequence.id) {
		throw new RangeError('Legacy track reorder cannot cross V12 sequence boundaries.');
	}
	const movedSpan = resolveTrackNodeSpanV12(source.sequence.trackNodes, trackId, laneGroups);
	if (destination.nodeIndex >= movedSpan.start && destination.nodeIndex < movedSpan.end) return;
	const neighborSpan = resolveTrackNodeSpanV12(
		destination.sequence.trackNodes,
		String(neighbor.id),
		laneGroups,
	);
	const movingDown = flatIndex > fromIndex;
	const boundary = movingDown ? neighborSpan.end : neighborSpan.start;
	const childIndex = directChildrenBefore(
		destination.sequence.trackNodes,
		destination.node.parentFolderId,
		boundary,
		movedSpan,
	);
	moveTrackNodeV12(candidate.sequences, {
		sequenceId: destination.sequence.id,
		nodeId: trackId,
		parentFolderId: destination.node.parentFolderId,
		index: childIndex,
	}, laneGroups);
}

function markFolderAware(project: object): FolderedTrackProject {
	const candidate = project as FolderedTrackProject;
	candidate[FOLDER_AWARE_TRACK_STRUCTURE_EDIT] = true;
	return candidate;
}

interface TrackNodeLocation {
	readonly sequence: MutableHierarchySequenceV12;
	readonly node: MutableTrackNodeV12;
	readonly nodeIndex: number;
}

function locateTrackNode(
	sequences: readonly MutableHierarchySequenceV12[],
	nodeId: string,
): TrackNodeLocation {
	for (const sequence of sequences) {
		const nodeIndex = sequence.trackNodes.findIndex((node) => node.id === nodeId);
		if (nodeIndex >= 0) return { sequence, node: sequence.trackNodes[nodeIndex], nodeIndex };
	}
	throw new ReferenceError(`Track ${nodeId} is not part of any sequence.`);
}

function directChildrenBefore(
	nodes: readonly MutableTrackNodeV12[],
	parentFolderId: string | null,
	boundary: number,
	excluded?: Readonly<{ readonly start: number; readonly end: number }>,
): number {
	let count = 0;
	for (let index = 0; index < boundary && index < nodes.length; index += 1) {
		if (excluded && index >= excluded.start && index < excluded.end) continue;
		if (nodes[index].parentFolderId === parentFolderId) count += 1;
	}
	return count;
}
