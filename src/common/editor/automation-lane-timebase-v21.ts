/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationLaneTimebaseV21 } from './automation-lane-v21.ts';
import { createIndexedBeatFrameProjector } from './indexed-tempo-projector.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import { normalizeRational, type HoldTempoMap, type Rational } from './timeline-time.ts';

export interface AutomationLaneTimebaseOptionsV21 {
	readonly sampleRate: number;
	readonly tempoMap?: HoldTempoMap;
}

/**
 * Convert one authored lane position between the sample and beat timebases through the
 * project's tempo map. Reinterpreting the raw number instead would silently re-time the
 * lane, because a sample frame and a beat are different coordinates, not two spellings
 * of one. A position the target timebase cannot express exactly is refused rather than
 * rounded into the document.
 */
export function convertAutomationLanePositionV21(
	position: unknown,
	from: AutomationLaneTimebaseV21,
	to: AutomationLaneTimebaseV21,
	options: AutomationLaneTimebaseOptionsV21,
): number | Rational {
	const sampleRate = positiveSafeInteger(options.sampleRate, 'sampleRate');
	if (from === to) throw new RangeError('An automation timebase conversion requires two timebases.');
	const tempoMap = options.tempoMap;
	if (!tempoMap) throw new TypeError('An automation timebase conversion requires the project tempo map.');
	if (to === 'musical-beats') {
		const frame = nonNegativeSafeInteger(position, 'automation position');
		return canonicalRational(sampleFrameToBeat(frame, tempoMap, sampleRate));
	}
	const beat = canonicalRational(position);
	const frame = createIndexedBeatFrameProjector(tempoMap, sampleRate)(beat);
	return nonNegativeSafeInteger(frame, 'converted automation position');
}

/**
 * Convert one Bézier control position, which is a rational in either timebase.
 *
 * A lane's points are bare sample frames on the sample timebase and rationals on
 * the beat timebase; its curve controls are rationals in both. Converting a
 * control through the point rule wrote a bare number where the document requires
 * a rational, and the lane was only refused later, on Apply, naming a field the
 * operator never edited.
 */
export function convertAutomationLaneControlPositionV21(
	position: unknown,
	from: AutomationLaneTimebaseV21,
	to: AutomationLaneTimebaseV21,
	options: AutomationLaneTimebaseOptionsV21,
): Rational {
	const source = from === 'absolute-samples' ? controlFrame(position) : position;
	const converted = convertAutomationLanePositionV21(source, from, to, options);
	return typeof converted === 'number'
		? Object.freeze({ num: converted, den: 1 })
		: converted;
}

/**
 * The whole sample a control sits on.
 *
 * A control between two samples has no exact beat, and this conversion refuses
 * what it cannot state exactly rather than rounding it into the document.
 */
function controlFrame(position: unknown): number {
	const rational = canonicalRational(position);
	if (rational.den !== 1) {
		throw new RangeError('A Bézier control between samples cannot be stated in beats.');
	}
	return rational.num;
}

/** Reject a conversion that collapsed or reordered authored positions. */
export function assertConvertedPositionsOrderedV21(
	positions: readonly (number | Rational)[],
): true {
	for (let index = 1; index < positions.length; index += 1) {
		if (comparePositions(positions[index - 1]!, positions[index]!) >= 0) {
			throw new RangeError('This tempo map cannot express the lane in the requested timebase.');
		}
	}
	return true;
}

function comparePositions(left: number | Rational, right: number | Rational): number {
	const first = typeof left === 'number' ? { num: left, den: 1 } : left;
	const second = typeof right === 'number' ? { num: right, den: 1 } : right;
	return first.num * second.den - second.num * first.den;
}

function canonicalRational(value: unknown): Rational {
	if (typeof value === 'number') return normalizeRational(value);
	if (!value || typeof value !== 'object') throw new RangeError('An automation position must be rational.');
	const record = value as Readonly<{ num?: unknown; den?: unknown }>;
	if (!Number.isSafeInteger(record.num) || !Number.isSafeInteger(record.den)) {
		throw new RangeError('An automation position must be a canonical safe-integer rational.');
	}
	return normalizeRational({ num: Number(record.num), den: Number(record.den) });
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
