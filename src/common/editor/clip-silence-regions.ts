/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Silence detection shared by the two commands that detach audio at silences:
 * Edit > Clip > Split clips at silences, which scans the selected clip whole,
 * and Edit > Labeled audio > Detach at silences, which scans only the part of
 * each clip a label covers (au3/src/menus/LabelMenus.cpp, OnDisjoinLabels).
 */

export interface ClipSilenceScanClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames?: number;
	readonly reversed?: boolean;
}

export interface ClipSilenceScanBuffer {
	readonly sampleRate: number;
	readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array | undefined;
}

export interface ClipSilenceScanBounds {
	readonly startFrame: number;
	readonly endFrame: number;
}

export type ClipSilenceRegion = readonly [startFrame: number, endFrame: number];

/** Amplitude at or below which a frame counts as silent, matching the selected-clip scan. */
const SILENCE_PEAK = 0.001;
/** Shortest run that is worth detaching, ten milliseconds of the source. */
const MINIMUM_SILENCE_SECONDS = 0.01;
/** Upper bound on the splits one invocation may commit. */
const MAXIMUM_REGIONS = 128;

/**
 * Locate the silent runs of one clip and return them as timeline frame ranges
 * that lie strictly inside the clip, so every one of them yields two splits.
 */
export function findClipSilenceRegions(
	clip: ClipSilenceScanClip,
	buffer: ClipSilenceScanBuffer,
	bounds: ClipSilenceScanBounds | null = null,
): readonly ClipSilenceRegion[] {
	const sourceDurationFrames = clip.sourceDurationFrames ?? clip.durationFrames;
	if (!(sourceDurationFrames > 0) || !(clip.durationFrames > 0)) return Object.freeze([]);
	const minimumSilenceFrames = Math.max(1, Math.round(buffer.sampleRate * MINIMUM_SILENCE_SECONDS));
	const scan = scanBounds(clip, sourceDurationFrames, bounds);
	if (!scan) return Object.freeze([]);
	const regions: ClipSilenceRegion[] = [];
	let silenceStart: number | null = null;
	for (let relativeSourceFrame = scan.start; relativeSourceFrame < scan.end; relativeSourceFrame += 1) {
		const sourceFrame = clip.reversed
			? clip.sourceStartFrame + sourceDurationFrames - 1 - relativeSourceFrame
			: clip.sourceStartFrame + relativeSourceFrame;
		let peak = 0;
		for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
			peak = Math.max(peak, Math.abs(buffer.getChannelData(channel)?.[sourceFrame] ?? 0));
		}
		if (peak <= SILENCE_PEAK) silenceStart ??= relativeSourceFrame;
		else if (silenceStart != null) {
			if (relativeSourceFrame - silenceStart >= minimumSilenceFrames) regions.push([silenceStart, relativeSourceFrame]);
			silenceStart = null;
		}
	}
	if (silenceStart != null && scan.end - silenceStart >= minimumSilenceFrames) regions.push([silenceStart, scan.end]);
	const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
	return Object.freeze(regions
		.map(([start, end]) => Object.freeze([
			clip.timelineStartFrame + Math.round(start / sourceDurationFrames * clip.durationFrames),
			clip.timelineStartFrame + Math.round(end / sourceDurationFrames * clip.durationFrames),
		]) as ClipSilenceRegion)
		.filter(([start, end]) => start > clip.timelineStartFrame && end < clipEndFrame && end > start)
		.slice(0, MAXIMUM_REGIONS));
}

/** Translate an optional timeline window into the source-relative scan range. */
function scanBounds(
	clip: ClipSilenceScanClip,
	sourceDurationFrames: number,
	bounds: ClipSilenceScanBounds | null,
): Readonly<{ start: number; end: number }> | null {
	if (!bounds) return Object.freeze({ start: 0, end: sourceDurationFrames });
	const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
	const startFrame = Math.max(bounds.startFrame, clip.timelineStartFrame);
	const endFrame = Math.min(bounds.endFrame, clipEndFrame);
	if (endFrame <= startFrame) return null;
	const toSource = (frame: number) => Math.round(
		(frame - clip.timelineStartFrame) / clip.durationFrames * sourceDurationFrames,
	);
	const start = Math.max(0, toSource(startFrame));
	const end = Math.min(sourceDurationFrames, toSource(endFrame));
	return end > start ? Object.freeze({ start, end }) : null;
}
