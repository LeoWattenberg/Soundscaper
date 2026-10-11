/* SPDX-License-Identifier: AGPL-3.0-only */

export const MOTION_EXPRESSION_INTRINSICS = {
	sin: [1, 1], cos: [1, 1], tan: [1, 1], asin: [1, 1], acos: [1, 1], atan: [1, 1], atan2: [2, 2], abs: [1, 1],
	min: [2, 4], max: [2, 4], floor: [1, 1], ceil: [1, 1], round: [1, 1], sqrt: [1, 1], pow: [2, 2], exp: [1, 1], log: [1, 1],
	clamp: [3, 3], lerp: [3, 3], linear: [5, 5], ease: [5, 5], easeIn: [5, 5], easeOut: [5, 5], length: [1, 1], normalize: [1, 1], dot: [2, 2], cross: [2, 2],
	reference: [1, 1], valueAtTime: [1, 2], loopIn: [0, 2], loopOut: [0, 2], random: [1, 3], noise: [1, 2], wiggle: [2, 5], audioAmplitude: [1, 3], framesToTime: [1, 1], timeToFrames: [1, 1],
} as const;
export type MotionExpressionIntrinsic = keyof typeof MOTION_EXPRESSION_INTRINSICS;
export type MotionExpressionVariable = 'time' | 'localTime' | 'frame' | 'frameRate' | 'value' | 'index' | 'pi' | 'e';
export type MotionExpressionBinaryOperator = '+' | '-' | '*' | '/' | '%' | '**' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '===' | '!==' | '&&' | '||';
export interface MotionExpressionSpan { readonly start: number; readonly end: number }
export type MotionExpressionNode = MotionExpressionSpan & (
	| { readonly kind: 'literal'; readonly value: number | string | boolean }
	| { readonly kind: 'variable'; readonly name: MotionExpressionVariable }
	| { readonly kind: 'vector'; readonly elements: readonly MotionExpressionNode[] }
	| { readonly kind: 'index'; readonly target: MotionExpressionNode; readonly index: MotionExpressionNode }
	| { readonly kind: 'unary'; readonly operator: '+' | '-' | '!'; readonly operand: MotionExpressionNode }
	| { readonly kind: 'binary'; readonly operator: MotionExpressionBinaryOperator; readonly left: MotionExpressionNode; readonly right: MotionExpressionNode }
	| { readonly kind: 'conditional'; readonly condition: MotionExpressionNode; readonly consequent: MotionExpressionNode; readonly alternate: MotionExpressionNode }
	| { readonly kind: 'call'; readonly name: MotionExpressionIntrinsic; readonly arguments: readonly MotionExpressionNode[] }
);
export interface MotionExpressionProgram {
	readonly source: string; readonly ast: MotionExpressionNode; readonly nodeCount: number;
	readonly referenceIds: readonly string[]; readonly audioAssetIds: readonly string[];
}
export type MotionExpressionDiagnosticCode = 'syntax' | 'name' | 'type' | 'reference' | 'budget' | 'cancelled' | 'non-finite' | 'unavailable';
export interface MotionExpressionDiagnostic extends MotionExpressionSpan { readonly code: MotionExpressionDiagnosticCode; readonly message: string }
export class MotionExpressionError extends Error {
	readonly diagnostic: MotionExpressionDiagnostic;
	constructor(code: MotionExpressionDiagnosticCode, message: string, span: MotionExpressionSpan) {
		super(message); this.name = 'MotionExpressionError'; this.diagnostic = Object.freeze({ code, message, start: span.start, end: span.end });
	}
}
export function motionExpressionChildren(node: MotionExpressionNode): readonly MotionExpressionNode[] {
	switch (node.kind) {
		case 'literal': case 'variable': return [];
		case 'vector': return node.elements;
		case 'call': return node.arguments;
		case 'index': return [node.target, node.index];
		case 'unary': return [node.operand];
		case 'binary': return [node.left, node.right];
		case 'conditional': return [node.condition, node.consequent, node.alternate];
	}
}
