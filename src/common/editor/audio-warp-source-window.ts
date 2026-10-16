/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAudioWarpMap } from './audio-warp-domain.ts';
import { addMultiplyDivideRationals, compareRationals, subtractRationals } from './timeline-time.ts';

export interface AudioWarpSourceWindow {
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
}

/** Preserve exact marker progress when rounded native source windows change. */
export function remapAudioWarpSourceWindow(
	value: unknown,
	original: AudioWarpSourceWindow,
	replacement: AudioWarpSourceWindow,
) {
	const map = normalizeAudioWarpMap(value);
	for (const window of [original, replacement]) {
		if (!Number.isSafeInteger(window.sourceStartFrame) || window.sourceStartFrame < 0
			|| !Number.isSafeInteger(window.sourceDurationFrames) || window.sourceDurationFrames < 1
			|| !Number.isSafeInteger(window.sourceStartFrame + window.sourceDurationFrames)) {
			throw new RangeError('Audio warp remapping requires bounded positive source windows.');
		}
	}
	if (compareRationals(map.points[0]!.source, original.sourceStartFrame) !== 0
		|| compareRationals(map.points.at(-1)!.source, original.sourceStartFrame + original.sourceDurationFrames) !== 0) {
		throw new RangeError('Audio warp remapping requires matching original source endpoints.');
	}
	return normalizeAudioWarpMap({ ...map, points: map.points.map(point => ({ ...point,
		source: addMultiplyDivideRationals(replacement.sourceStartFrame,
			subtractRationals(point.source, original.sourceStartFrame),
			replacement.sourceDurationFrames, original.sourceDurationFrames),
	})) });
}
