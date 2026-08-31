/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { MediaAssetDisposalRepository } from '../src/common/editor/storage/media-asset-disposal-repository.ts';
import type { MediaAssetStagingIdentity } from '../src/common/editor/storage/media-asset-staging-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('disposal preserves a chunk token leased by a foreign media writer', async () => {
	const port = memoryPort('durable-chunk-lease');
	port.memory.mediaAssetChunks.set('foreign-token:0', {
		key: 'foreign-token:0',
		sourceId: 'foreign-owner',
		mediaChunkToken: 'foreign-token',
	});
	const observed: MediaAssetStagingIdentity[] = [];
	const disposal = new MediaAssetDisposalRepository(
		port,
		new MediaAssetChunkRecords(port),
		() => new Set(),
		async (identity) => {
			observed.push(identity);
			return identity.mediaChunkToken === 'foreign-token';
		},
	);
	const record = {
		sourceId: 'foreign-owner',
		storage: 'indexeddb-media-chunks-v1',
		mediaChunkToken: 'foreign-token',
	};

	assert.strictEqual(await disposal.prepare(record), record);
	assert.equal(port.memory.mediaAssetChunks.size, 1);
	assert.deepEqual(observed, [{ mediaChunkToken: 'foreign-token' }]);
});

test('disposal preserves an OPFS path leased by a foreign media writer', async () => {
	const port = memoryPort('durable-path-lease');
	const observed: MediaAssetStagingIdentity[] = [];
	const disposal = new MediaAssetDisposalRepository(
		port,
		new MediaAssetChunkRecords(port),
		() => new Set(),
		async (identity) => {
			observed.push(identity);
			return identity.path === 'foreign-staging.opus';
		},
	);

	assert.equal(await disposal.prepare({
		sourceId: 'attacker',
		storage: 'opfs',
		path: 'foreign-staging.opus',
	}), null);
	assert.deepEqual(observed, [{ path: 'foreign-staging.opus' }]);
});

test('stale media chunk cleanup pages multiple records through each read transaction', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `stale-media-chunk-pages-${crypto.randomUUID()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const port: StorageRepositoryPort = {
		memory: getMemoryDatabase(databaseName),
		async database() { return database; },
	};
	for (let index = 0; index < 9; index += 1) {
		indexedDB.seedRecord(databaseName, 'mediaAssetChunks', {
			key: `stale-token:${String(index).padStart(10, '0')}`,
			mediaChunkToken: 'stale-token',
			createdAt: 0,
		});
	}

	await new MediaAssetChunkRecords(port).cleanupStale(new Set(), 1);

	assert.equal(indexedDB.recordCount(databaseName, 'mediaAssetChunks'), 0);
	assert.equal(indexedDB.stats.cursorRequests.filter(({ store, index }: {
		store: string;
		index: string | null;
	}) => store === 'mediaAssetChunks' && index === null).length, 3);
});

function memoryPort(name: string): StorageRepositoryPort {
	return {
		memory: getMemoryDatabase(`${name}-${crypto.randomUUID()}`),
		async database() { return null; },
	};
}
