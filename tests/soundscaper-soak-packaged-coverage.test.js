/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
	createSoundscaperDesktopSoakLaunchEnvironment,
	retireSoundscaperDesktopSoakRuntime,
	terminateSoundscaperDesktopSoakChild,
} from '../scripts/lib/soundscaper-soak-desktop-playwright.mjs';

test('packaged soak binds external executable resources before process launch', async () => {
	const source = await readFile(new URL(
		'../scripts/lib/soundscaper-soak-desktop-playwright.mjs',
		import.meta.url,
	), 'utf8');
	const launch = source.slice(source.indexOf('async function launchDesktopRuntime'));
	const resourceSnapshot = launch.indexOf('capturePackagedExecutableResourcesBeforeLaunch({');
	const processLaunch = launch.indexOf('const child = spawn(');
	assert.ok(resourceSnapshot >= 0, 'the soak must snapshot every external JavaScript and HTML resource');
	assert.ok(processLaunch > resourceSnapshot, 'the resource snapshot must finish before the process can execute');
	assert.match(
		launch,
		/createPackagedRuntimeCoverageCollector\(\{[\s\S]*?\n\s*executableResources,/u,
		'the collector must retain the pre-launch snapshot for stale-resource rejection after collection',
	);
});

test('packaged soak coverage reaches only its product processes', () => {
	const runRoot = join(tmpdir(), 'soundscaper-packaged-soak-coverage');
	const environment = {
		ELECTRON_RUN_AS_NODE: '1',
		NODE_V8_COVERAGE: '/outer/node-coverage',
		SCAPE_BROWSER_COVERAGE: '1',
		SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify({
			soundscaper: 'http://127.0.0.1:4101',
			framescaper: 'http://127.0.0.1:4102',
		}),
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	};
	assert.deepEqual(createSoundscaperDesktopSoakLaunchEnvironment({
		capturePackagedCoverage: false,
		environment,
	}), {
		coverageDirectory: null,
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: environment.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS,
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
		},
	});
	assert.deepEqual(createSoundscaperDesktopSoakLaunchEnvironment({
		capturePackagedCoverage: true,
		environment,
	}), {
		coverageDirectory: join(runRoot, 'coverage/v8-packaged'),
		coverageBaseURL: 'http://127.0.0.1:4101/',
		environment: {
			NODE_V8_COVERAGE: join(runRoot, 'coverage/v8-packaged'),
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: environment.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS,
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
		'main-coverage-checkpoint',
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
		'main-coverage-checkpoint',
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
		'main-coverage-checkpoint',
		'coverage-checkpoint',
		'quit',
		['terminate', { force: false }],
		'coverage-collect',
		'browser-close',
	]);
});

test('packaged soak retirement preserves CDP coverage and shutdown after a main checkpoint failure', async () => {
	const calls = [];
	const runtime = fakeRuntime(calls, { mainCheckpointError: new Error('main checkpoint failed') });
	await assert.rejects(
		retireSoundscaperDesktopSoakRuntime(runtime, {
			abrupt: true,
			async terminateRuntime(_child, options) { calls.push(['terminate', options]); },
		}),
		/main checkpoint failed/u,
	);
	assert.deepEqual(calls, [
		'main-coverage-checkpoint',
		'coverage-checkpoint',
		'coverage-collect',
		['terminate', { force: true }],
		'browser-close',
	]);
});

test('packaged soak retirement aggregates independent main and CDP checkpoint failures', async () => {
	const calls = [];
	const runtime = fakeRuntime(calls, {
		mainCheckpointError: new Error('main checkpoint failed'),
		checkpointError: new Error('CDP checkpoint failed'),
	});
	await assert.rejects(
		retireSoundscaperDesktopSoakRuntime(runtime, {
			abrupt: true,
			async terminateRuntime(_child, options) { calls.push(['terminate', options]); },
		}),
		(error) => {
			assert.equal(error instanceof AggregateError, true);
			assert.deepEqual(error.errors.map(String), [
				'Error: main checkpoint failed',
				'Error: CDP checkpoint failed',
			]);
			return true;
		},
	);
	assert.deepEqual(calls, [
		'main-coverage-checkpoint',
		'coverage-checkpoint',
		'coverage-collect',
		['terminate', { force: true }],
		'browser-close',
	]);
});

test('packaged soak forced termination is bounded and observed', async () => {
	const child = stubbornChild(() => true);
	await assert.rejects(
		terminateSoundscaperDesktopSoakChild(child, { force: true, timeoutMs: 5 }),
		/forced termination was not observed/u,
	);
	assert.deepEqual(child.signals, ['SIGKILL']);
});

test('packaged soak rejects a refused forced termination signal', async () => {
	const child = stubbornChild((signal) => signal !== 'SIGKILL');
	await assert.rejects(
		terminateSoundscaperDesktopSoakChild(child, { timeoutMs: 5 }),
		/forced termination signal was refused/u,
	);
	assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('packaged soak fallback termination rejects an unobserved forced exit', async () => {
	const child = stubbornChild(() => true);
	await assert.rejects(
		terminateSoundscaperDesktopSoakChild(child, { timeoutMs: 5 }),
		/forced termination was not observed/u,
	);
	assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

function fakeRuntime(calls, { mainCheckpointError = null, checkpointError = null } = {}) {
	return {
		browser: { async close() { calls.push('browser-close'); } },
		child: {},
		async checkpointMainCoverage() {
			calls.push('main-coverage-checkpoint');
			if (mainCheckpointError) throw mainCheckpointError;
		},
		coverageCollector: {
			async checkpoint() {
				calls.push('coverage-checkpoint');
				if (checkpointError) throw checkpointError;
			},
			async collect() { calls.push('coverage-collect'); },
		},
	};
}

function stubbornChild(kill) {
	const child = Object.assign(new EventEmitter(), {
		exitCode: null,
		signalCode: null,
		signals: [],
		kill(signal = 'SIGTERM') {
			this.signals.push(signal);
			return kill(signal);
		},
	});
	return child;
}
