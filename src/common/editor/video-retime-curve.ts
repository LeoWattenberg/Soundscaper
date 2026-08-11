/* SPDX-License-Identifier: AGPL-3.0-only */

export interface VideoRetimeCurveRational {
	readonly num: number;
	readonly den: number;
}

export interface ExactVideoRetimeRational {
	readonly numerator: bigint;
	readonly denominator: bigint;
}

export type VideoRetimeCurveSegment = Readonly<
	| { mode: 'constant-forward' | 'constant-reverse' | 'freeze' }
	| {
		mode: 'ramp-forward' | 'ramp-reverse';
		startVelocity: VideoRetimeCurveRational;
		endVelocity: VideoRetimeCurveRational;
	}
>;

export interface CompiledVideoRetimeCurve {
	readonly version: 2;
	readonly outerFrameCount: number;
	readonly sourceStartFrame: number;
	readonly sourceFrameCount: number;
	readonly points: readonly Readonly<{
		readonly outerFrame: number;
		readonly sourceFrame: VideoRetimeCurveRational;
	}>[];
	readonly segments: readonly VideoRetimeCurveSegment[];
}

export type VideoRetimeInverseOccurrence = Readonly<
	| { kind: 'point'; outerFrame: number }
	| { kind: 'range'; startOuterFrame: number; endOuterFrame: number }
	| { kind: 'bracket'; beforeOuterFrame: number; afterOuterFrame: number }
>;

interface Fraction { readonly numerator: bigint; readonly denominator: bigint }
interface InternalPoint { readonly outerFrame: number; readonly sourceFrame: Fraction }
interface InternalSegment {
	readonly mode: VideoRetimeCurveSegment['mode'];
	readonly startOuterFrame: number;
	readonly endOuterFrame: number;
	readonly startSourceFrame: Fraction;
	readonly endSourceFrame: Fraction;
	readonly startVelocity: Fraction;
	readonly endVelocity: Fraction;
	readonly direction: -1 | 0 | 1;
}
interface InternalCurve {
	readonly outerFrameCount: number;
	readonly points: readonly InternalPoint[];
	readonly segments: readonly InternalSegment[];
}

const MAXIMUM_SEGMENTS = 4_096;
const MAXIMUM_INPUT_DENOMINATOR = Number.MAX_SAFE_INTEGER;
const MAXIMUM_EXACT_BITS = 4_096;
const COMPILED_CURVES = new WeakMap<CompiledVideoRetimeCurve, InternalCurve>();

