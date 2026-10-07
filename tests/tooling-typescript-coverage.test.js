/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function toolingProject() {
	const path = resolve(ROOT, 'tsconfig.tooling.json');
	const project = ts.readConfigFile(path, ts.sys.readFile);
	assert.equal(project.error, undefined);
	const parsed = ts.parseJsonConfigFileContent(project.config, ts.sys, dirname(path), undefined, path);
	assert.deepEqual(parsed.errors, []);
	assert.equal(parsed.options.checkJs, false);
	assert.equal(parsed.options.strict, true);
	assert.ok(parsed.fileNames.length > 0);
	return parsed;
}

test('included tooling JavaScript opts into diagnostics after TypeScript expands include patterns', async () => {
	const files = toolingProject().fileNames.filter((path) => /\.[cm]?jsx?$/u.test(path));
	assert.ok(files.length > 0);
	for (const path of files) {
		assert.match(
			await readFile(path, 'utf8'),
			/^\/\/ @ts-check\n/u,
			`${path} is included by tsconfig.tooling.json but receives no JavaScript diagnostics`,
		);
	}
});

test('performance TypeScript probes remain covered by the strict tooling project', async () => {
	const included = new Set(toolingProject().fileNames);
	const directory = resolve(ROOT, 'scripts/performance');
	const probes = (await readdir(directory)).filter((name) => name.endsWith('.ts'));
	assert.ok(probes.length > 0);
	for (const name of probes) assert.ok(included.has(resolve(directory, name)), `${name} lacks strict tooling diagnostics`);
});
