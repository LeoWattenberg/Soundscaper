/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../commands/protocol.ts';

interface AudibilityProject {
	readonly tracks: readonly Readonly<{ id: string; type: string; mute?: boolean; solo?: boolean }>[];
}

/** Set the chosen audibility switch and clear its peers in one history entry. */
export function exclusiveTrackAudibilityCommand(project: AudibilityProject | null, trackId: string, parameter: 'mute' | 'solo'): AudioEditorCommand | null {
	if (!project?.tracks.some(track => track.id === trackId && track.type === 'audio')) return null;
	const commands = project.tracks.filter(track => track.type === 'audio' && Boolean(track[parameter]) !== (track.id === trackId))
		.map((track): AudioEditorCommand => ({ type: 'track/update', trackId: track.id, changes: { [parameter]: track.id === trackId } }));
	return commands.length ? { type: 'batch', commands } : null;
}