export function compileVideoRetimeCurve(value: unknown): CompiledVideoRetimeCurve {
	const input = dataRecord(value, 'curve', [
		'version', 'outerFrameCount', 'sourceStartFrame', 'sourceFrameCount', 'points', 'segments',
	]);
	if (input.version !== 2) throw new RangeError('curve.version must be 2.');
	const outerFrameCount = positiveSafeInteger(input.outerFrameCount, 'curve.outerFrameCount');
	const sourceStartFrame = nonNegativeSafeInteger(input.sourceStartFrame, 'curve.sourceStartFrame');
	const sourceFrameCount = positiveSafeInteger(input.sourceFrameCount, 'curve.sourceFrameCount');
	const sourceEndFrame = safeAdd(sourceStartFrame, sourceFrameCount, 'curve source range');
	const pointValues = denseArray(input.points, 'curve.points');
	const segmentValues = denseArray(input.segments, 'curve.segments');
	if (segmentValues.length < 1 || segmentValues.length > MAXIMUM_SEGMENTS) {
		throw new RangeError(`A curve requires 1 through ${String(MAXIMUM_SEGMENTS)} segments.`);
	}
	if (pointValues.length !== segmentValues.length + 1) {
		throw new RangeError('curve.points must contain exactly one more item than curve.segments.');
	}

	const points: InternalPoint[] = [];
	for (const [index, candidate] of pointValues.entries()) {
		const point = dataRecord(candidate, `curve.points[${String(index)}]`, ['outerFrame', 'sourceFrame']);
		const outerFrame = nonNegativeSafeInteger(point.outerFrame, `curve.points[${String(index)}].outerFrame`);
		const sourceFrame = inputFraction(point.sourceFrame, `curve.points[${String(index)}].sourceFrame`);
		if (compare(sourceFrame, integerFraction(sourceStartFrame)) < 0
			|| compare(sourceFrame, integerFraction(sourceEndFrame)) > 0) {
			throw new RangeError(`curve.points[${String(index)}].sourceFrame is outside the source range.`);
		}
		if (index > 0 && outerFrame <= nonNullable(points[index - 1]).outerFrame) {
			throw new RangeError('Curve outer frames must be strictly increasing.');
		}
		points.push(Object.freeze({ outerFrame, sourceFrame }));
	}
	if (nonNullable(points[0]).outerFrame !== 0) throw new RangeError('The first curve outer frame must be zero.');
	if (nonNullable(points.at(-1)).outerFrame !== outerFrameCount) {
		throw new RangeError('The last curve outer frame must equal outerFrameCount.');
	}

	const publicSegments: VideoRetimeCurveSegment[] = [];
	const segments = segmentValues.map((candidate, index): InternalSegment => {
		const start = nonNullable(points[index]);
		const end = nonNullable(points[index + 1]);
		const base = plainRecord(candidate, `curve.segments[${String(index)}]`);
		const mode = dataProperty(base, 'mode', `curve.segments[${String(index)}]`);
		if (typeof mode !== 'string') throw new TypeError(`curve.segments[${String(index)}].mode must be a string.`);
		const span = integerFraction(end.outerFrame - start.outerFrame);
		const sourceDelta = subtract(end.sourceFrame, start.sourceFrame);
		let startVelocity: Fraction;
		let endVelocity: Fraction;
		let direction: -1 | 0 | 1;
		if (mode === 'constant-forward' || mode === 'constant-reverse' || mode === 'freeze') {
			assertKeys(base, ['mode'], `curve.segments[${String(index)}]`);
			const sourceDirection = compare(sourceDelta, ZERO);
			if (mode === 'constant-forward' && sourceDirection <= 0) {
				throw new RangeError('A constant-forward segment must increase its source position.');
			}
			if (mode === 'constant-reverse' && sourceDirection >= 0) {
				throw new RangeError('A constant-reverse segment must decrease its source position.');
			}
			if (mode === 'freeze' && sourceDirection !== 0) {
				throw new RangeError('A freeze segment must retain one source position.');
			}
			direction = mode === 'constant-forward' ? 1 : mode === 'constant-reverse' ? -1 : 0;
			startVelocity = direction === 0 ? ZERO : divide(sourceDelta, span);
			endVelocity = startVelocity;
			publicSegments.push(Object.freeze({ mode }));
		} else if (mode === 'ramp-forward' || mode === 'ramp-reverse') {
			assertKeys(base, ['mode', 'startVelocity', 'endVelocity'], `curve.segments[${String(index)}]`);
			startVelocity = inputFraction(
				dataProperty(base, 'startVelocity', `curve.segments[${String(index)}]`),
				`curve.segments[${String(index)}].startVelocity`,
			);
			endVelocity = inputFraction(
				dataProperty(base, 'endVelocity', `curve.segments[${String(index)}]`),
				`curve.segments[${String(index)}].endVelocity`,
			);
			if (compare(startVelocity, ZERO) < 0 || compare(endVelocity, ZERO) < 0) {
				throw new RangeError('Ramp velocity magnitudes must be non-negative.');
			}
			if (isZero(startVelocity) && isZero(endVelocity)) {
				throw new RangeError('A ramp with two zero velocities must be a freeze segment.');
			}
			direction = mode === 'ramp-forward' ? 1 : -1;
			const sourceDirection = compare(sourceDelta, ZERO);
			if ((direction === 1 && sourceDirection <= 0) || (direction === -1 && sourceDirection >= 0)) {
				throw new RangeError(`${mode} direction does not match its source positions.`);
			}
			const expectedMagnitude = divide(multiply(span, add(startVelocity, endVelocity)), TWO);
			if (compare(absolute(sourceDelta), expectedMagnitude) !== 0) {
				throw new RangeError('Ramp source endpoints do not match the exact velocity integral.');
			}
			publicSegments.push(Object.freeze({
				mode,
				startVelocity: publicInputRational(startVelocity),
				endVelocity: publicInputRational(endVelocity),
			}));
		} else {
			throw new RangeError(`curve.segments[${String(index)}].mode is unsupported.`);
		}
		return Object.freeze({
			mode, startOuterFrame: start.outerFrame, endOuterFrame: end.outerFrame,
			startSourceFrame: start.sourceFrame, endSourceFrame: end.sourceFrame,
			startVelocity, endVelocity, direction,
		}) as InternalSegment;
	});

	for (let index = 1; index < segments.length; index += 1) {
		const previous = nonNullable(segments[index - 1]);
		const current = nonNullable(segments[index]);
		if (previous.direction !== 0 && current.direction !== 0 && previous.direction !== current.direction
			&& (!isZero(previous.endVelocity) || !isZero(current.startVelocity))) {
			throw new RangeError('A direct direction change requires zero incident velocities.');
		}
	}

	const curve = Object.freeze({
		version: 2 as const,
		outerFrameCount,
		sourceStartFrame,
		sourceFrameCount,
		points: Object.freeze(points.map((point) => Object.freeze({
			outerFrame: point.outerFrame,
			sourceFrame: publicInputRational(point.sourceFrame),
		}))),
		segments: Object.freeze(publicSegments),
	});
	COMPILED_CURVES.set(curve, Object.freeze({
		outerFrameCount,
		points: Object.freeze(points),
		segments: Object.freeze(segments),
	}));
	return curve;
}

