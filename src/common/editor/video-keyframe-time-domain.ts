/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from './timeline-coordinate-limits.ts';
import {
	addMultiplyDivideRationals,
	addRationals,
	compareRationalSum,
	compareRationals,
	normalizeRational,
	subtractRationals,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';

export interface VideoKeyframeTimeDomain {
	readonly authoredDuration: Rational;
	readonly viewStart: Rational;
	readonly viewDuration: Rational;
}

export interface VideoKeyframeTimeRange {
	readonly start: RationalInput;
	readonly end: RationalInput;
}

export interface TrimmedVideoKeyframeTimeDomain {
	readonly timeDomain: VideoKeyframeTimeDomain;
	readonly curveOffset: Rational;
	readonly duration: Rational;
}

export interface SplitVideoKeyframeTimeDomains {
	readonly left: TrimmedVideoKeyframeTimeDomain;
	readonly right: TrimmedVideoKeyframeTimeDomain;
}

/** Snapshot the persisted authored domain and current visible view window. */
export function normalizeVideoKeyframeTimeDomain(
	value: unknown,
	name = 'video keyframe time domain',
): VideoKeyframeTimeDomain {
	const record = readClosedDomainRecord(
		value,
		name,
		['authoredDuration', 'viewStart', 'viewDuration'],
	);
	const authoredDuration = persistedRational(field(record, 'authoredDuration', name), `${name}.authoredDuration`);
	const viewStart = persistedRational(field(record, 'viewStart', name), `${name}.viewStart`);
	const viewDuration = persistedRational(field(record, 'viewDuration', name), `${name}.viewDuration`);
	if (compareRationals(authoredDuration, 0) <= 0) {
		throw new RangeError(`${name}.authoredDuration must be positive.`);
	}
	if (compareRationals(viewStart, 0) < 0) {
		throw new RangeError(`${name}.viewStart must be non-negative.`);
	}
	if (compareRationals(viewDuration, 0) <= 0) {
		throw new RangeError(`${name}.viewDuration must be positive.`);
	}
	if (compareRationalSum(viewStart, viewDuration, authoredDuration) > 0) {
		throw new RangeError(`${name} view must stay inside the authored domain.`);
	}
	return Object.freeze({ authoredDuration, viewStart, viewDuration });
}

/** Create the contextual fresh-clip domain; there is no duration-free default. */
export function createVideoKeyframeTimeDomain(durationValue: RationalInput): VideoKeyframeTimeDomain {
	const duration = coordinateRational(durationValue, 'video keyframe authored duration');
	if (compareRationals(duration, 0) <= 0) {
		throw new RangeError('A video keyframe authored duration must be positive.');
	}
	return normalizeVideoKeyframeTimeDomain({
		authoredDuration: duration,
		viewStart: { num: 0, den: 1 },
		viewDuration: duration,
	});
}

/** Map one visible clip-local query into the stable authored coordinate space. */
export function mapVideoKeyframeVisiblePosition(
	timeDomainValue: unknown,
	durationValue: RationalInput,
	positionValue: RationalInput,
): Rational {
	const timeDomain = normalizeVideoKeyframeTimeDomain(timeDomainValue);
	const duration = positiveCoordinate(durationValue, 'video keyframe visible duration');
	const position = coordinateRational(positionValue, 'video keyframe visible position');
	if (compareRationals(position, 0) < 0 || compareRationals(position, duration) > 0) {
		throw new RangeError('The video keyframe position is outside the visible clip domain.');
	}
	return mapUnbounded(timeDomain, duration, position);
}

/**
 * Reframe a visible range without cutting any curve. Extending before the
 * authored origin shifts the complete curve and grows the authored domain;
 * extending after it grows only the authored duration.
 */
export function trimVideoKeyframeTimeDomain(
	timeDomainValue: unknown,
	durationValue: RationalInput,
	rangeValue: VideoKeyframeTimeRange | unknown,
): TrimmedVideoKeyframeTimeDomain {
	const timeDomain = normalizeVideoKeyframeTimeDomain(timeDomainValue);
	const duration = positiveCoordinate(durationValue, 'video keyframe trim source duration');
	const range = readClosedDomainRecord(rangeValue, 'video keyframe trim range', ['start', 'end']);
	const start = coordinateRational(field(range, 'start', 'video keyframe trim range'), 'video keyframe trim range.start');
	const end = coordinateRational(field(range, 'end', 'video keyframe trim range'), 'video keyframe trim range.end');
	if (compareRationals(start, end) >= 0) {
		throw new RangeError('A video keyframe trim range must have positive duration.');
	}
	const mappedStart = mapUnbounded(timeDomain, duration, start);
	const mappedEnd = mapUnbounded(timeDomain, duration, end);
	const curveOffset = compareRationals(mappedStart, 0) < 0
		? subtractRationals(0, mappedStart)
		: normalizeRational(0);
	const shiftedStart = addRationals(mappedStart, curveOffset);
	const shiftedEnd = addRationals(mappedEnd, curveOffset);
	const shiftedAuthoredEnd = addRationals(timeDomain.authoredDuration, curveOffset);
	const authoredDuration = compareRationals(shiftedEnd, shiftedAuthoredEnd) > 0
		? shiftedEnd
		: shiftedAuthoredEnd;
	const viewDuration = subtractRationals(shiftedEnd, shiftedStart);
	return Object.freeze({
		timeDomain: normalizeVideoKeyframeTimeDomain({
			authoredDuration: persistedDerivedRational(
				authoredDuration,
				'video keyframe trim authored duration',
			),
			viewStart: persistedDerivedRational(shiftedStart, 'video keyframe trim view start'),
			viewDuration: persistedDerivedRational(viewDuration, 'video keyframe trim view duration'),
		}),
		curveOffset: persistedDerivedRational(curveOffset, 'video keyframe trim curve offset'),
		duration: coordinateRational(subtractRationals(end, start), 'video keyframe trim destination duration'),
	});
}

/** Partition one visible window while both children retain the complete curve. */
export function splitVideoKeyframeTimeDomain(
	timeDomainValue: unknown,
	durationValue: RationalInput,
	positionValue: RationalInput,
): SplitVideoKeyframeTimeDomains {
	const duration = positiveCoordinate(durationValue, 'video keyframe split source duration');
	const position = coordinateRational(positionValue, 'video keyframe split position');
	if (compareRationals(position, 0) <= 0 || compareRationals(position, duration) >= 0) {
		throw new RangeError('A video keyframe split must be inside the visible clip domain.');
	}
	return Object.freeze({
		left: trimVideoKeyframeTimeDomain(timeDomainValue, duration, { start: 0, end: position }),
		right: trimVideoKeyframeTimeDomain(timeDomainValue, duration, { start: position, end: duration }),
	});
}

/** A stretch changes the visible duration, never the persisted authored path. */
export function stretchVideoKeyframeTimeDomain(
	timeDomainValue: unknown,
	destinationDurationValue: RationalInput,
): VideoKeyframeTimeDomain {
	positiveCoordinate(destinationDurationValue, 'video keyframe stretch destination duration');
	return normalizeVideoKeyframeTimeDomain(timeDomainValue);
}

/** Rejoin two exact split views without reconstructing or sampling their path. */
export function joinVideoKeyframeTimeDomains(
	leftValue: unknown,
	leftDurationValue: RationalInput,
	rightValue: unknown,
	rightDurationValue: RationalInput,
): VideoKeyframeTimeDomain {
	const left = normalizeVideoKeyframeTimeDomain(leftValue, 'left video keyframe time domain');
	const right = normalizeVideoKeyframeTimeDomain(rightValue, 'right video keyframe time domain');
	const leftDuration = positiveCoordinate(leftDurationValue, 'left video keyframe duration');
	const rightDuration = positiveCoordinate(rightDurationValue, 'right video keyframe duration');
	if (compareRationals(left.authoredDuration, right.authoredDuration) !== 0) {
		throw new RangeError('Joined video keyframes must share one authored duration.');
	}
	if (compareRationalSum(left.viewStart, left.viewDuration, right.viewStart) !== 0) {
		throw new RangeError('Joined video keyframe views must be adjacent and ordered.');
	}
	if (!ratesEqual(left.viewDuration, leftDuration, right.viewDuration, rightDuration)) {
		throw new RangeError('Joined video keyframe views must have one exact stretch rate.');
	}
	return normalizeVideoKeyframeTimeDomain({
		authoredDuration: left.authoredDuration,
		viewStart: left.viewStart,
		viewDuration: addRationals(left.viewDuration, right.viewDuration),
	});
}

function mapUnbounded(
	timeDomain: VideoKeyframeTimeDomain,
	duration: Rational,
	position: Rational,
): Rational {
	return coordinateRational(addMultiplyDivideRationals(
		timeDomain.viewStart, position, timeDomain.viewDuration, duration,
	), 'mapped video keyframe position');
}

function ratesEqual(
	leftView: Rational,
	leftDuration: Rational,
	rightView: Rational,
	rightDuration: Rational,
): boolean {
	return BigInt(leftView.num) * BigInt(leftDuration.den)
		* BigInt(rightView.den) * BigInt(rightDuration.num)
		=== BigInt(rightView.num) * BigInt(rightDuration.den)
			* BigInt(leftView.den) * BigInt(leftDuration.num);
}

function persistedRational(value: unknown, name: string): Rational {
	if (typeof value === 'number') throw new TypeError(`${name} must be a rational object.`);
	const record = readClosedDomainRecord(value, name, ['num', 'den']);
	for (const key of ['num', 'den'] as const) {
		if (Object.is(field(record, key, name), -0)) {
			throw new RangeError(`${name}.${key} must not be negative zero.`);
		}
	}
	const num = field(record, 'num', name);
	const den = field(record, 'den', name);
	const normalized = normalizeRational({ num: num as number, den: den as number });
	if (num !== normalized.num || den !== normalized.den) {
		throw new RangeError(`${name} must be a canonical reduced rational object.`);
	}
	return normalized;
}

function persistedDerivedRational(value: RationalInput, name: string): Rational {
	try { return normalizeRational(value); } catch (error) {
		if (error instanceof RangeError) throw new RangeError(`${name} is outside the persisted rational domain.`, { cause: error });
		throw error;
	}
}

function coordinateRational(value: unknown, name: string): Rational {
	if (typeof value === 'number') {
		if (Object.is(value, -0)) throw new RangeError(`${name} must not be negative zero.`);
		return normalizeRational(value, { maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR });
	}
	const record = readClosedDomainRecord(value, name, ['num', 'den']);
	for (const key of ['num', 'den'] as const) {
		if (Object.is(field(record, key, name), -0)) throw new RangeError(`${name}.${key} must not be negative zero.`);
	}
	return normalizeRational({
		num: field(record, 'num', name) as number,
		den: field(record, 'den', name) as number,
	}, { maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR });
}

function positiveCoordinate(value: unknown, name: string): Rational {
	const result = coordinateRational(value, name);
	if (compareRationals(result, 0) <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}
