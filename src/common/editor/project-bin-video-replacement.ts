/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection, type RuntimeClipProject, type RuntimePersistedClip } from './runtime-clip-projection.ts';
import { registeredVideoTimingIndex, videoSourceCoordinateRate } from './video-source-time.ts';
import { videoFrameToSampleFrame } from './timeline-time.ts';

type Source = Readonly<Record<string, unknown>>;

export interface ProjectBinVideoReplacementRange {
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
	readonly sequenceFrameCount: number;
	readonly shortens: boolean;
}

export function isNativeProjectBinVideo(clip: RuntimePersistedClip): boolean {
	return clip.kind === 'video' && Object.hasOwn(clip, 'sourceInFrame');
}

/** Replacement keeps source times, then conforms the retained span to the new frame grid. */
export function projectBinVideoReplacementRange(
	project: RuntimeClipProject, clip: RuntimePersistedClip, oldSourceValue: unknown, newSourceValue: unknown,
): Readonly<ProjectBinVideoReplacementRange> | null {
	const oldSource = source(oldSourceValue);
	const newSource = source(newSourceValue);
	const resolved = resolveRuntimeClipProjection(project, clip);
	const oldStart = timeAt(oldSource, resolved.sourceStartFrame);
	const oldEnd = timeAt(oldSource, resolved.sourceEndFrame);
	const count = positiveInteger(newSource.sourceFrameCount, 'replacement video frame count');
	const newEnd = timeAt(newSource, count);
	if (oldStart >= newEnd) return null;
	const sourceInFrame = nearestBoundary(newSource, oldStart);
	if (sourceInFrame >= count) return null;
	const sourceEnd = Math.min(count, Math.max(sourceInFrame + 1, nearestBoundary(newSource, Math.min(oldEnd, newEnd))));
	const shortens = oldEnd > newEnd + Number.EPSILON * Math.max(1, oldEnd, newEnd) * 8;
	const originalSequenceCount = positiveInteger(clip.sequenceFrameCount, 'clip sequence frame count');
	const sequenceFrameCount = shortens
		? Math.max(1, Math.round(originalSequenceCount * (timeAt(newSource, sourceEnd) - timeAt(newSource, sourceInFrame)) / (oldEnd - oldStart)))
		: originalSequenceCount;
	const sequence = project.sequences?.find(item => item.id === clip.sequenceId);
	const rate = rationalRate(sequence?.rate);
	const start = nonNegativeInteger(clip.sequenceStartFrame, 'clip sequence start');
	const sampleRate = positiveInteger(project.sampleRate, 'project sample rate');
	const durationFrames = videoFrameToSampleFrame(start + sequenceFrameCount, rate, sampleRate, 'point')
		- videoFrameToSampleFrame(start, rate, sampleRate, 'point');
	return Object.freeze({ sourceStartFrame: sourceInFrame, sourceDurationFrames: sourceEnd - sourceInFrame, durationFrames,
		sourceInFrame, sourceFrameCount: sourceEnd - sourceInFrame, sequenceFrameCount, shortens });
}

function timeAt(value: Source, ordinal: number): number {
	const index = registeredVideoTimingIndex(value);
	if (index) return Number(ordinal === index.frameCount ? index.endTicks : index.presentationTicks[ordinal]) / index.timescale;
	const rate = videoSourceCoordinateRate({ sourceInFrame: 0 }, value);
	return ordinal / rate;
}

function nearestBoundary(value: Source, seconds: number): number {
	const count = positiveInteger(value.sourceFrameCount, 'replacement video frame count');
	const index = registeredVideoTimingIndex(value);
	if (!index) return Math.min(count, Math.max(0, Math.round(seconds * videoSourceCoordinateRate({ sourceInFrame: 0 }, value))));
	let low = 0;
	let high = count;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (timeAt(value, middle) < seconds) low = middle + 1;
		else high = middle;
	}
	return low > 0 && seconds - timeAt(value, low - 1) < timeAt(value, low) - seconds ? low - 1 : low;
}

function source(value: unknown): Source {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Video replacement requires a source record.');
	return value as Source;
}

function rationalRate(value: unknown) {
	const rate = source(value);
	return { num: positiveInteger(rate.num, 'sequence rate numerator'), den: positiveInteger(rate.den, 'sequence rate denominator') };
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return value;
}
