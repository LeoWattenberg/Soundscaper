/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { MediaAssetDisposalRepository } from '../src/common/editor/storage/media-asset-disposal-repository.ts';
import type { MediaAssetStagingIdentity } from '../src/common/editor/storage/media-asset-staging-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';

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

function memoryPort(name: string): StorageRepositoryPort {
	return {
		memory: getMemoryDatabase(`${name}-${crypto.randomUUID()}`),
		async database() { return null; },
	};
}
