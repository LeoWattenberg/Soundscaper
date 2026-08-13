/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	addFractions,
	approximateBoundedFraction,
	compareFractions,
	cubicFraction,
	cubicValueDirection,
	divideFractions,
	exactFraction,
	fractionNumber,
	integerFraction,
	interpolateFraction,
	multiplyFractions,
	numberFraction,
	publicFraction,
	stableCubic,
	stableInterpolate,
	subtractFractions,
	ZERO_FRACTION,
	type ExactInterpolationFraction,
} from './interpolation-curve-math.ts';
import {
	normalizeRational,
	roundRational,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';

export interface InterpolationAnchor {
	readonly position: Rational;
	readonly value: number;
}

export type InterpolationShape = Readonly<
	| { kind: 'hold' | 'linear' | 'eased' }
	| {
		kind: 'bezier';
		control1: InterpolationAnchor;
		control2: InterpolationAnchor;
	}
>;

export interface CompiledInterpolationCurve {
	readonly anchors: readonly Readonly<InterpolationAnchor>[];
	readonly segments: readonly InterpolationShape[];
}

export type InverseOccurrence = Readonly<
	| { kind: 'point'; position: Rational }
	| { kind: 'range'; start: Rational; end: Rational }
	| { kind: 'bracket'; lower: Rational; upper: Rational }
>;

interface InternalAnchor { readonly position: ExactInterpolationFraction; readonly value: number }
interface InternalShape {
	readonly kind: InterpolationShape['kind'];
	readonly control1Position: ExactInterpolationFraction | null;
	readonly control2Position: ExactInterpolationFraction | null;
	readonly control1Value: number | null;
	readonly control2Value: number | null;
}
interface InternalSegment {
	readonly start: InternalAnchor;
	readonly end: InternalAnchor;
	readonly shape: InternalShape;
	readonly control1Time: number;
	readonly control2Time: number;
	readonly valueDirection: -1 | 0 | 1 | null;
}
interface InternalCurve {
	readonly anchors: readonly InternalAnchor[];
	readonly segments: readonly InternalSegment[];
}

// This hostile-input ceiling mirrors the project traversal ceiling while admitting
// synthetic legacy-envelope endpoints. 4A lanes retain a separate 4,096-point wire cap.
const MAXIMUM_SEGMENTS = 100_000;
const BISECTION_STEPS = 64;
const COMPILED_CURVES = new WeakMap<CompiledInterpolationCurve, InternalCurve>();

/** Compile one schema-neutral, clip-relative interpolation description. */
export function compileInterpolationCurve(value: unknown): CompiledInterpolationCurve {
	const input = readClosedDomainRecord(value, 'interpolation curve', ['anchors', 'segments']);
	const anchorValues = readClosedDomainArray(
		readClosedDomainField(input, 'anchors', 'interpolation curve'),
		'interpolation curve anchors', 2, MAXIMUM_SEGMENTS + 1,
	);
	const segmentValues = readClosedDomainArray(
		readClosedDomainField(input, 'segments', 'interpolation curve'),
		'interpolation curve segments', 1, MAXIMUM_SEGMENTS,
	);
	if (anchorValues.length !== segmentValues.length + 1) {
		throw new RangeError('Interpolation curve anchors must contain exactly one more item than segments.');
	}

	const publicAnchors: InterpolationAnchor[] = [];
	const anchors: InternalAnchor[] = [];
	for (const [index, candidate] of anchorValues.entries()) {
		const name = `interpolation curve anchors[${String(index)}]`;
		const record = readClosedDomainRecord(candidate, name, ['position', 'value']);
		const position = inputPosition(readClosedDomainField(record, 'position', name), `${name}.position`);
		const value = finiteValue(readClosedDomainField(record, 'value', name), `${name}.value`);
		if (index === 0 && compareFractions(position.exact, ZERO_FRACTION) < 0) {
			throw new RangeError('Interpolation curve positions must be non-negative clip-relative values.');
		}
		if (index > 0 && compareFractions(nonNullable(anchors[index - 1]).position, position.exact) >= 0) {
			throw new RangeError('Interpolation curve anchor positions must be strictly increasing.');
		}
		publicAnchors.push(Object.freeze({ position: position.public, value }));
		anchors.push(Object.freeze({ position: position.exact, value }));
	}

	const publicSegments: InterpolationShape[] = [];
	const segments: InternalSegment[] = [];
	for (const [index, candidate] of segmentValues.entries()) {
		const start = nonNullable(anchors[index]);
		const end = nonNullable(anchors[index + 1]);
		const normalized = inputShape(candidate, index, start, end);
		publicSegments.push(normalized.public);
		segments.push(Object.freeze({
			start,
			end,
			shape: normalized.internal,
			control1Time: normalized.internal.control1Position === null ? 0
				: normalizedTime(start.position, end.position, normalized.internal.control1Position),
			control2Time: normalized.internal.control2Position === null ? 1
				: normalizedTime(start.position, end.position, normalized.internal.control2Position),
			valueDirection: valueDirection(start.value, end.value, normalized.internal),
		}));
	}

	const curve = Object.freeze({
		anchors: Object.freeze(publicAnchors),
		segments: Object.freeze(publicSegments),
	});
	COMPILED_CURVES.set(curve, Object.freeze({
		anchors: Object.freeze(anchors),
		segments: Object.freeze(segments),
	}));
	return curve;
}

/** Evaluate without rounding; callers choose a named timeline rounding policy once at their boundary. */
export function evaluateInterpolationCurve(
	curveValue: unknown,
	positionValue: RationalInput,
): number {
	const curve = compiledCurve(curveValue);
	const position = queryPosition(positionValue, 'position');
	const first = nonNullable(curve.anchors[0]);
	const last = nonNullable(curve.anchors.at(-1));
	if (compareFractions(position, first.position) <= 0) return first.value;
	if (compareFractions(position, last.position) >= 0) return last.value;
	return evaluateSegment(segmentAt(curve, position), position);
}

/**
 * Invert every value-monotone occurrence. Ranges use the same half-open
 * segment ownership as evaluation, except that the curve's final endpoint is
 * included. Irrational roots are reported as enclosing whole-domain cells.
 */
export function invertInterpolationCurve(
	curveValue: unknown,
	valueValue: unknown,
): readonly InverseOccurrence[] {
	const curve = compiledCurve(curveValue);
	const target = finiteValue(valueValue, 'value');
	if (curve.segments.some((segment) => segment.valueDirection === null)) {
		throw new RangeError('Bézier value controls must be monotone before the curve can be inverted.');
	}
	const raw: InverseOccurrence[] = [];
	for (const [index, segment] of curve.segments.entries()) {
		const final = index === curve.segments.length - 1;
		if (segment.shape.kind === 'hold' || segment.valueDirection === 0) {
			if (target === segment.start.value) raw.push(Object.freeze({
				kind: 'range',
				start: publicFraction(segment.start.position),
				end: publicFraction(segment.end.position),
			}));
			if (final && target === segment.end.value && target !== segment.start.value) {
				raw.push(pointOccurrence(segment.end.position));
			}
			continue;
		}
		const direction = nonNullable(segment.valueDirection);
		if (!between(target, segment.start.value, segment.end.value, direction)) continue;
		if (target === segment.start.value) {
			raw.push(pointOccurrence(segment.start.position));
			continue;
		}
		if (target === segment.end.value) {
			if (final) raw.push(pointOccurrence(segment.end.position));
			continue;
		}
		raw.push(invertMovingSegment(segment, target, direction));
	}
	return Object.freeze(normalizeOccurrences(raw));
}

function inputShape(
	value: unknown,
	index: number,
	start: InternalAnchor,
	end: InternalAnchor,
): Readonly<{ public: InterpolationShape; internal: InternalShape }> {
	const name = `interpolation curve segments[${String(index)}]`;
	const base = readClosedDomainRecord(value, name, ['kind', 'control1', 'control2'], ['kind']);
	const kind = readClosedDomainField(base, 'kind', name);
	if (kind === 'hold' || kind === 'linear' || kind === 'eased') {
		readClosedDomainRecord(value, name, ['kind']);
		return Object.freeze({
			public: Object.freeze({ kind }),
			internal: Object.freeze({
				kind, control1Position: null, control2Position: null,
				control1Value: null, control2Value: null,
			}),
		});
	}
	if (kind !== 'bezier') throw new RangeError(`${name}.kind is unsupported.`);
	const bezier = readClosedDomainRecord(value, name, ['kind', 'control1', 'control2']);
	const first = inputControl(readClosedDomainField(bezier, 'control1', name), `${name}.control1`);
	const second = inputControl(readClosedDomainField(bezier, 'control2', name), `${name}.control2`);
	if (compareFractions(start.position, first.exact) > 0
		|| compareFractions(first.exact, second.exact) > 0
		|| compareFractions(second.exact, end.position) > 0) {
		throw new RangeError('Bézier control positions must satisfy start <= control1 <= control2 <= end.');
	}
	return Object.freeze({
		public: Object.freeze({
			kind,
			control1: Object.freeze({ position: first.public, value: first.value }),
			control2: Object.freeze({ position: second.public, value: second.value }),
		}),
		internal: Object.freeze({
			kind,
			control1Position: first.exact,
			control2Position: second.exact,
			control1Value: first.value,
			control2Value: second.value,
		}),
	});
}

function inputControl(value: unknown, name: string): Readonly<{
	public: Rational;
	exact: ExactInterpolationFraction;
	value: number;
}> {
	const record = readClosedDomainRecord(value, name, ['position', 'value']);
	const position = inputPosition(readClosedDomainField(record, 'position', name), `${name}.position`);
	return Object.freeze({
		public: position.public,
		exact: position.exact,
		value: finiteValue(readClosedDomainField(record, 'value', name), `${name}.value`),
	});
}

function inputPosition(value: unknown, name: string): Readonly<{
	public: Rational;
	exact: ExactInterpolationFraction;
}> {
	let normalized: Rational;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
		normalized = normalizeRational(value);
	} else {
		const record = readClosedDomainRecord(value, name, ['num', 'den']);
		const num = readClosedDomainField(record, 'num', name);
		const den = readClosedDomainField(record, 'den', name);
		if (typeof num !== 'number' || typeof den !== 'number') throw new TypeError(`${name} must be rational.`);
		normalized = normalizeRational({ num, den });
	}
	return Object.freeze({ public: normalized, exact: exactFraction(normalized) });
}

