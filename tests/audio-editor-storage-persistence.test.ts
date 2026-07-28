/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';

test('project storage reports and requests browser eviction protection explicitly', async () => {
	let persisted = false;
	const store = createProjectStore({
		indexedDB: {} as IDBFactory,
		databaseName: `storage-persistence-${Date.now()}`,
		storageManager: {
			estimate: async () => ({ usage: 25, quota: 100 }),
			persisted: async () => persisted,
			persist: async () => { persisted = true; return true; },
		},
	});

	assert.equal(store.supportsPersistentStorage(), true);
	assert.equal(await store.queryPersistentStorage(), false);
	assert.equal(await store.requestPersistentStorage(), true);
	assert.equal(await store.queryPersistentStorage(), true);
	assert.deepEqual(await store.estimateStorage(), { usage: 25, quota: 100 });
	await store.close();
});

test('project storage distinguishes unavailable persistence APIs from denial', async () => {
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `storage-persistence-unavailable-${Date.now()}`,
		storageManager: {},
	});
	await store.ready();

	assert.equal(store.supportsPersistentStorage(), false);
	assert.equal(await store.queryPersistentStorage(), null);
	assert.equal(await store.requestPersistentStorage(), false);
	await store.close();
});

test('memory fallback never claims eviction protection even when StorageManager grants it', async () => {
	let persistCalls = 0;
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `storage-persistence-memory-${Date.now()}`,
		storageManager: {
			persisted: async () => true,
			persist: async () => { persistCalls += 1; return true; },
		},
	});
	await store.ready();

	assert.equal(store.getStatus().backend, 'memory');
	assert.equal(store.supportsPersistentStorage(), false);
	assert.equal(await store.queryPersistentStorage(), null);
	assert.equal(await store.requestPersistentStorage(), false);
	assert.equal(persistCalls, 0);
	await store.close();
});

test('temporary cleanup preserves projects, revisions, originals, canonical PCM, derivatives, and active writes', async () => {
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `storage-safe-cleanup-${Date.now()}`,
		preferOpfs: false,
	});
	await store.ready();
	const canonical = await store.beginSourceWrite('canonical', {
		sampleRate: 48_000, channelCount: 1, chunkFrames: 1,
	});
	await canonical.write([Float32Array.of(0.25)]);
	await canonical.commit();
	await store.writeMediaAsset('canonical', new Blob(['original'], { type: 'audio/test' }));
	await store.saveVideoDerivative('canonical', {
		timestamp: 0, type: 'poster', blob: new Blob(['derivative']),
	} as never);
	await store.saveProject({ id: 'project', revision: 1, sources: [{ id: 'canonical' }] });
	await store.saveProject({ id: 'project', revision: 2, sources: [{ id: 'canonical' }] });
	const active = await store.beginSourceWrite('active', {
		sampleRate: 48_000, channelCount: 1, chunkFrames: 1,
	});
	await active.write([Float32Array.of(0.5)]);

	await store.cleanupTemporaryAssets();
	await active.write([Float32Array.of(0.75)]);
	await active.commit();

	assert.equal((await store.loadProject('project'))?.revision, 2);
	assert.deepEqual((await store.listProjectRevisions('project')).map(({ revision }) => revision), [2, 1]);
	assert.equal((await store.getSourceMetadata('canonical'))?.frameCount, 1);
	const canonicalChunks = [];
	for await (const chunk of store.readSourceChunks('canonical')) canonicalChunks.push(chunk.channels[0][0]);
	assert.deepEqual(canonicalChunks, [0.25]);
	const original = await store.loadMediaAsset('canonical');
	const derivative = await store.loadVideoDerivative('canonical', { timestamp: 0, type: 'poster' } as never);
	assert.ok(original);
	assert.ok(derivative);
	assert.equal(new TextDecoder().decode(await original.arrayBuffer()), 'original');
	assert.equal(new TextDecoder().decode(await derivative.arrayBuffer()), 'derivative');
	const activeChunks = [];
	for await (const chunk of store.readSourceChunks('active')) activeChunks.push(chunk.channels[0][0]);
	assert.deepEqual(activeChunks, [0.5, 0.75]);
	await store.close();
});
