/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	beatToSampleFrame,
	normalizeRational,
	roundRational,
	type HoldTempoMap,
	type RationalInput,
} from './timeline-time.ts';

interface BigFraction {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

/** Project a nondecreasing beat stream with one exact scan of a held tempo map. */
export function createMonotonicBeatFrameProjector(
	map: HoldTempoMap,
	sampleRate: number,
): (beat: RationalInput) => number {
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive.');
	const events = map?.events;
	if (!Array.isArray(events) || !events.length) throw new TypeError('A hold tempo map is required.');
	beatToSampleFrame(events[0].beat, map, sampleRate, 'point');
	let eventIndex = 0;
	let eventBeat = fraction(events[0].beat);
	let eventBpm = fraction(events[0].bpm);
	let eventSamples = map.mode === 'sampleLocked'
		? samplePositionFraction(events[0].samplePosition)
		: integerFraction(0);
	let previousTarget: BigFraction | null = null;
	return (beat) => {
		const target = fraction(beat);
		if (previousTarget && compare(previousTarget, target) > 0) {
			throw new RangeError('Monotonic tempo projection targets cannot move backwards.');
		}
		while (eventIndex + 1 < events.length) {
			const next = events[eventIndex + 1];
			const nextBeat = fraction(next.beat);
			if (compare(nextBeat, target) > 0) break;
			eventSamples = map.mode === 'sampleLocked'
				? samplePositionFraction(next.samplePosition)
				: add(eventSamples, tempoSegmentSamples(nextBeat, eventBeat, eventBpm, sampleRate));
			eventIndex += 1;
			eventBeat = nextBeat;
			eventBpm = fraction(next.bpm);
		}
		previousTarget = target;
		const position = add(eventSamples, tempoSegmentSamples(target, eventBeat, eventBpm, sampleRate));
		return roundRational(position.numerator, position.denominator, 'point');
	};
}

function tempoSegmentSamples(
	endBeat: BigFraction,
	startBeat: BigFraction,
	bpm: BigFraction,
	sampleRate: number,
): BigFraction {
	const span = subtract(endBeat, startBeat);
	return reduce(
		span.numerator * 60n * BigInt(sampleRate) * bpm.denominator,
		span.denominator * bpm.numerator,
	);
}

function fraction(value: RationalInput): BigFraction {
	const rational = normalizeRational(value, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	return reduce(BigInt(rational.num), BigInt(rational.den));
}

function samplePositionFraction(value: unknown): BigFraction {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('Sample-locked tempo events require non-negative sample positions.');
	}
	return integerFraction(Number(value));
}

function integerFraction(value: number): BigFraction {
	return Object.freeze({ numerator: BigInt(value), denominator: 1n });
}

function add(left: BigFraction, right: BigFraction): BigFraction {
	return reduce(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function subtract(left: BigFraction, right: BigFraction): BigFraction {
	return reduce(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function compare(left: BigFraction, right: BigFraction): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function reduce(numerator: bigint, denominator: bigint): BigFraction {
	if (denominator <= 0n) throw new RangeError('A positive rational denominator is required.');
	const divisor = greatestCommonDivisor(numerator, denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left < 0n ? -left : left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a || 1n;
}
