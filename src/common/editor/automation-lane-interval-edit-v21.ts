/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	AUTOMATION_LANE_MAXIMUM_POINTS_V21,
	normalizeAutomationLaneV21,
	type AutomationLaneFrameOptionsV21,
	type AutomationLanePointV21,
	type AutomationLaneV21,
} from './automation-lane-v21.ts';
import {
	addFractions,
	approximateBoundedFraction,
	compareFractions,
	cubicFraction,
	divideFractions,
	exactFraction,
	fractionNumber,
	interpolateFraction,
	integerFraction,
	publicFraction,
	stableInterpolate,
	subtractFractions,
	type ExactInterpolationFraction,
} from './interpolation-curve-math.ts';
import type { InterpolationShape } from './interpolation-curve.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import type { Rational } from './timeline-time.ts';

export interface AutomationLaneTimelineReplacementV21 {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly insertedDurationFrames: number;
}

interface EditablePoint {
	readonly id: string;
	readonly position: ExactInterpolationFraction;
	readonly value: number;
}

interface EditableCurve {
	readonly points: readonly EditablePoint[];
	readonly segments: readonly InterpolationShape[];
}

interface SplitShape {
	readonly left: InterpolationShape;
	readonly right: InterpolationShape;
}

const ID_ENCODER = new TextEncoder();

/**
 * Replace one exact timeline interval in a lane. The removed interval is
 * discarded, the inserted interval holds the left boundary value, and the
 * surviving suffix moves as authored curve segments rather than sampled data.
 */
export function replaceAutomationLaneTimelineIntervalV21(
	laneValue: AutomationLaneV21,
	editValue: AutomationLaneTimelineReplacementV21,
	options: AutomationLaneFrameOptionsV21,
): AutomationLaneV21 {
	const lane = normalizeAutomationLaneV21(laneValue);
	const edit = normalizedEdit(editValue);
	const sampleRate = positiveSafeInteger(options.sampleRate, 'sampleRate');
	if (edit.startFrame === edit.endFrame && edit.insertedDurationFrames === 0) return laneValue;
	const curve = editableCurve(lane);
	const startPosition = positionAtFrame(lane, edit.startFrame, sampleRate, options);
	const endPosition = positionAtFrame(lane, edit.endFrame, sampleRate, options);
	const insertedEndFrame = safeAdd(
		edit.startFrame,
		edit.insertedDurationFrames,
		'automation inserted interval end',
	);
	const insertedEndPosition = positionAtFrame(lane, insertedEndFrame, sampleRate, options);
	if (edit.startFrame === edit.endFrame
		&& compareFractions(startPosition, curve.points.at(-1)!.position) > 0) return laneValue;

	const prefix = curvePrefixAt(
		lane, curve, startPosition, edit.startFrame,
		boundaryId(lane.id, edit, 'left'), sampleRate, options,
	);
	const suffix = curveSuffixAt(
		lane, curve, endPosition, edit.endFrame,
		boundaryId(lane.id, edit, 'right'), sampleRate, options,
	);
	const shift = subtractFractions(insertedEndPosition, endPosition);
	const shiftedSuffix = shiftCurve(suffix, shift);
	const edited = edit.insertedDurationFrames === 0
		? joinDeletedInterval(lane, edit, prefix, shiftedSuffix, startPosition)
		: joinInsertedInterval(lane, edit, prefix, shiftedSuffix);
	if (edited.points.length > AUTOMATION_LANE_MAXIMUM_POINTS_V21) {
		throw new RangeError('An automation interval edit cannot exceed the 4096-point lane cap.');
	}
	return normalizeAutomationLaneV21({
		id: lane.id,
		address: lane.address,
		timebase: lane.timebase,
		points: edited.points.map((point) => publicPoint(point, lane.timebase)),
		segments: edited.segments,
	});
}

function curvePrefixAt(
	lane: AutomationLaneV21,
	curve: EditableCurve,
	position: ExactInterpolationFraction,
	frame: number,
	id: string,
	sampleRate: number,
	options: AutomationLaneFrameOptionsV21,
): EditableCurve {
	const first = curve.points[0]!;
	const last = curve.points.at(-1)!;
	if (compareFractions(position, first.position) < 0) {
		return { points: [{ id, position, value: first.value }], segments: [] };
	}
	if (compareFractions(position, last.position) > 0) return {
		points: [...curve.points, { id, position, value: last.value }],
		segments: [...curve.segments, { kind: 'hold' }],
	};
	const existing = curve.points.findIndex((point) => compareFractions(point.position, position) === 0);
	if (existing >= 0) return {
		points: curve.points.slice(0, existing + 1),
		segments: curve.segments.slice(0, existing),
	};
	const segmentIndex = segmentIndexAt(curve, position);
	const value = valueAtBoundary(lane, frame, sampleRate, options);
	const split = splitShape(curve, segmentIndex, position, value);
	return {
		points: [...curve.points.slice(0, segmentIndex + 1), { id, position, value }],
		segments: [...curve.segments.slice(0, segmentIndex), split.left],
	};
}

