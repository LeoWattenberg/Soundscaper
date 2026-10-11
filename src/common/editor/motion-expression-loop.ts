/* SPDX-License-Identifier: AGPL-3.0-only */
import { compileMotionCurveMetrics } from './motion-curve-metrics.ts';
import type { MotionProperty } from './motion-property.ts';
import type { MotionPropertyValue } from './motion-property-evaluation.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { MotionExpressionError, type MotionExpressionSpan } from './motion-expression-ast.ts';
import type { MotionExpressionBudget } from './motion-expression-context.ts';
import { zipExpressionNumbers } from './motion-expression-values.ts';

/** Loop the pre-expression keys using exact frame coordinates; no playback history is consulted. */
export function evaluateMotionExpressionLoop(property: MotionProperty, base: (position: Rational) => MotionPropertyValue, position: Rational,
	direction: 'in' | 'out', mode: 'cycle' | 'pingpong' | 'offset' | 'continue', keyCount: number, budget: MotionExpressionBudget, span: MotionExpressionSpan): MotionPropertyValue {
	const curves = property.kind === 'scalar' ? [property.curve] : property.kind === 'path' ? [] : property.curves;
	const positions = property.kind === 'path' ? property.keyframes.map((key) => key.position) : curves.flatMap((curve) => curve?.anchors.map((key) => key.position) ?? []);
	budget.consume(positions.length, span);
	const sorted = [...new Map(positions.map((key) => [`${key.num}/${key.den}`, key])).values()].sort(compareRationals);
	if (sorted.length < 2) return base(position);
	const count = keyCount === 0 ? sorted.length - 1 : keyCount;
	if (count >= sorted.length) throw new MotionExpressionError('type', 'Expression loop key count exceeds its authored key intervals.', span);
	const first = sorted[direction === 'in' ? 0 : sorted.length - 1 - count]!, last = sorted[direction === 'in' ? count : sorted.length - 1]!;
	if (direction === 'in' ? compareRationals(position, first) >= 0 : compareRationals(position, last) <= 0) return base(position);
	if (mode === 'continue') {
		if (property.kind === 'path') throw new MotionExpressionError('type', 'Path expressions support cycle and pingpong loops; a numeric curve is required for continuation.', span);
		const boundary = direction === 'in' ? first : last; const distance = subtractRationals(position, boundary);
		const slopes = curves.map((curve, index) => compileMotionCurveMetrics(curve, typeof property.value === 'number' ? property.value : property.value[index]!).slopeAt(boundary));
		if (slopes.some((slope) => slope === null)) throw new MotionExpressionError('type', 'Expression loop continuation has a discontinuous or vertical tangent.', span);
		return zipExpressionNumbers(base(boundary), property.kind === 'scalar' ? slopes[0]! : slopes as readonly number[], (value, slope) => value + slope * distance.num / distance.den, span) as MotionPropertyValue;
	}
	const length = subtractRationals(last, first), ratio = divideRationals(subtractRationals(position, first), length);
	const numerator = BigInt(ratio.num), denominator = BigInt(ratio.den);
	const quotient = numerator / denominator - (numerator < 0n && numerator % denominator !== 0n ? 1n : 0n);
	const cycles = Number(quotient); if (!Number.isSafeInteger(cycles)) throw new MotionExpressionError('budget', 'Expression loop exceeds its exact cycle domain.', span);
	const offset = subtractRationals(subtractRationals(position, first), multiplyRationals(length, cycles));
	const samplePosition = mode === 'pingpong' && quotient % 2n !== 0n ? subtractRationals(last, offset) : addRationals(first, offset);
	const value = base(samplePosition);
	if (mode !== 'offset') return value;
	if (property.kind === 'path') throw new MotionExpressionError('type', 'Path expression offset loops require numeric channels.', span);
	const delta = zipExpressionNumbers(base(last), base(first), (end, start) => end - start, span);
	return zipExpressionNumbers(value, delta, (channel, difference) => channel + difference * cycles, span) as MotionPropertyValue;
}
