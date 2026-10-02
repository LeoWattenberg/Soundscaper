/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimelineViewportClip } from './types.ts';
import { addFrames, nonNegativeSafeInteger, positiveSafeInteger } from './validation.ts';

interface ClipInterval<Clip> {
	readonly clip: Clip;
	readonly ordinal: number;
	readonly start: number;
	readonly end: number;
}

export interface TimelineViewportClipIndex<Clip extends TimelineViewportClip> {
	readonly clips: readonly Clip[];
	query(startFrame: number, endFrame: number): readonly Clip[];
}

/**
 * Index one immutable track snapshot, retaining input order for clip stacking.
 * Subtree end bounds retain long overlapping clips while skipping expired
 * regions; scrolling queries never read geometry from offscreen clip objects.
 * Rebuild when the snapshot changes, including during an interactive preview.
 */
export function createTimelineViewportClipIndex<Clip extends TimelineViewportClip>(
	clips: readonly Clip[],
): TimelineViewportClipIndex<Clip> {
	if (!Array.isArray(clips)) throw new TypeError('clips must be an array.');
	const intervals = clips.map((clip, ordinal): ClipInterval<Clip> => {
		if (!clip || typeof clip !== 'object') throw new TypeError('Each clip must be an object.');
		const start = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
		const duration = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
		return { clip, ordinal, start, end: addFrames(start, duration, 'clip') };
	}).sort((left, right) => left.start - right.start || left.ordinal - right.ordinal);
	const maximumEnds = new Float64Array(intervals.length);
	const build = (first: number, last: number): number => {
		if (first >= last) return 0;
		const middle = first + Math.floor((last - first) / 2);
		const maximum = Math.max(intervals[middle]!.end, build(first, middle), build(middle + 1, last));
		maximumEnds[middle] = maximum;
		return maximum;
	};
	build(0, intervals.length);
	return {
		clips,
		query(startFrame, endFrame) {
			const found: ClipInterval<Clip>[] = [];
			const visit = (first: number, last: number): void => {
				if (first >= last) return;
				const middle = first + Math.floor((last - first) / 2);
				if (maximumEnds[middle]! <= startFrame) return;
				const interval = intervals[middle]!;
				visit(first, middle);
				if (interval.start >= endFrame) return;
				if (interval.end > startFrame) found.push(interval);
				visit(middle + 1, last);
			};
			visit(0, intervals.length);
			found.sort((left, right) => left.ordinal - right.ordinal);
			return found.map(({ clip }) => clip);
		},
	};
}
