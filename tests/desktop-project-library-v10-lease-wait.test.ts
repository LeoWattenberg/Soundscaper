/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	acquireProjectLibraryV10LeaseWithWait,
} from '../desktop/project-library-v10-lease-wait.ts';

test('an available lease is acquired without waiting', async () => {
	let calls = 0;
	const startedAt = Date.now();
	const lease = await acquireProjectLibraryV10LeaseWithWait(() => {
		calls += 1;
		return 'lease';
	}, { waitMs: 5_000 });

	assert.equal(lease, 'lease');
	assert.equal(calls, 1);
	assert.ok(Date.now() - startedAt < 1_000);
});

test('a lease a crashed owner left behind is waited out rather than failing startup', async () => {
	// The previous owner's lease is unexpired until it ages out, so acquisition keeps
	// refusing until then. Startup has to outlast that instead of exiting first.
	let calls = 0;
	const lease = await acquireProjectLibraryV10LeaseWithWait(() => {
		calls += 1;
		if (calls < 3) throw new Error('Soundscaper desktop V10 writer lease is busy');
		return 'lease';
	}, { waitMs: 5_000, pollIntervalMs: 10 });

	assert.equal(lease, 'lease');
	assert.equal(calls, 3);
});

test('a locked library database is waited out as transient contention', async () => {
	let calls = 0;
	const lease = await acquireProjectLibraryV10LeaseWithWait(() => {
		calls += 1;
		if (calls < 3) throw sqliteBusy();
		return 'lease';
	}, { waitMs: 5_000, pollIntervalMs: 10 });

	assert.equal(lease, 'lease');
	assert.equal(calls, 3);
});

test('a failure that is not contention surfaces without consuming the wait window', async () => {
	// A corrupt lease row throws the same way on every attempt, so retrying it only
	// delays startup by the whole wait before reporting what the first attempt saw.
	let calls = 0;
	const startedAt = Date.now();
	await assert.rejects(
		() => acquireProjectLibraryV10LeaseWithWait(() => {
			calls += 1;
			throw new TypeError('Persisted Soundscaper desktop V10 lease expiry is invalid');
		}, { waitMs: 5_000, pollIntervalMs: 10 }),
		/lease expiry is invalid/u,
	);
	assert.equal(calls, 1);
	assert.ok(Date.now() - startedAt < 1_000);
});

test('a lease still held past the wait reports the acquisition failure it saw', async () => {
	let calls = 0;
	await assert.rejects(
		() => acquireProjectLibraryV10LeaseWithWait(() => {
			calls += 1;
			throw new Error('Soundscaper desktop V10 writer lease is busy');
		}, { waitMs: 30, pollIntervalMs: 10 }),
		/writer lease is busy/iu,
	);
	assert.ok(calls > 1, 'the acquisition is retried before the deadline');
});

test('a zero wait keeps the original single-attempt behaviour', async () => {
	let calls = 0;
	await assert.rejects(
		() => acquireProjectLibraryV10LeaseWithWait(() => {
			calls += 1;
			throw new Error('Soundscaper desktop V10 writer lease is busy');
		}, { waitMs: 0 }),
		/busy/iu,
	);
	assert.equal(calls, 1);
});

test('an unusable wait or poll interval is refused', async () => {
	for (const options of [
		{ waitMs: -1 },
		{ waitMs: 1.5 },
		{ waitMs: 600_001 },
		{ waitMs: 100, pollIntervalMs: -1 },
	]) {
		await assert.rejects(
			() => acquireProjectLibraryV10LeaseWithWait(() => 'lease', options),
			/milliseconds/iu,
		);
	}
});

function sqliteBusy(): Error {
	return Object.assign(new Error('database is locked'), {
		code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked',
	});
}
