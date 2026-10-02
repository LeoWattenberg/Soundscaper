/* SPDX-License-Identifier: AGPL-3.0-only */

import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { compareCodeUnits } from '../../code-unit-order.ts';
import { createTimelineViewportClipIndex, type TimelineViewportClipIndex } from '../../design-system-adapters/timeline-viewport-index.ts';
import { validateVideoTrackComposition } from '../../video-timeline.js';

interface VideoOverlapClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly isRecordingPreview?: boolean;
	readonly title?: string;
}

interface VideoOverlap {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly valid: boolean;
	readonly label: string;
}

export interface VideoOverlapAnalysis {
	readonly invalid: boolean;
	readonly invalidClipIds: ReadonlySet<string>;
	readonly overlaps: readonly VideoOverlap[];
	readonly index?: TimelineViewportClipIndex<VideoOverlap>;
}

/** Analyze document-wide validity once; subsequent scrolls only project visible overlaps. */
export function analyzeVideoClipOverlaps(clips: readonly VideoOverlapClip[]): VideoOverlapAnalysis {
	const ordered = clips.filter((clip) => !clip.isRecordingPreview && Number(clip.durationFrames) > 0)
		.map((clip) => ({ clip, start: clip.timelineStartFrame, end: clip.timelineStartFrame + clip.durationFrames }))
		.sort((left, right) => left.start - right.start || compareCodeUnits(String(left.clip.id), String(right.clip.id)));
	const overlaps: VideoOverlap[] = [];
	const invalidClipIds = new Set<string>();
	let invalid = false;
	try {
		validateVideoTrackComposition({
			id: 'video-drag-preview', type: 'video', clipIds: ordered.map(({ clip }) => clip.id),
		}, new Map(ordered.map(({ clip }) => [clip.id, clip])));
	} catch {
		invalid = true;
	}
	// Every third-clip query excludes at most two entries. The three longest
	// ends in each start-sorted prefix therefore answer it without an N scan.
	const longestEnds: number[][] = [];
	let longest: number[] = [];
	for (let index = 0; index < ordered.length; index += 1) {
		longest = [...longest, index].sort((left, right) => ordered[right]!.end - ordered[left]!.end).slice(0, 3);
		longestEnds.push(longest);
	}
	const hasThirdClip = (start: number, end: number, left: number, right: number): boolean => {
		let low = 0;
		let high = ordered.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			if (ordered[middle]!.start < end) low = middle + 1;
			else high = middle;
		}
		return longestEnds[low - 1]?.some((index) => index !== left && index !== right
			&& ordered[index]!.end > start) ?? false;
	};
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex]!;
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex]!;
			if (right.start >= left.end) break;
			const startFrame = Math.max(left.start, right.start);
			const endFrame = Math.min(left.end, right.end);
			if (endFrame <= startFrame) continue;
			const valid = left.start < right.start && left.end < right.end
				&& !hasThirdClip(startFrame, endFrame, leftIndex, rightIndex);
			if (!valid) {
				invalid = true;
				invalidClipIds.add(left.clip.id);
				invalidClipIds.add(right.clip.id);
			}
			overlaps.push({
				id: `${left.clip.id}:${right.clip.id}:${startFrame}:${endFrame}`,
				timelineStartFrame: startFrame,
				durationFrames: endFrame - startFrame,
				valid,
				label: valid
					? `Automatic crossfade between ${left.clip.title || left.clip.id} and ${right.clip.title || right.clip.id}`
					: `Invalid video overlap between ${left.clip.title || left.clip.id} and ${right.clip.title || right.clip.id}`,
			});
		}
	}
	const index = overlaps.length > 128 && overlaps.every((overlap) => (
		Number.isSafeInteger(overlap.timelineStartFrame) && overlap.timelineStartFrame >= 0
		&& Number.isSafeInteger(overlap.durationFrames) && overlap.durationFrames > 0
		&& overlap.durationFrames <= Number.MAX_SAFE_INTEGER - overlap.timelineStartFrame
	)) ? createTimelineViewportClipIndex(overlaps) : undefined;
	return { invalid, invalidClipIds, overlaps, index };
}

export function projectVideoOverlapPresentation(
	analysis: VideoOverlapAnalysis,
	overscanStartFrame: number,
	overscanEndFrame: number,
	pixelsPerSecond: number,
	sampleRate: number,
) {
	const candidates = analysis.index?.query(overscanStartFrame, overscanEndFrame) ?? analysis.overlaps;
	const overlays = candidates.flatMap((overlap) => {
		const visibleStartFrame = Math.max(overlap.timelineStartFrame, overscanStartFrame);
		const visibleEndFrame = Math.min(overlap.timelineStartFrame + overlap.durationFrames, overscanEndFrame);
		return visibleEndFrame <= visibleStartFrame ? [] : [{
			id: overlap.id,
			left: CLIP_CONTENT_OFFSET + (visibleStartFrame - overscanStartFrame) / sampleRate * pixelsPerSecond,
			width: Math.max(2, (visibleEndFrame - visibleStartFrame) / sampleRate * pixelsPerSecond),
			valid: overlap.valid,
			label: overlap.label,
		}];
	});
	return { invalid: analysis.invalid, invalidClipIds: analysis.invalidClipIds, overlays };
}
