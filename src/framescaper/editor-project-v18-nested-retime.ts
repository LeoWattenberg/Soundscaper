/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compileVideoRetimeCurveV16,
	normalizeVideoRetimeCurveV16,
	type VideoRetimeCurveV16,
} from '../common/editor/video-retime-v16.ts';
import {
	evaluateVideoRetimeCurve,
	type ExactVideoRetimeRational,
	type VideoRetimeCurveRational,
	type VideoRetimeCurveSegment,
} from '../common/editor/video-retime-curve.ts';

export interface FramescaperNestedVideoRetimeRequestV18 {
	readonly retimeMap: unknown;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
	readonly authoredOuterFrameCount: number;
	readonly visibleStartOuterFrame: number;
	readonly visibleEndOuterFrame: number;
	readonly materializedOuterFrameCount: number;
}

/** Slice one exact leaf curve and reparameterize it onto an exact root occurrence grid. */
export function materializeFramescaperNestedVideoRetimeV18(
	requestValue: FramescaperNestedVideoRetimeRequestV18 | unknown,
): VideoRetimeCurveV16 | null {
	const request = requestRecord(requestValue);
	const sourceBinding = Object.freeze({
		sequenceFrameCount: request.authoredOuterFrameCount,
		sourceInFrame: request.sourceInFrame,
		sourceFrameCount: request.sourceFrameCount,
	});
	const curve = compileVideoRetimeCurveV16(request.retimeMap, sourceBinding);
	if (curve === null) return null;
	const visibleCount = request.visibleEndOuterFrame - request.visibleStartOuterFrame;
	const points: Array<Readonly<{ outerFrame: number; sourceFrame: VideoRetimeCurveRational }>> = [];
	const segments: VideoRetimeCurveSegment[] = [];
	for (let index = 0; index < curve.segments.length; index += 1) {
		const authoredStart = curve.points[index]!.outerFrame;
		const authoredEnd = curve.points[index + 1]!.outerFrame;
		const start = Math.max(authoredStart, request.visibleStartOuterFrame);
		const end = Math.min(authoredEnd, request.visibleEndOuterFrame);
		if (end <= start) continue;
		const rootStart = scaledBoundary(
			start - request.visibleStartOuterFrame,
			request.materializedOuterFrameCount,
			visibleCount,
		);
		const rootEnd = scaledBoundary(
			end - request.visibleStartOuterFrame,
			request.materializedOuterFrameCount,
			visibleCount,
		);
		if (points.length === 0) points.push(Object.freeze({
			outerFrame: rootStart,
			sourceFrame: inputRational(evaluateVideoRetimeCurve(curve, start), 'nested retime point'),
		}));
		points.push(Object.freeze({
			outerFrame: rootEnd,
			sourceFrame: inputRational(evaluateVideoRetimeCurve(curve, end), 'nested retime point'),
		}));
		const segment = curve.segments[index]!;
		if (segment.mode !== 'ramp-forward' && segment.mode !== 'ramp-reverse') {
			segments.push(Object.freeze({ mode: segment.mode }));
			continue;
		}
		const scale = fraction(BigInt(visibleCount), BigInt(request.materializedOuterFrameCount));
		segments.push(Object.freeze({
			mode: segment.mode,
			startVelocity: inputRational(multiply(
				velocityAt(segment, start - authoredStart, authoredEnd - authoredStart), scale,
			), 'nested retime start velocity'),
			endVelocity: inputRational(multiply(
				velocityAt(segment, end - authoredStart, authoredEnd - authoredStart), scale,
			), 'nested retime end velocity'),
		}));
	}
	if (segments.length < 1 || points[0]?.outerFrame !== 0
		|| points.at(-1)?.outerFrame !== request.materializedOuterFrameCount) {
		throw new RangeError('Nested retime slicing did not cover the exact root occurrence.');
	}
	return normalizeVideoRetimeCurveV16({
		feature: 'video-retime', version: 2, points, segments,
	}, {
		sequenceFrameCount: request.materializedOuterFrameCount,
		sourceInFrame: request.sourceInFrame,
		sourceFrameCount: request.sourceFrameCount,
	});
}

