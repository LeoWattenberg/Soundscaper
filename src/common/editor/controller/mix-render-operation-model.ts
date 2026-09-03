/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NormalizedMixRenderOptions } from './mix-render-options.ts';
import {
	findControllerClip,
	type ControllerProject,
	type ControllerTrack,
} from './track-domain-types.ts';

/** Reject destructive requests before storage admission or rendering begins. */
export function assertMixRenderPreflight(
	project: ControllerProject,
	targetTracks: readonly ControllerTrack[],
	options: Readonly<NormalizedMixRenderOptions>,
): void {
	if (!options.replaceOriginals) return;
	const locked = targetTracks.find((track) => track.locked === true);
	if (locked) throw new Error(`Mix and Render cannot replace locked track ${locked.name}.`);
	for (const track of targetTracks) {
		for (const clipId of track.clipIds) {
			const clip = findControllerClip(project, clipId);
			if (clip?.avLinkId) {
				throw new Error('Mix and Render cannot replace a track containing linked A/V clips.');
			}
		}
	}
	if (targetTracks.some((track) => Boolean(track.laneGroupId))) {
		throw new Error('Mix and Render cannot destructively mix linked A/V track lanes.');
	}
}
