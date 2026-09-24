/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('public media deletion preserves an asset while another editor may hold it in Undo', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `public-media-delete-cross-tab-${crypto.randomUUID()}`;
	const create = () => createProjectStore({
		indexedDB, databaseName, memoryFallback: false, preferOpfs: false,
	});
	const first = create();
	const other = create();
	try {
		await first.writeMediaAsset('undo-media', new Blob(['original media']));
		assert.ok(await other.getMediaAssetMetadata('undo-media'));

		await assert.rejects(() => first.deleteMediaAsset('undo-media'), /open editor session/u);
		assert.ok(await first.getMediaAssetMetadata('undo-media'));
		const retained = await other.loadMediaAsset('undo-media');
		assert.ok(retained);
		assert.equal(new TextDecoder().decode(await retained.arrayBuffer()), 'original media');

		await other.close();
		await first.deleteMediaAsset('undo-media');
		assert.equal(await first.getMediaAssetMetadata('undo-media'), null);
	} finally {
		await other.close();
		await first.close();
	}
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`public media deletion preserves an asset referenced by a saved project in ${backend}`, async () => {
		const store = createProjectStore({
			indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName: `public-media-delete-saved-root-${backend}-${crypto.randomUUID()}`,
		});
		try {
			await store.writeMediaAsset('saved-media', new Blob(['saved original']));
			await store.saveProject({
				id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
				revision: 1, updatedAt: '2026-09-24T00:00:00.000Z',
				sources: [{ id: 'saved-media' }],
				clips: [{ id: 'clip-1', sourceId: 'saved-media' }],
			});
			await assert.rejects(() => store.deleteMediaAsset('saved-media'), /saved project or revision/u);
			assert.ok(await store.getMediaAssetMetadata('saved-media'));
			await store.deleteProject('project-1');
			await store.deleteMediaAsset('saved-media');
			assert.equal(await store.getMediaAssetMetadata('saved-media'), null);
		} finally {
			await store.close();
		}
	});
}
