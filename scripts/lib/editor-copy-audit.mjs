/* SPDX-License-Identifier: AGPL-3.0-only */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const HOST_ALIASES = new Set(['deleteClip', 'addLabelTrack']);
const TECHNICAL_TOKEN = /^(?:[A-Z]{1,3}|dB(?:FS|\/oct)?|Hz|kHz|BPM|LUFS|ms|s|ch|FFT|TP|k)$/u;
const AUTHORED_ATTRIBUTE = /^(?:aria-label|ariaLabel|title|placeholder|label)$/u;

function technicalText(text) {
	const tokens = text.match(/[A-Za-z]+(?:\/[A-Za-z]+)?/gu);
	return tokens !== null && tokens.every(token => TECHNICAL_TOKEN.test(token));
}

/** Audit static presentation references; projected domain copy is checked at its UI caller. */
export function auditEditorCopySource(path, content, inventory) {
	const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
	const canonical = new Set(Object.keys(inventory));
	const scoped = new Set([...canonical].filter(key => key.startsWith('ui.')).map(key => key.split('.').at(-1)));
	const issues = [];
	const registered = key => canonical.has(key) || scoped.has(key) || HOST_ALIASES.has(key);
	const issue = (node, kind, key) => issues.push({ path,
		line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, key });
	const fullUiCopy = /\.[jt]sx$/u.test(path);
	function visit(node) {
		if (fullUiCopy && ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'copy'
			&& !registered(node.name.text)) issue(node, 'key', node.name.text);
		if (ts.isElementAccessExpression(node) && node.expression.getText(source) === 'copy'
			&& node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
			&& !registered(node.argumentExpression.text)) issue(node, 'key', node.argumentExpression.text);
		if (ts.isCallExpression(node)) {
			const args = node.arguments;
			if (args.length >= 3 && ts.isStringLiteralLike(args[1]) && ts.isStringLiteralLike(args[2])
				&& /copy/iu.test(args[0].getText(source)) && !registered(args[1].text)) issue(node, 'fallback', args[1].text);
		}
		if (ts.isJsxText(node)) {
			const prose = node.text.trim();
			if (/\p{Letter}/u.test(prose) && !technicalText(prose)) issue(node, 'text', prose);
		}
		if (ts.isStringLiteralLike(node) && (ts.isJsxExpression(node.parent)
			|| (ts.isConditionalExpression(node.parent) && node.parent.condition !== node))) {
			let ancestor = node.parent;
			while (ancestor && !ts.isJsxExpression(ancestor) && !ts.isCallExpression(ancestor)) ancestor = ancestor.parent;
			if (ancestor && ts.isJsxExpression(ancestor)
				&& (!ts.isJsxAttribute(ancestor.parent) || AUTHORED_ATTRIBUTE.test(ancestor.parent.name.getText(source)))
				&& /\p{Letter}/u.test(node.text)
				&& !technicalText(node.text)) issue(node, 'text', node.text);
		}
		if (ts.isVariableDeclaration(node) && /^(?:COPY|TEXT|DEFAULT_COPY|fallbacks)$/u.test(node.name.getText(source))
			&& node.initializer) {
			function ownedDictionary(child) {
				if (ts.isPropertyAssignment(child) && ts.isStringLiteralLike(child.initializer)
					&& /\p{Letter}/u.test(child.initializer.text) && !technicalText(child.initializer.text)) {
					issue(child, 'dictionary', child.name.getText(source));
				}
				ts.forEachChild(child, ownedDictionary);
			}
			ownedDictionary(node.initializer);
		}
		if (ts.isJsxAttribute(node) && AUTHORED_ATTRIBUTE.test(node.name.getText(source))
			&& node.initializer && ts.isStringLiteralLike(node.initializer)) {
			const prose = node.initializer.text.trim();
			if (/\p{Letter}/u.test(prose) && !technicalText(prose)) issue(node, 'attribute', prose);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return issues;
}

export async function auditEditorCopyTree(directory, inventory) {
	const issues = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) issues.push(...await auditEditorCopyTree(path, inventory));
		else if (/\.[jt]sx?$/u.test(entry.name)) issues.push(...auditEditorCopySource(path, await readFile(path, 'utf8'), inventory));
	}
	return issues;
}
