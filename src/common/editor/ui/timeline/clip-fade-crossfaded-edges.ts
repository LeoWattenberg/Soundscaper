/* SPDX-License-Identifier: AGPL-3.0-only */

import { findPartialClipOverlaps } from '../../audio-clip-overlap.ts';

interface FadeEdgeClip {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

/** Identify the authored edges whose gain is also controlled by an automatic crossfade. */
export function crossfadedClipFadeEdges(clips: readonly FadeEdgeClip[]): ReadonlySet<string> {
	const edges = new Set<string>();
	for (const overlap of findPartialClipOverlaps(clips, {
		id: clip => clip.id,
		startFrame: clip => clip.timelineStartFrame,
		durationFrames: clip => clip.durationFrames,
	})) {
		edges.add(`${overlap.left.id}:out`);
		edges.add(`${overlap.right.id}:in`);
	}
	return edges;
}
