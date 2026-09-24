/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`owned media rollback preserves another editor's unsaved source in ${backend}`, async () => {
		const options = storeOptions(backend);
		const first = createProjectStore(options);
		const other = createProjectStore(options);
		try {
			const publication = await publish(first, 'unsaved-media');
			await other.ready();
			await assert.rejects(publication.discardIfCurrent(), /another open editor session/iu);
			assert.ok(await other.loadMediaAsset('unsaved-media'));

			await other.close();
			assert.equal(await publication.discardIfCurrent(), true);
			assert.equal(await first.loadMediaAsset('unsaved-media'), null);
		} finally {
			await other.close();
			await first.close();
		}
	});

	test(`owned media rollback preserves a saved project source in ${backend}`, async () => {
		const store = createProjectStore(storeOptions(backend));
		try {
			const publication = await publish(store, 'saved-media');
			await store.saveProject({
				id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
				revision: 1, updatedAt: '2026-09-24T00:00:00.000Z',
				sources: [{ id: 'saved-media' }],
				clips: [{ id: 'clip-1', sourceId: 'saved-media' }],
			});
			await assert.rejects(publication.discardIfCurrent(), /saved project or revision/iu);
			assert.ok(await store.loadMediaAsset('saved-media'));

			await store.deleteProject('project-1');
			assert.equal(await publication.discardIfCurrent(), true);
			assert.equal(await store.loadMediaAsset('saved-media'), null);
		} finally {
			await store.close();
		}
	});
}

function storeOptions(backend: 'memory' | 'indexeddb') {
	return {
		indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
		memoryFallback: backend === 'memory',
		preferOpfs: false,
		databaseName: `owned-media-retention-${backend}-${crypto.randomUUID()}`,
	};
}

async function publish(store: ReturnType<typeof createProjectStore>, sourceId: string) {
	const bytes = Uint8Array.of(1, 2, 3, 4);
	const writer = await store.beginMediaAssetWrite(sourceId, {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
	});
	await writer.write(bytes);
	return writer.commitOwned();
}
