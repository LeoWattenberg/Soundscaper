/* SPDX-License-Identifier: AGPL-3.0-only */

interface TrackHierarchyNode {
	readonly kind: 'folder' | 'track';
	readonly id: string;
	readonly parentFolderId: string | null;
}

interface TrackHierarchyProject {
	readonly primarySequenceId?: string;
	readonly sequences?: readonly Readonly<{
		readonly id: string;
		readonly trackNodes: readonly TrackHierarchyNode[];
	}>[];
}

/** Capture a track's sequence and child-relative position for derived tracks. */
export function trackHierarchyPlacement(project: object, trackId: string, offset = 0, supportsTrackFolders = true): Readonly<{
	sequenceId?: string; parentFolderId?: string | null; parentIndex?: number;
}> {
	const hierarchy = project as TrackHierarchyProject;
	for (const sequence of hierarchy.sequences ?? []) {
		const index = sequence.trackNodes.findIndex(node => node.kind === 'track' && node.id === trackId);
		if (index < 0) continue;
		const parentFolderId = sequence.trackNodes[index]!.parentFolderId;
		const parentIndex = sequence.trackNodes.slice(0, index)
			.filter(node => node.parentFolderId === parentFolderId).length;
		return { ...(sequence.id !== hierarchy.primarySequenceId ? { sequenceId: sequence.id } : {}),
			...(supportsTrackFolders ? { parentFolderId, parentIndex: parentIndex + offset } : {}) };
	}
	return {};
}
