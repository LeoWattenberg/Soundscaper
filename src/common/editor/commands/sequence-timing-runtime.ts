/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	conformSequenceTimecode,
	isLegalSequenceTimecode,
	isSequenceDropFrameRate,
	type SequenceTimecode,
} from '../sequence-timecode.ts';
import { nonNegativeSafeInteger, positiveSafeInteger } from './scalar-guards.ts';
import {
	normalizeRational,
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type RationalRate,
} from '../timeline-time.ts';
import { CONFORMED_SEQUENCE_PLACEMENT } from './command-projection-transients.ts';
import { defineSequenceTimingCommandHandlers } from './sequence-timing.ts';
import type { SequenceTimingCommandChanges } from './protocol.ts';

const MAXIMUM_RATE_DENOMINATOR = 1_000_000;

type DataRecord = Record<string, unknown> & { [CONFORMED_SEQUENCE_PLACEMENT]?: true };

export function createSequenceTimingRuntimeHandlers() {
	return defineSequenceTimingCommandHandlers({
		'sequence/update': (project, command) => updateSequenceTiming(
			record(project, 'project'),
			nonEmptyString(command.sequenceId, 'sequence ID'),
			command.changes,
		),
	});
}

function updateSequenceTiming(
	project: DataRecord,
	sequenceId: string,
	changes: SequenceTimingCommandChanges,
): void {
	if (!changes || typeof changes !== 'object') throw new TypeError('Sequence timing changes must be an object.');
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const sequences = recordArray(project.sequences, 'project.sequences');
	const sequence = sequences.find((candidate) => String(candidate.id) === sequenceId);
	if (!sequence) throw new ReferenceError(`Sequence ${sequenceId} is missing.`);
	const previousRate = rationalRate(sequence.rate, 'sequence.rate');
	const nextRate = changes.rate === undefined
		? previousRate
		: boundedRate(changes.rate, sampleRate);
	const nextDropFrame = changes.dropFrame === undefined ? sequence.dropFrame === true : Boolean(changes.dropFrame);
	if (nextDropFrame && !isSequenceDropFrameRate(nextRate)) {
		throw new RangeError('Drop frame is only legal at 30000/1001 and 60000/1001.');
	}
	if (changes.name !== undefined) sequence.name = nonEmptyString(changes.name, 'sequence.name');
	if (nextRate.num !== previousRate.num || nextRate.den !== previousRate.den) {
		conformSequenceMedia(project, sequenceId, nextRate, sampleRate);
	}
	sequence.rate = { num: nextRate.num, den: nextRate.den };
	sequence.dropFrame = nextDropFrame;
	sequence.startTimecode = nextStartTimecode(sequence, changes, nextRate, nextDropFrame);
}

/**
 * A rate change preserves wall-clock placement rather than frame indices, so
 * every video clip in the sequence conforms both of its resolved absolute
 * boundaries once onto the new grid and takes their difference as its extent.
 * Each conformed clip carries the conformed-placement marker, so the command
 * reconciliation boundary verifies this placement against the draft's new grid
 * instead of re-deriving it as a delta against the previous one.
 */
function conformSequenceMedia(
	project: DataRecord,
	sequenceId: string,
	rate: RationalRate,
	sampleRate: number,
): void {
	const primarySequenceId = String(project.primarySequenceId ?? '');
	for (const clip of recordArray(project.clips, 'project.clips')) {
		if (!ownsClip(clip, sequenceId, primarySequenceId)) continue;
		conformVideoPlacement(clip, rate, sampleRate);
	}
	const bin = record(project.projectBin, 'project.projectBin');
	const binClips = recordArray(bin.clips, 'project.projectBin.clips');
	const conformedDurations = new Map<string, number>();
	for (const clip of binClips) {
		if (!ownsClip(clip, sequenceId, primarySequenceId)) continue;
		conformedDurations.set(String(clip.binItemId), conformVideoPlacement(clip, rate, sampleRate));
	}
	for (const clip of binClips) {
		const duration = clip.kind === 'audio' ? conformedDurations.get(String(clip.binItemId)) : undefined;
		if (duration !== undefined) clip.durationFrames = duration;
	}
}

