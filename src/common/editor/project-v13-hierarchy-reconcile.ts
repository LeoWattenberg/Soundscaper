/* SPDX-License-Identifier: AGPL-3.0-only */

import { reconcileFolderBusesV13 } from './folder-bus-v13.ts';
import { orderByHierarchyPreorderV12 } from './track-hierarchy-mutation-v12.ts';
import { deriveTrackHierarchyOrderV12 } from './track-hierarchy-v12.ts';

type DataRecord = Record<string, unknown>;

/**
 * Reconcile a draft mutated by folder-aware structural commands: the sequence
 * node lists are authoritative, so the project-wide folder and track arrays are
 * re-derived into exact hierarchy preorder, and folder bus ownership, mirrored
 * bus identity, and mixer routes are brought back into agreement in the same
 * commit. Divergence between the node lists and the project records is an
 * error here, never a repair.
 */
export function reconcileFolderAwareTrackHierarchy(
	draft: DataRecord,
	sequences: readonly DataRecord[],
): void {
	const order = deriveTrackHierarchyOrderV12(sequences.map((sequence) => ({
		id: sequence.id,
		trackNodes: sequence.trackNodes,
		trackIds: sequence.trackIds,
	})));
	draft.trackFolders = orderByHierarchyPreorderV12(
		draft.trackFolders as readonly Readonly<{ readonly id?: unknown }>[],
		order.folderIds,
	);
	draft.tracks = orderByHierarchyPreorderV12(
		draft.tracks as readonly Readonly<{ readonly id?: unknown }>[],
		order.trackIds,
	);
	reconcileFolderBusesV13(draft);
}
