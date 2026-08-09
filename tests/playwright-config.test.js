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
	const firefox = config.projects.find(({ name }) => name === 'firefox');
	assert.deepEqual(firefox.use.launchOptions.firefoxUserPrefs, {
		'media.cubeb.force_mock_context': true,
	});
	for (const project of config.projects.filter(({ name }) => name !== 'firefox')) {
		assert.equal(project.use.launchOptions?.firefoxUserPrefs, undefined);
	}
	assert.equal(config.use.serviceWorkers, 'block', 'ordinary browser tests must not install the offline shell');
});

test('desktop verification installs every configured browser engine', async () => {
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	assert.match(workflow, /playwright install --with-deps chromium firefox webkit/u);
});

test('quality verification isolates each browser engine in a supported Playwright container', async () => {
	const workflow = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
	const browserJob = workflow.slice(workflow.indexOf('\n  browser:\n'));

	assert.ok(browserJob.startsWith('\n  browser:\n'), 'quality workflow must retain its browser job');
	assert.ok(browserJob.includes('name: Browser / ${{ matrix.project }}'));
	assert.match(browserJob, /strategy:\n\s+fail-fast: false\n\s+matrix:\n\s+project: \[chromium, firefox, webkit\]/u);
	assert.match(browserJob, /container:\n\s+image: mcr\.microsoft\.com\/playwright:[^\n]+\n\s+options: --user 1001/u);
	assert.match(browserJob, /npm install --global --prefix "\$HOME\/\.local" npm@12\.0\.1/u);
	assert.match(browserJob, /echo "\$HOME\/\.local\/bin" >> "\$GITHUB_PATH"/u);
	assert.ok(browserJob.includes('npm run test:browser:built -- --project=${{ matrix.project }}'));
	assert.ok(browserJob.includes('name: browser-diagnostics-${{ matrix.project }}'));
});