/** Conform one video clip and report the resolved duration its new placement carries. */
function conformVideoPlacement(clip: DataRecord, rate: RationalRate, sampleRate: number): number {
	const start = nonNegativeSafeInteger(clip.timelineStartFrame, 'clip.timelineStartFrame');
	const duration = positiveSafeInteger(clip.durationFrames, 'clip.durationFrames');
	const sequenceStartFrame = sampleFrameToVideoFrame(start, rate, sampleRate, 'point');
	const sequenceEndFrame = sampleFrameToVideoFrame(safeSum(start, duration), rate, sampleRate, 'point');
	if (sequenceStartFrame < 0) throw new RangeError(`Video clip ${String(clip.id)} conforms before the sequence origin.`);
	const sequenceFrameCount = Math.max(1, sequenceEndFrame - sequenceStartFrame);
	const resolvedStart = videoFrameToSampleFrame(sequenceStartFrame, rate, sampleRate, 'point');
	const resolvedEnd = videoFrameToSampleFrame(sequenceStartFrame + sequenceFrameCount, rate, sampleRate, 'point');
	clip.sequenceStartFrame = sequenceStartFrame;
	clip.sequenceFrameCount = sequenceFrameCount;
	clip.timelineStartFrame = resolvedStart;
	clip.durationFrames = resolvedEnd - resolvedStart;
	clip[CONFORMED_SEQUENCE_PLACEMENT] = true;
	return resolvedEnd - resolvedStart;
}

function ownsClip(clip: DataRecord, sequenceId: string, primarySequenceId: string): boolean {
	return clip.kind === 'video' && String(clip.sequenceId ?? primarySequenceId) === sequenceId;
}

/**
 * A start timecode is the label the user chose for the sequence origin, so it
 * survives a rate change and is conformed only when the new rate or drop-frame
 * combination stops producing it. An explicitly requested label is rejected
 * rather than repaired.
 */
function nextStartTimecode(
	sequence: DataRecord,
	changes: SequenceTimingCommandChanges,
	rate: RationalRate,
	dropFrame: boolean,
): SequenceTimecode {
	const requested = changes.startTimecode !== undefined;
	const timecode = timecodeFields(requested ? changes.startTimecode : sequence.startTimecode);
	if (!requested) return conformSequenceTimecode(timecode, rate, dropFrame);
	if (!isLegalSequenceTimecode(timecode, rate, dropFrame)) {
		throw new RangeError('A start timecode must be a label the sequence rate produces.');
	}
	return timecode;
}

function timecodeFields(value: unknown): SequenceTimecode {
	const candidate = value == null ? {} : record(value, 'sequence.startTimecode');
	return {
		negative: candidate.negative === true,
		hours: nonNegativeSafeInteger(candidate.hours ?? 0, 'startTimecode.hours'),
		minutes: nonNegativeSafeInteger(candidate.minutes ?? 0, 'startTimecode.minutes'),
		seconds: nonNegativeSafeInteger(candidate.seconds ?? 0, 'startTimecode.seconds'),
		frames: nonNegativeSafeInteger(candidate.frames ?? 0, 'startTimecode.frames'),
	};
}

function boundedRate(value: unknown, sampleRate: number): RationalRate {
	const candidate = record(value, 'sequence.rate');
	const rate = normalizeRational({
		num: positiveSafeInteger(candidate.num, 'sequence.rate.num'),
		den: positiveSafeInteger(candidate.den, 'sequence.rate.den'),
	}, { maximumDenominator: MAXIMUM_RATE_DENOMINATOR });
	if (rate.num > rate.den * sampleRate) throw new RangeError('A sequence rate cannot exceed its sample-rate bound.');
	return { num: rate.num, den: rate.den };
}

function rationalRate(value: unknown, name: string): RationalRate {
	const candidate = record(value, name);
	return {
		num: positiveSafeInteger(candidate.num, `${name}.num`),
		den: positiveSafeInteger(candidate.den, `${name}.den`),
	};
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item) => record(item, name));
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function safeSum(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('A clip range exceeds the safe integer range.');
	return result;
}
