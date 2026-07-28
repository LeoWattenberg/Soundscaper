/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Playwright allows CI to pass when a retry succeeds', async () => {
	process.env.CI = 'true';
	const { default: config } = await import('../playwright.config.mjs?ci-flaky-policy');

	assert.equal(config.retries, 1);
	assert.equal(config.failOnFlakyTests, false);
});

test('Playwright runs the maintained evergreen browser-engine matrix', async () => {
	delete process.env.CI;
	const { default: config } = await import('../playwright.config.mjs?browser-matrix');

	assert.deepEqual(config.projects.map(({ name }) => name), ['chromium', 'firefox', 'webkit']);
	for (const project of config.projects) {
		assert.ok(project.use.browserName, `${project.name} must select an engine explicitly`);
		assert.equal(project.use.viewport.width, 1280);
		assert.equal(project.use.viewport.height, 720);
	}
});

test('desktop verification installs every configured browser engine', async () => {
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	assert.match(workflow, /playwright install --with-deps chromium firefox webkit/u);
});
