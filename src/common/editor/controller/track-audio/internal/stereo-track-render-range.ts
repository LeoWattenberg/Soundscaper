/* SPDX-License-Identifier: AGPL-3.0-only */

import { rackTailFrames } from '../../../effects.js';
import type { ControllerClip, ControllerTrack } from '../track-domain-types.ts';

/** Channel conversion removes both racks, so capture their last audible samples too. */
export function stereoTrackRenderRange(
	tracks: readonly ControllerTrack[],
	clips: readonly ControllerClip[],
	sampleRate: number,
): Readonly<{ startFrame: number; endFrame: number }> {
	const startFrame = clips.length ? Math.min(...clips.map(clip => clip.timelineStartFrame)) : 0;
	const byId = new Map(clips.map(clip => [clip.id, clip]));
	const ends = tracks.map(track => {
		const owned = (track.clipIds ?? []).flatMap(id => { const clip = byId.get(id); return clip ? [clip] : []; });
		if (!owned.length) return 0;
		const end = Math.max(...owned.map(clip => clip.timelineStartFrame + clip.durationFrames));
		const tail = track.effectsActive === false ? 0 : rackTailFrames(track.effects ?? [], sampleRate, 10);
		return end + tail;
	});
	return Object.freeze({ startFrame, endFrame: Math.max(0, ...ends) });
}