export function evaluateVideoRetimeCurve(
	curveValue: unknown,
	outerFrameValue: unknown,
): ExactVideoRetimeRational {
	const curve = compiledCurve(curveValue);
	const outerFrame = queryFraction(outerFrameValue, 'outerFrame');
	assertInOuterDomain(curve, outerFrame);
	return publicExact(evaluateInternal(curve, outerFrame));
}

export function invertVideoRetimeCurve(
	curveValue: unknown,
	sourceFrameValue: unknown,
	optionsValue: unknown,
): readonly VideoRetimeInverseOccurrence[] {
	const curve = compiledCurve(curveValue);
	const sourceFrame = queryFraction(sourceFrameValue, 'sourceFrame');
	const options = dataRecord(optionsValue, 'options', ['policy', 'outerHint'], true);
	const policy = options.policy;
	if (typeof policy !== 'string' || !['all', 'earliest', 'latest', 'nearest-cell'].includes(policy)) {
		throw new RangeError('options.policy must be all, earliest, latest, or nearest-cell.');
	}
	let outerHint: number | null = null;
	if (policy === 'nearest-cell') {
		outerHint = safeInteger(options.outerHint, 'options.outerHint');
	} else if (Object.hasOwn(options, 'outerHint')) {
		throw new TypeError('options.outerHint is supported only by nearest-cell.');
	}

	const raw: VideoRetimeInverseOccurrence[] = [];
	for (const [index, segment] of curve.segments.entries()) {
		const final = index === curve.segments.length - 1;
		if (segment.direction === 0) {
			if (compare(sourceFrame, segment.startSourceFrame) === 0) {
				raw.push(Object.freeze({
					kind: 'range',
					startOuterFrame: segment.startOuterFrame,
					endOuterFrame: final ? segment.endOuterFrame : segment.endOuterFrame - 1,
				}));
			}
			continue;
		}
		const startComparison = compare(sourceFrame, segment.startSourceFrame);
		const endComparison = compare(sourceFrame, segment.endSourceFrame);
		const within = segment.direction === 1
			? startComparison >= 0 && endComparison <= 0
			: startComparison <= 0 && endComparison >= 0;
		if (!within) continue;
		if (startComparison === 0) {
			raw.push(Object.freeze({ kind: 'point', outerFrame: segment.startOuterFrame }));
			continue;
		}
		if (endComparison === 0) {
			if (final) raw.push(Object.freeze({ kind: 'point', outerFrame: segment.endOuterFrame }));
			continue;
		}
		raw.push(invertMovingSegment(segment, sourceFrame));
	}

	const occurrences = Object.freeze(normalizeOccurrences(raw));
	if (policy === 'all' || occurrences.length === 0) return occurrences;
	if (policy === 'earliest') return Object.freeze([nonNullable(occurrences[0])]);
	if (policy === 'latest') return Object.freeze([nonNullable(occurrences.at(-1))]);
	const hint = nonNullable(outerHint);
	let selected = nonNullable(occurrences[0]);
	let selectedDistance = occurrenceDistance(selected, hint);
	for (let index = 1; index < occurrences.length; index += 1) {
		const candidate = nonNullable(occurrences[index]);
		const distance = occurrenceDistance(candidate, hint);
		if (distance < selectedDistance) {
			selected = candidate;
			selectedDistance = distance;
		}
	}
	return Object.freeze([selected]);
}

