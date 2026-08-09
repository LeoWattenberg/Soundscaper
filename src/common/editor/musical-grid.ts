/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addRationals,
	compareRationals,
	divideRationals,
	multiplyRationals,
	normalizeRational,
	roundRational,
	subtractRationals,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';

export interface SignatureEvent {
	readonly id?: string;
	readonly bar: number;
	readonly numerator: number;
	readonly denominator: number;
}

export interface SignatureMap {
	readonly events: readonly SignatureEvent[];
}

export interface BarBoundaryPair {
	readonly lowerBar: number;
	readonly lowerBeat: Rational;
	readonly upperBar: number;
	readonly upperBeat: Rational;
}

/** Resolve an integer bar through a hold-only, bar-anchored signature map. */
export function barStartBeat(bar: number, map: SignatureMap): Rational {
	if (!Number.isSafeInteger(bar)) throw new RangeError('bar must be a safe integer.');
	const events = signatureEvents(map);
	if (bar < 0) return multiplyRationals(bar, measureBeats(events[0]));
	let active = events[0];
	let activeBar = 0;
	let beat = normalizeRational(0);
	for (let index = 1; index < events.length && events[index].bar <= bar; index += 1) {
		const next = events[index];
		beat = addRationals(beat, multiplyRationals(next.bar - activeBar, measureBeats(active)));
		active = next;
		activeBar = next.bar;
	}
	return addRationals(beat, multiplyRationals(bar - activeBar, measureBeats(active)));
}

/** Find the adjacent bar boundaries enclosing an exact beat coordinate. */
export function surroundingBarBoundaries(beat: RationalInput, map: SignatureMap): BarBoundaryPair {
	const target = normalizeRational(beat, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	const events = signatureEvents(map);
	let active = events[0];
	let activeBeat = normalizeRational(0);
	for (let index = 1; index < events.length; index += 1) {
		const candidate = events[index];
		const candidateBeat = addRationals(
			activeBeat,
			multiplyRationals(candidate.bar - active.bar, measureBeats(active)),
		);
		if (compareRationals(target, candidateBeat) < 0) break;
		active = candidate;
		activeBeat = candidateBeat;
	}
	const offset = divideRationals(subtractRationals(target, activeBeat), measureBeats(active));
	const wholeBars = roundRational(
		BigInt(offset.num),
		BigInt(offset.den),
		'directional',
		'previous',
	);
	const lowerBar = safeAdd(active.bar, wholeBars, 'bar boundary');
	const upperBar = safeAdd(lowerBar, 1, 'bar boundary');
	const lowerBeat = addRationals(activeBeat, multiplyRationals(lowerBar - active.bar, measureBeats(active)));
	const upperBeat = addRationals(lowerBeat, measureBeats(active));
	return Object.freeze({
		lowerBar,
		lowerBeat,
		upperBar,
		upperBeat,
	});
}

function signatureEvents(map: SignatureMap): readonly SignatureEvent[] {
	if (!Array.isArray(map?.events) || !map.events.length) throw new TypeError('A signature map is required.');
	let previous = -1;
	for (const [index, event] of map.events.entries()) {
		if (!Number.isSafeInteger(event.bar) || event.bar < 0 || (index === 0 && event.bar !== 0)
			|| (index > 0 && event.bar <= previous)) {
			throw new RangeError('Signature events must use strictly increasing non-negative bars beginning at zero.');
		}
		if (!Number.isSafeInteger(event.numerator) || event.numerator <= 0
			|| !isPowerOfTwo(event.denominator)) {
			throw new RangeError('Signature events require a positive numerator and power-of-two denominator.');
		}
		previous = event.bar;
	}
	return map.events;
}

function measureBeats(event: SignatureEvent): Rational {
	return normalizeRational({ num: event.numerator * 4, den: event.denominator });
}

function isPowerOfTwo(value: number): boolean {
	if (!Number.isSafeInteger(value) || value <= 0) return false;
	const bits = BigInt(value);
	return (bits & (bits - 1n)) === 0n;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
