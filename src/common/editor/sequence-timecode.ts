/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * SMPTE labelling for foundation sequences.
 *
 * This module owns labels, never timing. A timecode counts sequence frames and
 * says nothing about where those frames land in samples, so drop frame can skip
 * labels without moving a single resolved sample. The sample side of the
 * relationship lives in `sequence-frame-navigation.ts`.
 */

export interface SequenceTimecode {
	readonly negative: boolean;
	readonly hours: number;
	readonly minutes: number;
	readonly seconds: number;
	readonly frames: number;
}

export interface SequenceRationalRate {
	readonly num: number;
	readonly den: number;
}

/** The only rates whose label sequence may skip labels, matching the document validator. */
export const SEQUENCE_DROP_FRAME_RATES: readonly string[] = Object.freeze(['30000/1001', '60000/1001']);

const DROP_FRAME_RATE_SET: ReadonlySet<string> = new Set(SEQUENCE_DROP_FRAME_RATES);
const MINUTES_PER_SKIPPED_DROP = 10;
const TIMECODE_PATTERN = /^(-)?(\d{1,6})[:;](\d{1,2})[:;](\d{1,2})[:;](\d{1,3})$/u;

/**
 * Labels counted per timecode second. Exact integer division keeps this equal
 * to the bound the persisted `startTimecode` validator applies, so a legal
 * label is exactly a legal persisted value.
 */
export function sequenceTimecodeFrameRate(rate: SequenceRationalRate): number {
	const num = positiveSafeInteger(rate?.num, 'sequence.rate.num');
	const den = positiveSafeInteger(rate?.den, 'sequence.rate.den');
	const whole = Math.floor(num / den);
	const nominal = whole * den === num ? whole : whole + 1;
	if (!Number.isSafeInteger(nominal) || nominal < 1) throw new RangeError('A sequence rate must label at least one frame per second.');
	return nominal;
}

/** Whether a rational rate may carry the drop-frame flag. */
export function isSequenceDropFrameRate(rate: SequenceRationalRate): boolean {
	return DROP_FRAME_RATE_SET.has(`${String(rate?.num)}/${String(rate?.den)}`);
}

/** Resolve the label geometry of one rate, rejecting an illegal drop-frame pairing. */
export function sequenceTimecodeGeometry(
	rate: SequenceRationalRate,
	dropFrame: boolean,
): Readonly<{ nominalRate: number; droppedLabels: number }> {
	const nominalRate = sequenceTimecodeFrameRate(rate);
	if (!dropFrame) return Object.freeze({ nominalRate, droppedLabels: 0 });
	if (!isSequenceDropFrameRate(rate)) throw new RangeError('Drop frame is only legal at 30000/1001 and 60000/1001.');
	return Object.freeze({ nominalRate, droppedLabels: (nominalRate / 30) * 2 });
}

/** Label one signed sequence-frame count. Hours are never wrapped at 24. */
export function sequenceTimecodeFromFrameCount(
	count: number,
	rate: SequenceRationalRate,
	dropFrame: boolean,
): SequenceTimecode {
	const frameCount = safeInteger(count, 'sequence frame count');
	const { nominalRate, droppedLabels } = sequenceTimecodeGeometry(rate, dropFrame);
	const magnitude = Math.abs(frameCount);
	const labelled = droppedLabels ? labelledFrameCount(magnitude, nominalRate, droppedLabels) : magnitude;
	const frames = labelled % nominalRate;
	const totalSeconds = (labelled - frames) / nominalRate;
	const seconds = totalSeconds % 60;
	const totalMinutes = (totalSeconds - seconds) / 60;
	return Object.freeze({
		negative: frameCount < 0,
		hours: (totalMinutes - (totalMinutes % 60)) / 60,
		minutes: totalMinutes % 60,
		seconds,
		frames,
	});
}

/** Count the sequence frames a label represents, rejecting labels the rate cannot produce. */
export function sequenceTimecodeToFrameCount(
	timecode: SequenceTimecode,
	rate: SequenceRationalRate,
	dropFrame: boolean,
): number {
	const { nominalRate, droppedLabels } = sequenceTimecodeGeometry(rate, dropFrame);
	const fields = assertSequenceTimecodeFields(timecode, nominalRate, droppedLabels);
	const totalMinutes = safeSum(safeProduct(fields.hours, 60), fields.minutes);
	const skipped = safeProduct(droppedLabels, totalMinutes - Math.floor(totalMinutes / MINUTES_PER_SKIPPED_DROP));
	const labelled = safeSum(
		safeProduct(safeSum(safeProduct(totalMinutes, 60), fields.seconds), nominalRate),
		fields.frames,
	);
	const magnitude = safeSum(labelled, -skipped);
	if (magnitude < 0) throw new RangeError('A timecode label cannot resolve to a negative frame count.');
	return fields.negative ? -magnitude : magnitude;
}

/** Whether a label exists in this rate's sequence of labels. */
export function isLegalSequenceTimecode(
	timecode: SequenceTimecode,
	rate: SequenceRationalRate,
	dropFrame: boolean,
): boolean {
	try {
		sequenceTimecodeToFrameCount(timecode, rate, dropFrame);
		return true;
	} catch {
		return false;
	}
}

