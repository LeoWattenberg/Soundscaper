/* SPDX-License-Identifier: AGPL-3.0-only */

import { MOTION_EXPRESSION_INTRINSICS, MotionExpressionError, motionExpressionChildren, type MotionExpressionBinaryOperator, type MotionExpressionDiagnostic, type MotionExpressionIntrinsic, type MotionExpressionNode, type MotionExpressionProgram, type MotionExpressionVariable } from './motion-expression-ast.ts';
import { tokenizeMotionExpression, type MotionExpressionToken } from './motion-expression-lexer.ts';
import { freezeMotionValue, motionInteger } from './motion-values.ts';

const PROGRAMS = new WeakSet<object>();
const PRECEDENCE: Readonly<Record<MotionExpressionBinaryOperator, number>> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 7 };
const VARIABLES: readonly string[] = ['time', 'localTime', 'frame', 'frameRate', 'value', 'index', 'pi', 'e'];
const MATH_NAMES = new Set<string>(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs', 'min', 'max', 'floor', 'ceil', 'round', 'sqrt', 'pow', 'exp', 'log']);
export interface MotionExpressionParseOptions { readonly maximumNodes?: number; readonly maximumDepth?: number }

/** Parse only closed expressions. No declaration, assignment, arbitrary member/call or executable host object enters this AST. */
export function parseMotionExpression(source: string, options: MotionExpressionParseOptions = {}): MotionExpressionProgram {
	if (typeof source !== 'string' || source.length > 16_384) throw new MotionExpressionError('budget', 'Expression source exceeds its bounded length.', { start: 0, end: 0 });
	const maximumNodes = motionInteger(options.maximumNodes ?? 2048, 'expression node budget', 1, 4096);
	const maximumDepth = motionInteger(options.maximumDepth ?? 64, 'expression depth budget', 1, 128);
	const tokens = tokenizeMotionExpression(source); let index = 0; let nodeCount = 0; let depth = 0;
	const references = new Set<string>(); const audioAssets = new Set<string>();
	const peek = () => tokens[index]!; const take = () => tokens[index++]!;
	const fail = (message: string, token = peek(), code: 'syntax' | 'name' | 'budget' = 'syntax'): never => { throw new MotionExpressionError(code, message, token); };
	const expect = (text: string) => { const token = peek(); if (token.text !== text) fail(`Expected ${text} in motion expression.`, token); return take(); };
	const node = (value: MotionExpressionNode): MotionExpressionNode => { if (++nodeCount > maximumNodes) fail('Expression node budget exceeded.', peek(), 'budget'); return value; };
	const expression = (minimum = 0): MotionExpressionNode => {
		if (++depth > maximumDepth) fail('Expression nesting depth budget exceeded.', peek(), 'budget');
		let left = primary();
		while (Object.hasOwn(PRECEDENCE, peek().text)) {
			const operator = peek().text as MotionExpressionBinaryOperator; const precedence = PRECEDENCE[operator]; if (precedence < minimum) break;
			take(); const right = expression(operator === '**' ? precedence : precedence + 1); left = node({ kind: 'binary', operator, left, right, start: left.start, end: right.end });
		}
		if (minimum === 0 && peek().text === '?') { take(); const consequent = expression(); expect(':'); const alternate = expression(); left = node({ kind: 'conditional', condition: left, consequent, alternate, start: left.start, end: alternate.end }); }
		depth--; return left;
	};
	const primary = (): MotionExpressionNode => {
		const token = take(); let result: MotionExpressionNode;
		if (token.text === '+' || token.text === '-' || token.text === '!') { const operand = expression(7); result = node({ kind: 'unary', operator: token.text, operand, start: token.start, end: operand.end }); }
		else if (token.kind === 'number' || token.kind === 'string') result = node({ kind: 'literal', value: token.value!, start: token.start, end: token.end });
		else if (token.text === 'true' || token.text === 'false') result = node({ kind: 'literal', value: token.text === 'true', start: token.start, end: token.end });
		else if (token.text === '(') { result = expression(); expect(')'); }
		else if (token.text === '[') {
			const elements: MotionExpressionNode[] = []; if (peek().text !== ']') do { elements.push(expression()); if (peek().text !== ',') break; take(); } while (peek().text !== ']');
			const end = expect(']'); if (elements.length < 2 || elements.length > 4) fail('Expression vectors require two through four components.', token);
			result = node({ kind: 'vector', elements, start: token.start, end: end.end });
		} else if (token.kind === 'identifier') result = identifier(token);
		else return fail('Expected a value in motion expression.', token);
		while (peek().text === '[') {
			take(); const offset = expression(); const end = expect(']');
			if (offset.kind === 'literal' && typeof offset.value !== 'number') fail('Expression indexing requires a numeric vector channel.', token);
			result = node({ kind: 'index', target: result, index: offset, start: result.start, end: end.end });
		}
		return result;
	};
	const identifier = (token: MotionExpressionToken): MotionExpressionNode => {
		let name = token.text;
		if (name === 'Math') { expect('.'); const member = take(); if (member.kind !== 'identifier') fail('Expected a closed Math intrinsic.', member, 'name');
			if (member.text === 'PI' || member.text === 'E') return node({ kind: 'variable', name: member.text === 'PI' ? 'pi' : 'e', start: token.start, end: member.end });
			if (!MATH_NAMES.has(member.text)) fail(`Math.${member.text} is not a permitted expression intrinsic.`, member, 'name'); name = member.text;
		}
		if (peek().text !== '(') { if (!VARIABLES.includes(name)) fail(`Unknown motion expression name ${name}.`, token, 'name'); return node({ kind: 'variable', name: name as MotionExpressionVariable, start: token.start, end: token.end }); }
		if (!Object.hasOwn(MOTION_EXPRESSION_INTRINSICS, name)) fail(`Unknown motion expression function ${name}.`, token, 'name');
		take(); const args: MotionExpressionNode[] = []; if (peek().text !== ')') do { args.push(expression()); if (peek().text !== ',') break; take(); } while (peek().text !== ')');
		const end = expect(')'); const intrinsic = name as MotionExpressionIntrinsic; const [minimum, maximum] = MOTION_EXPRESSION_INTRINSICS[intrinsic];
		if (args.length < minimum || args.length > maximum) fail(`${name} requires ${minimum === maximum ? String(minimum) : `${minimum} through ${maximum}`} arguments.`, token);
		if (name === 'reference' || name === 'audioAmplitude' || (name === 'valueAtTime' && args.length === 2)) {
			const first = args[0]!; if (first.kind !== 'literal' || typeof first.value !== 'string' || first.value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(first.value)) return fail(`${name} requires a literal stable identity as its first argument.`, token, 'name');
			(name === 'audioAmplitude' ? audioAssets : references).add(first.value as string);
		}
		return node({ kind: 'call', name: intrinsic, arguments: args, start: token.start, end: end.end });
	};
	const ast = expression(); if (peek().kind !== 'end') fail(`Unexpected expression token ${peek().text}.`);
	const pending = [{ node: ast, depth: 1 }]; while (pending.length) { const next = pending.pop()!; if (next.depth > maximumDepth) throw new MotionExpressionError('budget', 'Expression AST depth budget exceeded.', next.node); for (const child of motionExpressionChildren(next.node)) pending.push({ node: child, depth: next.depth + 1 }); }
	const program = freezeMotionValue({ source, ast, nodeCount, referenceIds: [...references].sort(), audioAssetIds: [...audioAssets].sort() }); PROGRAMS.add(program); return program;
}
export function assertParsedMotionExpression(value: unknown): asserts value is MotionExpressionProgram {
	if (!value || typeof value !== 'object' || !PROGRAMS.has(value)) throw new TypeError('A parsed motion expression program is required.');
}
export function diagnoseMotionExpression(source: string, options?: MotionExpressionParseOptions): Readonly<{ program: MotionExpressionProgram | null; diagnostic: MotionExpressionDiagnostic | null }> {
	try { return { program: parseMotionExpression(source, options), diagnostic: null }; } catch (error) { if (error instanceof MotionExpressionError) return { program: null, diagnostic: error.diagnostic }; throw error; }
}
