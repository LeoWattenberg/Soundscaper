/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../playwright.motionscaper.config.mjs';

test('Motion local qualification includes all declared engines without widening the existing Chromium suite', () => {
	assert.deepEqual(config.projects?.map(project => project.name), ['chromium', 'firefox', 'webkit']);
	assert.equal(config.testMatch, '**/motionscaper*.spec.{js,ts}');
	const projects = config.projects ?? [];
	assert.equal(projects[0]?.testMatch, undefined);
	for (const project of projects.slice(1)) {
		assert.deepEqual(project.testMatch, ['**/motionscaper-platform.spec.ts', '**/motionscaper-video-delivery.spec.ts', '**/motionscaper-project-release.spec.ts']);
		assert.equal(project.use?.browserName, project.name);
		assert.equal(project.use?.deviceScaleFactor, 1);
		assert.equal(project.use?.launchOptions, undefined);
	}
	assert.equal(config.use?.serviceWorkers, 'block');
	assert.equal(config.use?.ignoreHTTPSErrors, undefined);
});
