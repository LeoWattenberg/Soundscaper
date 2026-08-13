/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compileInterpolationCurve,
	evaluateInterpolationCurve,
	type CompiledInterpolationCurve,
	type InterpolationAnchor,
	type InterpolationShape,
} from './interpolation-curve.ts';
import {
	addFractions,
	compareFractions,
	divideFractions,
	exactFraction,
	fractionNumber,
	multiplyFractions,
	numberFraction,
	subtractFractions,
	type ExactInterpolationFraction,
} from './interpolation-curve-math.ts';
import {
	compareRationals,
	normalizeRational,
	subtractRationals,
	validateBreakpointMap,
	type BreakpointMap,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import { AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR } from './timeline-coordinate-limits.ts';
import {
	compileVideoRetimeCurve,
	evaluateVideoRetimeCurve,
	type CompiledVideoRetimeCurve,
	type VideoRetimeCurveSegment,
	type VideoRetimeCurveRational,
} from './video-retime-curve.ts';

export interface LegacyEnvelopePoint {
	readonly frame: number;
	readonly value: number;
}

export interface BreakpointInterpolationPiece {
	readonly origin: Rational;
	readonly end: Rational;
	readonly curve: CompiledInterpolationCurve;
}

export interface BreakpointInterpolationAdapter {
	readonly pieces: readonly Readonly<BreakpointInterpolationPiece>[];
}

interface InternalBreakpointPiece {
	readonly origin: ExactInterpolationFraction;
	readonly end: ExactInterpolationFraction;
	readonly sourceStart: ExactInterpolationFraction;
	readonly sourceEnd: ExactInterpolationFraction;
	readonly mode: 'forward' | 'freeze' | 'reverse';
}

export interface VideoRetimeInterpolationPiece {
	readonly origin: Rational;
	readonly end: Rational;
	readonly curve: CompiledInterpolationCurve;
}

export interface VideoRetimeInterpolationAdapter {
	readonly pieces: readonly Readonly<VideoRetimeInterpolationPiece>[];
}

const RETIME_ADAPTERS = new WeakSet<VideoRetimeInterpolationAdapter>();
const BREAKPOINT_ADAPTERS = new WeakMap<
	BreakpointInterpolationAdapter,
	readonly Readonly<InternalBreakpointPiece>[]
>();

/** Express one admitted legacy envelope without changing its persisted wire. */
export function compileEnvelopeInterpolationCurve(
	points: readonly LegacyEnvelopePoint[],
	durationFrames: number,
): CompiledInterpolationCurve {
	const duration = positiveSafeInteger(durationFrames, 'durationFrames');
	if (!Array.isArray(points)) throw new TypeError('Envelope points must be an array.');
	const normalized = points.map((point, index) => {
		if (!point || typeof point !== 'object') throw new TypeError(`Envelope point ${String(index)} is invalid.`);
		const frame = nonNegativeSafeInteger(point.frame, `Envelope point ${String(index)} frame`);
		if (frame > duration) throw new RangeError(`Envelope point ${String(index)} is outside the clip.`);
		const value = finiteNumber(point.value, `Envelope point ${String(index)} value`);
		if (value < 0) throw new RangeError(`Envelope point ${String(index)} value must be non-negative.`);
		if (index > 0 && frame <= nonNullable(points[index - 1]).frame) {
			throw new RangeError('Envelope points must use strictly increasing frames.');
		}
		return Object.freeze({ frame, value });
	});

	const anchors: InterpolationAnchor[] = [];
	const segments: InterpolationShape[] = [];
	if (normalized[0]?.frame === 0) anchors.push(anchor(0, normalized[0].value));
	else anchors.push(anchor(0, 1));
	for (const point of normalized) {
		if (point.frame === 0) continue;
		segments.push(Object.freeze({ kind: 'linear' }));
		anchors.push(anchor(point.frame, point.value));
	}
	if (nonNullable(anchors.at(-1)).position.num < duration) {
		segments.push(Object.freeze({ kind: 'hold' }));
		anchors.push(anchor(duration, nonNullable(anchors.at(-1)).value));
	}
	return compileInterpolationCurve({ anchors, segments });
}

/** Express a breakpoint map when every absolute coordinate is in the core Rational domain. */
export function compileBreakpointInterpolationCurve(map: BreakpointMap): CompiledInterpolationCurve {
	validateBreakpointMap(map);
	const anchors = map.points.map((point) => anchor(point.outer, rationalNumber(point.source)));
	const segments = map.points.slice(0, -1).map((point): InterpolationShape => Object.freeze({
		kind: point.mode === 'freeze' ? 'hold' : 'linear',
	}));
	return compileInterpolationCurve({ anchors, segments });
}

/** Express every Rational breakpoint map through signed/high-denominator origins and local curves. */
export function compileBreakpointInterpolationAdapter(map: BreakpointMap): BreakpointInterpolationAdapter {
	validateBreakpointMap(map);
	const internal: InternalBreakpointPiece[] = [];
	const pieces = map.points.slice(0, -1).map((point, index): BreakpointInterpolationPiece => {
		const next = nonNullable(map.points[index + 1]);
		internal.push(Object.freeze({
			origin: adapterFraction(point.outer),
			end: adapterFraction(next.outer),
			sourceStart: adapterFraction(point.source),
			sourceEnd: adapterFraction(next.source),
			mode: point.mode,
		}));
		return Object.freeze({
			origin: adapterRational(point.outer),
			end: adapterRational(next.outer),
			curve: compileInterpolationCurve({
				anchors: [anchor(0, rationalNumber(point.source)), anchor(1, rationalNumber(next.source))],
				segments: [Object.freeze({ kind: point.mode === 'freeze' ? 'hold' : 'linear' })],
			}),
		});
	});
	const adapter = Object.freeze({ pieces: Object.freeze(pieces) });
	BREAKPOINT_ADAPTERS.set(adapter, Object.freeze(internal));
	return adapter;
}

/** Evaluate after exact origin/span normalization, before one native-value conversion. */
export function evaluateBreakpointInterpolationAdapter(
	adapter: BreakpointInterpolationAdapter,
	position: RationalInput,
): number {
	const pieces = BREAKPOINT_ADAPTERS.get(adapter);
	if (pieces === undefined) {
		throw new TypeError('A compiled breakpoint interpolation adapter is required.');
	}
	const query = adapterFraction(position);
	const first = nonNullable(pieces[0]);
	const last = nonNullable(pieces.at(-1));
	if (compareFractions(query, first.origin) <= 0) return legacyBreakpointNumber(first.sourceStart);
	if (compareFractions(query, last.end) >= 0) return legacyBreakpointNumber(last.sourceEnd);
	let low = 0;
	let high = pieces.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const piece = nonNullable(pieces[middle]);
		if (compareFractions(piece.end, query) <= 0) low = middle + 1;
		else high = middle;
	}
	const piece = nonNullable(pieces[Math.min(low, pieces.length - 1)]);
	if (piece.mode === 'freeze') return legacyBreakpointNumber(piece.sourceStart);
	const interpolation = multiplyFractions(
		subtractFractions(query, piece.origin),
		divideFractions(
			subtractFractions(piece.sourceEnd, piece.sourceStart),
			subtractFractions(piece.end, piece.origin),
		),
	);
	return legacyBreakpointNumber(addFractions(piece.sourceStart, interpolation));
}

