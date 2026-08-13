/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
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

interface Fraction { readonly numerator: bigint; readonly denominator: bigint }
interface InternalAnchor { readonly position: Fraction; readonly value: number }
interface InternalShape {
	readonly kind: InterpolationShape['kind'];
	readonly control1Position: Fraction | null;
	readonly control2Position: Fraction | null;
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

// Preserve the admitted V2 retime ceiling. Persisted 4A lanes apply their
// separate 4,096-point wire cap before they reach this schema-neutral module.
const MAXIMUM_SEGMENTS = 4_096;
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
		if (index === 0 && compare(position.exact, ZERO) < 0) {
			throw new RangeError('Interpolation curve positions must be non-negative clip-relative values.');
		}
		if (index > 0 && compare(nonNullable(anchors[index - 1]).position, position.exact) >= 0) {
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
	if (compare(position, first.position) <= 0) return first.value;
	if (compare(position, last.position) >= 0) return last.value;
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
	if (compare(start.position, first.exact) > 0
		|| compare(first.exact, second.exact) > 0
		|| compare(second.exact, end.position) > 0) {
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
	exact: Fraction;
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

function inputPosition(value: unknown, name: string): Readonly<{ public: Rational; exact: Fraction }> {
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

function queryPosition(value: RationalInput, name: string): Fraction {
	return inputPosition(value, name).exact;
}

function segmentAt(curve: InternalCurve, position: Fraction): InternalSegment {
	let low = 0;
	let high = curve.anchors.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (compare(nonNullable(curve.anchors[middle]).position, position) <= 0) low = middle + 1;
		else high = middle;
	}
	return nonNullable(curve.segments[Math.min(Math.max(0, low - 1), curve.segments.length - 1)]);
}

function evaluateSegment(segment: InternalSegment, position: Fraction): number {
	if (compare(position, segment.start.position) === 0) return segment.start.value;
	if (compare(position, segment.end.position) === 0) return segment.end.value;
	if (segment.shape.kind === 'hold') return segment.start.value;
	const amount = normalizedTime(segment.start.position, segment.end.position, position);
	if (segment.shape.kind === 'linear') return interpolate(segment.start.value, segment.end.value, amount);
	if (segment.shape.kind === 'eased') {
		const eased = amount * amount * (3 - 2 * amount);
		return interpolate(segment.start.value, segment.end.value, eased);
	}
	const parameter = invertBezierTime(amount, segment.control1Time, segment.control2Time);
	return deCasteljau(
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
		if (deCasteljau(0, control1, control2, 1, middle) < target) low = middle;
		else high = middle;
	}
	return high;
}

function invertMovingSegment(
	segment: InternalSegment,
	target: number,
	direction: -1 | 1,
): InverseOccurrence {
	const rationalCandidate = exactLinearCandidate(segment, target);
	if (rationalCandidate !== null) return pointOccurrence(rationalCandidate);
	const minimum = roundRational(
		segment.start.position.numerator, segment.start.position.denominator, 'enclosingEnd',
	);
	const maximum = roundRational(
		segment.end.position.numerator, segment.end.position.denominator, 'enclosingStart',
	);
	let low = minimum;
	let high = maximum + 1;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const evaluated = evaluateSegment(segment, integerFraction(middle));
		if (evaluated === target) return pointOccurrence(integerFraction(middle));
		if ((direction === 1 && evaluated < target) || (direction === -1 && evaluated > target)) low = middle + 1;
		else high = middle;
	}
	return Object.freeze({
		kind: 'bracket',
		lower: normalizeRational(Math.max(0, low - 1)),
		upper: normalizeRational(low),
	});
}

function exactLinearCandidate(segment: InternalSegment, target: number): Fraction | null {
	if (segment.shape.kind !== 'linear') return null;
	const valueSpan = subtract(numberFraction(segment.end.value), numberFraction(segment.start.value));
	const amount = divide(
		subtract(numberFraction(target), numberFraction(segment.start.value)),
		valueSpan,
	);
	const candidate = add(
		segment.start.position,
		multiply(subtract(segment.end.position, segment.start.position), amount),
	);
	let admitted: Fraction;
	try {
		admitted = exactFraction(normalizeRational(publicFraction(candidate)));
	} catch (error) {
		if (error instanceof RangeError) return null;
		throw error;
	}
	return evaluateSegment(segment, admitted) === target ? admitted : null;
}

function valueDirection(start: number, end: number, shape: InternalShape): -1 | 0 | 1 | null {
	if (shape.kind === 'hold') return 0;
	if (shape.kind !== 'bezier') return start < end ? 1 : start > end ? -1 : 0;
	const first = nonNullable(shape.control1Value);
	const second = nonNullable(shape.control2Value);
	if (start <= first && first <= second && second <= end) return start === end ? 0 : 1;
	if (start >= first && first >= second && second >= end) return start === end ? 0 : -1;
	return null;
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
		if (compare(currentStart, previousEnd) > 0) {
			result.push(occurrence);
			continue;
		}
		if (previous.kind === 'point' && occurrence.kind === 'point') continue;
		result[result.length - 1] = Object.freeze({
			kind: 'range', start: publicFraction(previousStart), end: publicFraction(
				compare(currentEnd, previousEnd) > 0 ? currentEnd : previousEnd,
			),
		});
	}
	return result;
}

function occurrenceStart(value: Exclude<InverseOccurrence, { kind: 'bracket' }>): Fraction {
	return exactFraction(value.kind === 'point' ? value.position : value.start);
}

function occurrenceEnd(value: Exclude<InverseOccurrence, { kind: 'bracket' }>): Fraction {
	return exactFraction(value.kind === 'point' ? value.position : value.end);
}

function pointOccurrence(position: Fraction): InverseOccurrence {
	return Object.freeze({ kind: 'point', position: publicFraction(position) });
}

function between(target: number, start: number, end: number, direction: -1 | 1): boolean {
	return direction === 1 ? target >= start && target <= end : target <= start && target >= end;
}

function normalizedTime(start: Fraction, end: Fraction, position: Fraction): number {
	return fractionNumber(divide(subtract(position, start), subtract(end, start)));
}

function deCasteljau(start: number, control1: number, control2: number, end: number, amount: number): number {
	const first = interpolate(start, control1, amount);
	const second = interpolate(control1, control2, amount);
	const third = interpolate(control2, end, amount);
	return interpolate(interpolate(first, second, amount), interpolate(second, third, amount), amount);
}

function interpolate(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
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

function exactFraction(value: Rational): Fraction {
	return normalizeFraction(BigInt(value.num), BigInt(value.den));
}

function publicFraction(value: Fraction): Rational {
	const num = Number(value.numerator);
	const den = Number(value.denominator);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
		throw new RangeError('The interpolation position is outside the safe rational domain.');
	}
	return Object.freeze({ num, den });
}

function integerFraction(value: number): Fraction {
	return Object.freeze({ numerator: BigInt(value), denominator: 1n });
}

function numberFraction(value: number): Fraction {
	if (Number.isSafeInteger(value)) return integerFraction(value);
	const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(String(value));
	if (!match) throw new RangeError('A finite interpolation value could not be represented exactly.');
	const decimals = match[3] ?? '';
	const exponent = Number(match[4] ?? 0) - decimals.length;
	let numerator = BigInt(`${match[1] ?? ''}${match[2] ?? ''}${decimals}`);
	let denominator = 1n;
	if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
	else denominator = 10n ** BigInt(-exponent);
	return normalizeFraction(numerator, denominator);
}

function normalizeFraction(numerator: bigint, denominator: bigint): Fraction {
	if (denominator === 0n) throw new RangeError('An interpolation position denominator cannot be zero.');
	if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
	const divisor = gcd(absolute(numerator), denominator);
	return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function subtract(left: Fraction, right: Fraction): Fraction {
	return normalizeFraction(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function add(left: Fraction, right: Fraction): Fraction {
	return normalizeFraction(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function multiply(left: Fraction, right: Fraction): Fraction {
	return normalizeFraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: Fraction, right: Fraction): Fraction {
	if (right.numerator === 0n) throw new RangeError('Cannot divide by zero.');
	return normalizeFraction(left.numerator * right.denominator, left.denominator * right.numerator);
}

function compare(left: Fraction, right: Fraction): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function fractionNumber(value: Fraction): number {
	return Number(value.numerator) / Number(value.denominator);
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) { const remainder = left % right; left = right; right = remainder; }
	return left || 1n;
}

function absolute(value: bigint): bigint { return value < 0n ? -value : value; }

function nonNullable<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a bounded interpolation value.');
	return value;
}

const ZERO = Object.freeze({ numerator: 0n, denominator: 1n });
