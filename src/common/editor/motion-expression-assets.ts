/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionExpressionChildren, type MotionExpressionNode } from './motion-expression-ast.ts';
import { parseMotionExpression } from './motion-expression-parser.ts';
import type { MotionExpression } from './motion-property.ts';
import { motionId } from './motion-values.ts';

/** Invalid source remains editable; dependency transfer must refuse an unparseable possible asset link. */
export function motionExpressionAssetIds(expression: MotionExpression | null): readonly string[] {
	return expression?.source.includes('audioAmplitude') ? parseMotionExpression(expression.source).audioAssetIds : [];
}
/** Rewrite only actual audioAmplitude literal arguments, preserving other source bytes and authored enablement. */
export function remapMotionExpressionAssets(expression: MotionExpression | null, assets: ReadonlyMap<string, string>): MotionExpression | null {
	if (!expression?.source.includes('audioAmplitude')) return expression;
	const program = parseMotionExpression(expression.source); const pending: MotionExpressionNode[] = [program.ast];
	const replacements: { start: number; end: number; text: string }[] = [];
	while (pending.length) {
		const node = pending.pop()!;
		if (node.kind === 'call' && node.name === 'audioAmplitude') {
			const literal = node.arguments[0]!;
			if (literal.kind !== 'literal' || typeof literal.value !== 'string') throw new TypeError('Audio expression asset link is not a literal.');
			const replacement = assets.get(literal.value); if (!replacement) throw new ReferenceError(`Expression audio asset ${literal.value} is missing from the clipboard closure.`);
			if (replacement !== literal.value) replacements.push({ start: literal.start, end: literal.end, text: JSON.stringify(motionId(replacement)) });
		}
		pending.push(...motionExpressionChildren(node));
	}
	let source = expression.source;
	for (const replacement of replacements.sort((left, right) => right.start - left.start)) source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
	return source === expression.source ? expression : { ...expression, source };
}