/**
 * Express the existing V2 retime algebra. Constant and freeze segments map
 * directly; a linear-velocity ramp is the equivalent cubic Bézier with
 * one-third time handles and endpoint derivatives converted to value handles.
 * This single-curve convenience rejects absolute handles outside Rational;
 * compileVideoRetimeInterpolationAdapter is total over the admitted V2 wire.
 */
export function compileVideoRetimeInterpolationCurve(value: unknown): CompiledInterpolationCurve {
	const curve = compileVideoRetimeCurve(value);
	const anchors: InterpolationAnchor[] = [anchor(
		nonNullable(curve.points[0]).outerFrame,
		rationalNumber(nonNullable(curve.points[0]).sourceFrame),
	)];
	const segments: InterpolationShape[] = [];
	for (const [index, segment] of curve.segments.entries()) {
		const start = nonNullable(curve.points[index]);
		const end = nonNullable(curve.points[index + 1]);
		if (segment.mode === 'freeze') appendSegment(
			anchors, segments, end.outerFrame, rationalNumber(end.sourceFrame), Object.freeze({ kind: 'hold' }),
		);
		else if (segment.mode === 'constant-forward' || segment.mode === 'constant-reverse') appendSegment(
			anchors, segments, end.outerFrame, rationalNumber(end.sourceFrame), Object.freeze({ kind: 'linear' }),
		);
		else {
			if (!('startVelocity' in segment) || !('endVelocity' in segment)) {
				throw new RangeError('A retime ramp requires endpoint velocities.');
			}
			const shape = equalRationals(segment.startVelocity, segment.endVelocity)
				? Object.freeze({ kind: 'linear' as const })
				: rampShape(
					start.outerFrame, end.outerFrame,
					retimeValue(curve, start.outerFrame), retimeValue(curve, end.outerFrame),
					rationalNumber(segment.startVelocity), rationalNumber(segment.endVelocity), segment.mode,
				);
			if (shape === null) throw unrepresentableRetimeRamp();
			appendSegment(anchors, segments, end.outerFrame, retimeValue(curve, end.outerFrame), shape);
		}
	}
	return compileInterpolationCurve({ anchors, segments });
}

