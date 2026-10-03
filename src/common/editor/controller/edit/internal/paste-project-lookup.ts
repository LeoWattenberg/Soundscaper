/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	findControllerSource,
	type ControllerClip,
	type ControllerProject,
	type ControllerSource,
	type ControllerTrack,
} from '../../track-audio/track-domain-types.ts';

export interface PasteProjectLookup {
	track(id: string): ControllerTrack | undefined;
	clipsForTrack(id: string): readonly ControllerClip[];
	source(id: string): ControllerSource | null;
}

/** One snapshot per paste; preserve find's first-match and exact-ID semantics. */
export function createPasteProjectLookup(
	project: Pick<ControllerProject, 'tracks' | 'clips' | 'sources'>,
): PasteProjectLookup {
	const tracks = firstMatches(project.tracks);
	const clips = firstMatches(project.clips);
	const sources = firstMatches(project.sources);
	const trackClips = new Map<string, readonly ControllerClip[]>();
	return {
		track: (id) => tracks.get(id),
		clipsForTrack(id) {
			let values = trackClips.get(id);
			if (!values) {
				values = (tracks.get(id)?.clipIds ?? []).map((clipId) => clips.get(clipId))
					.filter((clip): clip is ControllerClip => Boolean(clip));
				trackClips.set(id, values);
			}
			return values;
		},
		source(id) {
			const source = sources.get(id);
			return source ? findControllerSource({ sources: [source] }, id) : null;
		},
	};
}

function firstMatches<T extends Readonly<{ id: string }>>(values: readonly T[]): ReadonlyMap<string, T> {
	const matches = new Map<string, T>();
	for (const value of values) {
		const id = value.id;
		if (!Number.isNaN(id) && !matches.has(id)) matches.set(id, value);
	}
	return matches;
}
