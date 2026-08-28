/* SPDX-License-Identifier: AGPL-3.0-only */

import { deriveFolderBusOwnershipV13, reconcileFolderBusesV13 } from './folder-bus-v13.ts';
import { isSoundscaperProductionProject } from './project-schema-version.ts';
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
	persistedBase: DataRecord,
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
	// V21 replaces the single-layer legacy bus with its nested graph reconciler.
	if (!isSoundscaperProductionProject(draft)) {
		reconcileFolderBusesV13(draft);
	}
	assertAuthoredAdmOwnershipUnchanged(draft, persistedBase);
}

/**
 * An ADM authored programme pins its terminal strips: a routed track stops
 * being a terminal and its folder bus becomes one, so changing folder bus
 * ownership would silently invalidate authored bed assignments and only
 * surface at export. Authored projects therefore refuse the ownership change
 * at the command, with the folder edit as the actionable message.
 */
function assertAuthoredAdmOwnershipUnchanged(draft: DataRecord, persistedBase: DataRecord): void {
	const metadata = draft.metadata as Readonly<{ adm?: Readonly<{ mode?: unknown }> | null }> | undefined;
	if (metadata?.adm?.mode !== 'authored') return;
	if (ownershipSignature(draft) === ownershipSignature(persistedBase)) return;
	throw new RangeError(
		'An ADM authored programme pins its terminal strips; move tracks out of folders or switch ADM to passthrough before changing folder buses.',
	);
}

function ownershipSignature(project: DataRecord): string {
	const ownership = deriveFolderBusOwnershipV13(
		Array.isArray(project.sequences) ? project.sequences as Readonly<{ trackNodes?: unknown }>[] : [],
		Array.isArray(project.tracks) ? project.tracks as Readonly<{ id?: unknown; type?: unknown }>[] : [],
	);
	return JSON.stringify([
		ownership.busFolderIds,
		[...ownership.busFolderIdByAudioTrackId.entries()].sort(([left], [right]) => left.localeCompare(right)),
	]);
}
