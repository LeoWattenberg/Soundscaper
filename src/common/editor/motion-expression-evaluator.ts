/* SPDX-License-Identifier: AGPL-3.0-only */

import { MotionExpressionError, type MotionExpressionNode, type MotionExpressionProgram, type MotionExpressionSpan, type MotionExpressionBinaryOperator } from './motion-expression-ast.ts';
import { assertParsedMotionExpression } from './motion-expression-parser.ts';
import { evaluateMotionIntrinsic } from './motion-expression-intrinsics.ts';
import { expressionNumber as number, expressionVector as vector, expressionTruth as truth, mapExpressionNumbers as map, zipExpressionNumbers as zip, type MotionExpressionValue } from './motion-expression-values.ts';
import type { MotionExpressionBudget, MotionExpressionContext } from './motion-expression-context.ts';
import { motionInteger } from './motion-values.ts';
export type { MotionExpressionBudget, MotionExpressionContext } from './motion-expression-context.ts';
export type { MotionExpressionValue } from './motion-expression-values.ts';

export function createMotionExpressionBudget(options: Readonly<{ maximumOperations?: number; signal?: AbortSignal }> = {}): MotionExpressionBudget {
	let remaining = motionInteger(options.maximumOperations ?? 10_000, 'expression operation budget', 1, 1_000_000);
	return Object.freeze({ get remaining() { return remaining; }, consume(operations: number, span: MotionExpressionSpan) {
		if (options.signal?.aborted) throw new DOMException('Motion expression evaluation was cancelled.', 'AbortError');
		if (!Number.isSafeInteger(operations) || operations < 0 || operations > remaining) { remaining = 0; throw new MotionExpressionError('budget', 'Motion expression evaluation budget exceeded.', span); }
		remaining -= operations;
	} });
}

/** Pure per-query interpretation. The same shared budget follows nested property and time samples. */
export function evaluateMotionExpression(program: MotionExpressionProgram, context: MotionExpressionContext, budget = createMotionExpressionBudget()): MotionExpressionValue {
	assertParsedMotionExpression(program); for (const value of [context.time, context.localTime, context.frame, context.frameRate, context.index]) number(value, program.ast);
	if (context.frameRate <= 0) throw new MotionExpressionError('type', 'Expression frame rate must be positive.', program.ast);
	const evaluate = (node: MotionExpressionNode): MotionExpressionValue => {
		budget.consume(1, node); let result: MotionExpressionValue;
		switch (node.kind) {
			case 'literal': result = node.value; break;
			case 'variable': result = node.name === 'pi' ? Math.PI : node.name === 'e' ? Math.E : context[node.name]; break;
			case 'vector': result = node.elements.map((item) => number(evaluate(item), item)); break;
			case 'index': { const target = vector(evaluate(node.target), node); const index = number(evaluate(node.index), node); if (!Number.isInteger(index) || index < 0 || index >= target.length) throw new MotionExpressionError('type', 'Expression vector channel is outside its dimensions.', node); result = target[index]!; break; }
			case 'unary': { const value = evaluate(node.operand); result = node.operator === '!' ? !truth(value, node) : map(value, (channel) => node.operator === '-' ? -channel : channel, node); break; }
			case 'conditional': result = evaluate(truth(evaluate(node.condition), node.condition) ? node.consequent : node.alternate); break;
			case 'binary': { const left = evaluate(node.left); result = node.operator === '&&' ? truth(left, node.left) ? evaluate(node.right) : left : node.operator === '||' ? truth(left, node.left) ? left : evaluate(node.right) : binary(node.operator, left, evaluate(node.right), node); break; }
			case 'call': result = evaluateMotionIntrinsic(node.name, node.arguments.map(evaluate), context, budget, node); break;
		}
		if (typeof result === 'number') return number(result, node);
		if (Array.isArray(result)) return Object.freeze(vector(result, node));
		return result;
	};
	const result = evaluate(program.ast); budget.consume(0, program.ast); return result;
}
function binary(operator: MotionExpressionBinaryOperator, left: MotionExpressionValue, right: MotionExpressionValue, span: MotionExpressionSpan): MotionExpressionValue {
	if (operator === '==' || operator === '===' || operator === '!=' || operator === '!==') {
		const equal = Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((value: number, index) => value === right[index]) : left === right;
		return operator === '!=' || operator === '!==' ? !equal : equal;
	}
	if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') { const a = number(left, span), b = number(right, span); return operator === '<' ? a < b : operator === '<=' ? a <= b : operator === '>' ? a > b : a >= b; }
	return zip(left, right, (a, b) => {
		switch (operator) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b; case '**': return a ** b; default: throw new MotionExpressionError('type', 'Unsupported numeric expression operator.', span); }
	}, span);
}
