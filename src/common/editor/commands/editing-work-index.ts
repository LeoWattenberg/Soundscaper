/* SPDX-License-Identifier: AGPL-3.0-only */

interface Identified { readonly id: string }
interface OwnedTrack extends Identified { readonly clipIds?: readonly string[] }
interface RelatedClip extends Identified {
	readonly groupId?: string | null;
	readonly avLinkId?: string | null;
}

interface OwnershipDiagnostics {
	duplicateTrackIds: boolean;
	duplicateClipOwners: boolean;
}

/** Invocation-local indexes never retain mutable caller documents between edits. */
export function firstById<Item extends Identified>(items: readonly Item[]): Map<string, Item> {
	const result = new Map<string, Item>();
	for (const item of items) if (!result.has(item.id)) result.set(item.id, item);
	return result;
}

export function clipOwnerIndex<Track extends OwnedTrack>(tracks: readonly Track[], diagnostics?: OwnershipDiagnostics): Map<string, Track> {
	const owners = new Map<string, Track>();
	const trackIds = diagnostics ? new Set<string>() : null;
	for (const track of tracks) {
		if (diagnostics && trackIds) {
			if (trackIds.has(track.id)) diagnostics.duplicateTrackIds = true;
			trackIds.add(track.id);
		}
		for (const id of track.clipIds ?? []) {
			if (!owners.has(id)) owners.set(id, track);
			else if (diagnostics) diagnostics.duplicateClipOwners = true;
		}
	}
	return owners;
}

export function requireIndexedClip<Clip>(clips: ReadonlyMap<string, Clip>, id: string): Clip {
	const clip = clips.get(id);
	if (!clip) throw new ReferenceError(`Unknown clip: ${id}.`);
	return clip;
}

/** Expand each relationship once, including chains alternating groups and A/V links. */
export function expandRelatedClipIds<Clip extends RelatedClip>(
	clips: readonly Clip[], seeds: readonly string[], available = new Map(clips.map(clip => [clip.id, clip])),
): string[] {
	if (!seeds.length) return [];
	const ids = new Set(createRelatedClipReader(clips, available)(seeds));
	return clips.filter(clip => ids.has(clip.id)).map(clip => clip.id);
}

export function createRelatedClipReader<Clip extends RelatedClip>(clips: readonly Clip[], available = new Map(clips.map(clip => [clip.id, clip]))): (seeds: readonly string[]) => string[] {
	const groups = new Map<string, Clip[]>();
	const links = new Map<string, Clip[]>();
	for (const clip of clips) {
		appendRelationship(groups, clip.groupId, clip);
		appendRelationship(links, clip.avLinkId, clip);
	}
	return seeds => {
		const ids = new Set(seeds.filter(id => available.has(id)));
		const pending = [...ids];
		const seenGroups = new Set<string>();
		const seenLinks = new Set<string>();
		for (let cursor = 0; cursor < pending.length; cursor += 1) {
			const clip = available.get(pending[cursor]!)!;
			for (const [index, relation, seen] of [[groups, clip.groupId, seenGroups], [links, clip.avLinkId, seenLinks]] as const) {
				if (typeof relation !== 'string' || !relation || seen.has(relation)) continue;
				const related = index.get(relation);
				if (!related) continue;
				seen.add(relation);
				for (const candidate of related) if (!ids.has(candidate.id)) {
					ids.add(candidate.id);
					pending.push(candidate.id);
				}
			}
		}
		return pending;
	};
}

function appendRelationship<Clip>(index: Map<string, Clip[]>, value: unknown, clip: Clip): void {
	if (typeof value !== 'string' || !value) return;
	const existing = index.get(value);
	if (existing) existing.push(clip);
	else index.set(value, [clip]);
}

/** Sum completed removals with one prefix lookup, preserving coincident boundaries. */
export function createCompletedFrameSum(entries: readonly Readonly<{ endFrame: number; frames: number }>[]): (frame: number) => number {
	const sorted = [...entries].sort((left, right) => left.endFrame - right.endFrame);
	const ends: number[] = [];
	const sums: number[] = [];
	let total = 0;
	for (const entry of sorted) {
		total += entry.frames;
		ends.push(entry.endFrame);
		sums.push(total);
	}
	return frame => {
		let low = 0;
		let high = ends.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (ends[middle]! <= frame) low = middle + 1;
			else high = middle;
		}
		return low ? sums[low - 1]! : 0;
	};
}
