/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	sequenceFrameAtSample,
	sequenceFrameBoundarySample,
} from './sequence-frame-navigation.ts';
import {
	formatSequenceTimecode,
	parseSequenceTimecode,
	sequenceTimecodeFrameRate,
	sequenceTimecodeFromFrameCount,
	sequenceTimecodeToFrameCount,
	type SequenceRationalRate,
	type SequenceTimecode,
} from './sequence-timecode.ts';

/**
 * Project-facing sequence timing: resolve a document's sequence into the view
 * the readout, ruler, and controller share, and label positions through it.
 * Nothing here is persisted; every value is derived on demand.
 */

export interface SequenceTimingProject extends Readonly<Record<string, unknown>> {
	readonly sampleRate?: unknown;
	readonly sequences?: unknown;
	readonly primarySequenceId?: unknown;
}

export interface SequenceTimingView {
	readonly id: string;
	readonly name: string;
	readonly rate: SequenceRationalRate;
	readonly dropFrame: boolean;
	readonly startTimecode: SequenceTimecode;
	readonly nominalFrameRate: number;
	readonly startFrameCount: number;
}

/** Resolve a sequence, defaulting to the project's primary sequence. */
export function resolveSequenceTimingView(
	project: SequenceTimingProject,
	sequenceId?: string,
): SequenceTimingView {
	if (!project || typeof project !== 'object') throw new TypeError('A project is required to resolve sequence timing.');
	const sequences = Array.isArray(project.sequences) ? project.sequences : [];
	const targetId = sequenceId ?? String(project.primarySequenceId ?? '');
	const sequence = sequences.find((candidate) => (
		Boolean(candidate) && typeof candidate === 'object'
		&& String((candidate as Record<string, unknown>).id) === targetId
	)) as Record<string, unknown> | undefined;
	if (!sequence) throw new ReferenceError(`Sequence ${targetId || '(unnamed)'} is missing.`);
	const rate = rationalRate(sequence.rate);
	const dropFrame = sequence.dropFrame === true;
	const startTimecode = timecodeFields(sequence.startTimecode);
	return Object.freeze({
		id: String(sequence.id),
		name: String(sequence.name ?? ''),
		rate,
		dropFrame,
		startTimecode,
		nominalFrameRate: sequenceTimecodeFrameRate(rate),
		startFrameCount: sequenceTimecodeToFrameCount(startTimecode, rate, dropFrame),
	});
}

/** Label the frame that contains a sample, offset by the sequence's start timecode. */
export function sequenceTimecodeAtSample(
	view: SequenceTimingView,
	sample: number,
	sampleRate: number,
): SequenceTimecode {
	const frame = sequenceFrameAtSample(sample, view.rate, sampleRate);
	return sequenceTimecodeFromFrameCount(frame + view.startFrameCount, view.rate, view.dropFrame);
}

/** Render the label a surface displays for a sample position. */
export function sequenceTimecodeLabelAtSample(
	view: SequenceTimingView,
	sample: number,
	sampleRate: number,
): string {
	return formatSequenceTimecode(
		sequenceTimecodeAtSample(view, sample, sampleRate),
		view.rate,
		view.dropFrame,
	);
}

/** Read a typed label back as the sample its frame begins on, clamped at the origin. */
export function sampleAtSequenceTimecodeLabel(
	view: SequenceTimingView,
	label: string,
	sampleRate: number,
): number {
	const timecode = parseSequenceTimecode(label, view.rate, view.dropFrame);
	const count = sequenceTimecodeToFrameCount(timecode, view.rate, view.dropFrame) - view.startFrameCount;
	return sequenceFrameBoundarySample(Math.max(0, count), view.rate, sampleRate);
}

function rationalRate(value: unknown): SequenceRationalRate {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A sequence rate must be rational.');
	const candidate = value as Record<string, unknown>;
	return Object.freeze({
		num: positiveSafeInteger(candidate.num, 'rate.num'),
		den: positiveSafeInteger(candidate.den, 'rate.den'),
	});
}

function timecodeFields(value: unknown): SequenceTimecode {
	const candidate = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return Object.freeze({
		negative: candidate.negative === true,
		hours: nonNegativeSafeInteger(candidate.hours ?? 0, 'startTimecode.hours'),
		minutes: nonNegativeSafeInteger(candidate.minutes ?? 0, 'startTimecode.minutes'),
		seconds: nonNegativeSafeInteger(candidate.seconds ?? 0, 'startTimecode.seconds'),
		frames: nonNegativeSafeInteger(candidate.frames ?? 0, 'startTimecode.frames'),
	});
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}
