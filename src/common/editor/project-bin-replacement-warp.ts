/* SPDX-License-Identifier: AGPL-3.0-only */

import { remapAudioWarpSourceWindow, type AudioWarpSourceWindow } from './audio-warp-source-window.ts';
import { normalizeAudioWarpMap } from './audio-warp-domain.ts';
import { addMultiplyDivideRationals, type RationalInput } from './timeline-time.ts';

interface ReplacementWarpClip extends AudioWarpSourceWindow {
	readonly warpMap?: unknown;
	readonly durationFrames: number;
	readonly anchor?: unknown;
	readonly musicalDurationBeats?: RationalInput | null;
}

/** Bin replacement owns both the new native window and the resulting clip extent. */
export function projectBinReplacementWarp(original: ReplacementWarpClip, replacement: ReplacementWarpClip) {
	if (original.warpMap == null) return {};
	const map = remapAudioWarpSourceWindow(original.warpMap, original, replacement);
	const previousExtent = map.points.at(-1)!.outer;
	const extent = replacement.anchor === 'musical'
		? replacement.musicalDurationBeats! : replacement.durationFrames;
	return { warpMap: normalizeAudioWarpMap({ ...map, points: map.points.map(point => ({ ...point,
		outer: addMultiplyDivideRationals(0, point.outer, extent, previousExtent),
	})) }) };
}
