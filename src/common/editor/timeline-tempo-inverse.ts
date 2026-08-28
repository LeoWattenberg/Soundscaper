/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addRationals,
	beatToSampleFrame,
	compareRationals,
	divideRationals,
	multiplyRationals,
	normalizeRational,
	roundRational,
	type HoldTempoEvent,
	type HoldTempoMap,
	type Rational,
} from './timeline-time.ts';

const MAXIMUM_SAFE_RATIONAL_COMPONENT = BigInt(Number.MAX_SAFE_INTEGER);

interface SampleLockedTempoEvent {
	readonly bpm: Rational;
	readonly samplePosition?: number;
}

/** Prove that each tempo segment can add exact sample quanta inside the JSON-safe rational domain. */
export function validateTempoInverseRationalClosure(tempoMap: HoldTempoMap, sampleRate: number): true {
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive.');
	if (!Array.isArray(tempoMap?.events) || !tempoMap.events.length) throw new TypeError('A hold tempo map is required.');
	for (const [index, event] of tempoMap.events.entries()) {
		const beat = bigRational(event.beat);
		const bpm = bigRational(event.bpm);
		const beatsPerSample = reduceBigRational(
			bpm.numerator,
			bpm.denominator * 60n * BigInt(sampleRate),
		);
		const commonDenominator = beat.denominator
			/ greatestCommonDivisor(beat.denominator, beatsPerSample.denominator)
			* beatsPerSample.denominator;
		if (commonDenominator > MAXIMUM_SAFE_RATIONAL_COMPONENT) {
			throw new RangeError(
				`tempoMap.events[${String(index)}] cannot reconcile exact sample edits to a safe rational denominator.`,
			);
		}
		const sum = reduceBigRational(
			beat.numerator * (commonDenominator / beat.denominator)
				+ beatsPerSample.numerator * (commonDenominator / beatsPerSample.denominator),
			commonDenominator,
		);
		if (absoluteBigInt(sum.numerator) > MAXIMUM_SAFE_RATIONAL_COMPONENT
			|| sum.denominator > MAXIMUM_SAFE_RATIONAL_COMPONENT) {
			throw new RangeError(
				`tempoMap.events[${String(index)}] cannot reconcile exact sample edits to a safe rational value.`,
			);
		}
	}
	return true;
}

/** Derive every beat from authoritative integer sample positions and preceding held tempos. */
export function deriveSampleLockedTempoEventBeats(
	events: readonly SampleLockedTempoEvent[],
	sampleRate: number,
): readonly Rational[] {
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive.');
	if (!Array.isArray(events) || !events.length) throw new TypeError('Sample-locked tempo events are required.');
	const beats: Rational[] = [];
	let beat = normalizeRational(0);
	let previousSample = -1;
	for (const [index, event] of events.entries()) {
		const sample = Number(event.samplePosition);
		if (!Number.isSafeInteger(sample) || sample < 0 || (index === 0 && sample !== 0) || sample <= previousSample) {
			throw new RangeError('Sample-locked tempo positions must increase from sample zero.');
		}
		const bpm = normalizeRational(event.bpm, { maximumDenominator: Number.MAX_SAFE_INTEGER });
		if (bpm.num <= 0) throw new RangeError('Sample-locked tempo values must be positive.');
		if (index > 0) {
			const previousBpm = tempoEvent(events, index - 1).bpm;
			beat = addRationals(beat, multiplyRationals(
				sample - previousSample,
				divideRationals(previousBpm, 60 * sampleRate),
			));
		}
		beats.push(beat);
		previousSample = sample;
	}
	return Object.freeze(beats);
}

/** Require persisted derived beats to agree exactly with sample-locked authority. */
export function validateSampleLockedTempoBeatAuthority(tempoMap: HoldTempoMap, sampleRate: number): true {
	const beats = deriveSampleLockedTempoEventBeats(tempoMap.events, sampleRate);
	for (const [index, event] of tempoMap.events.entries()) {
		if (compareRationals(event.beat, rationalAt(beats, index)) !== 0) {
			throw new RangeError(`tempoMap.events[${String(index)}].beat must equal its exact sample authority.`);
		}
	}
	return true;
}