function curveSuffixAt(
	lane: AutomationLaneV21,
	curve: EditableCurve,
	position: ExactInterpolationFraction,
	frame: number,
	id: string,
	sampleRate: number,
	options: AutomationLaneFrameOptionsV21,
): EditableCurve {
	const first = curve.points[0]!;
	const last = curve.points.at(-1)!;
	if (compareFractions(position, first.position) < 0) return {
		points: [{ id, position, value: first.value }, ...curve.points],
		segments: [{ kind: 'hold' }, ...curve.segments],
	};
	if (compareFractions(position, last.position) > 0) {
		return { points: [{ id, position, value: last.value }], segments: [] };
	}
	const existing = curve.points.findIndex((point) => compareFractions(point.position, position) === 0);
	if (existing >= 0) return {
		points: curve.points.slice(existing),
		segments: curve.segments.slice(existing),
	};
	const segmentIndex = segmentIndexAt(curve, position);
	const value = valueAtBoundary(lane, frame, sampleRate, options);
	const split = splitShape(curve, segmentIndex, position, value);
	return {
		points: [{ id, position, value }, ...curve.points.slice(segmentIndex + 1)],
		segments: [split.right, ...curve.segments.slice(segmentIndex + 1)],
	};
}

function joinInsertedInterval(
	lane: AutomationLaneV21,
	edit: AutomationLaneTimelineReplacementV21,
	prefix: EditableCurve,
	suffix: EditableCurve,
): EditableCurve {
	const left = [...prefix.points];
	if (left.at(-1)!.id === suffix.points[0]!.id) {
		left[left.length - 1] = {
			...left.at(-1)!, id: boundaryId(lane.id, edit, 'insert-left'),
		};
	}
	return {
		points: [...left, ...suffix.points],
		segments: [...prefix.segments, { kind: 'hold' }, ...suffix.segments],
	};
}

function joinDeletedInterval(
	lane: AutomationLaneV21,
	edit: AutomationLaneTimelineReplacementV21,
	prefix: EditableCurve,
	suffix: EditableCurve,
	position: ExactInterpolationFraction,
): EditableCurve {
	const leftBoundary = prefix.points.at(-1)!;
	const rightBoundary = suffix.points[0]!;
	if (compareFractions(rightBoundary.position, position) !== 0) {
		throw new RangeError('Automation ripple-delete produced a noncanonical splice position.');
	}
	if (prefix.points.length === 1) {
		if (edit.startFrame === 0) return suffix;
		const origin = integerFraction(0);
		if (compareFractions(origin, position) === 0) return suffix;
		return {
			points: [{
				id: boundaryId(lane.id, edit, 'origin'), position: origin,
				value: leftBoundary.value,
			}, ...suffix.points],
			segments: [{ kind: 'hold' }, ...suffix.segments],
		};
	}
	const bridge = prefix.segments.at(-1)!;
	if (leftBoundary.value !== rightBoundary.value && bridge.kind !== 'hold') {
		throw new RangeError(
			'Automation ripple-delete cannot encode this discontinuous curve splice canonically.',
		);
	}
	return {
		points: [...prefix.points.slice(0, -1), ...suffix.points],
		segments: [...prefix.segments, ...suffix.segments],
	};
}

function splitShape(
	curve: EditableCurve,
	index: number,
	position: ExactInterpolationFraction,
	boundaryValue: number,
): SplitShape {
	const start = curve.points[index]!;
	const end = curve.points[index + 1]!;
	const shape = curve.segments[index]!;
	if (shape.kind === 'hold' || shape.kind === 'linear') {
		return { left: shape, right: shape };
	}
	const handles = shape.kind === 'eased'
		? easedHandles(start, end)
		: {
			control1: control(bezierShapeValue(shape).control1),
			control2: control(bezierShapeValue(shape).control2),
		};
	const amount = splitAmount(start.position, end.position, handles, position);
	const q0 = mixedControl(start, handles.control1, amount);
	const q1 = mixedControl(handles.control1, handles.control2, amount);
	const q2 = mixedControl(handles.control2, end, amount);
	const r0 = mixedControl(q0, q1, amount);
	const r1 = mixedControl(q1, q2, amount);
	const split = mixedControl(r0, r1, amount);
	if (compareFractions(split.position, position) !== 0) {
		throw new RangeError('Automation curve boundary is not exactly representable by canonical Bézier controls.');
	}
	if (!Number.isFinite(boundaryValue)) throw new RangeError('Automation curve boundary must evaluate finitely.');
	return {
		left: bezierShape(q0, r0),
		right: bezierShape(r1, q2),
	};
}

