/* SPDX-License-Identifier: AGPL-3.0-only */
import { MotionExpressionError, type MotionExpressionNode } from './motion-expression-ast.ts';
import { parseMotionExpression } from './motion-expression-parser.ts';

export interface MotionAeScalarExpressionOptions {
	readonly direction: 'from-after-effects' | 'to-after-effects';
	/** Destination numeric units per source numeric unit, including percentage conversion. */
	readonly scale: number;
}
export interface MotionAeExpressionReview { readonly translateScalarExpressions?: boolean }
export interface MotionAeExpressionConversion {
	readonly status: 'translated' | 'unsupported'; readonly source: string | null; readonly message: string;
}
const MATH = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs', 'min', 'max', 'floor', 'ceil', 'round', 'sqrt', 'pow', 'exp', 'log']);
type ScalarType = 'number' | 'boolean';
interface Emission { readonly text: string; readonly type: ScalarType }
class UnsupportedExpression extends Error {}

/** Closed scalar syntax only. No host execution occurs here; original source remains in exchange custody.
 * AE composition seconds and pre-expression value: https://helpx.adobe.com/after-effects/desktop/work-with-expressions/expression-language-reference/expression-language-reference.html
 * Standard Math syntax is emitted for both AE engines; custom procedural and vector semantics require sampling.
 */
export function translateMotionAeScalarExpression(source: string, options: MotionAeScalarExpressionOptions): MotionAeExpressionConversion {
	if (!['from-after-effects', 'to-after-effects'].includes(options.direction) || !Number.isFinite(options.scale) || options.scale < 1e-6 || options.scale > 1e6) throw new TypeError('Invalid scalar expression unit mapping.');
	const importing = options.direction === 'from-after-effects', scale = String(options.scale);
	const refuse = (message: string): never => { throw new UnsupportedExpression(message); };
	const requireNumber = (value: Emission): Emission => value.type === 'number' ? value : refuse('Boolean-to-number coercion has no portable scalar mapping.');
	try {
		if (typeof source !== 'string' || source.length > 16_384) refuse('Expression source exceeds its bounded length.');
		const captured = importing ? source.trim().replace(/;\s*$/u, '') : source;
		const program = parseMotionExpression(captured);
		function emit(node: MotionExpressionNode): Emission {
			switch (node.kind) {
				case 'literal':
					if (typeof node.value === 'string') return refuse('Strings have no portable scalar expression mapping.');
					return { text: String(node.value), type: typeof node.value === 'number' ? 'number' : 'boolean' };
				case 'variable': {
					if (node.name === 'time') return { text: 'time', type: 'number' };
					if (node.name === 'value') return { text: options.scale === 1 ? 'value' : `(value/${scale})`, type: 'number' };
					if (node.name !== 'pi' && node.name !== 'e') return refuse('Layer-local clocks, indexes and frame metadata require explicit sampling.');
					if (importing && !/^Math\s*\.\s*(?:PI|E)$/u.test(captured.slice(node.start, node.end))) return refuse('AE constants must use explicit standard Math syntax.');
					return { text: node.name === 'pi' ? 'Math.PI' : 'Math.E', type: 'number' };
				}
				case 'vector': case 'index': return refuse('Vector results and channel access require a separate dimensional mapping.');
				case 'unary': {
					const value = emit(node.operand);
					if (node.operator !== '!') requireNumber(value);
					return { text: `(${node.operator}${value.text})`, type: node.operator === '!' ? 'boolean' : 'number' };
				}
				case 'binary': {
					const left = emit(node.left), right = emit(node.right), operator = node.operator;
					if (operator === '&&' || operator === '||') {
						if (left.type !== right.type) return refuse('Mixed logical result types require explicit sampling.');
						return { text: `(${left.text}${operator}${right.text})`, type: left.type };
					}
					if (['==', '!=', '===', '!=='].includes(operator)) {
						if (left.type !== right.type) return refuse('Cross-type equality has incompatible expression coercion.');
						return { text: `(${left.text}${operator === '==' ? '===' : operator === '!=' ? '!==' : operator}${right.text})`, type: 'boolean' };
					}
					requireNumber(left); requireNumber(right);
					if (operator === '**') {
						if (importing) return refuse('AE power syntax requires explicit Math.pow for the reviewed engine-independent subset.');
						return { text: `Math.pow(${left.text},${right.text})`, type: 'number' };
					}
					return { text: `(${left.text}${operator}${right.text})`, type: ['<', '<=', '>', '>='].includes(operator) ? 'boolean' : 'number' };
				}
				case 'conditional': {
					const condition = emit(node.condition), consequent = emit(node.consequent), alternate = emit(node.alternate);
					if (consequent.type !== alternate.type) return refuse('Conditional branches require the same portable scalar type.');
					return { text: `(${condition.text}?${consequent.text}:${alternate.text})`, type: consequent.type };
				}
				case 'call': {
					if (!MATH.has(node.name)) return refuse('Property links, procedural functions and AE-specific intrinsics require sampling or complete rendering.');
					if (importing && !new RegExp(`^Math\\s*\\.\\s*${node.name}\\s*\\(`, 'u').test(captured.slice(node.start))) return refuse('AE Math calls must use explicit standard Math syntax.');
					return { text: `Math.${node.name}(${node.arguments.map(argument => requireNumber(emit(argument)).text).join(',')})`, type: 'number' };
				}
			}
		}
		const result = requireNumber(emit(program.ast));
		const translated = options.scale === 1 ? result.text : `(${result.text}*${scale})`;
		// Reparse emitted syntax so extra unit wrappers cannot evade source/node/depth budgets.
		parseMotionExpression(translated);
		return Object.freeze({ status: 'translated', source: translated, message: 'Closed scalar arithmetic, composition time and standard Math remain editable with explicit numeric unit conversion. Installed AE reference qualification remains pending.' });
	} catch (error) {
		if (!(error instanceof UnsupportedExpression) && !(error instanceof MotionExpressionError)) throw error;
		return Object.freeze({ status: 'unsupported', source: null, message: `${error.message} Sample this property explicitly or render the complete composition; original expression source remains in custody.` });
	}
}
