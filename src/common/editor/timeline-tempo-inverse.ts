/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addRationals,
	beatToSampleFrame,
	compareRationals,
	divideRationals,
	multiplyRationals,
	normalizeRational,
	type HoldTempoEvent,
	type HoldTempoMap,
	type Rational,
} from './timeline-time.ts';

const MAXIMUM_SAFE_RATIONAL_COMPONENT = BigInt(Number.MAX_SAFE_INTEGER);

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
	let active = events[0];
	let activeFrame = eventFrame(active, tempoMap, sampleRate);
	for (let index = 1; index < events.length; index += 1) {
		const candidateFrame = eventFrame(events[index], tempoMap, sampleRate);
		if (frame < candidateFrame) break;
		active = events[index];
		activeFrame = candidateFrame;
	}
	const sampleOffset = normalizeRational(frame - activeFrame);
	const beatsPerSample = divideRationals(active.bpm, 60 * sampleRate);
	return addRationals(active.beat, multiplyRationals(sampleOffset, beatsPerSample));
}

function eventFrame(event: HoldTempoEvent, map: HoldTempoMap, sampleRate: number): number {
	if (map.mode === 'sampleLocked') {
		if (!Number.isSafeInteger(event.samplePosition) || Number(event.samplePosition) < 0) {
			throw new RangeError('Sample-locked tempo events require non-negative sample positions.');
		}
		return Number(event.samplePosition);
	}
	return beatToSampleFrame(event.beat, map, sampleRate, 'point');
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

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = absoluteBigInt(left);
	let b = absoluteBigInt(right);
	while (b !== 0n) [a, b] = [b, a % b];
	return a || 1n;
}

function absoluteBigInt(value: bigint): bigint {
	return value < 0n ? -value : value;
}
