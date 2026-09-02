/* SPDX-License-Identifier: AGPL-3.0-only */

import { splitAutomationLaneAtFrameV21 } from './automation-lane-interval-edit-v21.ts';
import {
	normalizeAutomationLaneV21,
	type AutomationLaneFrameOptionsV21,
	type AutomationLanePointV21,
	type AutomationLaneV21,
} from './automation-lane-v21.ts';
import {
	divideFractions,
	exactFraction,
	integerFraction,
	interpolateFraction,
	publicFraction,
	subtractFractions,
} from './interpolation-curve-math.ts';
import type { InterpolationShape } from './interpolation-curve.ts';
import type { ParameterAddress, ParameterDescriptor } from './parameter-address.ts';
import { quantizeAutomationValueV21 } from './track-automation-targets-v21.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import {
	compareRationals,
	type HoldTempoMap,
	type Rational,
} from './timeline-time.ts';

type SegmentKind = InterpolationShape['kind'];

interface InlineAutomationContext extends AutomationLaneFrameOptionsV21 {
	readonly descriptor: ParameterDescriptor;
}

export interface CreateAutomationLaneAtFrameV21Options extends InlineAutomationContext {
	readonly address: ParameterAddress;
	readonly currentValue: number;
	readonly frame: number;
	readonly value: number;
	readonly createId: (prefix: 'automation-lane' | 'automation-point') => string;
}

export interface InsertAutomationLanePointV21Options extends InlineAutomationContext {
	readonly frame: number;
	readonly value: number;
	readonly pointId: string;
}

export interface MoveAutomationLanePointV21Options extends InlineAutomationContext {
	readonly pointId: string;
	readonly frame: number;
	readonly value: number;
}

export interface MoveAutomationLaneBezierControlV21Options extends InlineAutomationContext {
	readonly segmentIndex: number;
	readonly control: 'control1' | 'control2';
	readonly frame: number;
	readonly value: number;
}

/** Create the absent lane only when the first authored edit occurs. */
export function createAutomationLaneAtFrameV21(
	options: CreateAutomationLaneAtFrameV21Options,
): AutomationLaneV21 {
	const frame = frameValue(options.frame);
	const laneId = options.createId('automation-lane');
	const baseline = quantizeAutomationValueV21(options.descriptor, options.currentValue);
	const edited = quantizeAutomationValueV21(options.descriptor, options.value);
	const points = frame === 0
		? [{ id: options.createId('automation-point'), position: 0, value: edited }]
		: [
			{ id: options.createId('automation-point'), position: 0, value: baseline },
			{ id: options.createId('automation-point'), position: frame, value: edited },
		];
	return normalizeAutomationLaneV21({
		id: laneId,
		address: options.address,
		timebase: 'absolute-samples',
		points,
		segments: frame === 0 ? [] : [defaultShape(options.descriptor)],
	}, { descriptor: options.descriptor });
}

/** Insert one stable point, preserving the exact authored shape on either side. */
export function insertAutomationLanePointV21(
	laneValue: AutomationLaneV21,
	options: InsertAutomationLanePointV21Options,
): AutomationLaneV21 {
	const lane = normalizeAutomationLaneV21(laneValue, { descriptor: options.descriptor });
	const frame = frameValue(options.frame);
	const position = positionAtFrame(lane, frame, options);
	const authored = lane.points.map((point) => authoredPosition(point, lane.timebase));
	if (authored.some((candidate) => compareRationals(candidate, position) === 0)) {
		throw new RangeError('An automation point already exists at the requested position.');
	}
	const first = authored[0]!;
	const last = authored.at(-1)!;
	const value = quantizeAutomationValueV21(options.descriptor, options.value);
	if (compareRationals(position, first) < 0) return normalizedReplacement(lane, {
		points: [{ id: options.pointId, position: publicPosition(position, lane.timebase), value }, ...lane.points],
		segments: [defaultShape(options.descriptor), ...lane.segments],
	}, options.descriptor);
	if (compareRationals(position, last) > 0) return normalizedReplacement(lane, {
		points: [...lane.points, { id: options.pointId, position: publicPosition(position, lane.timebase), value }],
		segments: [...lane.segments, defaultShape(options.descriptor)],
	}, options.descriptor);
	const split = splitAutomationLaneAtFrameV21(lane, frame, options.pointId, options);
	const splitValue = split.points.find(({ id }) => id === options.pointId)!.value;
	const insertedValue = Math.abs(options.value - splitValue) <= options.descriptor.automationTolerance
		? splitValue
		: value;
	return normalizedReplacement(split, {
		points: split.points.map((point) => point.id === options.pointId
			? { ...point, value: insertedValue }
			: point),
		segments: split.segments,
	}, options.descriptor);
}

