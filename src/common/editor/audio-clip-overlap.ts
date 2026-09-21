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

export type FrameRange = readonly [startFrame: number, endFrame: number];

export interface ClipCrossfadeRanges {
	readonly crossfadeInRanges: readonly FrameRange[];
	readonly crossfadeOutRanges: readonly FrameRange[];
}

export interface ClipOverlapAccessors<T> {
	readonly id: (clip: T) => unknown;
	readonly startFrame: (clip: T) => number;
	readonly durationFrames: (clip: T) => number;
}

export type FrameRangeNormalizer = (ranges: readonly FrameRange[]) => readonly FrameRange[];

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

/** Project proper overlaps into complementary clip-local automatic crossfade ranges. */
export function automaticClipCrossfadeRanges<T>(
	clips: readonly T[],
	accessors: ClipOverlapAccessors<T>,
	normalizeRanges: FrameRangeNormalizer = mergeFrameRanges,
): Map<string, ClipCrossfadeRanges> {
	const ranges = new Map<string, {
		crossfadeInRanges: FrameRange[];
		crossfadeOutRanges: FrameRange[];
	}>(clips.map((clip) => [
		String(accessors.id(clip)),
		{ crossfadeInRanges: [], crossfadeOutRanges: [] },
	]));
	for (const overlap of findPartialClipOverlaps(clips, accessors)) {
		ranges.get(String(accessors.id(overlap.left)))?.crossfadeOutRanges.push([
			overlap.startFrame - overlap.leftStartFrame,
			overlap.endFrame - overlap.leftStartFrame,
		]);
		ranges.get(String(accessors.id(overlap.right)))?.crossfadeInRanges.push([
			overlap.startFrame - overlap.rightStartFrame,
			overlap.endFrame - overlap.rightStartFrame,
		]);
	}
	return new Map([...ranges].map(([id, value]) => [id, {
		crossfadeInRanges: normalizeRanges(value.crossfadeInRanges),
		crossfadeOutRanges: normalizeRanges(value.crossfadeOutRanges),
	}]));
}

/** Sort and merge touching or overlapping frame-boundary ranges. */
export function mergeFrameRanges(ranges: readonly FrameRange[]): FrameRange[] {
	const ordered = ranges
		.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
		.slice()
		.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
	const merged: [number, number][] = [];
	for (const [start, end] of ordered) {
		const previous = merged.at(-1);
		if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
		else merged.push([start, end]);
	}
	return merged;
}
