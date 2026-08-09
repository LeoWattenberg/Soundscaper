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