/** Move one point without sorting through or deleting any neighboring identities. */
export function moveAutomationLanePointV21(
	laneValue: AutomationLaneV21,
	options: MoveAutomationLanePointV21Options,
): AutomationLaneV21 {
	const lane = normalizeAutomationLaneV21(laneValue, { descriptor: options.descriptor });
	const index = lane.points.findIndex(({ id }) => id === options.pointId);
	if (index < 0) throw new ReferenceError(`Automation point ${options.pointId} is unavailable.`);
	const position = positionAtFrame(lane, frameValue(options.frame), options);
	const previous = index > 0 ? authoredPosition(lane.points[index - 1]!, lane.timebase) : null;
	const next = index < lane.points.length - 1
		? authoredPosition(lane.points[index + 1]!, lane.timebase)
		: null;
	if ((previous && compareRationals(position, previous) <= 0)
		|| (next && compareRationals(position, next) >= 0)) {
		throw new RangeError('An automation point must remain strictly between its neighbors.');
	}
	const oldPoints = lane.points;
	const points = oldPoints.map((point, pointIndex) => pointIndex === index ? {
		...point,
		position: publicPosition(position, lane.timebase),
		value: quantizeAutomationValueV21(options.descriptor, options.value),
	} : point);
	const segments = lane.segments.map((segment, segmentIndex) => {
		if (segment.kind !== 'bezier' || (segmentIndex !== index - 1 && segmentIndex !== index)) {
			return segment;
		}
		return reparameterizedBezier(
			segment,
			authoredPosition(oldPoints[segmentIndex]!, lane.timebase),
			authoredPosition(oldPoints[segmentIndex + 1]!, lane.timebase),
			authoredPosition(points[segmentIndex]!, lane.timebase),
			authoredPosition(points[segmentIndex + 1]!, lane.timebase),
		);
	});
	return normalizedReplacement(lane, { points, segments }, options.descriptor);
}

/** Move one Bézier handle while preserving the segment's ordered time domain. */
export function moveAutomationLaneBezierControlV21(
	laneValue: AutomationLaneV21,
	options: MoveAutomationLaneBezierControlV21Options,
): AutomationLaneV21 {
	const lane = normalizeAutomationLaneV21(laneValue, { descriptor: options.descriptor });
	if (!Number.isSafeInteger(options.segmentIndex) || options.segmentIndex < 0
		|| options.segmentIndex >= lane.segments.length) {
		throw new RangeError('Automation segment index is outside the lane.');
	}
	const segment = lane.segments[options.segmentIndex];
	if (segment?.kind !== 'bezier') {
		throw new RangeError('An automation Bézier control requires a Bézier segment.');
	}
	const start = authoredPosition(lane.points[options.segmentIndex]!, lane.timebase);
	const end = authoredPosition(lane.points[options.segmentIndex + 1]!, lane.timebase);
	const requested = positionAtFrame(lane, frameValue(options.frame), options);
	const other = options.control === 'control1' ? segment.control2.position : segment.control1.position;
	const minimum = options.control === 'control1' ? start : other;
	const maximum = options.control === 'control1' ? other : end;
	const position = compareRationals(requested, minimum) < 0 ? minimum
		: compareRationals(requested, maximum) > 0 ? maximum
			: requested;
	const control = Object.freeze({
		position: publicFraction(exactFraction(position)),
		value: quantizeAutomationValueV21(options.descriptor, options.value),
	});
	const segments = lane.segments.map((candidate, index) => index === options.segmentIndex
		? Object.freeze({ ...segment, [options.control]: control })
		: candidate);
	return normalizedReplacement(lane, { points: lane.points, segments }, options.descriptor);
}

/** Remove one point and explicitly bridge its neighbors. Lane deletion is separate. */
export function removeAutomationLanePointV21(
	laneValue: AutomationLaneV21,
	options: Readonly<{
		pointId: string;
		bridgeKind?: SegmentKind;
		descriptor: ParameterDescriptor;
	}>,
): AutomationLaneV21 {
	const lane = normalizeAutomationLaneV21(laneValue, { descriptor: options.descriptor });
	if (lane.points.length === 1) {
		throw new RangeError('A sole automation point cannot be removed; delete the lane explicitly.');
	}
	const index = lane.points.findIndex(({ id }) => id === options.pointId);
	if (index < 0) throw new ReferenceError(`Automation point ${options.pointId} is unavailable.`);
	const points = lane.points.filter((_point, pointIndex) => pointIndex !== index);
	let segments: readonly InterpolationShape[];
	if (index === 0) segments = lane.segments.slice(1);
	else if (index === lane.points.length - 1) segments = lane.segments.slice(0, -1);
	else {
		const kind = requiredKind(options.descriptor, options.bridgeKind ?? 'linear');
		segments = [
			...lane.segments.slice(0, index - 1),
			shapeForKind(kind, points[index - 1]!, points[index]!, lane.timebase),
			...lane.segments.slice(index + 1),
		];
	}
	return normalizedReplacement(lane, { points, segments }, options.descriptor);
}

