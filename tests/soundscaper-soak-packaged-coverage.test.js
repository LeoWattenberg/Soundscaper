/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
	createSoundscaperDesktopSoakLaunchEnvironment,
	retireSoundscaperDesktopSoakRuntime,
} from '../scripts/lib/soundscaper-soak-desktop-playwright.mjs';

test('packaged soak coverage reaches only its product processes', () => {
	const runRoot = join(tmpdir(), 'soundscaper-packaged-soak-coverage');
	const environment = {
		ELECTRON_RUN_AS_NODE: '1',
		NODE_V8_COVERAGE: '/outer/node-coverage',
		SCAPE_BROWSER_COVERAGE: '1',
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	};
	assert.deepEqual(createSoundscaperDesktopSoakLaunchEnvironment({
		capturePackagedCoverage: false,
		environment,
	}), {
		coverageDirectory: null,
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
		},
	});
	assert.deepEqual(createSoundscaperDesktopSoakLaunchEnvironment({
		capturePackagedCoverage: true,
		environment,
	}), {
		coverageDirectory: join(runRoot, 'coverage/v8-packaged'),
		environment: {
			NODE_V8_COVERAGE: join(runRoot, 'coverage/v8-packaged'),
			SCAPE_BROWSER_COVERAGE: '1',
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
		},
	});
	assert.equal(environment.NODE_V8_COVERAGE, '/outer/node-coverage');
	assert.throws(
		() => createSoundscaperDesktopSoakLaunchEnvironment({
			capturePackagedCoverage: true,
			environment: { SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot },
		}),
		/SCAPE_BROWSER_COVERAGE/iu,
	);
});

test('packaged soak retirement captures live targets before a forced restart', async () => {
	const calls = [];
	const runtime = fakeRuntime(calls);
	await retireSoundscaperDesktopSoakRuntime(runtime, {
		abrupt: true,
		async quitRuntime() { calls.push('quit'); },
		async terminateRuntime(_child, options) { calls.push(['terminate', options]); },
	});
	assert.deepEqual(calls, [
		'coverage-checkpoint',
		'coverage-collect',
		['terminate', { force: true }],
		'browser-close',
	]);
});

test('packaged soak retirement captures live targets before graceful quit', async () => {
	const calls = [];
	const runtime = fakeRuntime(calls);
	await retireSoundscaperDesktopSoakRuntime(runtime, {
		async quitRuntime(candidate) {
			assert.equal(candidate, runtime);
			calls.push('quit');
		},
		async terminateRuntime() { calls.push('terminate'); },
	});
	assert.deepEqual(calls, [
		'coverage-checkpoint',
		'quit',
		'coverage-collect',
		'browser-close',
	]);
});

test('packaged soak retirement finalizes coverage after graceful shutdown errors', async () => {
	const calls = [];
	const runtime = fakeRuntime(calls, { checkpointError: new Error('checkpoint failed') });
	await assert.rejects(
		retireSoundscaperDesktopSoakRuntime(runtime, {
			async quitRuntime() {
				calls.push('quit');
				throw new Error('quit failed');
			},
			async terminateRuntime(_child, options) { calls.push(['terminate', options]); },
		}),
		(error) => {
			assert.equal(error instanceof AggregateError, true);
			assert.match(String(error.errors[0]), /checkpoint failed/u);
			assert.match(String(error.errors[1]), /quit failed/u);
			return true;
		},
	);
	assert.deepEqual(calls, [
		'coverage-checkpoint',
		'quit',
		['terminate', { force: false }],
		'coverage-collect',
		'browser-close',
	]);
});

function fakeRuntime(calls, { checkpointError = null } = {}) {
	return {
		browser: { async close() { calls.push('browser-close'); } },
		child: {},
		coverageCollector: {
			async checkpoint() {
				calls.push('coverage-checkpoint');
				if (checkpointError) throw checkpointError;
			},
			async collect() { calls.push('coverage-collect'); },
		},
	};
}
