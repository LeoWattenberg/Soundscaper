/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSourceFile, forEachChild, isIdentifier, isNewExpression,
	isStringLiteralLike, ScriptTarget, type Node,
} from 'typescript';

/** Escapes can spell any part of the suffix; keep those sources for full parsing. */
export function needsBrowserMediaReferenceSyntaxTree(source: string): boolean {
	return source.includes('.base64') || source.includes('\\');
}

/** Match the same literal URL expressions used by the nightly packaging audit. */
export function collectBrowserMediaReferenceSpecifiers(file: string, source: string): readonly string[] {
	if (!needsBrowserMediaReferenceSyntaxTree(source)) return [];
	const sourceFile = createSourceFile(file, source, ScriptTarget.Latest, true);
	const specifiers: string[] = [];
	forEachChild(sourceFile, visit);
	return specifiers;

	function visit(node: Node): void {
		if (isNewExpression(node) && isIdentifier(node.expression)
			&& node.expression.text === 'URL' && node.arguments?.length === 2
			&& isStringLiteralLike(node.arguments[0])
			&& node.arguments[1]?.getText(sourceFile) === 'import.meta.url') {
			const specifier = node.arguments[0].text;
			if (specifier.startsWith('.') && specifier.endsWith('.base64')) specifiers.push(specifier);
		}
		forEachChild(node, visit);
	}
}
