/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DocumentTrackFolderSnapshot } from '../controller/document/document-track-folder-snapshot.ts';

/** Global navigation follows the same collapsed hierarchy as the track rows. */
export function visibleNavigationTracks<T extends Readonly<{ id: string }>>(
	tracks: readonly T[],
	folders: DocumentTrackFolderSnapshot | null | undefined,
): readonly T[] {
	const hidden = new Set(folders?.sequences.flatMap(sequence => sequence.rows
		.filter(row => row.kind === 'track' && row.rowHidden).map(row => row.id)));
	return hidden.size ? tracks.filter(track => !hidden.has(track.id)) : tracks;
}
