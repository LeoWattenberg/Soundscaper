/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';

interface MuteProject {
	readonly tracks: readonly Readonly<{ id: string; type: string; mute?: boolean; hidden?: boolean }>[];
	readonly trackFolders?: readonly Readonly<{ id: string; mute?: boolean }>[];
}

/** Folder mute is authoritative audio state just as a leaf track's mute is. */
export function planMuteAllTracks(project: object, mute: boolean): readonly AudioEditorCommand[] {
	const current = project as MuteProject;
	return [
		...current.tracks.filter(track => track.type !== 'label'
			&& (track.type === 'video' ? track.hidden : track.mute) !== mute)
			.map((track): AudioEditorCommand => ({ type: 'track/update', trackId: track.id,
				changes: track.type === 'video' ? { hidden: mute } : { mute } })),
		...(current.trackFolders ?? []).filter(folder => folder.mute !== mute)
			.map((folder): AudioEditorCommand => ({ type: 'track-folder/update', folderId: folder.id, changes: { mute } })),
	];
}
