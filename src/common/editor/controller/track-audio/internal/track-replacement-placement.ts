/* SPDX-License-Identifier: AGPL-3.0-only */

interface TrackReplacementNode {
	readonly kind: 'folder' | 'track';
	readonly id: string;
	readonly parentFolderId: string | null;
}

interface TrackReplacementProject {
	readonly primarySequenceId?: string;
	readonly sequences?: readonly Readonly<{
		readonly id: string;
		readonly trackNodes: readonly TrackReplacementNode[];
	}>[];
}

interface TrackReplacementPlacement {
	readonly sequenceId?: string;
	readonly parentFolderId?: string | null;
	readonly parentIndex?: number;
}

/** Capture a track's hierarchy position before its replacement removes it. */
export function trackReplacementPlacement(
	project: object,
	trackId: string,
	offset = 0,
): TrackReplacementPlacement {
	const hierarchy = project as TrackReplacementProject;
	for (const sequence of hierarchy.sequences ?? []) {
		const index = sequence.trackNodes.findIndex((node) => node.kind === 'track' && node.id === trackId);
		if (index < 0) continue;
		const parentFolderId = sequence.trackNodes[index]!.parentFolderId;
		const parentIndex = sequence.trackNodes.slice(0, index)
			.filter((node) => node.parentFolderId === parentFolderId).length;
		return { ...(sequence.id !== hierarchy.primarySequenceId ? { sequenceId: sequence.id } : {}),
			parentFolderId, parentIndex: parentIndex + offset };
	}
	return {};
}
