/* SPDX-License-Identifier: AGPL-3.0-only */

interface TrackPairMember {
	readonly type?: unknown;
	readonly laneGroupId?: unknown;
}

/** A camera's paired audio lane cannot be removed by the independent mono merge. */
export function isStandaloneMonoAudioTrack(
	track: TrackPairMember | null | undefined,
	channelCount: number,
): boolean {
	return track?.type === 'audio' && track.laneGroupId == null && channelCount === 1;
}
