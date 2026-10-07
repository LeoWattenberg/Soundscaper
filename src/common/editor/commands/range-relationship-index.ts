/* SPDX-License-Identifier: AGPL-3.0-only */

interface RangeClip { readonly id: string; readonly avLinkId?: unknown }
interface RangeTrack { readonly id: string; readonly clipIds?: readonly string[] }
interface RangeProject<Clip extends RangeClip, Track extends RangeTrack> { readonly clips: readonly Clip[]; readonly tracks: readonly Track[] }

function avIndex<Clip extends RangeClip>(clips: readonly Clip[]): {
	first: Map<string, Clip>;
	links: Map<unknown, Clip[]>;
} {
	const first = new Map<string, Clip>();
	const links = new Map<unknown, Clip[]>();
	for (const clip of clips) {
		const id = clip.id;
		if (!first.has(id)) first.set(id, clip);
		const link = clip.avLinkId;
		if (!link) continue;
		const members = links.get(link);
		if (members) members.push(clip);
		else links.set(link, [clip]);
	}
	return { first, links };
}

/** This range relation is one-hop A/V only; groups and linked-track closure are separate. */
export function collectRangeAvClipIds<Clip extends RangeClip>(clips: readonly Clip[], seeds: readonly string[]): string[] {
	const { first, links } = avIndex(clips);
	const ids = new Set<string>();
	const seenLinks = new Set<unknown>();
	for (const id of seeds) {
		const clip = first.get(id);
		if (!clip) continue;
		ids.add(id);
		const link = clip.avLinkId;
		if (!link || seenLinks.has(link)) continue;
		seenLinks.add(link);
		for (const member of links.get(link) ?? []) ids.add(member.id);
	}
	return clips.filter(clip => ids.has(clip.id)).map(clip => clip.id);
}

/** Traverse each admitted track, relationship and owner once instead of rescan rounds. */
export function collectRangeLinkedTrackTargets<Clip extends RangeClip, Track extends RangeTrack>(
	project: RangeProject<Clip, Track>, requested: readonly string[],
): { trackIds: string[]; clipIds: string[] } {
	const { first, links } = avIndex(project.clips);
	const tracks = new Map<string, Track>();
	const owners = new Map<string, Track>();
	let ambiguous = first.size !== project.clips.length;
	for (const track of project.tracks) {
		if (tracks.has(track.id)) ambiguous = true;
		tracks.set(track.id, track);
		if (!Array.isArray(track.clipIds)) continue;
		for (const id of track.clipIds) {
			if (owners.has(id)) ambiguous = true;
			else owners.set(id, track);
		}
	}
	if (ambiguous || project.clips.some(clip => !owners.has(clip.id))) return legacyLinkedTrackTargets(project, requested);
	const trackIds = new Set(requested);
	const clipIds = new Set<string>();
	const pending = project.tracks.filter(track => trackIds.has(track.id));
	const seenLinks = new Set<unknown>();
	for (let cursor = 0; cursor < pending.length; cursor += 1) {
		const track = pending[cursor]!;
		if (!Array.isArray(track.clipIds)) throw new RangeError(`Track ${track.id} does not contain media clips.`);
		for (const id of track.clipIds) {
			clipIds.add(id);
			const clip = first.get(id);
			const link = clip?.avLinkId;
			if (!link || seenLinks.has(link)) continue;
			seenLinks.add(link);
			for (const member of links.get(link) ?? []) {
				clipIds.add(member.id);
				const owner = owners.get(member.id)!;
				if (!trackIds.has(owner.id)) {
					trackIds.add(owner.id);
					pending.push(owner);
				}
			}
		}
	}
	return {
		trackIds: project.tracks.filter(track => trackIds.has(track.id) && Array.isArray(track.clipIds)).map(track => track.id),
		clipIds: project.clips.filter(clip => clipIds.has(clip.id)).map(clip => clip.id),
	};
}

/** Malformed mutable helper callers retain the former rounds and diagnostic order. */
function legacyLinkedTrackTargets<Clip extends RangeClip, Track extends RangeTrack>(
	project: RangeProject<Clip, Track>, requested: readonly string[],
): { trackIds: string[]; clipIds: string[] } {
	const trackIds = new Set(requested);
	const clipIds = new Set<string>();
	let previousCount = -1;
	while (trackIds.size !== previousCount) {
		previousCount = trackIds.size;
		for (const track of project.tracks) {
			if (!trackIds.has(track.id)) continue;
			if (!Array.isArray(track.clipIds)) throw new RangeError(`Track ${track.id} does not contain media clips.`);
			for (const id of track.clipIds) clipIds.add(id);
		}
		for (const id of collectRangeAvClipIds(project.clips, [...clipIds])) {
			clipIds.add(id);
			const owner = project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(id));
			if (!owner) throw new ReferenceError(`Clip ${id} is not assigned to a track.`);
			trackIds.add(owner.id);
		}
	}
	return {
		trackIds: project.tracks.filter(track => trackIds.has(track.id) && Array.isArray(track.clipIds)).map(track => track.id),
		clipIds: project.clips.filter(clip => clipIds.has(clip.id)).map(clip => clip.id),
	};
}
