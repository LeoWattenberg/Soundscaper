/* SPDX-License-Identifier: AGPL-3.0-only */

export type PersistedTrackLockAuthority = (trackId: string) => boolean;

/** Capture track locks from the exact persisted projection used for planning. */
export function capturePersistedTrackLockAuthority(
	project: unknown,
): PersistedTrackLockAuthority {
	const candidate = project !== null && typeof project === 'object'
		? project as Readonly<Record<string, unknown>>
		: null;
	const tracks = Array.isArray(candidate?.tracks) ? candidate.tracks : [];
	const lockedTrackIds = new Set(tracks.flatMap((value) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
		const track = value as Readonly<Record<string, unknown>>;
		return track.locked === true && typeof track.id === 'string' && track.id.length > 0
			? [track.id]
			: [];
	}));
	return (trackId: string): boolean => lockedTrackIds.has(trackId);
}
