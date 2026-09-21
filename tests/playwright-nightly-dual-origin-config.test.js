/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

test('nightly dual-origin coverage runs only the reciprocal Chromium workflow', async () => {
	const payloadRoot = resolve('/tmp/soundscaper-nightly-dual-origin-payload');
	const runRoot = resolve('/tmp/soundscaper-nightly-dual-origin-run');
	const origins = {
		soundscaper: 'http://127.0.0.1:4332',
		framescaper: 'http://127.0.0.1:4333',
	};
	const keys = [
		'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT',
		'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT',
		'SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS',
	];
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	let config;
	try {
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT = payloadRoot;
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT = runRoot;
		process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS = JSON.stringify(origins);
		const { createNightlyDualOriginConfig } = await import(
			'../playwright.nightly-dual-origin.config.mjs?nightly-dual-origin'
		);
		config = createNightlyDualOriginConfig(process.env);
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	assert.equal(config.testDir, resolve(payloadRoot, 'tests/browser/dual-origin'));
	assert.equal(config.testMatch, '*.spec.js');
	assert.equal(config.outputDir, resolve(runRoot, 'e2e-coverage/dual-origin/test-results'));
	assert.equal(config.fullyParallel, false);
	assert.equal(config.failOnFlakyTests, true);
	assert.equal(config.retries, 0);
	assert.equal(config.workers, 1);
	assert.equal(config.webServer, undefined);
	assert.equal(config.use.baseURL, origins.soundscaper);
	assert.equal(config.use.serviceWorkers, 'block');
	assert.deepEqual(config.projects.map(({ name }) => name), ['chromium']);
	assert.deepEqual(config.use.storageState.origins.map(({ origin }) => origin), [origins.soundscaper]);
	assert.deepEqual(config.reporter, [
		['list'],
		['html', {
			outputFolder: resolve(runRoot, 'e2e-coverage/dual-origin/playwright-report'),
			open: 'never',
		}],
		['json', { outputFile: resolve(runRoot, 'e2e-coverage/dual-origin/results.json') }],
		['junit', { outputFile: resolve(runRoot, 'e2e-coverage/dual-origin/junit.xml') }],
	]);
});

test('nightly dual-origin coverage requires two distinct loopback build origins', async () => {
	const base = {
		SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: resolve('/tmp/payload'),
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: resolve('/tmp/run'),
	};
	const keys = [...Object.keys(base), 'SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS'];
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	let createNightlyDualOriginConfig;
	try {
		Object.assign(process.env, base, {
			SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify({
				soundscaper: 'http://127.0.0.1:4322',
				framescaper: 'http://127.0.0.1:4323',
			}),
		});
		({ createNightlyDualOriginConfig } = await import(
			'../playwright.nightly-dual-origin.config.mjs?nightly-dual-origin-refusals'
		));
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
	assert.throws(() => createNightlyDualOriginConfig({
		...base,
		SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify({
			soundscaper: 'http://127.0.0.1:4322',
			framescaper: 'http://127.0.0.1:4322',
		}),
	}), /distinct product origins/iu);
	assert.throws(() => createNightlyDualOriginConfig({
		...base,
		SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify({
			soundscaper: 'https://soundscaper.org',
			framescaper: 'http://127.0.0.1:4323',
		}),
	}), /loopback product origins/iu);
});