/** Invert a hold-only tempo map at one integer sample position without accumulating rounded segments. */
export function sampleFrameToBeat(
	frame: number,
	tempoMap: HoldTempoMap,
	sampleRate: number,
): Rational {
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('frame must be a non-negative safe integer.');
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive.');
	if (!Array.isArray(tempoMap?.events) || !tempoMap.events.length) throw new TypeError('A hold tempo map is required.');
	const events = tempoMap.events;
	const eventFrames = tempoEventFrames(events, tempoMap, sampleRate);
	let activeIndex = 0;
	for (let index = 1; index < events.length; index += 1) {
		const candidateFrame = frameAt(eventFrames, index);
		if (frame < candidateFrame) break;
		activeIndex = index;
	}
	const active = tempoEvent(events, activeIndex);
	const activeFrame = frameAt(eventFrames, activeIndex);
	const sampleOffset = normalizeRational(frame - activeFrame);
	const beatsPerSample = divideRationals(active.bpm, 60 * sampleRate);
	return addRationals(active.beat, multiplyRationals(sampleOffset, beatsPerSample));
}

function tempoEventFrames(
	events: readonly HoldTempoEvent[],
	map: HoldTempoMap,
	sampleRate: number,
): readonly number[] {
	const firstEvent = tempoEvent(events, 0);
	beatToSampleFrame(firstEvent.beat, map, sampleRate, 'point');
	if (map.mode === 'sampleLocked') {
		return events.map((event) => {
			if (!Number.isSafeInteger(event.samplePosition) || Number(event.samplePosition) < 0) {
				throw new RangeError('Sample-locked tempo events require non-negative sample positions.');
			}
			return Number(event.samplePosition);
		});
	}
	const frames = [0];
	let position = reduceBigRational(0n, 1n);
	let previousBeat = bigRational(firstEvent.beat);
	let previousBpm = bigRational(firstEvent.bpm);
	for (let index = 1; index < events.length; index += 1) {
		const event = tempoEvent(events, index);
		const beat = bigRational(event.beat);
		const span = subtractBigRational(beat, previousBeat);
		const segment = reduceBigRational(
			span.numerator * 60n * BigInt(sampleRate) * previousBpm.denominator,
			span.denominator * previousBpm.numerator,
		);
		position = addBigRational(position, segment);
		frames.push(roundRational(position.numerator, position.denominator, 'point'));
		previousBeat = beat;
		previousBpm = bigRational(event.bpm);
	}
	return frames;
}

function tempoEvent<T extends HoldTempoEvent | SampleLockedTempoEvent>(events: readonly T[], index: number): T {
	const event = events[index];
	if (!event) throw new RangeError('The tempo event list is incomplete.');
	return event;
}

function rationalAt(values: readonly Rational[], index: number): Rational {
	const value = values[index];
	if (!value) throw new RangeError('The derived tempo beat list is incomplete.');
	return value;
}

function frameAt(values: readonly number[], index: number): number {
	const value = values[index];
	if (value === undefined) throw new RangeError('The tempo event frame list is incomplete.');
	return value;
}

export function orderedBeatRange(start: Rational, end: Rational): true {
	if (compareRationals(start, end) > 0) throw new RangeError('A musical range cannot have a negative extent.');
	return true;
}

function bigRational(value: Rational): Readonly<{ numerator: bigint; denominator: bigint }> {
	const normalized = normalizeRational(value, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	return Object.freeze({ numerator: BigInt(normalized.num), denominator: BigInt(normalized.den) });
}

function reduceBigRational(
	numerator: bigint,
	denominator: bigint,
): Readonly<{ numerator: bigint; denominator: bigint }> {
	if (denominator <= 0n) throw new RangeError('A positive rational denominator is required.');
	const divisor = greatestCommonDivisor(absoluteBigInt(numerator), denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function addBigRational(
	left: Readonly<{ numerator: bigint; denominator: bigint }>,
	right: Readonly<{ numerator: bigint; denominator: bigint }>,
): Readonly<{ numerator: bigint; denominator: bigint }> {
	return reduceBigRational(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function subtractBigRational(
	left: Readonly<{ numerator: bigint; denominator: bigint }>,
	right: Readonly<{ numerator: bigint; denominator: bigint }>,
): Readonly<{ numerator: bigint; denominator: bigint }> {
	return reduceBigRational(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = absoluteBigInt(left);
	let b = absoluteBigInt(right);
	while (b !== 0n) [a, b] = [b, a % b];
	return a || 1n;
}

function absoluteBigInt(value: bigint): bigint {
	return value < 0n ? -value : value;
}