function queryPosition(value: RationalInput, name: string): ExactInterpolationFraction {
	return inputPosition(value, name).exact;
}

function segmentAt(curve: InternalCurve, position: ExactInterpolationFraction): InternalSegment {
	let low = 0;
	let high = curve.anchors.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (compareFractions(nonNullable(curve.anchors[middle]).position, position) <= 0) low = middle + 1;
		else high = middle;
	}
	return nonNullable(curve.segments[Math.min(Math.max(0, low - 1), curve.segments.length - 1)]);
}

function evaluateSegment(segment: InternalSegment, position: ExactInterpolationFraction): number {
	if (compareFractions(position, segment.start.position) === 0) return segment.start.value;
	if (compareFractions(position, segment.end.position) === 0) return segment.end.value;
	if (segment.shape.kind === 'hold') return segment.start.value;
	const amount = normalizedTime(segment.start.position, segment.end.position, position);
	if (segment.shape.kind === 'linear') return stableInterpolate(segment.start.value, segment.end.value, amount);
	if (segment.shape.kind === 'eased') {
		const eased = amount * amount * (3 - 2 * amount);
		return stableInterpolate(segment.start.value, segment.end.value, eased);
	}
	const parameter = invertBezierTime(amount, segment.control1Time, segment.control2Time);
	return stableCubic(
		segment.start.value,
		nonNullable(segment.shape.control1Value),
		nonNullable(segment.shape.control2Value),
		segment.end.value,
		parameter,
	);
}