function velocityAt(
	segment: Extract<VideoRetimeCurveSegment, { readonly mode: 'ramp-forward' | 'ramp-reverse' }>,
	offset: number,
	span: number,
): ExactVideoRetimeRational {
	const start = exact(segment.startVelocity);
	const end = exact(segment.endVelocity);
	return add(start, multiply(subtract(end, start), fraction(BigInt(offset), BigInt(span))));
}

function requestRecord(value: unknown): FramescaperNestedVideoRetimeRequestV18 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('A nested video-retime materialization request must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const fields = [
		'retimeMap', 'sourceInFrame', 'sourceFrameCount', 'authoredOuterFrameCount',
		'visibleStartOuterFrame', 'visibleEndOuterFrame', 'materializedOuterFrameCount',
	];
	if (Reflect.ownKeys(record).length !== fields.length
		|| Reflect.ownKeys(record).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('A nested video-retime materialization request has an invalid closed shape.');
	}
	const read = (key: string): unknown => {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Nested video-retime request.${key} must be an own enumerable data field.`);
		}
		return descriptor.value;
	};
	const sourceInFrame = nonNegativeInteger(read('sourceInFrame'), 'sourceInFrame');
	const sourceFrameCount = positiveInteger(read('sourceFrameCount'), 'sourceFrameCount');
	const authoredOuterFrameCount = positiveInteger(read('authoredOuterFrameCount'), 'authoredOuterFrameCount');
	const visibleStartOuterFrame = nonNegativeInteger(read('visibleStartOuterFrame'), 'visibleStartOuterFrame');
	const visibleEndOuterFrame = positiveInteger(read('visibleEndOuterFrame'), 'visibleEndOuterFrame');
	const materializedOuterFrameCount = positiveInteger(
		read('materializedOuterFrameCount'), 'materializedOuterFrameCount',
	);
	if (visibleEndOuterFrame <= visibleStartOuterFrame
		|| visibleEndOuterFrame > authoredOuterFrameCount) {
		throw new RangeError('Nested video-retime visible bounds must be an authored positive subrange.');
	}
	return Object.freeze({
		retimeMap: read('retimeMap'), sourceInFrame, sourceFrameCount, authoredOuterFrameCount,
		visibleStartOuterFrame, visibleEndOuterFrame, materializedOuterFrameCount,
	});
}

function scaledBoundary(offset: number, outerCount: number, visibleCount: number): number {
	const numerator = BigInt(offset) * BigInt(outerCount);
	const denominator = BigInt(visibleCount);
	if (numerator % denominator !== 0n) {
		throw new RangeError('Nested retime breakpoint does not align exactly to the root frame grid.');
	}
	const result = numerator / denominator;
	if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Nested retime breakpoint exceeds the safe-integer range.');
	}
	return Number(result);
}

function inputRational(value: ExactVideoRetimeRational, name: string): VideoRetimeCurveRational {
	const result = fraction(value.numerator, value.denominator);
	const num = Number(result.numerator);
	const den = Number(result.denominator);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
		throw new RangeError(`${name} exceeds the persisted rational range.`);
	}
	return Object.freeze({ num, den });
}

function exact(value: VideoRetimeCurveRational): ExactVideoRetimeRational {
	return fraction(BigInt(value.num), BigInt(value.den));
}

function add(left: ExactVideoRetimeRational, right: ExactVideoRetimeRational): ExactVideoRetimeRational {
	return fraction(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function subtract(left: ExactVideoRetimeRational, right: ExactVideoRetimeRational): ExactVideoRetimeRational {
	return fraction(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function multiply(left: ExactVideoRetimeRational, right: ExactVideoRetimeRational): ExactVideoRetimeRational {
	return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

function fraction(numeratorValue: bigint, denominatorValue: bigint): ExactVideoRetimeRational {
	let numerator = numeratorValue;
	let denominator = denominatorValue;
	if (denominator === 0n) throw new RangeError('A nested retime exact denominator cannot be zero.');
	if (denominator < 0n) {
		numerator = -numerator;
		denominator = -denominator;
	}
	const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function gcd(leftValue: bigint, rightValue: bigint): bigint {
	let left = leftValue;
	let right = rightValue;
	while (right !== 0n) [left, right] = [right, left % right];
	return left === 0n ? 1n : left;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
		throw new RangeError(`Nested video-retime ${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result === 0) throw new RangeError(`Nested video-retime ${name} must be positive.`);
	return result;
}
