/* SPDX-License-Identifier: AGPL-3.0-only */

import { MotionExpressionError, type MotionExpressionIntrinsic, type MotionExpressionSpan } from './motion-expression-ast.ts';
import type { MotionExpressionBudget, MotionExpressionContext } from './motion-expression-context.ts';
import { evaluateMotionProcedural } from './motion-expression-procedural.ts';
import { expressionNumber as number, expressionVector as vector, mapExpressionNumbers as map, zipExpressionNumbers as zip, type MotionExpressionValue } from './motion-expression-values.ts';

const UNARY: Readonly<Partial<Record<MotionExpressionIntrinsic, (value: number) => number>>> = {
	sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, exp: Math.exp, log: Math.log,
};
export function evaluateMotionIntrinsic(name: MotionExpressionIntrinsic, args: readonly MotionExpressionValue[], context: MotionExpressionContext, budget: MotionExpressionBudget, span: MotionExpressionSpan): MotionExpressionValue {
	budget.consume(args.length, span); const unary = UNARY[name]; if (unary) return map(args[0]!, unary, span);
	if (name === 'random' || name === 'noise' || name === 'wiggle') return evaluateMotionProcedural(name, args, context, budget, span);
	if (name === 'reference' || name === 'valueAtTime' || name === 'loopIn' || name === 'loopOut' || name === 'audioAmplitude') return capability(name, args, context, span);
	if (name === 'framesToTime') return number(args[0], span) / context.frameRate;
	if (name === 'timeToFrames') return number(args[0], span) * context.frameRate;
	if (name === 'pow' || name === 'atan2') return zip(args[0]!, args[1]!, name === 'pow' ? Math.pow : Math.atan2, span);
	if (name === 'min' || name === 'max') return args.slice(1).reduce((value, next) => zip(value, next, name === 'min' ? Math.min : Math.max, span), args[0]!);
	if (name === 'length' || name === 'normalize') { const channels = typeof args[0] === 'number' ? [args[0]] : vector(args[0], span); const length = number(Math.hypot(...channels), span); return name === 'length' ? length : map(args[0]!, (value) => length === 0 ? 0 : value / length, span); }
	if (name === 'dot' || name === 'cross') {
		const a = vector(args[0], span), b = vector(args[1], span); if (a.length !== b.length) throw new MotionExpressionError('type', 'Motion vector dimensions must match.', span);
		if (name === 'dot') return a.reduce((sum, value, index) => sum + value * b[index]!, 0);
		if (a.length !== 3) throw new MotionExpressionError('type', 'Cross product requires three-dimensional vectors.', span);
		return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
	}
	if (name === 'clamp') { const minimum = number(args[1], span), maximum = number(args[2], span); if (minimum > maximum) throw new MotionExpressionError('type', 'Clamp limits must be increasing.', span); return map(args[0]!, (value) => Math.max(minimum, Math.min(maximum, value)), span); }
	if (name === 'lerp') return zip(args[0]!, args[1]!, (a, b) => a + (b - a) * number(args[2], span), span);
	const at = number(args[0], span), from = number(args[1], span), to = number(args[2], span);
	if (from === to) throw new MotionExpressionError('type', 'Expression interpolation requires different time endpoints.', span);
	let t = Math.min(1, Math.max(0, (at - from) / (to - from)));
	if (name === 'ease') t = t * t * (3 - 2 * t); else if (name === 'easeIn') t *= t; else if (name === 'easeOut') t = 1 - (1 - t) ** 2;
	return zip(args[3]!, args[4]!, (a, b) => a + (b - a) * t, span);
}
function capability(name: 'reference' | 'valueAtTime' | 'loopIn' | 'loopOut' | 'audioAmplitude', args: readonly MotionExpressionValue[], context: MotionExpressionContext, span: MotionExpressionSpan): MotionExpressionValue {
	const unavailable = (): never => { throw new MotionExpressionError('unavailable', `${name} has no prepared motion evaluation capability.`, span); };
	if (name === 'reference') return context.reference ? context.reference(args[0] as string) : unavailable();
	if (name === 'valueAtTime') return args.length === 1 ? context.valueAtTime ? context.valueAtTime(number(args[0], span)) : unavailable() : context.reference ? context.reference(args[0] as string, number(args[1], span)) : unavailable();
	if (name === 'audioAmplitude') {
		const windowSeconds = number(args[2] ?? 0.02, span); if (windowSeconds <= 0 || windowSeconds > 10) throw new MotionExpressionError('budget', 'Audio amplitude windows must be positive and at most ten seconds.', span);
		return context.audioAmplitude ? context.audioAmplitude({ assetId: args[0] as string, time: number(args[1] ?? context.time, span), windowSeconds }) : unavailable();
	}
	const mode = args[0] ?? 'cycle', count = number(args[1] ?? 0, span);
	if (!['cycle', 'pingpong', 'offset', 'continue'].includes(String(mode)) || !Number.isInteger(count) || count < 0 || count > 4096) throw new MotionExpressionError('type', 'Loop mode or key count is invalid.', span);
	return context.loop ? context.loop(name === 'loopIn' ? 'in' : 'out', mode as 'cycle' | 'pingpong' | 'offset' | 'continue', count) : unavailable();
}