function invertBezierTime(target: number, control1: number, control2: number): number {
	if (target <= 0) return 0;
	if (target >= 1) return 1;
	let low = 0;
	let high = 1;
	for (let iteration = 0; iteration < BISECTION_STEPS; iteration += 1) {
		const middle = low + (high - low) / 2;
		if (stableCubic(0, control1, control2, 1, middle) < target) low = middle;
		else high = middle;
	}
	return high;
}

function invertMovingSegment(
	segment: InternalSegment,
	target: number,
	direction: -1 | 1,
): InverseOccurrence {
	const rationalCandidate = exactRationalCandidate(segment, target, direction);
	if (rationalCandidate !== null) return pointOccurrence(rationalCandidate);
	const minimum = roundRational(
		segment.start.position.numerator, segment.start.position.denominator, 'enclosingEnd',
	);
	const maximum = roundRational(
		segment.end.position.numerator, segment.end.position.denominator, 'enclosingStart',
	);
	if (minimum > maximum) return integerBracket(minimum);
	let low = minimum;
	let high = maximum;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const evaluated = evaluateSegment(segment, integerFraction(middle));
		if (evaluated === target) return pointOccurrence(integerFraction(middle));
		if ((direction === 1 && evaluated < target) || (direction === -1 && evaluated > target)) low = middle + 1;
		else high = middle;
	}
	if (evaluateSegment(segment, integerFraction(low)) === target) return pointOccurrence(integerFraction(low));
	return integerBracket(low);
}

function integerBracket(upper: number): InverseOccurrence {
	return Object.freeze({
		kind: 'bracket',
		lower: normalizeRational(Math.max(0, upper - 1)),
		upper: normalizeRational(upper),
	});
}

function exactRationalCandidate(
	segment: InternalSegment,
	target: number,
	direction: -1 | 1,
): ExactInterpolationFraction | null {
	if (segment.shape.kind === 'linear') return exactLinearCandidate(segment, target);
	const parameter = inverseValueParameter(segment, target, direction);
	const exactParameter = numberFraction(parameter);
	const exactPosition = segment.shape.kind === 'eased'
		? interpolateFraction(segment.start.position, segment.end.position, exactParameter)
		: cubicFraction(
			segment.start.position,
			nonNullable(segment.shape.control1Position),
			nonNullable(segment.shape.control2Position),
			segment.end.position,
			exactParameter,
		);
	const admitted = admittedCandidate(exactPosition);
	if (admitted !== null && evaluateSegment(segment, admitted) === target) return admitted;
	const approximate = approximateBoundedFraction(fractionNumber(exactPosition));
	return approximate !== null && evaluateSegment(segment, approximate) === target ? approximate : null;
}

