/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { packagedRuntimeCoverageLaunch } from './browser/helpers/packaged-runtime-coverage.js';

test('packaged coverage is opt-in and NODE_V8_COVERAGE reaches only the product child', () => {
	const runRoot = join(tmpdir(), 'soundscaper-nightly-run');
	const coverageDirectory = join(runRoot, 'coverage/v8-packaged');
	const ordinaryEnvironment = {
		ELECTRON_RUN_AS_NODE: '1',
		NODE_V8_COVERAGE: '/outer/coverage',
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	};
	assert.deepEqual(packagedRuntimeCoverageLaunch(ordinaryEnvironment), {
		coverageDirectory: null,
		environment: { SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot },
	});
	assert.deepEqual(ordinaryEnvironment, {
		ELECTRON_RUN_AS_NODE: '1',
		NODE_V8_COVERAGE: '/outer/coverage',
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	}, 'the outer Playwright environment is not mutated');

	const enabled = packagedRuntimeCoverageLaunch({
		...ordinaryEnvironment,
		SCAPE_BROWSER_COVERAGE: '1',
	});
	assert.equal(enabled.coverageDirectory, coverageDirectory);
	assert.deepEqual(enabled.environment, {
		NODE_V8_COVERAGE: coverageDirectory,
		SCAPE_BROWSER_COVERAGE: '1',
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	});
	assert.throws(
		() => packagedRuntimeCoverageLaunch({ SCAPE_BROWSER_COVERAGE: '1' }),
		/SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT/u,
	);
});
