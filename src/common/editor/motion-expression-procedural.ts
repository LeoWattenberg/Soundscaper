/* SPDX-License-Identifier: AGPL-3.0-only */

import { MotionExpressionError, type MotionExpressionSpan } from './motion-expression-ast.ts';
import type { MotionExpressionBudget, MotionExpressionContext } from './motion-expression-context.ts';
import { expressionNumber, mapExpressionNumbers, zipExpressionNumbers, type MotionExpressionValue } from './motion-expression-values.ts';

/** Stateless integer mixing: every sample depends only on the pinned property seed and its explicit coordinates. */
function hash(value: number): number { let bits = value | 0; bits = Math.imul(bits ^ (bits >>> 16), 0x7feb352d); bits = Math.imul(bits ^ (bits >>> 15), 0x846ca68b); return (bits ^ (bits >>> 16)) >>> 0; }
function seedValue(value: number, span: MotionExpressionSpan): number {
	if (!Number.isSafeInteger(value) || Math.abs(value) > 0x7fffffff) throw new MotionExpressionError('type', 'Expression seeds must be signed 32-bit integers.', span); return value | 0;
}
function contextSeed(context: MotionExpressionContext, budget: MotionExpressionBudget, span: MotionExpressionSpan): number {
	if (typeof context.seed === 'number') return seedValue(context.seed, span);
	if (context.seed.length > 2048) throw new MotionExpressionError('budget', 'Expression property seed exceeds its identity budget.', span);
	budget.consume(context.seed.length, span); let value = 0x811c9dc5; for (let index = 0; index < context.seed.length; index++) value = Math.imul(value ^ context.seed.charCodeAt(index), 0x01000193); return value;
}
function noise(coordinate: number, seed: number, span: MotionExpressionSpan): number {
	if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 2 ** 52) throw new MotionExpressionError('non-finite', 'Noise coordinates exceed the deterministic sample domain.', span);
	const floor = Math.floor(coordinate); const t = coordinate - floor; const eased = t * t * t * (t * (t * 6 - 15) + 10);
	const a = hash((floor | 0) ^ seed) / 0xffffffff * 2 - 1, b = hash(((floor + 1) | 0) ^ seed) / 0xffffffff * 2 - 1;
	return a + (b - a) * eased;
}
export function evaluateMotionProcedural(name: 'random' | 'noise' | 'wiggle', args: readonly MotionExpressionValue[], context: MotionExpressionContext, budget: MotionExpressionBudget, span: MotionExpressionSpan): MotionExpressionValue {
	const base = contextSeed(context, budget, span);
	if (name === 'random') {
		const seed = seedValue(expressionNumber(args[0], span), span); const minimum = args[1] ?? 0, maximum = args[2] ?? 1;
		let channel = 0; return zipExpressionNumbers(minimum, maximum, (a, b) => { if (b < a) throw new MotionExpressionError('type', 'Random maximum must not be below its minimum.', span); return a + (b - a) * (hash(base ^ seed ^ hash(channel++)) / 0x100000000); }, span);
	}
	if (name === 'noise') return noise(expressionNumber(args[0], span), base ^ seedValue(expressionNumber(args[1] ?? 0, span), span), span);
	const frequency = expressionNumber(args[0], span); const amplitude = args[1]!; const octaves = expressionNumber(args[2] ?? 1, span);
	const persistence = expressionNumber(args[3] ?? 0.5, span); const seed = base ^ seedValue(expressionNumber(args[4] ?? 0, span), span);
	if (frequency < 0 || frequency > 1_000_000 || !Number.isInteger(octaves) || octaves < 1 || octaves > 8 || persistence < 0 || persistence > 1) throw new MotionExpressionError('budget', 'Wiggle requires frequency 0..1000000, one through eight octaves and persistence 0..1.', span);
	const amplitudes = zipExpressionNumbers(context.value, amplitude, (_value, amount) => amount, span);
	const delta = mapExpressionNumbers(amplitudes, (amount, channel) => {
		let total = 0; for (let octave = 0; octave < octaves; octave++) { budget.consume(1, span); total += amount * persistence ** octave * noise(context.time * frequency * 2 ** octave, seed ^ hash(channel * 31 + octave), span); } return total;
	}, span);
	return zipExpressionNumbers(context.value, delta, (a, b) => a + b, span);
}
