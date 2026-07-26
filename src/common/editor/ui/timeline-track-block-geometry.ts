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
	const indexes = tracks
		.map((track, trackIndex) => track.laneGroupId === laneGroupId ? trackIndex : -1)
		.filter((trackIndex) => trackIndex >= 0);
	return {
		start: Math.min(...indexes),
		end: Math.max(...indexes),
	};
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
