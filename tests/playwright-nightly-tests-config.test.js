/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const environmentKeys = [
	'SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL',
	'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT',
	'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT',
];

test('bundled Playwright config uses only absolute launcher-provided paths', async () => {
	const originalEnvironment = Object.fromEntries(
		environmentKeys.map((key) => [key, process.env[key]]),
	);
	const payloadRoot = resolve('/tmp/soundscaper-nightly-tests-payload');
	const runRoot = resolve('/tmp/soundscaper-nightly-tests-run');

	try {
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL = 'http://127.0.0.1:41000';
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT = payloadRoot;
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT = runRoot;
		const { createNightlyTestsConfig, default: config } = await import(
			'../playwright.nightly-tests.config.mjs?absolute-launcher-paths'
		);

		assert.equal(config.testDir, resolve(payloadRoot, 'tests/browser'));
		assert.equal(config.outputDir, resolve(runRoot, 'test-results'));
		assert.equal(config.use.baseURL, 'http://127.0.0.1:41000');
		assert.equal(config.webServer, undefined);
		assert.equal(config.workers, 2);
		assert.equal(config.retries, 1);
		assert.equal(config.failOnFlakyTests, false);
		assert.equal(config.updateSnapshots, 'none');
		assert.deepEqual(config.projects.map(({ name }) => name), ['chromium', 'firefox', 'webkit']);
		assert.deepEqual(config.reporter, [
			['list'],
			['html', { outputFolder: resolve(runRoot, 'playwright-report'), open: 'never' }],
			['json', { outputFile: resolve(runRoot, 'results.json') }],
			['junit', { outputFile: resolve(runRoot, 'junit.xml') }],
		]);

		assert.throws(
			() => createNightlyTestsConfig({
				SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: 'http://example.com:41000',
				SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
				SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
			}),
			/loopback/u,
		);
		assert.throws(
			() => createNightlyTestsConfig({
				SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: 'http://127.0.0.1:41000',
				SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: 'relative/payload',
				SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
			}),
			/absolute/u,
		);
	} finally {
		for (const [key, value] of Object.entries(originalEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test('package scripts expose local preparation and packaging of the diagnostic flavor', async () => {
	const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

	assert.equal(
		packageMetadata.scripts['desktop:nightly-tests:prepare'],
		'node scripts/desktop-nightly-tests-prepare.mjs',
	);
	assert.equal(
		packageMetadata.scripts['desktop:nightly-tests:dist'],
		'npm run build && npm run desktop:nightly-tests:prepare && electron-builder --config electron-builder.nightly-tests.config.cjs --publish never',
	);
});

test('diagnostic runs keep the canonical visual baseline on Linux Chromium', async () => {
	const [browserSpec, snapshots] = await Promise.all([
		readFile(new URL('./browser/audio-editor-export-session.spec.js', import.meta.url), 'utf8'),
		readdir(new URL('./browser/audio-editor-export-session.spec.js-snapshots/', import.meta.url)),
	]);

	assert.match(
		browserSpec,
		/test\.skip\(\s*process\.platform !== 'linux'\s*\|\|\s*testInfo\.project\.name !== 'chromium',\s*'[^']*Ubuntu CI[^']*'\s*,?\s*\)/u,
	);
	assert.ok(snapshots.length > 0);
	assert.ok(snapshots.every((snapshot) => snapshot.endsWith('-chromium-linux.png')));
});
