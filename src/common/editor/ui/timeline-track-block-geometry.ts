export interface TimelineTrackBlockTrack {
	readonly id: string;
	readonly laneGroupId?: string | null;
}

export interface TimelineTrackBlockBounds {
	readonly start: number;
	readonly end: number;
}

export type TimelineTrackBlockDirection = 'top' | 'up' | 'down' | 'bottom';

export function mediaTrackBlockBounds(
	tracks: readonly TimelineTrackBlockTrack[],
	trackId: string,
): TimelineTrackBlockBounds | null {
	const index = tracks.findIndex((track) => track.id === trackId);
	if (index < 0) return null;
	const laneGroupId = tracks[index]?.laneGroupId;
	if (!laneGroupId) return { start: index, end: index };
	let start = index;
	let end = index;
	tracks.forEach((track, trackIndex) => {
		if (track.laneGroupId !== laneGroupId) return;
		start = Math.min(start, trackIndex);
		end = Math.max(end, trackIndex);
	});
	return { start, end };
}

export function mediaTrackBlockDestination(
	tracks: readonly TimelineTrackBlockTrack[],
	trackId: string,
	direction: TimelineTrackBlockDirection,
): number | null {
	const bounds = mediaTrackBlockBounds(tracks, trackId);
	if (!bounds) return null;
	if (direction === 'top') return 0;
	if (direction === 'bottom') return Math.max(0, tracks.length - 1);
	if (direction === 'up') return Math.max(0, bounds.start - 1);
	if (direction === 'down') {
		return Math.min(Math.max(0, tracks.length - 1), bounds.end + 1);
	}
	return bounds.start;
}