function invertMovingSegment(segment: InternalSegment, target: Fraction): VideoRetimeInverseOccurrence {
	let low = segment.startOuterFrame;
	let high = segment.endOuterFrame;
	while (high - low > 1) {
		const middle = low + Math.floor((high - low) / 2);
		const comparison = compare(evaluateSegment(segment, integerFraction(middle)), target);
		if (comparison === 0) return Object.freeze({ kind: 'point', outerFrame: middle });
		if ((segment.direction === 1 && comparison < 0) || (segment.direction === -1 && comparison > 0)) {
			low = middle;
		} else {
			high = middle;
		}
	}
	if (compare(evaluateSegment(segment, integerFraction(low)), target) === 0) {
		return Object.freeze({ kind: 'point', outerFrame: low });
	}
	if (compare(evaluateSegment(segment, integerFraction(high)), target) === 0) {
		return Object.freeze({ kind: 'point', outerFrame: high });
	}
	return Object.freeze({ kind: 'bracket', beforeOuterFrame: low, afterOuterFrame: high });
}

function evaluateInternal(curve: InternalCurve, outerFrame: Fraction): Fraction {
	let low = 0;
	let high = curve.points.length - 1;
	while (low + 1 < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (compare(outerFrame, integerFraction(nonNullable(curve.points[middle]).outerFrame)) < 0) high = middle;
		else low = middle;
	}
	return evaluateSegment(nonNullable(curve.segments[Math.min(low, curve.segments.length - 1)]), outerFrame);
}

function evaluateSegment(segment: InternalSegment, outerFrame: Fraction): Fraction {
	if (segment.direction === 0) return segment.startSourceFrame;
	const offset = subtract(outerFrame, integerFraction(segment.startOuterFrame));
	const span = integerFraction(segment.endOuterFrame - segment.startOuterFrame);
	if (segment.mode === 'constant-forward' || segment.mode === 'constant-reverse') {
		return add(segment.startSourceFrame, divide(multiply(
			subtract(segment.endSourceFrame, segment.startSourceFrame), offset,
		), span));
	}
	const linear = multiply(segment.startVelocity, offset);
	const quadratic = divide(multiply(
		subtract(segment.endVelocity, segment.startVelocity), multiply(offset, offset),
	), multiply(TWO, span));
	const magnitude = add(linear, quadratic);
	return segment.direction === 1
		? add(segment.startSourceFrame, magnitude)
		: subtract(segment.startSourceFrame, magnitude);
}

