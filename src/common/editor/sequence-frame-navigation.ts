/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type RationalRate,
} from './timeline-time.ts';

/**
 * Sample↔sequence-frame navigation for video-rated surfaces.
 *
 * Frame boundaries resolve from the absolute origin with `point` rounding, the
 * same discipline the runtime clip projection uses, so a boundary computed here
 * is the boundary a clip placed on that frame resolves to. Positions are never
 * accumulated: every step re-resolves its boundary from the origin.
 */

export type SequenceFrameSnapMode = 'nearest' | 'previous' | 'next';

/** The resolved sample a sequence frame begins on. */
export function sequenceFrameBoundarySample(
	frame: number,
	rate: RationalRate,
	sampleRate: number,
): number {
	return videoFrameToSampleFrame(nonNegativeSafeInteger(frame, 'sequence frame'), rate, sampleRate, 'point');
}

/**
 * The sequence frame that contains a sample: the unique frame whose boundary is
 * at or before the sample while its successor's boundary is after it. `point`
 * rounding can move a boundary either way against the exact quotient, so the
 * floored estimate is corrected against the resolved boundaries themselves.
 */
export function sequenceFrameAtSample(
	sample: number,
	rate: RationalRate,
	sampleRate: number,
): number {
	const position = nonNegativeSafeInteger(sample, 'sample');
	let frame = Math.max(0, sampleFrameToVideoFrame(position, rate, sampleRate, 'enclosingStart'));
	for (let correction = 0; correction < 2 && frame > 0; correction += 1) {
		if (sequenceFrameBoundarySample(frame, rate, sampleRate) <= position) break;
		frame -= 1;
	}
	for (let correction = 0; correction < 2; correction += 1) {
		if (sequenceFrameBoundarySample(frame + 1, rate, sampleRate) > position) break;
		frame += 1;
	}
	if (sequenceFrameBoundarySample(frame, rate, sampleRate) > position
		|| sequenceFrameBoundarySample(frame + 1, rate, sampleRate) <= position) {
		throw new RangeError('A sample could not be resolved onto the sequence frame grid.');
	}
	return frame;
}

/** Snap a sample onto a frame boundary in the requested direction. */
export function snapSampleToSequenceFrame(
	sample: number,
	rate: RationalRate,
	sampleRate: number,
	mode: SequenceFrameSnapMode = 'nearest',
): number {
	const position = nonNegativeSafeInteger(sample, 'sample');
	const frame = sequenceFrameAtSample(position, rate, sampleRate);
	const start = sequenceFrameBoundarySample(frame, rate, sampleRate);
	if (start === position || mode === 'previous') return start;
	const end = sequenceFrameBoundarySample(frame + 1, rate, sampleRate);
	if (mode === 'next') return end;
	if (mode !== 'nearest') throw new RangeError(`Unsupported sequence frame snap mode: ${String(mode)}.`);
	return position - start <= end - position ? start : end;
}

/**
 * Move a whole number of frames. An on-grid position moves exactly that many
 * frames; an off-grid position first resolves onto the boundary it is moving
 * toward, so a single step never crosses more than one boundary.
 */
export function stepSampleBySequenceFrames(
	sample: number,
	frameDelta: number,
	rate: RationalRate,
	sampleRate: number,
): number {
	const position = nonNegativeSafeInteger(sample, 'sample');
	const delta = safeInteger(frameDelta, 'frame delta');
	const frame = sequenceFrameAtSample(position, rate, sampleRate);
	const offGrid = sequenceFrameBoundarySample(frame, rate, sampleRate) !== position;
	const base = offGrid && delta < 0 ? frame + 1 : frame;
	return sequenceFrameBoundarySample(Math.max(0, safeSum(base, delta)), rate, sampleRate);
}

function safeSum(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('A sequence frame position exceeds the safe integer range.');
	return result;
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}
