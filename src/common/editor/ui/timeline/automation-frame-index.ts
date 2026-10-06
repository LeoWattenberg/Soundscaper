/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveAutomationLanePointFramesV21, type AutomationLaneV21, type ResolvedAutomationLanePointV21 } from '../../automation-lane-v21.ts';
import type { HoldTempoMap } from '../../timeline-time.ts';

interface FrameIndex {
	readonly points: readonly ResolvedAutomationLanePointV21[];
	readonly indexByFrame: ReadonlyMap<number, number>;
	between(start: number, end: number): readonly ResolvedAutomationLanePointV21[];
}
const indexes = new WeakMap<AutomationLaneV21, Readonly<{ sampleRate: number; tempoMap?: HoldTempoMap; index: FrameIndex }>>();

/** One immutable lane/tempo snapshot serves point lookup and visible-span projection. */
export function automationFrameIndex(lane: AutomationLaneV21, sampleRate: number, tempoMap?: HoldTempoMap): FrameIndex {
	const cached = indexes.get(lane);
	if (cached?.sampleRate === sampleRate && cached.tempoMap === tempoMap) return cached.index;
	const points = resolveAutomationLanePointFramesV21(lane, { sampleRate, tempoMap });
	const indexByFrame = new Map<number, number>();
	// findIndex previously selected the first authored point at a rounded beat frame.
	points.forEach((point, index) => { if (!indexByFrame.has(point.frame)) indexByFrame.set(point.frame, index); });
	const index: FrameIndex = {
		points, indexByFrame,
		between(start, end) { return points.slice(lowerBound(points, start), lowerBound(points, end, true)); },
	};
	indexes.set(lane, { sampleRate, tempoMap, index });
	return index;
}

function lowerBound(points: readonly ResolvedAutomationLanePointV21[], frame: number, after = false): number {
	let first = 0, last = points.length;
	while (first < last) {
		const middle = first + Math.floor((last - first) / 2);
		if (points[middle]!.frame < frame || (after && points[middle]!.frame === frame)) first = middle + 1;
		else last = middle;
	}
	return first;
}

export function automationSpanContains(spans: readonly Readonly<{ startFrame: number; endFrame: number }>[]) {
	const intervals: Array<{ start: number; end: number }> = [];
	for (const span of [...spans].sort((left, right) => left.startFrame - right.startFrame)) {
		const previous = intervals.at(-1);
		if (previous && span.startFrame <= previous.end) previous.end = Math.max(previous.end, span.endFrame);
		else intervals.push({ start: span.startFrame, end: span.endFrame });
	}
	return (frame: number) => {
		let first = 0, last = intervals.length;
		while (first < last) {
			const middle = first + Math.floor((last - first) / 2);
			if (intervals[middle]!.start <= frame) first = middle + 1; else last = middle;
		}
		return first > 0 && frame <= intervals[first - 1]!.end;
	};
}
