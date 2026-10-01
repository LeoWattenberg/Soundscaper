/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

test('every nightly phase loads its item progress reporter from the staged payload', async () => {
	const payloadRoot = resolve('/tmp/nightly-progress-payload');
	const environment = {
		SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: resolve('/tmp/nightly-progress-run'),
		SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: 'http://127.0.0.1:41000',
		SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify({
			soundscaper: 'http://127.0.0.1:4332',
			framescaper: 'http://127.0.0.1:4333',
		}),
		SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '1',
	};
	const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
	try {
		Object.assign(process.env, environment);
		for (const phase of [
			'tests', 'dual-origin', 'metrics', 'packaged-metrics', 'packaged-coverage', 'local-assistance',
		]) {
			const { default: config } = await import(`../playwright.nightly-${phase}.config.mjs?item-progress`);
			assert.deepEqual(config.reporter.map(([reporter]) => reporter), [
				'list',
				resolve(payloadRoot, 'scripts/lib/desktop-nightly-tests-progress-reporter.mjs'),
				'html',
				'json',
				'junit',
			], phase);
		}
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
