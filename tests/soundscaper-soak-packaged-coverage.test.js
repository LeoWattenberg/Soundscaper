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

test('packaged soak seeds its locale before launching the product', async () => {
	const source = await readFile(new URL(
		'../scripts/lib/soundscaper-soak-desktop-playwright.mjs',
		import.meta.url,
	), 'utf8');
	const launch = source.slice(source.indexOf('export async function openSoundscaperDesktopSoakSession'));
	const profile = launch.indexOf("mkdtemp(join(tmpdir(), 'soundscaper-soak-debug-'))");
	const guard = launch.indexOf('try {', profile);
	const locale = launch.indexOf('await seedDesktopNightlyPackagedLocale(profile)');
	const runtime = launch.indexOf('await launchDesktopRuntime({');
	const cleanup = launch.indexOf('await rm(profile, { recursive: true, force: true })', runtime);
	assert.ok(profile >= 0, 'the soak must create its isolated profile');
	assert.ok(locale > profile, 'the soak must seed a deterministic locale into that profile');
	assert.ok(guard > profile && guard < locale, 'locale seeding must run inside the profile cleanup guard');
	assert.ok(runtime > locale, 'the packaged app must not launch before its locale is seeded');
	assert.ok(cleanup > runtime, 'a failed locale seed or launch must remove its isolated profile');
});

test('packaged soak follows the Project management submenu for project lifecycle commands', async () => {
	const source = await readFile(new URL(
		'../scripts/lib/soundscaper-soak-workflows.mjs',
		import.meta.url,
	), 'utf8');
	assert.match(source, /chooseNestedMenu\(page, editor, 'File', \['Project management', 'Rename project'\]\)/u);
	assert.match(source, /chooseNestedMenu\(page, editor, 'File', \['Project management', 'Local projects'\]\)/u);
	assert.doesNotMatch(source, /chooseMenu\(page, editor, 'File', '(?:Rename project|Local projects)'\)/u);
});

test('packaged soak waits for desktop export completion before closing its dialog', async () => {
	const source = await readFile(new URL(
		'../scripts/lib/soundscaper-soak-workflows.mjs',
		import.meta.url,
	), 'utf8');
	const render = source.slice(source.indexOf('async function renderWav'));
	const output = render.indexOf("waitForOutput(outputDirectory, before, '.wav', 60_000)");
	const completed = render.indexOf("dialog.locator('[data-export-action=\"start\"]').waitFor");
	const close = render.indexOf("getByRole('button', { name: 'Close', exact: true }).click()");
	const hidden = render.indexOf("dialog.waitFor({ state: 'hidden' })");
	assert.ok(output >= 0, 'the desktop soak must observe its output file');
	assert.ok(completed > output, 'a nonempty output file must not be treated as completed rendering');
	assert.ok(close > completed, 'the export dialog must close only after rendering finishes');
	assert.ok(hidden > close, 'the next workflow must not race the closing export dialog');
});

test('packaged delivery waits for its preset dialog to close before opening the queue', async () => {
	const source = await readFile(new URL(
		'../scripts/lib/soundscaper-soak-workflows.mjs',
		import.meta.url,
	), 'utf8');
	const recovery = source.slice(
		source.indexOf('async function persistentDeliveryRecovery'),
		source.indexOf('async function renameProject'),
	);
	const saveMenu = recovery.indexOf("exportDialog.getByRole('button', { name: 'Save preset', exact: true }).click()");
	const saveAs = recovery.indexOf("getByRole('menuitem', { name: 'Save as new preset', exact: true }).click()");
	const prompt = recovery.indexOf("getByRole('dialog', { name: 'Save as new preset', exact: true })");
	const name = recovery.indexOf("presetDialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill(presetName)");
	const confirm = recovery.indexOf("presetDialog.getByRole('button', { name: 'Save preset', exact: true }).click()");
	const promptHidden = recovery.indexOf("presetDialog.waitFor({ state: 'hidden' })");
	const saved = recovery.indexOf("filter({ hasText: presetName }).waitFor({ state: 'visible' })");
	const close = recovery.indexOf("exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click()");
	const hidden = recovery.indexOf("exportDialog.waitFor({ state: 'hidden' })", promptHidden);
	const queue = recovery.indexOf("chooseMenu(page, editor, 'File', 'Delivery queue')");
	assert.doesNotMatch(recovery, /data-(?:delivery-)?preset-name/u, 'unforwarded preset name hooks cannot be used');
	assert.ok(saveMenu >= 0, 'the delivery workflow must open the preset save menu');
	assert.ok(saveAs > saveMenu, 'the delivery workflow must choose Save as new preset');
	assert.ok(prompt > saveAs, 'the delivery workflow must find the shared preset-name prompt');
	assert.ok(name > prompt, 'the delivery workflow must name the new preset in its prompt');
	assert.ok(confirm > name, 'the delivery workflow must confirm the named preset');
	assert.ok(promptHidden > confirm, 'the delivery workflow must observe its preset prompt closing');
	assert.ok(saved > promptHidden, 'the delivery workflow must observe its preset persistence');
	assert.ok(close > saved, 'the configured export dialog must be cancelled without rendering');
	assert.ok(hidden > close, 'the delivery workflow must observe the export dialog closing');
	assert.ok(queue > hidden, 'the delivery queue must open only after the preset dialog is gone');
});

test('packaged delivery reports a terminal queue failure without waiting for the soak timeout', async () => {
	const source = await readFile(new URL(
		'../scripts/lib/soundscaper-soak-workflows.mjs',
		import.meta.url,
	), 'utf8');
	const wait = source.slice(
		source.indexOf('async function waitForQueueState'),
		source.indexOf('async function outputNames'),
	);
	assert.match(wait, /\['failed', 'stale', 'cancelled', 'needs-authorization'\]\.includes\(state\)/u);
	assert.match(wait, /await job\.getAttribute\('data-delivery-queue-job'\)/u);
	assert.match(wait, /Persistent delivery job \$\{String\(jobId\)\} entered \$\{String\(state\)\}/u);
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
