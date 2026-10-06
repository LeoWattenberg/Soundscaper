/* SPDX-License-Identifier: AGPL-3.0-only */

interface EffectControlTrack {
	readonly id: string;
	readonly type?: string;
}

/** A sidechain consumes audio; annotations and visual tracks provide no signal. */
export function audioEffectControlTracks<Track extends EffectControlTrack>(
	tracks: readonly Track[], targetTrackId: string | null | undefined,
): Track[] {
	return tracks.filter(track => track.type === 'audio' && track.id !== targetTrackId);
}
