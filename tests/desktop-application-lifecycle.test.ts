/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	DesktopApplicationShutdown,
	resolveDesktopProjectLibraryAppData,
} from '../desktop/application-lifecycle.ts';

test('desktop shutdown runs every cleanup once and preserves the first failure exit code', async () => {
	let releaseLibrary: (() => void) | undefined;
	const libraryClosed = new Promise<void>((resolvePromise) => { releaseLibrary = resolvePromise; });
	const calls: string[] = [];
	const exits: number[] = [];
	const shutdown = new DesktopApplicationShutdown({
		tasks: [
			{ name: 'project library', run: async () => { calls.push('library'); await libraryClosed; } },
			{ name: 'read capabilities', run: () => { calls.push('reads'); } },
			{ name: 'save sessions', run: () => { calls.push('saves'); } },
		],
		exit: (code) => { exits.push(code); },
		reportError: () => assert.fail('successful cleanup must not report an error'),
	});

	const normalExit = shutdown.requestExit(0);
	const failedExit = shutdown.requestExit(2);
	const laterFailure = shutdown.requestExit(1);
	assert.equal(normalExit, failedExit);
	assert.equal(failedExit, laterFailure);
	assert.equal(shutdown.requested, true);
	await Promise.resolve();
	assert.deepEqual(new Set(calls), new Set(['library', 'reads', 'saves']));
	assert.deepEqual(exits, [], 'exit waits for every cleanup task');

	releaseLibrary?.();
	await normalExit;
	assert.deepEqual(exits, [2], 'success cannot mask the first requested failure code');
	await shutdown.requestExit(1);
	assert.deepEqual(exits, [2], 'settled shutdown remains idempotent');
});

test('desktop shutdown reports all cleanup failures and upgrades a normal exit', async () => {
	const calls: string[] = [];
	const reports: Array<{ name: string; error: unknown }> = [];
	const exits: number[] = [];
	const shutdown = new DesktopApplicationShutdown({
		tasks: [
			{ name: 'project library', run: () => { calls.push('library'); throw new Error('library close failed'); } },
			{ name: 'save sessions', run: async () => { calls.push('saves'); throw new Error('save cleanup failed'); } },
			{ name: 'read capabilities', run: () => { calls.push('reads'); } },
		],
		exit: (code) => { exits.push(code); },
		reportError: (name, error) => { reports.push({ name, error }); },
	});

	await shutdown.requestExit(0);
	assert.deepEqual(new Set(calls), new Set(['library', 'reads', 'saves']));
	assert.deepEqual(reports.map(({ name }) => name).sort(), ['project library', 'save sessions']);
	assert.deepEqual(exits, [1]);
});

test('desktop project library uses appData normally and requires an isolated smoke root', () => {
	const applicationDataPath = resolve('test-desktop-application-data');
	const smokeAppDataPath = resolve('test-desktop-smoke-application-data');
	const soakAppDataPath = resolve('test-desktop-soak-application-data');
	const ignoredAppDataPath = resolve('test-desktop-ignored-application-data');
	assert.equal(resolveDesktopProjectLibraryAppData({
		applicationDataPath,
		argv: ['/opt/Soundscaper'],
	}), applicationDataPath);
	assert.equal(resolveDesktopProjectLibraryAppData({
		applicationDataPath,
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-app-data=${smokeAppDataPath}`,
		],
	}), smokeAppDataPath);
	assert.equal(resolveDesktopProjectLibraryAppData({
		applicationDataPath,
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-soak-debug',
			`--soundscaper-soak-debug-app-data=${soakAppDataPath}`,
		],
	}), soakAppDataPath);
	assert.throws(
		() => resolveDesktopProjectLibraryAppData({
			applicationDataPath,
			argv: ['/opt/Soundscaper', '--soundscaper-soak-debug'],
		}),
		/soak debug.*isolated appData/iu,
	);
	assert.throws(
		() => resolveDesktopProjectLibraryAppData({
			applicationDataPath,
			argv: ['/opt/Soundscaper', '--soundscaper-smoke'],
		}),
		/requires exactly one isolated appData path/u,
	);
	assert.equal(resolveDesktopProjectLibraryAppData({
		applicationDataPath,
		argv: ['/opt/Soundscaper', `--soundscaper-smoke-app-data=${ignoredAppDataPath}`],
	}), applicationDataPath);
	assert.equal(resolveDesktopProjectLibraryAppData({
		applicationDataPath,
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-nightly-tests-base-url=http://127.0.0.1:4323',
			`--soundscaper-nightly-tests-app-data=${ignoredAppDataPath}`,
		],
	}), ignoredAppDataPath);
	assert.throws(
		() => resolveDesktopProjectLibraryAppData({
			applicationDataPath,
			argv: ['/opt/Soundscaper', `--soundscaper-nightly-tests-app-data=${ignoredAppDataPath}`],
		}),
		/nightly tests.*loopback/iu,
	);
});
