/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CompiledInterpolationCurve, InterpolationShape } from './interpolation-curve.ts';
import { stableCubic } from './interpolation-curve-math.ts';
import { motionPropertyOfKind } from './motion-property.ts';
import { compileMotionProperty } from './motion-property-evaluation.ts';
import { compareRationals, divideRationals, normalizeRational, subtractRationals, type Rational } from './timeline-time.ts';

export interface MotionCurveMetrics {
	valueAt(position: Rational): number;
	/** Value per local frame. Interior keys use the outgoing tangent; the final key uses its incoming tangent. */
	slopeAt(position: Rational): number | null;
}

/** Compile once for graph sampling. Discontinuous or vertical speeds remain explicit gaps, never finite guesses. */
export function compileMotionCurveMetrics(curveValue: CompiledInterpolationCurve | null, baseValue = 0): MotionCurveMetrics {
	const property = motionPropertyOfKind({ kind: 'scalar', value: baseValue, curve: curveValue, expression: null }, 'scalar');
	const curve = property.curve; const valueAt = compileMotionProperty(property);
	return Object.freeze({ valueAt: (position: Rational) => valueAt(position) as number, slopeAt(positionValue: Rational): number | null {
		const position = normalizeRational(positionValue, { maximumDenominator: Number.MAX_SAFE_INTEGER });
		if (!curve || curve.anchors.length === 1 || compareRationals(position, curve.anchors[0]!.position) < 0 || compareRationals(position, curve.anchors.at(-1)!.position) > 0) return 0;
		let end = curve.anchors.findIndex((anchor) => compareRationals(anchor.position, position) > 0); if (end < 0) end = curve.anchors.length - 1;
		const start = end - 1; const a = curve.anchors[start]!, b = curve.anchors[end]!;
		const exactKey = compareRationals(position, b.position) === 0 ? end : compareRationals(position, a.position) === 0 ? start : -1;
		if (exactKey > 0 && curve.segments[exactKey - 1]!.kind === 'hold' && curve.anchors[exactKey - 1]!.value !== curve.anchors[exactKey]!.value) return null;
		const shape = curve.segments[start]!; if (shape.kind === 'hold') return 0;
		const span = subtractRationals(b.position, a.position); const length = span.num / span.den;
		const fraction = divideRationals(subtractRationals(position, a.position), span); const amount = fraction.num / fraction.den;
		const linear = (b.value - a.value) / length;
		const value = shape.kind === 'linear' ? linear : shape.kind === 'eased' ? linear * 6 * amount * (1 - amount) : shape.kind === 'bezier' ? bezierSlope(shape, a.position, span, a.value, b.value, amount) : null;
		return value !== null && Number.isFinite(value) ? value : null;
	} });
}

/** Convenience for a single query; graph widgets should retain compileMotionCurveMetrics instead. */
export function evaluateMotionCurveSlope(curve: CompiledInterpolationCurve | null, position: Rational): number | null { return compileMotionCurveMetrics(curve).slopeAt(position); }

function bezierSlope(shape: Extract<InterpolationShape, { kind: 'bezier' }>, start: Rational, span: Rational, from: number, to: number, amount: number): number | null {
	const normalized = (position: Rational) => { const value = divideRationals(subtractRationals(position, start), span); return value.num / value.den; };
	const first = normalized(shape.control1.position), second = normalized(shape.control2.position);
	let low = 0; let high = 1;
	for (let iteration = 0; iteration < 64; iteration += 1) { const middle = low + (high - low) / 2; if (stableCubic(0, first, second, 1, middle) < amount) low = middle; else high = middle; }
	const parameter = amount <= 0 ? 0 : amount >= 1 ? 1 : high;
	const x = derivatives(0, first, second, 1, parameter), y = derivatives(from, shape.control1.value, shape.control2.value, to, parameter);
	for (let index = 0; index < x.length; index += 1) {
		if (x[index] !== 0) return y[index]! / x[index]! / (span.num / span.den);
		if (y[index] !== 0) return null;
	}
	return 0;
}
function derivatives(a: number, b: number, c: number, d: number, t: number): readonly number[] {
	const one = 1 - t;
	return [3 * (one * one * (b - a) + 2 * one * t * (c - b) + t * t * (d - c)),
		6 * (one * (c - 2 * b + a) + t * (d - 2 * c + b)), 6 * (d - 3 * c + 3 * b - a)];
}
