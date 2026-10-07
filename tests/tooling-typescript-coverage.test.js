/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('every tooling project entry receives TypeScript or opted-in JavaScript diagnostics', async () => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const project = JSON.parse(await readFile(
		new URL('../tsconfig.tooling.json', import.meta.url), 'utf8',
	));
	assert.equal(project.compilerOptions.checkJs, false);
	assert.ok(project.include.length > 0);
	const parsed = ts.parseJsonConfigFileContent(project, ts.sys, root);
	assert.deepEqual(parsed.errors, []);
	assert.equal(parsed.options.strict, true);

	for (const pattern of project.include) {
		const files = ts.sys.readDirectory(root, undefined, project.exclude, [pattern]);
		assert.ok(files.length > 0, `${pattern} does not include any tooling files`);
	}
	for (const path of parsed.fileNames) {
		if (/\.[cm]?tsx?$/u.test(path)) continue;
		assert.match(
			await readFile(path, 'utf8'),
			/^\/\/ @ts-check\n/u,
			`${path} is included by tsconfig.tooling.json but receives no JavaScript diagnostics`,
		);
	}
});
