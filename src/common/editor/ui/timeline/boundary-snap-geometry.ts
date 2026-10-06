/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop, type ClipLoop } from '../../audio-clip-loop.ts';

export interface SnapGeometryClip {
	readonly id: string;
	readonly kind?: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

interface Interval<Value> {
	readonly value: Value;
	readonly start: number;
	readonly end: number;
}

export interface SnapIntervalIndex<Value> {
	query(start: number, end: number): readonly Value[];
}

export interface LoopSnapGeometry {
	readonly trackId: string;
	readonly start: number;
	readonly end: number;
	readonly loop: ClipLoop;
}

export interface TrackSnapGeometry<Clip> {
	readonly starts: ReadonlyMap<number, readonly Clip[]>;
	readonly ends: ReadonlyMap<number, readonly Clip[]>;
	readonly intervals: SnapIntervalIndex<Clip>;
}

/** Captured geometry is read only at gesture admission, including long overlaps. */
function intervalIndex<Value>(values: readonly Interval<Value>[]): SnapIntervalIndex<Value> {
	const sorted = [...values].sort((a, b) => a.start - b.start);
	const maximumEnds = new Float64Array(sorted.length);
	function build(first: number, last: number): number {
		if (first >= last) return Number.NEGATIVE_INFINITY;
		const middle = first + Math.floor((last - first) / 2);
		return maximumEnds[middle] = Math.max(sorted[middle]!.end, build(first, middle), build(middle + 1, last));
	}
	build(0, sorted.length);
	return {
		query(start, end) {
			const found: Value[] = [];
			function visit(first: number, last: number): void {
				if (first >= last) return;
				const middle = first + Math.floor((last - first) / 2);
				if (maximumEnds[middle]! <= start) return;
				visit(first, middle);
				const interval = sorted[middle]!;
				if (interval.start >= end) return;
				if (interval.end > start) found.push(interval.value);
				visit(middle + 1, last);
			}
			visit(0, sorted.length);
			return found;
		},
	};
}

function add<Clip>(map: Map<number, Clip[]>, frame: number, clip: Clip): void {
	const entries = map.get(frame);
	if (entries) entries.push(clip);
	else map.set(frame, [clip]);
}

export function createBoundarySnapGeometry<Clip extends SnapGeometryClip>(
	tracks: readonly { readonly id: string; readonly clipIds?: readonly string[] }[],
	clips: ReadonlyMap<string, Clip>,
	excluded: ReadonlySet<string>,
) {
	const loops: Interval<LoopSnapGeometry>[] = [];
	const trackGeometry = new Map<string, TrackSnapGeometry<Clip>>();
	for (const track of tracks) {
		const starts = new Map<number, Clip[]>();
		const ends = new Map<number, Clip[]>();
		const intervals: Interval<Clip>[] = [];
		for (const id of track.clipIds ?? []) {
			if (excluded.has(id)) continue;
			const clip = clips.get(id);
			if (!clip) continue;
			const start = clip.timelineStartFrame;
			const end = start + clip.durationFrames;
			intervals.push({ value: clip, start, end });
			if (clip.kind === 'audio') { add(starts, start, clip); add(ends, end, clip); }
			const loop = readClipLoop(clip);
			if (loop) loops.push({ start, end, value: { trackId: track.id, start, end, loop } });
		}
		trackGeometry.set(track.id, { starts, ends, intervals: intervalIndex(intervals) });
	}
	return { loops: intervalIndex(loops), trackGeometry };
}
