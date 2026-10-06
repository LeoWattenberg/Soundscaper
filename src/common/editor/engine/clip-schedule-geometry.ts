/* SPDX-License-Identifier: AGPL-3.0-only */
import { automaticClipCrossfadeRanges, type ClipCrossfadeRanges } from '../audio-clip-overlap.ts';
import { clipStart, clipDuration } from './buffer-math.ts';
import type { EngineTrack, EngineClip } from './types.ts';

export function getTrackClips(track: EngineTrack, clipsById: ReadonlyMap<string, EngineClip>): EngineClip[] {
	if (Array.isArray(track.clipIds)) return track.clipIds.map((id) => clipsById.get(String(id))).filter((clip): clip is EngineClip => Boolean(clip));
	if (Array.isArray(track.clips)) return track.clips.map((clip) => clip && typeof clip === 'object'
		? clip as EngineClip : clipsById.get(String(clip))).filter((clip): clip is EngineClip => Boolean(clip));
	return [];
}

/** Derive complementary, clip-local crossfade ranges for proper partial overlaps. */
export function automaticCrossfadeRanges(clips: readonly EngineClip[]): Map<string, ClipCrossfadeRanges> {
	if (!Array.isArray(clips)) throw new TypeError('clips must be an array.');
	return automaticClipCrossfadeRanges<EngineClip>(clips, { id: (clip) => clip.id, startFrame: clipStart, durationFrames: clipDuration });
}
