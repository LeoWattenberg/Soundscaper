/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeWatchImportClient,
} from '../src/framescaper/editor-native-watch-import-client.ts';

type Data = Record<string, unknown>;

const PROJECT: Data = Object.freeze({
	schemaFamily: 'framescaper',
	schemaVersion: 1,
	id: 'project-1',
	revision: 2,
	sources: [],
	projectBin: { clips: [] },
});

function options(overrides: Data = {}): never {
	return {
		controller: {
			project: PROJECT,
			actions: { project: { importFiles: async () => undefined } },
		},
		linkedVideoOriginalPort: { load: async () => null },
		bridge: {
			claimWatchImport: async () => null,
			completeWatchImport: async () => undefined,
		},
		autoStart: false,
		...overrides,
	} as unknown as never;
}

function client(overrides: Data = {}): Data {
	return createFramescaperNativeWatchImportClient(options(overrides)) as unknown as Data;
}

test('a fully wired watch import client reports itself available', () => {
	assert.equal(client().available, true);
});

test('a client missing any required port reports itself unavailable', () => {
	assert.equal(client({ controller: null }).available, false);
	assert.equal(client({ linkedVideoOriginalPort: null }).available, false);
	assert.equal(client({ linkedVideoOriginalPort: {} }).available, false);
	assert.equal(
		client({ bridge: { completeWatchImport: async () => undefined } }).available,
		false,
	);
	assert.equal(
		client({ bridge: { claimWatchImport: async () => null } }).available,
		false,
	);
});

test('a non-positive poll interval is refused', () => {
	assert.throws(() => client({ intervalMs: 0 }), RangeError);
	assert.throws(() => client({ intervalMs: -5 }), RangeError);
	assert.throws(() => client({ intervalMs: 1.5 }), RangeError);
});

test('an available client schedules its first poll unless auto-start is declined', () => {
	let scheduled = 0;
	const schedule = () => { scheduled += 1; return { handle: true }; };

	client({ autoStart: false, schedule });
	assert.equal(scheduled, 0);

	client({ autoStart: true, schedule });
	assert.equal(scheduled, 1);
});

test('an unavailable client never schedules a poll', () => {
	let scheduled = 0;

	client({
		controller: null,
		autoStart: true,
		schedule: () => { scheduled += 1; return { handle: true }; },
	});

	assert.equal(scheduled, 0);
});

test('disposal cancels the pending timer and stays idempotent', async () => {
	let cancelled = 0;
	const watcher = client({
		autoStart: true,
		schedule: () => ({ handle: true }),
		cancelSchedule: () => { cancelled += 1; },
	});

	await (watcher.dispose as () => Promise<void>)();
	assert.equal(cancelled, 1);

	await (watcher.dispose as () => Promise<void>)();
	assert.equal(cancelled, 1, 'a second disposal must not cancel a timer it no longer owns');
});

test('an unavailable client resolves a poll to no work without touching its ports', async () => {
	let claimed = 0;
	const watcher = client({
		controller: null,
		bridge: {
			claimWatchImport: async () => { claimed += 1; return null; },
			completeWatchImport: async () => undefined,
		},
	});

	assert.equal(await (watcher.pollNow as () => Promise<boolean>)(), false);
	assert.equal(claimed, 0);
});

test('a poll that finds no claim reports no work', async () => {
	assert.equal(await (client().pollNow as () => Promise<boolean>)(), false);
});

test('concurrent polls share one in-flight claim rather than racing the bridge', async () => {
	let claimed = 0;
	const watcher = client({
		bridge: {
			claimWatchImport: async () => {
				claimed += 1;
				await new Promise((resolve) => { setTimeout(resolve, 5); });
				return null;
			},
			completeWatchImport: async () => undefined,
		},
	});

	const poll = watcher.pollNow as () => Promise<boolean>;
	await Promise.all([poll(), poll(), poll()]);

	assert.equal(claimed, 1, 'a second caller must join the in-flight poll, not start another');
});

test('a poll after disposal reports no work', async () => {
	const watcher = client();

	await (watcher.dispose as () => Promise<void>)();

	assert.equal(await (watcher.pollNow as () => Promise<boolean>)(), false);
});

test('a fresh poll runs once the previous one has settled', async () => {
	let claimed = 0;
	const watcher = client({
		bridge: {
			claimWatchImport: async () => { claimed += 1; return null; },
			completeWatchImport: async () => undefined,
		},
	});

	const poll = watcher.pollNow as () => Promise<boolean>;
	await poll();
	await poll();

	assert.equal(claimed, 2, 'coalescing must not outlive the poll it coalesced onto');
});