export function setAutomationLaneSegmentKindV21(
	laneValue: AutomationLaneV21,
	options: Readonly<{
		segmentIndex: number;
		kind: SegmentKind;
		descriptor: ParameterDescriptor;
	}>,
): AutomationLaneV21 {
	const lane = normalizeAutomationLaneV21(laneValue, { descriptor: options.descriptor });
	if (!Number.isSafeInteger(options.segmentIndex) || options.segmentIndex < 0
		|| options.segmentIndex >= lane.segments.length) {
		throw new RangeError('Automation segment index is outside the lane.');
	}
	const kind = requiredKind(options.descriptor, options.kind);
	const segments = lane.segments.map((segment, index) => index === options.segmentIndex
		? shapeForKind(kind, lane.points[index]!, lane.points[index + 1]!, lane.timebase)
		: segment);
	return normalizedReplacement(lane, { points: lane.points, segments }, options.descriptor);
}

function normalizedReplacement(
	lane: AutomationLaneV21,
	replacement: Readonly<{
		points: readonly Readonly<AutomationLanePointV21>[];
		segments: readonly InterpolationShape[];
	}>,
	descriptor: ParameterDescriptor,
): AutomationLaneV21 {
	return normalizeAutomationLaneV21({
		id: lane.id,
		address: lane.address,
		timebase: lane.timebase,
		points: replacement.points,
		segments: replacement.segments,
	}, { descriptor });
}

function positionAtFrame(
	lane: AutomationLaneV21,
	frame: number,
	options: Readonly<{ sampleRate: number; tempoMap?: HoldTempoMap }>,
): Rational {
	if (lane.timebase === 'absolute-samples') return Object.freeze({ num: frame, den: 1 });
	if (!options.tempoMap) throw new TypeError('A musical automation edit requires the tempo map.');
	return sampleFrameToBeat(frame, options.tempoMap, options.sampleRate);
}

function authoredPosition(
	point: Readonly<AutomationLanePointV21>,
	timebase: AutomationLaneV21['timebase'],
): Rational {
	return timebase === 'absolute-samples'
		? Object.freeze({ num: point.position as number, den: 1 })
		: point.position as Rational;
}

function publicPosition(position: Rational, timebase: AutomationLaneV21['timebase']): number | Rational {
	if (timebase === 'absolute-samples') {
		if (position.den !== 1) throw new RangeError('An absolute automation point requires an integer frame.');
		return position.num;
	}
	return position;
}

function reparameterizedBezier(
	segment: Extract<InterpolationShape, Readonly<{ readonly kind: 'bezier' }>>,
	oldStart: Rational,
	oldEnd: Rational,
	newStart: Rational,
	newEnd: Rational,
): InterpolationShape {
	const oldSpan = subtractFractions(exactFraction(oldEnd), exactFraction(oldStart));
	const amount = (position: Rational) => divideFractions(
		subtractFractions(exactFraction(position), exactFraction(oldStart)), oldSpan,
	);
	const position = (value: Rational) => publicFraction(interpolateFraction(
		exactFraction(newStart), exactFraction(newEnd), amount(value),
	));
	return Object.freeze({
		kind: 'bezier' as const,
		control1: Object.freeze({ ...segment.control1, position: position(segment.control1.position) }),
		control2: Object.freeze({ ...segment.control2, position: position(segment.control2.position) }),
	});
}

function requiredKind(descriptor: ParameterDescriptor, kind: SegmentKind): SegmentKind {
	if (descriptor.taper === 'discrete' && kind !== 'hold') {
		throw new RangeError('A discrete automation lane must use hold segments.');
	}
	return kind;
}

function defaultShape(descriptor: ParameterDescriptor): InterpolationShape {
	return Object.freeze({ kind: descriptor.taper === 'discrete' ? 'hold' : 'linear' });
}

function shapeForKind(
	kind: SegmentKind,
	start: Readonly<AutomationLanePointV21>,
	end: Readonly<AutomationLanePointV21>,
	timebase: AutomationLaneV21['timebase'],
): InterpolationShape {
	if (kind !== 'bezier') return Object.freeze({ kind });
	const first = exactFraction(authoredPosition(start, timebase));
	const last = exactFraction(authoredPosition(end, timebase));
	const third = divideFractions(integerFraction(1), integerFraction(3));
	const twoThirds = divideFractions(integerFraction(2), integerFraction(3));
	return Object.freeze({
		kind,
		control1: Object.freeze({ position: publicFraction(interpolateFraction(first, last, third)), value: start.value }),
		control2: Object.freeze({ position: publicFraction(interpolateFraction(first, last, twoThirds)), value: end.value }),
	});
}

function frameValue(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('An automation edit frame must be a non-negative safe integer.');
	}
	return Number(value);
}
