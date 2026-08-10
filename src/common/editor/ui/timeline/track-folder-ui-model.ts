/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DocumentTrackFolderSnapshot,
} from '../../controller/document-track-folder-snapshot.ts';
import type { TrackFolderStateNodeV12 } from '../../track-folder-state-projection.ts';

/**
 * Pure planning for the timeline's folder tree. Ordering comes only from the
 * snapshot rows, which mirror the trackNodes preorder — the UI introduces no
 * second ordering authority. Folder rows form an ARIA tree of folders whose
 * flattened DOM order is conveyed through level, position, and set size;
 * track rows keep their existing flat DOM contract and are merely suppressed
 * beneath a collapsed ancestor.
 */

export interface TrackFolderRowUiModel {
	readonly id: string;
	readonly sequenceId: string;
	readonly name: string;
	readonly parentFolderId: string | null;
	readonly level: number;
	readonly posInSet: number;
	readonly setSize: number;
	readonly collapsed: boolean;
	readonly hidden: boolean;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly hasAudioDescendant: boolean;
	readonly rowHidden: boolean;
	readonly domId: string;
}

export type TrackListRowPlanEntry =
	| Readonly<{ kind: 'folder'; row: TrackFolderRowUiModel }>
	| Readonly<{ kind: 'track'; trackId: string; rowHidden: boolean }>;

export interface TrackListRowPlan {
	readonly hasFolders: boolean;
	readonly entries: readonly TrackListRowPlanEntry[];
	readonly folderRows: readonly TrackFolderRowUiModel[];
	readonly treeOwnedIds: string;
}

const EMPTY_PLAN_ENTRIES: readonly TrackListRowPlanEntry[] = Object.freeze([]);

export function trackFolderRowDomId(folderId: string): string {
	return `audio-editor-track-folder-row-${folderId}`;
}

/** Plan the interleaved row list for the track list from the document snapshot. */
export function planTrackListRows(
	snapshot: DocumentTrackFolderSnapshot | null | undefined,
	tracks: readonly Readonly<{ readonly id: string }>[],
	folders: readonly Readonly<{ readonly id: string; readonly name: string }>[] = [],
): TrackListRowPlan {
	if (!snapshot || snapshot.sequences.length === 0) {
		return Object.freeze({
			hasFolders: false,
			entries: tracks.length === 0 ? EMPTY_PLAN_ENTRIES : Object.freeze(
				tracks.map(({ id }) => Object.freeze({ kind: 'track' as const, trackId: id, rowHidden: false })),
			),
			folderRows: Object.freeze([]),
			treeOwnedIds: '',
		});
	}
	const entries: TrackListRowPlanEntry[] = [];
	const folderRows: TrackFolderRowUiModel[] = [];
	const nameByFolderId = new Map(folders.map(({ id, name }) => [id, name]));
	for (const sequence of snapshot.sequences) {
		const siblingCounts = countFolderSiblings(sequence.rows);
		const siblingCursor = new Map<string, number>();
		for (const row of sequence.rows) {
			if (row.kind !== 'folder') {
				entries.push(Object.freeze({ kind: 'track' as const, trackId: row.id, rowHidden: row.rowHidden }));
				continue;
			}
			const siblingKey = row.parentFolderId ?? '';
			const position = (siblingCursor.get(siblingKey) ?? 0) + 1;
			siblingCursor.set(siblingKey, position);
			const model: TrackFolderRowUiModel = Object.freeze({
				id: row.id,
				sequenceId: sequence.sequenceId,
				name: nameByFolderId.get(row.id) ?? row.id,
				parentFolderId: row.parentFolderId,
				level: row.depth + 1,
				posInSet: position,
				setSize: siblingCounts.get(siblingKey) ?? position,
				collapsed: row.collapsed,
				hidden: row.hidden,
				mute: row.mute,
				solo: row.solo,
				hasAudioDescendant: row.hasAudioDescendant,
				rowHidden: row.rowHidden,
				domId: trackFolderRowDomId(row.id),
			});
			folderRows.push(model);
			entries.push(Object.freeze({ kind: 'folder' as const, row: model }));
		}
	}
	return Object.freeze({
		hasFolders: folderRows.length > 0,
		entries: Object.freeze(entries),
		folderRows: Object.freeze(folderRows),
		treeOwnedIds: folderRows.map(({ domId }) => domId).join(' '),
	});
}

export type TrackFolderTreeIntent =
	| Readonly<{ kind: 'focus'; folderId: string }>
	| Readonly<{ kind: 'expand'; folderId: string }>
	| Readonly<{ kind: 'collapse'; folderId: string }>
	| Readonly<{ kind: 'activate'; folderId: string }>
	| null;

/**
 * Resolve one ARIA-tree keystroke against the visible folder rows: vertical
 * arrows walk visible rows, Right expands or enters, Left collapses or exits
 * to the parent, Home and End jump, Enter and F2 activate for rename.
 */
export function resolveTrackFolderTreeKey(
	key: string,
	folderId: string,
	plan: TrackListRowPlan,
): TrackFolderTreeIntent {
	const visible = plan.folderRows.filter((row) => !row.rowHidden);
	const index = visible.findIndex((row) => row.id === folderId);
	if (index < 0) return null;
	const current = visible[index];
	switch (key) {
		case 'ArrowDown':
			return visible[index + 1] ? { kind: 'focus', folderId: visible[index + 1].id } : null;
		case 'ArrowUp':
			return visible[index - 1] ? { kind: 'focus', folderId: visible[index - 1].id } : null;
		case 'ArrowRight': {
			if (current.collapsed) return { kind: 'expand', folderId: current.id };
			const child = visible.find((row) => row.parentFolderId === current.id);
			return child ? { kind: 'focus', folderId: child.id } : null;
		}
		case 'ArrowLeft': {
			if (!current.collapsed) return { kind: 'collapse', folderId: current.id };
			return current.parentFolderId === null
				? null
				: { kind: 'focus', folderId: current.parentFolderId };
		}
		case 'Home':
			return visible[0] && visible[0].id !== current.id ? { kind: 'focus', folderId: visible[0].id } : null;
		case 'End': {
			const last = visible[visible.length - 1];
			return last && last.id !== current.id ? { kind: 'focus', folderId: last.id } : null;
		}
		case 'Enter':
		case 'F2':
			return { kind: 'activate', folderId: current.id };
		default:
			return null;
	}
}

/** Roving tab index over folder rows: the active row, else the first visible row. */
export function trackFolderRowTabIndex(
	row: TrackFolderRowUiModel,
	activeFolderId: string | null,
	plan: TrackListRowPlan,
): 0 | -1 {
	if (activeFolderId !== null) return row.id === activeFolderId ? 0 : -1;
	const first = plan.folderRows.find((candidate) => !candidate.rowHidden);
	return first?.id === row.id ? 0 : -1;
}

function countFolderSiblings(rows: readonly TrackFolderStateNodeV12[]): ReadonlyMap<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (row.kind !== 'folder') continue;
		const key = row.parentFolderId ?? '';
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}
