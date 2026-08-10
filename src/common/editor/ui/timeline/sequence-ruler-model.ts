/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameAtSample, sequenceFrameBoundarySample } from '../../sequence-frame-navigation.ts';
import { formatSequenceTimecode, sequenceTimecodeFromFrameCount } from '../../sequence-timecode.ts';
import type { SequenceTimingView } from '../../sequence-timing-model.ts';

const MAXIMUM_TICKS = 4_096;
const MINIMUM_LABEL_PIXELS = 76;
const MINIMUM_MINOR_TICK_PIXELS = 6;
const FRAME_STEPS = Object.freeze([1, 2, 5, 10]);
const SECOND_STEPS = Object.freeze([1, 2, 5, 10, 15, 30]);
const MINUTE_STEPS = Object.freeze([1, 2, 5, 10, 15, 30]);
const HOUR_STEPS = Object.freeze([1, 2, 4, 8, 24]);

export interface SequenceRulerTick {
	readonly frame: number;
	readonly sequenceFrame: number;
	readonly label: string;
	readonly major: boolean;
}

export interface SequenceRulerTickOptions {
	readonly view: SequenceTimingView;
	readonly sampleRate: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly pixelsPerSample?: number;
}

/**
 * Whether a project asks its ruler and readout to speak SMPTE. A document
 * without sequences cannot: the rate that defines a frame lives on the sequence.
 */
export function usesSequenceTimecodeDisplay(
	project: Readonly<{
		timeDisplay?: Readonly<{ format?: unknown }>;
		sequences?: readonly unknown[];
	}>,
): boolean {
	return project.timeDisplay?.format === 'timecode' && Boolean(project.sequences?.length);
}

/**
 * Build a bounded viewport-local timecode ruler. Every tick resolves its own
 * boundary from the absolute origin, so no tick position depends on the
 * previous one and a scrolled viewport labels identically to a fresh one.
 */
export function createSequenceRulerTicks(options: SequenceRulerTickOptions): readonly SequenceRulerTick[] {
	const sampleRate = positiveSafeInteger(options.sampleRate, 'sampleRate');
	const startFrame = nonNegativeSafeInteger(options.startFrame, 'startFrame');
	const endFrame = nonNegativeSafeInteger(options.endFrame, 'endFrame');
	if (endFrame < startFrame) throw new RangeError('endFrame cannot precede startFrame.');
	const pixelsPerSample = options.pixelsPerSample === undefined
		? Number.POSITIVE_INFINITY
		: positiveFinite(options.pixelsPerSample, 'pixelsPerSample');
	const view = options.view;
	const first = sequenceFrameAtSample(startFrame, view.rate, sampleRate);
	const last = sequenceFrameAtSample(endFrame, view.rate, sampleRate);
	const samplesPerFrame = sampleRate * view.rate.den / view.rate.num;
	const labelStep = labelStepFrames(view.nominalFrameRate, samplesPerFrame * pixelsPerSample);
	const minorStep = minorStepFrames(labelStep, samplesPerFrame * pixelsPerSample);
	const ticks: SequenceRulerTick[] = [];
	const firstTick = Math.floor(first / minorStep) * minorStep;
	for (let frame = firstTick; frame <= last && ticks.length < MAXIMUM_TICKS; frame += minorStep) {
		const sample = sequenceFrameBoundarySample(frame, view.rate, sampleRate);
		if (sample < startFrame || sample > endFrame) continue;
		const major = frame % labelStep === 0;
		ticks.push(Object.freeze({
			frame: sample,
			sequenceFrame: frame,
			major,
			label: major ? formatSequenceTimecode(
				sequenceTimecodeFromFrameCount(frame + view.startFrameCount, view.rate, view.dropFrame),
				view.rate,
				view.dropFrame,
			) : '',
		}));
	}
	return Object.freeze(ticks);
}

function labelStepFrames(nominalRate: number, pixelsPerFrame: number): number {
	if (!Number.isFinite(pixelsPerFrame) || pixelsPerFrame <= 0) return 1;
	const required = MINIMUM_LABEL_PIXELS / pixelsPerFrame;
	for (const step of FRAME_STEPS) if (step >= required) return step;
	for (const step of SECOND_STEPS) if (step * nominalRate >= required) return step * nominalRate;
	for (const step of MINUTE_STEPS) if (step * 60 * nominalRate >= required) return step * 60 * nominalRate;
	for (const step of HOUR_STEPS) if (step * 3_600 * nominalRate >= required) return step * 3_600 * nominalRate;
	return Math.max(1, Math.ceil(required / (3_600 * nominalRate)) * 3_600 * nominalRate);
}

function minorStepFrames(labelStep: number, pixelsPerFrame: number): number {
	if (!Number.isFinite(pixelsPerFrame) || pixelsPerFrame <= 0) return labelStep;
	for (const divisor of [10, 5, 4, 2]) {
		if (labelStep % divisor !== 0) continue;
		const step = labelStep / divisor;
		if (step * pixelsPerFrame >= MINIMUM_MINOR_TICK_PIXELS) return step;
	}
	return labelStep;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveFinite(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}