function splitAmount(
	start: ExactInterpolationFraction,
	end: ExactInterpolationFraction,
	handles: Readonly<{ control1: EditablePoint; control2: EditablePoint }>,
	position: ExactInterpolationFraction,
): ExactInterpolationFraction {
	const linearAmount = divideFractions(
		subtractFractions(position, start), subtractFractions(end, start),
	);
	const oneThird = divideFractions(integerFraction(1), integerFraction(3));
	const twoThirds = divideFractions(integerFraction(2), integerFraction(3));
	if (compareFractions(handles.control1.position, interpolateFraction(start, end, oneThird)) === 0
		&& compareFractions(handles.control2.position, interpolateFraction(start, end, twoThirds)) === 0) {
		return linearAmount;
	}
	const numericTarget = fractionNumber(linearAmount);
	const firstTime = normalizedAmount(start, end, handles.control1.position);
	const secondTime = normalizedAmount(start, end, handles.control2.position);
	let low = 0;
	let high = 1;
	for (let index = 0; index < 64; index += 1) {
		const middle = low + (high - low) / 2;
		if (cubicNumber(0, firstTime, secondTime, 1, middle) < numericTarget) low = middle;
		else high = middle;
	}
	const candidate = approximateBoundedFraction(high);
	if (candidate === null || compareFractions(cubicFraction(
		start, handles.control1.position, handles.control2.position, end, candidate,
	), position) !== 0) {
		throw new RangeError('Automation Bézier time split has no exact canonical rational parameter.');
	}
	return candidate;
}

function easedHandles(start: EditablePoint, end: EditablePoint): Readonly<{
	control1: EditablePoint;
	control2: EditablePoint;
}> {
	const oneThird = divideFractions(integerFraction(1), integerFraction(3));
	const twoThirds = divideFractions(integerFraction(2), integerFraction(3));
	return {
		control1: { id: '', position: interpolateFraction(start.position, end.position, oneThird), value: start.value },
		control2: { id: '', position: interpolateFraction(start.position, end.position, twoThirds), value: end.value },
	};
}

function control(value: Readonly<{ position: Rational; value: number }>): EditablePoint {
	return { id: '', position: exactFraction(value.position), value: value.value };
}

function mixedControl(
	left: EditablePoint,
	right: EditablePoint,
	amount: ExactInterpolationFraction,
): EditablePoint {
	return {
		id: '',
		position: interpolateFraction(left.position, right.position, amount),
		value: stableInterpolate(left.value, right.value, fractionNumber(amount)),
	};
}

function bezierShape(control1: EditablePoint, control2: EditablePoint): InterpolationShape {
	return {
		kind: 'bezier',
		control1: { position: publicFraction(control1.position), value: control1.value },
		control2: { position: publicFraction(control2.position), value: control2.value },
	};
}

function shiftCurve(curve: EditableCurve, delta: ExactInterpolationFraction): EditableCurve {
	return {
		points: curve.points.map((point) => ({
			...point, position: addFractions(point.position, delta),
		})),
		segments: curve.segments.map((segment) => segment.kind !== 'bezier' ? segment : ({
			...segment,
			control1: {
				...segment.control1,
				position: publicFraction(addFractions(exactFraction(segment.control1.position), delta)),
			},
			control2: {
				...segment.control2,
				position: publicFraction(addFractions(exactFraction(segment.control2.position), delta)),
			},
		})),
	};
}

function editableCurve(lane: AutomationLaneV21): EditableCurve {
	return {
		points: lane.points.map((point) => ({
			id: point.id,
			position: exactFraction(authoredPosition(point, lane.timebase)),
			value: point.value,
		})),
		segments: [...lane.segments],
	};
}

function authoredPosition(
	point: Readonly<AutomationLanePointV21>,
	timebase: AutomationLaneV21['timebase'],
): Rational {
	return timebase === 'absolute-samples'
		? { num: point.position as number, den: 1 }
		: point.position as Rational;
}

