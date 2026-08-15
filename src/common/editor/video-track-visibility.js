/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A video track participates in the visual stack unless it is explicitly
 * hidden. `mute` remains independent so a future UI can use it for media audio
 * without changing picture composition.
 */
export function isVisibleVideoTrack(track) {
	return Boolean(track && track.type === 'video' && track.hidden !== true);
}

/**
 * Resolve picture visibility across the whole video track set, because solo is a
 * statement about the set rather than about one track: while any video track is
 * soloed, only the soloed tracks compose. Playback, export, and edit navigation all
 * read this one predicate so a soloed programme renders the same everywhere.
 */
export function createVisibleVideoTrackPredicate(tracks) {
	const videoTracks = (Array.isArray(tracks) ? tracks : []).filter((track) => track?.type === 'video');
	const soloed = videoTracks.some((track) => track.solo === true);
	if (!soloed) return isVisibleVideoTrack;
	return (track) => Boolean(track && track.type === 'video' && track.solo === true);
}
