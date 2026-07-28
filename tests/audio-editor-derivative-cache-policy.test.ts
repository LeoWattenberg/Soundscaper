/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	planDerivativeCacheEviction,
} from '../src/common/editor/storage/derivative-cache-policy.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';

test('derivative cache policy evicts the oldest committed records until both hard limits hold', () => {
	const plan = planDerivativeCacheEviction([
		record('newer-b', 30, '2026-07-03T00:00:00.000Z'),
		record('oldest', 40, '2026-07-01T00:00:00.000Z'),
		record('newer-a', 30, '2026-07-02T00:00:00.000Z'),
	], {
		maximumBytes: 60,
		maximumEntries: 2,
	});

	assert.deepEqual(plan.removals.map(({ key }) => key), ['oldest']);
	assert.deepEqual(plan.before, { bytes: 100, entries: 3 });
	assert.deepEqual(plan.after, { bytes: 60, entries: 2 });
	assert.equal(plan.removedBytes, 40);
});

test('derivative cache policy removes expired records before applying size and count limits', () => {
	const plan = planDerivativeCacheEviction([
		record('fresh', 20, '2026-07-28T10:00:00.000Z'),
		record('expired-b', 10, '2026-06-01T00:00:00.000Z'),
		record('expired-a', 10, '2026-06-01T00:00:00.000Z'),
	], {
		maximumBytes: 100,
		maximumEntries: 10,
		maximumAgeMs: 30 * 24 * 60 * 60 * 1000,
		now: Date.parse('2026-07-28T12:00:00.000Z'),
	});

	assert.deepEqual(plan.removals.map(({ key }) => key), ['expired-a', 'expired-b']);
	assert.deepEqual(plan.after, { bytes: 20, entries: 1 });
});

test('zero derivative cache limits produce a deterministic complete-cache cleanup plan', () => {
	const plan = planDerivativeCacheEviction([
		record('b', 2, '2026-07-28T00:00:00.000Z'),
		record('a', 1, '2026-07-28T00:00:00.000Z'),
	], { maximumBytes: 0, maximumEntries: 0 });

	assert.deepEqual(plan.removals.map(({ key }) => key), ['a', 'b']);
	assert.deepEqual(plan.after, { bytes: 0, entries: 0 });
});

test('derivative cache policy rejects corrupt accounting and unsafe totals without deleting anything', () => {
	assert.throws(
		() => planDerivativeCacheEviction([record('bad-size', -1, '2026-07-28T00:00:00.000Z')], {
			maximumBytes: 10,
			maximumEntries: 1,
		}),
		/size must be a non-negative safe integer/u,
	);
	assert.throws(
		() => planDerivativeCacheEviction([
			record('large-a', Number.MAX_SAFE_INTEGER, '2026-07-28T00:00:00.000Z'),
			record('large-b', 1, '2026-07-28T00:00:00.000Z'),
		], { maximumBytes: Number.MAX_SAFE_INTEGER, maximumEntries: 2 }),
		/total exceeds the supported safe integer range/u,
	);
	assert.throws(
		() => planDerivativeCacheEviction([record('a', 1, '2026-07-28T00:00:00.000Z')], {
			maximumBytes: 1,
			maximumEntries: -1,
		}),
		/maximumEntries must be a non-negative safe integer/u,
	);
});

test('derivative cleanup compare-and-delete preserves a replacement published after its snapshot', async () => {
	const memory = getMemoryDatabase(`derivative-cache-race-${Date.now()}-${Math.random()}`);
	const key = JSON.stringify(['source', 'poster', 0]);
	memory.videoDerivatives.set(key, {
		key, sourceId: 'source', timestamp: 0, type: 'poster', size: 4,
		storage: 'indexeddb-blob', blob: new Blob(['old!']), cacheToken: 'old-token',
		committedAt: '2026-07-28T00:00:00.000Z',
	});
	let databaseCalls = 0;
	const media = new MediaRepository({
		memory,
		database: async () => {
			databaseCalls += 1;
			if (databaseCalls === 2) {
				memory.videoDerivatives.set(key, {
					key, sourceId: 'source', timestamp: 0, type: 'poster', size: 4,
					storage: 'indexeddb-blob', blob: new Blob(['new!']), cacheToken: 'new-token',
					committedAt: '2026-07-28T00:00:00.000Z',
				});
			}
			return null;
		},
	}, new OpfsRepository({ preferOpfs: false }));

	const report = await media.trimDerivatives({ maximumBytes: 0, maximumEntries: 0 });

	assert.equal(report.removedEntries, 0);
	assert.equal(report.skippedEntries, 1);
	assert.equal(report.satisfied, false);
	const loaded = await media.loadDerivative('source', { timestamp: 0, type: 'poster' });
	assert.ok(loaded);
	assert.equal(new TextDecoder().decode(await loaded.arrayBuffer()), 'new!');
});

function record(key: string, size: number, committedAt: string) {
	return Object.freeze({ key, size, committedAt });
}