function normalizeOccurrences(values: readonly VideoRetimeInverseOccurrence[]): VideoRetimeInverseOccurrence[] {
	const result: VideoRetimeInverseOccurrence[] = [];
	for (const value of values) {
		const previous = result.at(-1);
		if (!previous || previous.kind === 'bracket' || value.kind === 'bracket') {
			result.push(value);
			continue;
		}
		const previousStart = occurrenceStart(previous);
		const previousEnd = occurrenceEnd(previous);
		const valueStart = occurrenceStart(value);
		const valueEnd = occurrenceEnd(value);
		if (previous.kind === 'point' && value.kind === 'point') {
			if (previous.outerFrame !== value.outerFrame) result.push(value);
			continue;
		}
		if (valueStart <= previousEnd + 1 && valueEnd >= previousStart) {
			result[result.length - 1] = Object.freeze({
				kind: 'range',
				startOuterFrame: Math.min(previousStart, valueStart),
				endOuterFrame: Math.max(previousEnd, valueEnd),
			});
		} else result.push(value);
	}
	return result;
}

function occurrenceStart(value: VideoRetimeInverseOccurrence): number {
	return value.kind === 'point' ? value.outerFrame
		: value.kind === 'range' ? value.startOuterFrame : value.beforeOuterFrame;
}

function occurrenceEnd(value: VideoRetimeInverseOccurrence): number {
	return value.kind === 'point' ? value.outerFrame
		: value.kind === 'range' ? value.endOuterFrame : value.afterOuterFrame;
}

function occurrenceDistance(value: VideoRetimeInverseOccurrence, hint: number): bigint {
	const start = BigInt(occurrenceStart(value));
	const end = BigInt(occurrenceEnd(value));
	const target = BigInt(hint);
	return target < start ? start - target : target > end ? target - end : 0n;
}

function compiledCurve(value: unknown): InternalCurve {
	if (!value || typeof value !== 'object') throw new TypeError('A compiled video-retime curve is required.');
	const curve = COMPILED_CURVES.get(value as CompiledVideoRetimeCurve);
	if (!curve) throw new TypeError('The video-retime curve was not produced by compileVideoRetimeCurve.');
	return curve;
}

function assertInOuterDomain(curve: InternalCurve, outerFrame: Fraction): void {
	if (compare(outerFrame, ZERO) < 0 || compare(outerFrame, integerFraction(curve.outerFrameCount)) > 0) {
		throw new RangeError('outerFrame is outside the curve domain.');
	}
}

function dataRecord(
	value: unknown,
	name: string,
	keys: readonly string[],
	allowMissing = false,
): Record<string, unknown> {
	const result = plainRecord(value, name);
	assertKeys(result, keys, name, allowMissing);
	for (const key of Reflect.ownKeys(result)) {
		if (typeof key === 'string') dataProperty(result, key, name);
	}
	return result;
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must have a plain record prototype.`);
	return value as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[], name: string, allowMissing = false): void {
	const allowed = new Set(keys);
	const ownKeys = Reflect.ownKeys(value);
	const unexpected = ownKeys.find((key) => typeof key !== 'string' || !allowed.has(key));
	if (unexpected !== undefined) throw new TypeError(`${name} contains an unsupported field.`);
	if (!allowMissing) for (const key of keys) if (!ownKeys.includes(key)) throw new TypeError(`${name}.${key} is required.`);
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property, not an accessor.`);
	}
	return descriptor.value;
}

function denseArray(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must have the standard array prototype.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length') continue;
		if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)) throw new TypeError(`${name} has an unsupported field.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name} must be a dense data array.`);
		result.push(descriptor.value);
	}
	return result;
}

function inputFraction(value: unknown, name: string): Fraction {
	const record = dataRecord(value, name, ['num', 'den']);
	const num = safeInteger(record.num, `${name}.num`);
	const den = positiveSafeInteger(record.den, `${name}.den`);
	if (den > MAXIMUM_INPUT_DENOMINATOR) throw new RangeError(`${name}.den exceeds its bound.`);
	const normalized = normalize(BigInt(num), BigInt(den));
	if (normalized.numerator !== BigInt(num) || normalized.denominator !== BigInt(den)) {
		throw new RangeError(`${name} must be canonically reduced.`);
	}
	return normalized;
}

