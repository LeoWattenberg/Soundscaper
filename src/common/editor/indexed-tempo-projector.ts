/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	beatToSampleFrame,
	roundRational,
	type HoldTempoMap,
	type RationalInput,
	type SampleFrame,
} from './timeline-time.ts';

interface BigFraction {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

interface IndexedTempoEvent {
	readonly beat: BigFraction;
	readonly bpm: BigFraction;
	readonly samplePosition: BigFraction;
}

/**
 * Validate and preindex one held tempo map, then point-project beats without
 * rescanning its event prefix. Every result retains origin-exact accumulation
 * and rounds only the final absolute sample coordinate.
 */
export function createIndexedBeatFrameProjector(
	tempoMap: HoldTempoMap,
	sampleRate: number,
): (beat: RationalInput) => SampleFrame {
	beatToSampleFrame(0, tempoMap, sampleRate, 'point');
	const events = indexTempoEvents(tempoMap, sampleRate);
	return (beat) => {
		const target = fraction(beat);
		const active = events[activeEventIndex(events, target)];
		const position = add(
			active.samplePosition,
			tempoSegmentSamples(target, active.beat, active.bpm, sampleRate),
		);
		return roundRational(position.numerator, position.denominator, 'point') as SampleFrame;
	};
}

function indexTempoEvents(tempoMap: HoldTempoMap, sampleRate: number): readonly IndexedTempoEvent[] {
	const result: IndexedTempoEvent[] = [];
	let musicalPosition = integerFraction(0);
	for (const [index, event] of tempoMap.events.entries()) {
		const beat = fraction(event.beat);
		const bpm = fraction(event.bpm);
		if (tempoMap.mode === 'musical' && index > 0) {
			const previous = result[index - 1];
			musicalPosition = add(
				musicalPosition,
				tempoSegmentSamples(beat, previous.beat, previous.bpm, sampleRate),
			);
		}
		result.push(Object.freeze({
			beat,
			bpm,
			samplePosition: tempoMap.mode === 'sampleLocked'
				? integerFraction(Number(event.samplePosition))
				: musicalPosition,
		}));
	}
	return Object.freeze(result);
}

function activeEventIndex(events: readonly IndexedTempoEvent[], target: BigFraction): number {
	let lower = 1;
	let upper = events.length;
	while (lower < upper) {
		const middle = lower + Math.floor((upper - lower) / 2);
		if (compare(events[middle].beat, target) <= 0) lower = middle + 1;
		else upper = middle;
	}
	return lower - 1;
}

function tempoSegmentSamples(
	endBeat: BigFraction,
	startBeat: BigFraction,
	bpm: BigFraction,
	sampleRate: number,
): BigFraction {
	return divide(
		multiply(
			subtract(endBeat, startBeat),
			Object.freeze({ numerator: 60n * BigInt(sampleRate), denominator: 1n }),
		),
		bpm,
	);
}

function fraction(value: RationalInput): BigFraction {
	if (typeof value === 'number') return numberFraction(value);
	if (!value || typeof value !== 'object') throw new TypeError('A rational value is required.');
	if (!Number.isSafeInteger(value.num)) throw new RangeError('rational.num must be a safe integer.');
	if (!Number.isSafeInteger(value.den)) throw new RangeError('rational.den must be a safe integer.');
	if (value.den === 0) throw new RangeError('rational.den cannot be zero.');
	return reduce(BigInt(value.num), BigInt(value.den));
}

function numberFraction(value: number): BigFraction {
	if (!Number.isFinite(value)) throw new RangeError('rational must be finite.');
	if (Number.isSafeInteger(value)) return integerFraction(value);
	const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value.toString());
	if (!match) throw new RangeError('The number cannot be represented as a finite rational.');
	const decimals = match[3] ?? '';
	const exponent = Number(match[4] ?? 0) - decimals.length;
	let numerator = BigInt(`${match[2]}${decimals}`) * (match[1] === '-' ? -1n : 1n);
	let denominator = 1n;
	if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
	else denominator = 10n ** BigInt(-exponent);
	return reduce(numerator, denominator);
}

function integerFraction(value: number): BigFraction {
	return Object.freeze({ numerator: BigInt(value), denominator: 1n });
}

function add(left: BigFraction, right: BigFraction): BigFraction {
	const divisor = greatestCommonDivisor(left.denominator, right.denominator);
	return reduce(
		left.numerator * (right.denominator / divisor)
			+ right.numerator * (left.denominator / divisor),
		(left.denominator / divisor) * right.denominator,
	);
}

function subtract(left: BigFraction, right: BigFraction): BigFraction {
	return add(left, Object.freeze({ numerator: -right.numerator, denominator: right.denominator }));
}

function multiply(left: BigFraction, right: BigFraction): BigFraction {
	const leftDivisor = greatestCommonDivisor(absoluteBigInt(left.numerator), right.denominator);
	const rightDivisor = greatestCommonDivisor(absoluteBigInt(right.numerator), left.denominator);
	return reduce(
		(left.numerator / leftDivisor) * (right.numerator / rightDivisor),
		(left.denominator / rightDivisor) * (right.denominator / leftDivisor),
	);
}

function divide(left: BigFraction, right: BigFraction): BigFraction {
	if (right.numerator === 0n) throw new RangeError('Cannot divide by zero.');
	return multiply(left, Object.freeze({ numerator: right.denominator, denominator: right.numerator }));
}

function compare(left: BigFraction, right: BigFraction): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function reduce(numerator: bigint, denominator: bigint): BigFraction {
	if (denominator === 0n) throw new RangeError('A rational denominator cannot be zero.');
	if (denominator < 0n) {
		numerator = -numerator;
		denominator = -denominator;
	}
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
