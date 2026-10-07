/* SPDX-License-Identifier: AGPL-3.0-only */

interface Identified { readonly id: string }

/** First-match lookup and writes share slots only while this draft array is stable. */
export function createClipEditIndex<Clip extends Identified>(clips: Clip[], requested?: readonly string[]): {
	require: (id: string) => Clip;
	replace: (clip: Clip) => void;
} {
	const slots = new Map<string, number>();
	const remaining = requested ? new Set(requested) : null;
	for (let index = 0; index < clips.length; index += 1) {
		if (remaining && !remaining.size) break;
		const id = clips[index]!.id;
		if (remaining && !remaining.delete(id)) continue;
		if (!slots.has(id)) slots.set(id, index);
		if (remaining && !remaining.size) break;
	}
	return {
		require: id => {
			const slot = slots.get(id);
			if (slot === undefined) throw new ReferenceError(`Unknown clip: ${id}.`);
			return clips[slot]!;
		},
		replace: clip => {
			const slot = slots.get(clip.id);
			if (slot === undefined) throw new ReferenceError(`Unknown clip: ${clip.id}.`);
			clips[slot] = clip;
		},
	};
}

export function readTrackClips<Clip extends Identified>(project: { clips: Clip[] }, track: { readonly clipIds: readonly string[] }): Clip[] {
	const index = createClipEditIndex(project.clips, track.clipIds);
	return track.clipIds.map(id => index.require(id));
}

export function requireIndexedTrack<Track>(tracks: ReadonlyMap<string, Track>, id: string): Track {
	const track = tracks.get(id);
	if (!track) throw new ReferenceError(`Unknown track: ${id}.`);
	return track;
}

export function requireIndexedOwner<Track>(owners: ReadonlyMap<string, Track>, id: string): Track {
	const track = owners.get(id);
	if (!track) throw new ReferenceError(`Clip ${id} is not assigned to a track.`);
	return track;
}

export function mediaClipOwnerIndex<Track extends { readonly clipIds?: readonly string[] }>(tracks: readonly Track[], requested?: Iterable<string>): Map<string, Track> {
	const owners = new Map<string, Track>();
	const remaining = requested ? new Set(requested) : null;
	for (const track of tracks) {
		if (remaining && !remaining.size) break;
		if (!Array.isArray(track.clipIds)) continue;
		for (const id of track.clipIds) {
			if (remaining && !remaining.delete(id)) continue;
			if (!owners.has(id)) owners.set(id, track);
		}
	}
	return owners;
}
