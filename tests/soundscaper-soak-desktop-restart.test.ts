/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	openSoundscaperDesktopSoakSession,
	waitForDesktopPage,
} from '../scripts/lib/soundscaper-soak-desktop-playwright.mjs';

test('packaged soak allows the crashed writer lease to expire before its editor opens', async (context) => {
	context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
	const page = { url: () => 'soundscaper-app://bundle/' };
	const pending = waitForDesktopPage({ pages: () => Date.now() >= 31_000 ? [page] : [] });

	context.mock.timers.tick(31_000);

	assert.equal(await pending, page);
});

test('packaged soak page startup still reports an exited child immediately', async () => {
	await assert.rejects(waitForDesktopPage({ pages: () => [] }, () => 'startup failure', {
		exitCode: 1,
		signalCode: null,
	}), /exited before its editor page opened[\s\S]*startup failure/u);
});

test('packaged soak page startup remains bounded when no window opens', async (context) => {
	context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
	const pending = waitForDesktopPage({ pages: () => [] }, () => 'startup output');
	const rejected = assert.rejects(pending, /did not expose its editor page \(pages: none\)[\s\S]*startup output/u);

	context.mock.timers.tick(60_000);

	await rejected;
});

test('a failed packaged soak relaunch leaves no retired runtime for final cleanup', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-soak-restart-test-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const desktopExecutable = join(directory, 'soundscaper');
	await writeFile(desktopExecutable, 'test executable');
	const runtime = fakeRuntime();
	const relaunchError = new Error('replacement runtime did not start');
	const profiles: string[] = [];
	const session = await openSoundscaperDesktopSoakSession({
		desktopExecutable,
		outputDirectory: directory,
		keepProfileOnFailure: false,
	}, {
		createPageSession: (options: SessionCallbacks) => Promise.resolve(options),
		installRuntimeHooks() {},
		async prepareContext() {},
		async waitForEditor() {},
		launchRuntime: (options: { profile: string }) => {
			profiles.push(options.profile);
			return Promise.resolve(runtime);
		},
		relaunchRuntime: () => Promise.reject(relaunchError),
	});
	const profile = profiles[0];
	assert.ok(profile);
	context.after(() => rm(profile, { recursive: true, force: true }));

	await assert.rejects(session.restartRuntime({ abrupt: true }), (error: unknown) => error === relaunchError);
	await session.closeRuntime({ failed: true });

	assert.equal(runtime.collectionCount, 1);
	assert.equal(runtime.closeCount, 1);
});

interface SessionCallbacks {
	restartRuntime(options: { abrupt: boolean }): Promise<unknown>;
	closeRuntime(options: { failed: boolean }): Promise<void>;
}

function fakeRuntime() {
	const runtime = {
		collectionCount: 0,
		closeCount: 0,
		child: { exitCode: 0, signalCode: null },
		page: {},
		context: {},
		async checkpointMainCoverage() {
			assert.equal(runtime.collectionCount, 0, 'a retired page cannot checkpoint main coverage');
		},
		coverageCollector: {
			async checkpoint() {},
			async collect() {
				runtime.collectionCount += 1;
				assert.equal(runtime.collectionCount, 1, 'a runtime can collect coverage only once');
			},
		},
		browser: { async close() { runtime.closeCount += 1; } },
	};
	return runtime;
}
