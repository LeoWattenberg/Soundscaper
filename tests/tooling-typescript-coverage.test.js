/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('every tooling TypeScript project entry opts into JavaScript diagnostics', async () => {
	const project = JSON.parse(await readFile(
		new URL('../tsconfig.tooling.json', import.meta.url), 'utf8',
	));
	assert.equal(project.compilerOptions.checkJs, false);
	assert.ok(project.include.length > 0);

	for (const path of project.include) {
		assert.match(
			await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
			/^\/\/ @ts-check\n/u,
			`${path} is included by tsconfig.tooling.json but receives no JavaScript diagnostics`,
		);
	}
});
