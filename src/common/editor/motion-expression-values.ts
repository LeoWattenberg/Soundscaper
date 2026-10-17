/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionPath } from './motion-property.ts';
import { MotionExpressionError, type MotionExpressionSpan } from './motion-expression-ast.ts';
export type MotionExpressionValue = number | boolean | string | readonly number[] | MotionPath;
export function expressionNumber(value: MotionExpressionValue | undefined, span: MotionExpressionSpan): number {
	if (typeof value !== 'number') throw new MotionExpressionError('type', 'Motion expression requires a numeric value.', span);
	if (!Number.isFinite(value)) throw new MotionExpressionError('non-finite', 'Motion expression produced a non-finite number.', span); return value;
}
export function expressionVector(value: MotionExpressionValue | undefined, span: MotionExpressionSpan): readonly number[] {
	if (!Array.isArray(value) || value.length < 2 || value.length > 4) throw new MotionExpressionError('type', 'Motion expression requires a vector of two through four numbers.', span);
	return value.map((channel: number) => expressionNumber(channel, span));
}
export function expressionTruth(value: MotionExpressionValue, span: MotionExpressionSpan): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return expressionNumber(value, span) !== 0;
	throw new MotionExpressionError('type', 'Motion expression conditions require a boolean or number.', span);
}
export function mapExpressionNumbers(value: MotionExpressionValue, map: (channel: number, index: number) => number, span: MotionExpressionSpan): number | readonly number[] {
	if (typeof value === 'number') return expressionNumber(map(expressionNumber(value, span), 0), span);
	return Object.freeze(expressionVector(value, span).map((channel, index) => expressionNumber(map(channel, index), span)));
}
export function zipExpressionNumbers(left: MotionExpressionValue, right: MotionExpressionValue, map: (a: number, b: number) => number, span: MotionExpressionSpan): number | readonly number[] {
	if (typeof left === 'number' && typeof right === 'number') return expressionNumber(map(expressionNumber(left, span), expressionNumber(right, span)), span);
	const a = typeof left === 'number' ? left : expressionVector(left, span); const b = typeof right === 'number' ? right : expressionVector(right, span);
	if (typeof a !== 'number' && typeof b !== 'number' && a.length !== b.length) throw new MotionExpressionError('type', 'Motion vector dimensions must match.', span);
	const count = typeof a === 'number' ? (b as readonly number[]).length : a.length;
	return Object.freeze(Array.from({ length: count }, (_, index) => expressionNumber(map(typeof a === 'number' ? a : a[index]!, typeof b === 'number' ? b : b[index]!), span)));
}
