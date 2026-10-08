/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from './audio-clip-loop.ts';
import type { SampleEditClip, SampleSmoothingSegment, SmoothSampleRange } from './sample-edit-types.ts';

/** A wrapped interval selects two source pieces; its untouched gap stays intact. */
export function loopSampleSmoothingSegments(
	clip: SampleEditClip, startFrame: number, endFrame: number,
): readonly SampleSmoothingSegment[] | null {
	const loop = readClipLoop(clip);
	if (!loop) return null;
	const width = BigInt(clip.sourceDurationFrames);
	const position = (frame: number): bigint => (
		(BigInt(frame - clip.timelineStartFrame) + BigInt(loop.offsetFrames)) * width / BigInt(loop.periodFrames)
	);
	const first = position(startFrame);
	const count = position(endFrame - 1) - first + 1n;
	const phase = first % width;
	const local = count >= width ? [{ startFrame: 0, endFrame: Number(width) }]
		: phase + count <= width ? [{ startFrame: Number(phase), endFrame: Number(phase + count) }]
			: [{ startFrame: 0, endFrame: Number(phase + count - width) },
				{ startFrame: Number(phase), endFrame: Number(width) }];
	return Object.freeze(local.map(segment => Object.freeze({
		startFrame: clip.sourceStartFrame + (clip.reversed ? clip.sourceDurationFrames - segment.endFrame : segment.startFrame),
		endFrame: clip.sourceStartFrame + (clip.reversed ? clip.sourceDurationFrames - segment.startFrame : segment.endFrame),
	})).sort((a, b) => a.startFrame - b.startFrame));
}

/** Keep source publication bounded to the disjoint intervals the mapper chose. */
export function sampleSmoothingSegments(
	range: SmoothSampleRange, sourceFrames: number, maximumFrames: number,
): readonly SampleSmoothingSegment[] {
	const segments = range.segments ?? [range];
	if (!segments.length) throw new RangeError('Sample smoothing requires a non-empty source range.');
	let previousEnd = 0;
	let frames = 0;
	for (const segment of segments) {
		if (!Number.isSafeInteger(segment.startFrame) || !Number.isSafeInteger(segment.endFrame)
			|| segment.startFrame < previousEnd || segment.endFrame <= segment.startFrame
			|| segment.endFrame > sourceFrames) throw new RangeError('Invalid sample smoothing source range.');
		previousEnd = segment.endFrame;
		frames += segment.endFrame - segment.startFrame;
		if (frames > maximumFrames) throw new RangeError(`A sample smoothing selection cannot exceed ${String(maximumFrames)} source frames.`);
	}
	return segments;
}