function positionAtFrame(
	lane: AutomationLaneV21,
	frame: number,
	sampleRate: number,
	options: AutomationLaneFrameOptionsV21,
): ExactInterpolationFraction {
	if (lane.timebase === 'absolute-samples') return integerFraction(frame);
	if (!options.tempoMap) throw new TypeError('A musical automation interval edit requires the authoritative tempo map.');
	return exactFraction(sampleFrameToBeat(frame, options.tempoMap, sampleRate));
}

function valueAtBoundary(
	lane: AutomationLaneV21,
	frame: number,
	sampleRate: number,
	options: AutomationLaneFrameOptionsV21,
): number {
	// Importing the public evaluator here would build another normalized curve.
	// The local exact segment split below computes the same boundary and checks it
	// against this compact evaluator so no sampled approximation can enter state.
	const curve = editableCurve(lane);
	const position = positionAtFrame(lane, frame, sampleRate, options);
	const first = curve.points[0]!;
	const last = curve.points.at(-1)!;
	if (compareFractions(position, first.position) <= 0) return first.value;
	if (compareFractions(position, last.position) >= 0) return last.value;
	const index = segmentIndexAt(curve, position);
	const start = curve.points[index]!;
	const end = curve.points[index + 1]!;
	const shape = curve.segments[index]!;
	if (shape.kind === 'hold') return start.value;
	const amount = normalizedAmount(start.position, end.position, position);
	if (shape.kind === 'linear') return stableInterpolate(start.value, end.value, amount);
	if (shape.kind === 'eased') {
		const eased = amount * amount * (3 - 2 * amount);
		return stableInterpolate(start.value, end.value, eased);
	}
	const bezier = bezierShapeValue(shape);
	const controls = { control1: control(bezier.control1), control2: control(bezier.control2) };
	const parameter = fractionNumber(splitAmount(start.position, end.position, controls, position));
	return cubicNumber(start.value, controls.control1.value, controls.control2.value, end.value, parameter);
}

function segmentIndexAt(curve: EditableCurve, position: ExactInterpolationFraction): number {
	const index = curve.points.findIndex((point) => compareFractions(point.position, position) > 0);
	if (index <= 0) throw new RangeError('Automation split position is outside its authored curve.');
	return index - 1;
}

function normalizedAmount(
	start: ExactInterpolationFraction,
	end: ExactInterpolationFraction,
	position: ExactInterpolationFraction,
): number {
	return fractionNumber(divideFractions(
		subtractFractions(position, start), subtractFractions(end, start),
	));
}

function cubicNumber(start: number, first: number, second: number, end: number, amount: number): number {
	const a = stableInterpolate(start, first, amount);
	const b = stableInterpolate(first, second, amount);
	const c = stableInterpolate(second, end, amount);
	return stableInterpolate(
		stableInterpolate(a, b, amount), stableInterpolate(b, c, amount), amount,
	);
}

function bezierShapeValue(
	value: InterpolationShape,
): Extract<InterpolationShape, Readonly<{ readonly kind: 'bezier' }>> {
	if (value.kind !== 'bezier') throw new RangeError('A Bézier automation segment is required.');
	return value as Extract<InterpolationShape, Readonly<{ readonly kind: 'bezier' }>>;
}

function publicPoint(point: EditablePoint, timebase: AutomationLaneV21['timebase']): AutomationLanePointV21 {
	const position = publicFraction(point.position);
	if (timebase === 'absolute-samples' && position.den !== 1) {
		throw new RangeError('An absolute-sample automation edit produced a fractional point position.');
	}
	return {
		id: point.id,
		position: timebase === 'absolute-samples' ? position.num : position,
		value: point.value,
	};
}

function normalizedEdit(value: AutomationLaneTimelineReplacementV21): AutomationLaneTimelineReplacementV21 {
	const startFrame = nonNegativeSafeInteger(value.startFrame, 'automation edit.startFrame');
	const endFrame = nonNegativeSafeInteger(value.endFrame, 'automation edit.endFrame');
	const insertedDurationFrames = nonNegativeSafeInteger(
		value.insertedDurationFrames, 'automation edit.insertedDurationFrames',
	);
	if (endFrame < startFrame) throw new RangeError('An automation edit range must be ordered.');
	return { startFrame, endFrame, insertedDurationFrames };
}

function boundaryId(
	laneId: string,
	edit: AutomationLaneTimelineReplacementV21,
	tag: string,
): string {
	return `automation-edit-${bytesToHex(sha256(ID_ENCODER.encode(JSON.stringify([
		'automation-lane-interval-edit-v21', laneId, edit.startFrame,
		edit.endFrame, edit.insertedDurationFrames, tag,
	]))))}`;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
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

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} is outside the safe timeline domain.`);
	return result;
}
