/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('public source deletion preserves PCM while another editor may hold it in Undo', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `public-delete-cross-tab-${Date.now()}-${Math.random()}`;
	const create = () => createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
	});
	const first = create();
	const other = create();
	try {
		const writer = await first.beginSourceWrite('undo-source', { sampleRate: 48_000 });
		await writer.write([Float32Array.of(0.25, 0.5)]);
		await writer.commit();
		assert.ok(await other.getSourceMetadata('undo-source'));

		await assert.rejects(() => first.deleteSource('undo-source'), /open editor session/u);
		assert.ok(await first.getSourceMetadata('undo-source'));
		assert.equal((await first.readSourceChunk('undo-source', 0))?.channels[0]?.[1], 0.5);

		await other.close();
		await first.deleteSource('undo-source');
		assert.equal(await first.getSourceMetadata('undo-source'), null);
	} finally {
		await other.close();
		await first.close();
	}
});

test('exact-generation source discard honors other sessions and durable roots', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `current-discard-retention-${Date.now()}-${Math.random()}`;
	const create = () => createProjectStore({
		indexedDB, memoryFallback: false, preferOpfs: false, databaseName,
	});
	const first = create();
	const other = create();
	try {
		const writer = await first.beginSourceWrite('current-source', { sampleRate: 48_000 });
		await writer.write([Float32Array.of(0.3)]);
		const expected = await writer.commit();
		assert.ok(await other.getSourceMetadata('current-source'));
		await assert.rejects(() => first.discardSourceIfCurrent(expected), /open editor session/u);
		assert.ok(await first.getSourceMetadata('current-source'));
		assert.equal((await first.readSourceChunk('current-source', 0))?.channels[0]?.[0], Math.fround(0.3));
		await other.close();

		await first.saveProject({
			id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
			revision: 1, updatedAt: '2026-09-24T00:00:00.000Z',
			sources: [{ id: 'current-source' }],
			clips: [{ id: 'clip-1', sourceId: 'current-source' }],
		});
		await assert.rejects(() => first.discardSourceIfCurrent(expected), /saved project or revision/u);
		assert.ok(await first.getSourceMetadata('current-source'));
		assert.equal((await first.readSourceChunk('current-source', 0))?.channels[0]?.[0], Math.fround(0.3));
		await first.deleteProject('project-1');
		assert.equal(await first.discardSourceIfCurrent(expected), true);
		assert.equal(await first.getSourceMetadata('current-source'), null);

		const replacement = await first.beginSourceWrite('current-source', { sampleRate: 48_000 });
		await replacement.write([Float32Array.of(0.9)]);
		const published = await replacement.commit();
		assert.equal(await first.discardSourceIfCurrent(expected), false);
		assert.deepEqual(await first.getSourceMetadata('current-source'), published);
	} finally {
		await other.close();
		await first.close();
	}
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`public source deletion preserves PCM referenced by a saved project revision in ${backend}`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName: `public-delete-saved-root-${backend}-${Date.now()}-${Math.random()}`,
		});
		try {
			const writer = await store.beginSourceWrite('saved-source', { sampleRate: 48_000 });
			await writer.write([Float32Array.of(0.75)]);
			await writer.commit();
			await store.saveProject({
				id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
				revision: 1, updatedAt: '2026-09-24T00:00:00.000Z',
				sources: [{ id: 'saved-source' }],
				clips: [{ id: 'clip-1', sourceId: 'saved-source' }],
			});
			await assert.rejects(() => store.deleteSource('saved-source'), /saved project or revision/u);
			assert.ok(await store.getSourceMetadata('saved-source'));
			await store.deleteProject('project-1');
			await store.deleteSource('saved-source');
			assert.equal(await store.getSourceMetadata('saved-source'), null);
		} finally {
			await store.close();
		}
	});
}

test('memory exact-generation discard preserves a saved project source', async () => {
	const store = createProjectStore({ indexedDB: null, memoryFallback: true, preferOpfs: false });
	try {
		const writer = await store.beginSourceWrite('saved-source', { sampleRate: 48_000 });
		await writer.write([Float32Array.of(0.625)]);
		const expected = await writer.commit();
		await store.saveProject({
			id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
			revision: 1, updatedAt: '2026-09-24T00:00:00.000Z',
			sources: [{ id: 'saved-source' }],
			clips: [{ id: 'clip-1', sourceId: 'saved-source' }],
		});
		await assert.rejects(() => store.discardSourceIfCurrent(expected), /saved project or revision/u);
		assert.equal((await store.readSourceChunk('saved-source', 0))?.channels[0]?.[0], 0.625);
		await store.deleteProject('project-1');
		assert.equal(await store.discardSourceIfCurrent(expected), true);
		assert.equal(await store.getSourceMetadata('saved-source'), null);
	} finally {
		await store.close();
	}
});
