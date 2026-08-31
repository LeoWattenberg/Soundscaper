/* SPDX-License-Identifier: AGPL-3.0-only */

export function coreClip(clip) {
	if (!clip) return clip;
	return {
		id: clip.id,
		sourceId: clip.sourceId,
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		durationFrames: clip.durationFrames,
		gain: clip.gain,
		fadeInFrames: clip.fadeInFrames,
		fadeOutFrames: clip.fadeOutFrames,
		reversed: clip.reversed,
	};
}
