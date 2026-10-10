/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import {
	createSourceFile, forEachChild, isIdentifier, isNewExpression,
	isStringLiteralLike, ScriptTarget, type Node,
} from 'typescript';

import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('nightly packaging retains media data opened by browser specs and helpers', async () => {
	const { default: config } = await import('../electron-builder.nightly-tests.config.cjs');
	assert.ok(Array.isArray(config.extraResources));
	const payload = config.extraResources.find(entry => typeof entry !== 'string' && entry.to === 'nightly-tests');
	assert.ok(payload && typeof payload !== 'string' && Array.isArray(payload.filter));
	const filter = payload.filter;
	const browserRoot = join(repositoryRoot, 'tests/browser');
	const references = new Map<string, Set<string>>();
	for (const entry of await readdir(browserRoot, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name)) continue;
		const importer = join(entry.parentPath, entry.name);
		const source = await readFile(importer, 'utf8');
		const sourceFile = createSourceFile(importer, source, ScriptTarget.Latest, true);
		forEachChild(sourceFile, visit);

		function visit(node: Node): void {
			if (isNewExpression(node) && isIdentifier(node.expression)
				&& node.expression.text === 'URL' && node.arguments?.length === 2
				&& isStringLiteralLike(node.arguments[0])
				&& node.arguments[1]?.getText(sourceFile) === 'import.meta.url') {
				const specifier = node.arguments[0].text;
				if (specifier.startsWith('.') && specifier.endsWith('.base64')) {
					const path = resolve(dirname(importer), specifier);
					const input = relative(repositoryRoot, path).split(sep).join('/');
					const importers = references.get(input) ?? new Set<string>();
					importers.add(relative(repositoryRoot, importer));
					references.set(input, importers);
				}
			}
			forEachChild(node, visit);
		}
	}
	assert.ok(references.size > 0, 'the audit must reach the browser media fixtures');
	const failures: string[] = [];
	for (const [input, importers] of references) {
		await readFile(join(repositoryRoot, input));
		const staged = NIGHTLY_TEST_PAYLOAD_INPUTS.find(entry => {
			const { source, kind } = entry;
			if (kind === 'file') return source === input;
			return input.startsWith(`${source}/`)
				&& !('exclude' in entry && entry.exclude.has(input.slice(source.length + 1).split('/')[0]));
		});
		if (!staged) {
			failures.push(`Missing ${input} (opened by ${[...importers].join(', ')})`);
			continue;
		}
		const packaged = staged.destination + input.slice(staged.source.length);
		assert.equal(resolve(repositoryRoot, packaged), resolve(repositoryRoot, input),
			`The browser fixture URL must resolve to its staged destination: ${input}`);
		if (!filter.some(pattern => matchesGlob(packaged, pattern))) {
			failures.push(`Packaging drops ${packaged}`);
		}
	}
	assert.deepEqual(failures, [], failures.join('\n'));
});
