/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateSoundscaperSoakConfig } from '../scripts/lib/soundscaper-soak-debug-config.mjs';
import { createSoundscaperSoakPageSession } from '../scripts/lib/soundscaper-soak-playwright.mjs';
import { runSoundscaperSoak } from '../scripts/run-soundscaper-soak.mjs';

const CONFIG = validateSoundscaperSoakConfig(JSON.parse(await readFile(
	new URL('../config/soundscaper-soak-debug.json', import.meta.url), 'utf8',
)));

test('runtime sampling waits for an intentional restart to finish', async () => {
	let transitioning = false;
	let releaseRestart;
	let announceRestart;
	const restartEntered = new Promise((resolvePromise) => { announceRestart = resolvePromise; });
	const restartReleased = new Promise((resolvePromise) => { releaseRestart = resolvePromise; });
	const session = await createSoundscaperSoakPageSession({
		page: fakeSoakPage(),
		context: fakeSoakContext(101),
		target: 'browser',
		outputDirectory: '/tmp/soundscaper-soak-restart-race',
		assertRuntime() {
			if (transitioning) {
				throw Object.assign(new Error('the intentionally stopped runtime looked crashed'), {
					code: 'SOAK_RUNTIME_CRASH',
				});
			}
		},
		async restartRuntime() {
			transitioning = true;
			announceRestart();
			await restartReleased;
			transitioning = false;
			return { page: fakeSoakPage(), context: fakeSoakContext(202) };
		},
		async closeRuntime() {},
	});

	const restarting = session.reset();
	await restartEntered;
	let sampleSettled = false;
	let samplingStarted = false;
	const sampling = session.sample({
		onStarted() { samplingStarted = true; },
	}).finally(() => { sampleSettled = true; });
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	assert.equal(sampleSettled, false);
	assert.equal(samplingStarted, false);
	releaseRestart();
	await restarting;
	assert.equal((await sampling).usedJsHeapBytes, 202);
	assert.equal(samplingStarted, true);
	await session.close({ failed: false });
});

test('an intentional restart waits for an active runtime sample to finish', async () => {
	let releaseCollection;
	let announceCollection;
	let oldRuntimeDetached = false;
	let restartEntered = false;
	let blockFirstCollection = true;
	const collectionEntered = new Promise((resolvePromise) => { announceCollection = resolvePromise; });
	const collectionReleased = new Promise((resolvePromise) => { releaseCollection = resolvePromise; });
	const session = await createSoundscaperSoakPageSession({
		page: fakeSoakPage(),
		context: fakeSoakContext(101, {
			async onSend(method) {
				if (method !== 'HeapProfiler.collectGarbage' || !blockFirstCollection) return;
				blockFirstCollection = false;
				announceCollection();
				await collectionReleased;
			},
			onDetach() { oldRuntimeDetached = true; },
		}),
		target: 'browser',
		outputDirectory: '/tmp/soundscaper-soak-sample-race',
		async restartRuntime() {
			restartEntered = true;
			return { page: fakeSoakPage(), context: fakeSoakContext(202) };
		},
		async closeRuntime() {},
	});

	const sampling = session.sample();
	await collectionEntered;
	let resetSettled = false;
	const resetting = session.reset().finally(() => { resetSettled = true; });
	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	assert.equal(oldRuntimeDetached, false);
	assert.equal(restartEntered, false);
	assert.equal(resetSettled, false);
	releaseCollection();
	assert.equal((await sampling).usedJsHeapBytes, 101);
	await resetting;
	assert.equal(restartEntered, true);
	assert.equal((await session.sample()).usedJsHeapBytes, 202);
	await session.close({ failed: false });
});

test('an external interruption during post-failure reset remains incomplete', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-soak-reset-interrupt-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const controller = new AbortController();
	const result = await runSoundscaperSoak({
		target: 'browser', profile: 'quick', outputDirectory: directory,
		desktopExecutable: null, keepProfileOnFailure: false,
	}, {
		config: CONFIG,
		clock: virtualClock(),
		signal: controller.signal,
		openSession: async () => ({
			async sample({ onStarted }) {
				onStarted();
				return {
					usedJsHeapBytes: 1024, forcedCollections: 3,
					electronWorkingSetBytes: null,
					electronWorkingSetUnavailableReason: 'Browser runs have no Electron process.',
				};
			},
			async execute() { throw new Error('operation failed'); },
			async captureFailure() { return null; },
			async reset({ signal }) {
				controller.abort(new Error('owner stopped during reset'));
				throw signal.reason;
			},
			async close() {},
		}),
	});

	assert.equal(result.exitCode, 2);
	assert.equal(result.runs[0].report.status, 'incomplete');
	assert.match(result.runs[0].report.incompleteReason, /owner stopped during reset/iu);
});

function fakeSoakPage() {
	return {
		locator() { return {}; },
		on() {},
		isClosed() { return false; },
	};
}

function fakeSoakContext(usedSize, hooks = {}) {
	return {
		async newCDPSession() {
			return {
				async send(method) {
					await hooks.onSend?.(method);
					return method === 'Runtime.getHeapUsage' ? { usedSize } : {};
				},
				async detach() { hooks.onDetach?.(); },
			};
		},
	};
}

function virtualClock() {
	let elapsedMs = 0;
	let wallMs = Date.parse('2026-08-31T10:00:00.000Z');
	return {
		now: () => new Date(wallMs),
		monotonicNow: () => elapsedMs,
		async sleep(milliseconds) { elapsedMs += milliseconds; wallMs += milliseconds; },
	};
}
