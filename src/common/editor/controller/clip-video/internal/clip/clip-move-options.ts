/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClipTransformProject, ClipTransformSelection } from './clip-domain-types.ts';

export interface ClipMoveOptions {
	readonly overwrite?: boolean;
	readonly allOnTrack?: boolean;
	readonly preserveTime?: boolean;
	readonly clipIds?: readonly string[];
}

/** A whole-track gesture replaces unrelated clip picks with its actual participants. */
export function clipMoveSelection(
	project: ClipTransformProject,
	clipIds: readonly string[],
	options: ClipMoveOptions,
): ClipTransformSelection | null | undefined {
	if ((!options.allOnTrack && !options.clipIds) || !project.selection) return project.selection;
	return {
		...project.selection,
		clipIds: [...clipIds],
		trackIds: project.tracks.filter((track) => (
			track.clipIds?.some((clipId) => clipIds.includes(clipId))
		)).map((track) => track.id),
	};
}
