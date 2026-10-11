/* SPDX-License-Identifier: AGPL-3.0-only */

import { MotionExpressionError, type MotionExpressionSpan } from './motion-expression-ast.ts';
export interface MotionExpressionToken extends MotionExpressionSpan { readonly kind: 'number' | 'string' | 'identifier' | 'symbol' | 'end'; readonly text: string; readonly value?: string | number }

export function tokenizeMotionExpression(source: string): readonly MotionExpressionToken[] {
	const tokens: MotionExpressionToken[] = []; let position = 0;
	const fail = (message: string, start = position): never => { throw new MotionExpressionError('syntax', message, { start, end: Math.min(source.length, position + 1) }); };
	while (position < source.length) {
		if (tokens.length >= 8192) throw new MotionExpressionError('budget', 'Expression token budget exceeded.', { start: position, end: position + 1 });
		const start = position; const character = source[position]!;
		if (/\s/u.test(character)) { position++; continue; }
		if (source.startsWith('//', position)) { const end = source.indexOf('\n', position + 2); position = end < 0 ? source.length : end; continue; }
		if (source.startsWith('/*', position)) { const end = source.indexOf('*/', position + 2); if (end < 0) fail('Unclosed expression comment.'); position = end + 2; continue; }
		if (character === '"' || character === "'") {
			position++; let value = ''; let closed = false;
			while (position < source.length) {
				const next = source[position++]!; if (next === character) { closed = true; break; }
				if (next === '\n' || next === '\r') fail('Expression strings cannot contain a raw newline.', start);
				if (next !== '\\') { value += next; continue; }
				const escape = source[position++];
				if (escape === 'u') { const digits = source.slice(position, position + 4); if (!/^[0-9a-fA-F]{4}$/u.test(digits)) fail('Invalid Unicode expression escape.', start); value += String.fromCharCode(Number.parseInt(digits, 16)); position += 4; }
				else { const values: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', '"': '"', "'": "'" }; if (escape === undefined || !Object.hasOwn(values, escape)) fail('Unsupported expression string escape.', start); value += values[escape]!; }
			}
			if (!closed) fail('Unclosed expression string.', start); tokens.push({ kind: 'string', text: source.slice(start, position), value, start, end: position }); continue;
		}
		const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(source.slice(position))?.[0];
		if (number) { position += number.length; const value = Number(number); if (!Number.isFinite(value)) fail('Expression number must be finite.', start); tokens.push({ kind: 'number', text: number, value, start, end: position }); continue; }
		const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(source.slice(position))?.[0];
		if (identifier) { position += identifier.length; tokens.push({ kind: 'identifier', text: identifier, start, end: position }); continue; }
		const symbol = ['===', '!==', '**', '<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', '[', ']', ',', '.'].find((item) => source.startsWith(item, position));
		if (!symbol) return fail(`Unsupported expression token ${character}.`);
		position += symbol.length; tokens.push({ kind: 'symbol', text: symbol, start, end: position });
	}
	tokens.push({ kind: 'end', text: '', start: source.length, end: source.length }); return tokens;
}