function exactLinearCandidate(
	segment: InternalSegment,
	target: number,
): ExactInterpolationFraction | null {
	const valueSpan = subtractFractions(numberFraction(segment.end.value), numberFraction(segment.start.value));
	const amount = divideFractions(
		subtractFractions(numberFraction(target), numberFraction(segment.start.value)),
		valueSpan,
	);
	const candidate = addFractions(
		segment.start.position,
		multiplyFractions(subtractFractions(segment.end.position, segment.start.position), amount),
	);
	const admitted = admittedCandidate(candidate);
	if (admitted === null) return null;
	return evaluateSegment(segment, admitted) === target ? admitted : null;
}

function inverseValueParameter(segment: InternalSegment, target: number, direction: -1 | 1): number {
	let low = 0;
	let high = 1;
	for (let iteration = 0; iteration < BISECTION_STEPS; iteration += 1) {
		const middle = low + (high - low) / 2;
		const value = segment.shape.kind === 'eased'
			? stableInterpolate(segment.start.value, segment.end.value, middle * middle * (3 - 2 * middle))
			: stableCubic(
				segment.start.value,
				nonNullable(segment.shape.control1Value),
				nonNullable(segment.shape.control2Value),
				segment.end.value,
				middle,
			);
		if (value === target) return middle;
		if ((direction === 1 && value < target) || (direction === -1 && value > target)) low = middle;
		else high = middle;
	}
	return high;
}

function admittedCandidate(value: ExactInterpolationFraction): ExactInterpolationFraction | null {
	try { return exactFraction(publicFraction(value)); } catch (error) {
		if (error instanceof RangeError) return null;
		throw error;
	}
}

function valueDirection(start: number, end: number, shape: InternalShape): -1 | 0 | 1 | null {
	if (shape.kind === 'hold') return 0;
	if (shape.kind !== 'bezier') return start < end ? 1 : start > end ? -1 : 0;
	return cubicValueDirection(
		start,
		nonNullable(shape.control1Value),
		nonNullable(shape.control2Value),
		end,
	);
}

function normalizeOccurrences(values: readonly InverseOccurrence[]): InverseOccurrence[] {
	const result: InverseOccurrence[] = [];
	for (const occurrence of values) {
		const previous = result.at(-1);
		if (!previous || previous.kind === 'bracket' || occurrence.kind === 'bracket') {
			result.push(occurrence);
			continue;
		}
		const previousStart = occurrenceStart(previous);
		const previousEnd = occurrenceEnd(previous);
		const currentStart = occurrenceStart(occurrence);
		const currentEnd = occurrenceEnd(occurrence);
		if (compareFractions(currentStart, previousEnd) > 0) {
			result.push(occurrence);
			continue;
		}
		if (previous.kind === 'point' && occurrence.kind === 'point') continue;
		result[result.length - 1] = Object.freeze({
			kind: 'range', start: publicFraction(previousStart), end: publicFraction(
				compareFractions(currentEnd, previousEnd) > 0 ? currentEnd : previousEnd,
			),
		});
	}
	return result;
}

function occurrenceStart(
	value: Exclude<InverseOccurrence, { kind: 'bracket' }>,
): ExactInterpolationFraction {
	return exactFraction(value.kind === 'point' ? value.position : value.start);
}

function occurrenceEnd(
	value: Exclude<InverseOccurrence, { kind: 'bracket' }>,
): ExactInterpolationFraction {
	return exactFraction(value.kind === 'point' ? value.position : value.end);
}

function pointOccurrence(position: ExactInterpolationFraction): InverseOccurrence {
	return Object.freeze({ kind: 'point', position: publicFraction(position) });
}

function between(target: number, start: number, end: number, direction: -1 | 1): boolean {
	return direction === 1 ? target >= start && target <= end : target <= start && target >= end;
}

function normalizedTime(
	start: ExactInterpolationFraction,
	end: ExactInterpolationFraction,
	position: ExactInterpolationFraction,
): number {
	return fractionNumber(divideFractions(
		subtractFractions(position, start),
		subtractFractions(end, start),
	));
}

function compiledCurve(value: unknown): InternalCurve {
	if (!value || typeof value !== 'object') throw new TypeError('A compiled interpolation curve is required.');
	const curve = COMPILED_CURVES.get(value as CompiledInterpolationCurve);
	if (!curve) throw new TypeError('The interpolation curve was not produced by compileInterpolationCurve.');
	return curve;
}

function finiteValue(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return value;
}

function nonNullable<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a bounded interpolation value.');
	return value;
}
