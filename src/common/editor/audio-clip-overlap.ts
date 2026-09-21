/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from './code-unit-order.ts';

export interface PartialClipOverlap<T> {
	readonly left: T;
	readonly right: T;
	readonly leftStartFrame: number;
	readonly rightStartFrame: number;
	readonly startFrame: number;
	readonly endFrame: number;
}

interface ClipOverlapAccessors<T> {
	readonly id: (clip: T) => unknown;
	readonly startFrame: (clip: T) => number;
	readonly durationFrames: (clip: T) => number;
}

/** Find overlaps where each clip extends beyond a different edge of the other. */
export function findPartialClipOverlaps<T>(
	clips: readonly T[],
	accessors: ClipOverlapAccessors<T>,
): PartialClipOverlap<T>[] {
	const ordered = clips.map((clip) => ({
		clip,
		id: accessors.id(clip),
		startFrame: accessors.startFrame(clip),
		durationFrames: accessors.durationFrames(clip),
	})).filter(({ id, durationFrames }) => id != null && durationFrames > 0)
		.sort((left, right) => left.startFrame - right.startFrame
			|| compareCodeUnits(String(left.id), String(right.id)));
	const overlaps: PartialClipOverlap<T>[] = [];
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex]!;
		const leftEnd = left.startFrame + left.durationFrames;
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex]!;
			if (right.startFrame >= leftEnd) break;
			const rightEnd = right.startFrame + right.durationFrames;
			if (left.startFrame >= right.startFrame || leftEnd >= rightEnd) continue;
			overlaps.push({
				left: left.clip,
				right: right.clip,
				leftStartFrame: left.startFrame,
				rightStartFrame: right.startFrame,
				startFrame: right.startFrame,
				endFrame: leftEnd,
			});
		}
	}
	return overlaps;
}