/** Compile every admitted V2 retime curve into exact-origin, local Rational pieces. */
export function compileVideoRetimeInterpolationAdapter(value: unknown): VideoRetimeInterpolationAdapter {
	const curve = compileVideoRetimeCurve(value);
	const pieces: VideoRetimeInterpolationPiece[] = [];
	for (const [index, segment] of curve.segments.entries()) {
		const start = nonNullable(curve.points[index]);
		const end = nonNullable(curve.points[index + 1]);
		if (segment.mode === 'freeze' || segment.mode === 'constant-forward'
			|| segment.mode === 'constant-reverse') {
			pieces.push(localPiece(
				curve, start.outerFrame, end.outerFrame,
				segment.mode === 'freeze' ? Object.freeze({ kind: 'hold' }) : Object.freeze({ kind: 'linear' }),
			));
			continue;
		}
		if (!('startVelocity' in segment) || !('endVelocity' in segment)) {
			throw new RangeError('A retime ramp requires endpoint velocities.');
		}
		if (equalRationals(segment.startVelocity, segment.endVelocity)) {
			pieces.push(localPiece(
				curve, start.outerFrame, end.outerFrame, Object.freeze({ kind: 'linear' }),
			));
			continue;
		}
		const span = end.outerFrame - start.outerFrame;
		// A divisible-by-three local prefix has integer handles. Its one- or
		// two-frame remainder has bounded local thirds, independent of origin.
		const prefixSpan = span - span % 3;
		if (prefixSpan > 0) pieces.push(localRampPiece(
			curve, segment, start.outerFrame, start.outerFrame + prefixSpan,
			start.outerFrame, end.outerFrame,
		));
		if (prefixSpan < span) pieces.push(localRampPiece(
			curve, segment, start.outerFrame + prefixSpan, end.outerFrame,
			start.outerFrame, end.outerFrame,
		));
	}
	const adapter = Object.freeze({ pieces: Object.freeze(pieces) });
	RETIME_ADAPTERS.add(adapter);
	return adapter;
}

/** Evaluate one adapter after exact Rational subtraction of its integer piece origin. */
export function evaluateVideoRetimeInterpolationAdapter(
	adapter: VideoRetimeInterpolationAdapter,
	position: RationalInput,
): number {
	if (!RETIME_ADAPTERS.has(adapter)) throw new TypeError('A compiled retime interpolation adapter is required.');
	const query = normalizeRational(position);
	let low = 0;
	let high = adapter.pieces.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (compareRationals(nonNullable(adapter.pieces[middle]).origin, query) <= 0) low = middle + 1;
		else high = middle;
	}
	const piece = nonNullable(adapter.pieces[Math.min(Math.max(0, low - 1), adapter.pieces.length - 1)]);
	return evaluateInterpolationCurve(piece.curve, subtractRationals(query, piece.origin));
}

function localRampPiece(
	curve: CompiledVideoRetimeCurve,
	segment: Extract<VideoRetimeCurveSegment, { mode: 'ramp-forward' | 'ramp-reverse' }>,
	startFrame: number,
	endFrame: number,
	originalStart: number,
	originalEnd: number,
): VideoRetimeInterpolationPiece {
	const shape = rampShape(
		0, endFrame - startFrame, retimeValue(curve, startFrame), retimeValue(curve, endFrame),
		velocityAt(segment.startVelocity, segment.endVelocity, originalStart, originalEnd, startFrame),
		velocityAt(segment.startVelocity, segment.endVelocity, originalStart, originalEnd, endFrame),
		segment.mode,
	);
	if (shape === null) throw unrepresentableRetimeRamp();
	return localPiece(curve, startFrame, endFrame, shape);
}

function localPiece(
	curve: CompiledVideoRetimeCurve,
	startFrame: number,
	endFrame: number,
	shape: InterpolationShape,
): VideoRetimeInterpolationPiece {
	return Object.freeze({
		origin: normalizeRational(startFrame),
		end: normalizeRational(endFrame),
		curve: compileInterpolationCurve({
			anchors: [anchor(0, retimeValue(curve, startFrame)),
				anchor(endFrame - startFrame, retimeValue(curve, endFrame))],
			segments: [shape],
		}),
	});
}