function queryFraction(value: unknown, name: string): Fraction {
	if (typeof value === 'number') return integerFraction(safeInteger(value, name));
	const record = plainRecord(value, name);
	const keys = Reflect.ownKeys(record);
	if (keys.length === 2 && keys.includes('num') && keys.includes('den')) return inputFraction(value, name);
	if (keys.length === 2 && keys.includes('numerator') && keys.includes('denominator')) {
		const exact = dataRecord(value, name, ['numerator', 'denominator']);
		if (typeof exact.numerator !== 'bigint' || typeof exact.denominator !== 'bigint') {
			throw new TypeError(`${name} exact numerator and denominator must be BigInt.`);
		}
		if (bitLength(exact.numerator) > MAXIMUM_EXACT_BITS
			|| bitLength(exact.denominator) > MAXIMUM_EXACT_BITS) {
			throw new RangeError(`Exact rational complexity exceeds ${String(MAXIMUM_EXACT_BITS)} bits.`);
		}
		const normalized = normalize(exact.numerator, exact.denominator);
		if (normalized.numerator !== exact.numerator || normalized.denominator !== exact.denominator) {
			throw new RangeError(`${name} must be a reduced exact rational.`);
		}
		return normalized;
	}
	throw new TypeError(`${name} must be a bounded or runtime exact rational.`);
}

function publicInputRational(value: Fraction): VideoRetimeCurveRational {
	const num = Number(value.numerator);
	const den = Number(value.denominator);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) throw new RangeError('Input rational is outside the safe domain.');
	return Object.freeze({ num, den });
}

function publicExact(value: Fraction): ExactVideoRetimeRational {
	return Object.freeze({ numerator: value.numerator, denominator: value.denominator });
}

const ZERO = Object.freeze({ numerator: 0n, denominator: 1n });
const TWO = Object.freeze({ numerator: 2n, denominator: 1n });

function integerFraction(value: number): Fraction {
	return Object.freeze({ numerator: BigInt(value), denominator: 1n });
}

function normalize(numerator: bigint, denominator: bigint): Fraction {
	if (denominator === 0n) throw new RangeError('An exact rational denominator cannot be zero.');
	if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
	const divisor = gcd(absoluteBigInt(numerator), denominator);
	const result = Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
	assertExactBits(result);
	return result;
}

function add(left: Fraction, right: Fraction): Fraction {
	return normalize(
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function subtract(left: Fraction, right: Fraction): Fraction {
	return normalize(
		left.numerator * right.denominator - right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

function multiply(left: Fraction, right: Fraction): Fraction {
	return normalize(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: Fraction, right: Fraction): Fraction {
	if (right.numerator === 0n) throw new RangeError('Cannot divide by zero.');
	return normalize(left.numerator * right.denominator, left.denominator * right.numerator);
}

function compare(left: Fraction, right: Fraction): -1 | 0 | 1 {
	const difference = left.numerator * right.denominator - right.numerator * left.denominator;
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function absolute(value: Fraction): Fraction {
	return value.numerator < 0n ? normalize(-value.numerator, value.denominator) : value;
}

function isZero(value: Fraction): boolean { return value.numerator === 0n; }

function assertExactBits(value: Fraction): void {
	if (bitLength(value.numerator) > MAXIMUM_EXACT_BITS || bitLength(value.denominator) > MAXIMUM_EXACT_BITS) {
		throw new RangeError(`Exact rational complexity exceeds ${String(MAXIMUM_EXACT_BITS)} bits.`);
	}
}

function bitLength(value: bigint): number {
	return absoluteBigInt(value).toString(2).length;
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) { const remainder = left % right; left = right; right = remainder; }
	return left || 1n;
}

function absoluteBigInt(value: bigint): bigint { return value < 0n ? -value : value; }

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result < 0) throw new RangeError(`${name} must be non-negative.`);
	return result;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = safeInteger(value, name);
	if (result <= 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer domain.`);
	return result;
}

function nonNullable<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a bounded curve value.');
	return value;
}
