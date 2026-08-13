/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compileInterpolationCurve,
	type CompiledInterpolationCurve,
	type InterpolationAnchor,
	type InterpolationShape,
} from './interpolation-curve.ts';
import {
	normalizeRational,
	validateBreakpointMap,
	type BreakpointMap,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import {
	compileVideoRetimeCurve,
	type VideoRetimeCurveRational,
} from './video-retime-curve.ts';

export interface LegacyEnvelopePoint {
	readonly frame: number;
	readonly value: number;
}

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

/** Express the shared V15-style linear/freeze breakpoint evaluator. */
export function compileBreakpointInterpolationCurve(map: BreakpointMap): CompiledInterpolationCurve {
	validateBreakpointMap(map);
	const anchors = map.points.map((point) => anchor(point.outer, rationalNumber(point.source)));
	const segments = map.points.slice(0, -1).map((point): InterpolationShape => Object.freeze({
		kind: point.mode === 'freeze' ? 'hold' : 'linear',
	}));
	return compileInterpolationCurve({ anchors, segments });
}

/**
 * Express the existing V2 retime algebra. Constant and freeze segments map
 * directly; a linear-velocity ramp is the equivalent cubic Bézier with
 * one-third time handles and endpoint derivatives converted to value handles.
 */
export function compileVideoRetimeInterpolationCurve(value: unknown): CompiledInterpolationCurve {
	const curve = compileVideoRetimeCurve(value);
	const anchors = curve.points.map((point) => anchor(point.outerFrame, rationalNumber(point.sourceFrame)));
	const segments = curve.segments.map((segment, index): InterpolationShape => {
		if (segment.mode === 'freeze') return Object.freeze({ kind: 'hold' });
		if (segment.mode === 'constant-forward' || segment.mode === 'constant-reverse') {
			return Object.freeze({ kind: 'linear' });
		}
		if (!('startVelocity' in segment) || !('endVelocity' in segment)) {
			throw new RangeError('A retime ramp requires endpoint velocities.');
		}
		const start = nonNullable(curve.points[index]);
		const end = nonNullable(curve.points[index + 1]);
		const startValue = rationalNumber(start.sourceFrame);
		const endValue = rationalNumber(end.sourceFrame);
		const span = end.outerFrame - start.outerFrame;
		const direction = segment.mode === 'ramp-forward' ? 1 : -1;
		return Object.freeze({
			kind: 'bezier',
			control1: anchor(
				interpolatePosition(start.outerFrame, end.outerFrame, 1, 3),
				startValue + direction * span * rationalNumber(segment.startVelocity) / 3,
			),
			control2: anchor(
				interpolatePosition(start.outerFrame, end.outerFrame, 2, 3),
				endValue - direction * span * rationalNumber(segment.endVelocity) / 3,
			),
		});
	});
	return compileInterpolationCurve({ anchors, segments });
}

function anchor(position: RationalInput, value: number): InterpolationAnchor {
	return Object.freeze({
		position: normalizeRational(position),
		value,
	});
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