function rampShape(
	startFrame: number,
	endFrame: number,
	startValue: number,
	endValue: number,
	startVelocity: number,
	endVelocity: number,
	mode: 'ramp-forward' | 'ramp-reverse',
): InterpolationShape | null {
	const span = endFrame - startFrame;
	const direction = mode === 'ramp-forward' ? 1 : -1;
	try {
		return Object.freeze({
			kind: 'bezier',
			control1: anchor(
				interpolatePosition(startFrame, endFrame, 1, 3),
				startValue + direction * span * startVelocity / 3,
			),
			control2: anchor(
				interpolatePosition(startFrame, endFrame, 2, 3),
				endValue - direction * span * endVelocity / 3,
			),
		});
	} catch (error) {
		if (error instanceof RangeError && /control position|shared rational domain/iu.test(error.message)) return null;
		throw error;
	}
}

function appendSegment(
	anchors: InterpolationAnchor[],
	segments: InterpolationShape[],
	endFrame: number,
	endValue: number,
	shape: InterpolationShape,
): void {
	segments.push(shape);
	anchors.push(anchor(endFrame, endValue));
}

function velocityAt(
	startVelocity: VideoRetimeCurveRational,
	endVelocity: VideoRetimeCurveRational,
	startFrame: number,
	endFrame: number,
	frame: number,
): number {
	const offset = BigInt(frame - startFrame);
	const span = BigInt(endFrame - startFrame);
	const startWeight = span - offset;
	const numerator = BigInt(startVelocity.num) * BigInt(endVelocity.den) * startWeight
		+ BigInt(endVelocity.num) * BigInt(startVelocity.den) * offset;
	const denominator = BigInt(startVelocity.den) * BigInt(endVelocity.den) * span;
	return Number(numerator) / Number(denominator);
}

function retimeValue(curve: CompiledVideoRetimeCurve, frame: number): number {
	const exact = evaluateVideoRetimeCurve(curve, frame);
	return Number(exact.numerator) / Number(exact.denominator);
}

function equalRationals(left: VideoRetimeCurveRational, right: VideoRetimeCurveRational): boolean {
	return BigInt(left.num) * BigInt(right.den) === BigInt(right.num) * BigInt(left.den);
}

function unrepresentableRetimeRamp(): RangeError {
	return new RangeError('The retime ramp cannot be expressed with absolute handles in the shared rational domain.');
}

function anchor(position: RationalInput, value: number): InterpolationAnchor {
	return Object.freeze({
		position: normalizeRational(position),
		value,
	});
}

function adapterRational(value: RationalInput): Rational {
	return normalizeRational(value, {
		maximumDenominator: AUDIO_EDITOR_COORDINATE_MAXIMUM_DENOMINATOR,
	});
}

function adapterFraction(value: RationalInput): ExactInterpolationFraction {
	return typeof value === 'number' ? numberFraction(value) : exactFraction(adapterRational(value));
}

function legacyBreakpointNumber(value: ExactInterpolationFraction): number {
	if (!Number.isSafeInteger(Number(value.numerator))
		|| !Number.isSafeInteger(Number(value.denominator))) {
		throw new RangeError('The rational result is outside the safe integer domain.');
	}
	return fractionNumber(value);
}

function interpolatePosition(start: number, end: number, numerator: bigint | number, denominator: bigint | number): Rational {
	const weightNumerator = typeof numerator === 'bigint' ? numerator : BigInt(numerator);
	const weightDenominator = typeof denominator === 'bigint' ? denominator : BigInt(denominator);
	const rawNumerator = BigInt(start) * weightDenominator + BigInt(end - start) * weightNumerator;
	const divisor = gcd(rawNumerator < 0n ? -rawNumerator : rawNumerator, weightDenominator);
	const num = Number(rawNumerator / divisor);
	const den = Number(weightDenominator / divisor);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
		throw new RangeError('The retime ramp control position is outside the shared rational domain.');
	}
	return Object.freeze({ num, den });
}

function rationalNumber(value: number | Rational | VideoRetimeCurveRational): number {
	return typeof value === 'number' ? value : value.num / value.den;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	return value;
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

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Number(value);
}

function gcd(left: bigint, right: bigint): bigint {
	while (right !== 0n) { const remainder = left % right; left = right; right = remainder; }
	return left || 1n;
}

function nonNullable<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new RangeError('Expected a bounded interpolation adapter value.');
	return value;
}