/**
 * Move an illegal label onto the nearest label the rate can produce: an
 * out-of-range frame field clamps to the last frame of its second, and a
 * skipped drop-frame label advances to the first label that exists.
 */
export function conformSequenceTimecode(
	timecode: SequenceTimecode,
	rate: SequenceRationalRate,
	dropFrame: boolean,
): SequenceTimecode {
	const { nominalRate, droppedLabels } = sequenceTimecodeGeometry(rate, dropFrame);
	const fields = normalizeTimecodeFields(timecode);
	if (fields.minutes > 59 || fields.seconds > 59) throw new RangeError('A timecode cannot carry more than 59 minutes or seconds.');
	const frames = Math.min(fields.frames, nominalRate - 1);
	const skipped = droppedLabels > 0 && fields.seconds === 0
		&& fields.minutes % MINUTES_PER_SKIPPED_DROP !== 0
		&& frames < droppedLabels;
	return Object.freeze({ ...fields, frames: skipped ? droppedLabels : frames });
}

/** Render a label; drop-frame sequences use the conventional semicolon. */
export function formatSequenceTimecode(
	timecode: SequenceTimecode,
	rate: SequenceRationalRate,
	dropFrame: boolean,
): string {
	const { nominalRate } = sequenceTimecodeGeometry(rate, dropFrame);
	const fields = normalizeTimecodeFields(timecode);
	const frameDigits = Math.max(2, String(nominalRate - 1).length);
	return [
		fields.negative ? '-' : '',
		pad(fields.hours, 2),
		':',
		pad(fields.minutes, 2),
		':',
		pad(fields.seconds, 2),
		dropFrame ? ';' : ':',
		pad(fields.frames, frameDigits),
	].join('');
}

/** Read a label back. Either separator is accepted; the sequence decides drop frame. */
export function parseSequenceTimecode(
	value: string,
	rate: SequenceRationalRate,
	dropFrame: boolean,
): SequenceTimecode {
	const { nominalRate, droppedLabels } = sequenceTimecodeGeometry(rate, dropFrame);
	const match = TIMECODE_PATTERN.exec(String(value ?? '').trim());
	if (!match) throw new RangeError(`Unsupported timecode: ${String(value)}.`);
	const timecode = Object.freeze({
		negative: match[1] === '-',
		hours: Number(match[2]),
		minutes: Number(match[3]),
		seconds: Number(match[4]),
		frames: Number(match[5]),
	});
	return assertSequenceTimecodeFields(timecode, nominalRate, droppedLabels);
}

function labelledFrameCount(count: number, nominalRate: number, droppedLabels: number): number {
	const framesPerMinute = nominalRate * 60 - droppedLabels;
	const framesPerTenMinutes = nominalRate * 600 - droppedLabels * 9;
	const tenMinuteBlocks = Math.floor(count / framesPerTenMinutes);
	const remainder = count % framesPerTenMinutes;
	const withinBlock = remainder >= droppedLabels
		? droppedLabels * Math.floor((remainder - droppedLabels) / framesPerMinute)
		: 0;
	return safeSum(count, droppedLabels * 9 * tenMinuteBlocks + withinBlock);
}

function assertSequenceTimecodeFields(
	timecode: SequenceTimecode,
	nominalRate: number,
	droppedLabels: number,
): SequenceTimecode {
	const fields = normalizeTimecodeFields(timecode);
	if (fields.minutes > 59 || fields.seconds > 59) throw new RangeError('A timecode cannot carry more than 59 minutes or seconds.');
	if (fields.frames >= nominalRate) throw new RangeError('A timecode frame field is outside its sequence rate.');
	if (droppedLabels > 0 && fields.seconds === 0
		&& fields.minutes % MINUTES_PER_SKIPPED_DROP !== 0
		&& fields.frames < droppedLabels) {
		throw new RangeError('A drop-frame sequence does not label this frame.');
	}
	return fields;
}

function normalizeTimecodeFields(timecode: SequenceTimecode): SequenceTimecode {
	if (!timecode || typeof timecode !== 'object') throw new TypeError('A timecode is required.');
	return Object.freeze({
		negative: Boolean(timecode.negative),
		hours: nonNegativeSafeInteger(timecode.hours, 'timecode.hours'),
		minutes: nonNegativeSafeInteger(timecode.minutes, 'timecode.minutes'),
		seconds: nonNegativeSafeInteger(timecode.seconds, 'timecode.seconds'),
		frames: nonNegativeSafeInteger(timecode.frames, 'timecode.frames'),
	});
}

function pad(value: number, digits: number): string {
	return String(value).padStart(digits, '0');
}

function safeProduct(left: number, right: number): number {
	const result = left * right;
	if (!Number.isSafeInteger(result)) throw new RangeError('A timecode exceeds the safe integer range.');
	return result;
}

function safeSum(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('A timecode exceeds the safe integer range.');
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

function positiveSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}
