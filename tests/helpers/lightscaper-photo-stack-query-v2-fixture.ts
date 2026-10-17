/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import type { PhotoDocumentV1 } from '../../src/lightscaper/catalog/types.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });

interface Statistics {
	readonly getRequests: readonly { readonly store: string; readonly key: string }[];
	readonly getAllRequests: readonly unknown[];
	readonly countRequests: readonly unknown[];
	readonly activeTransactions: number;
}
type Harness = Omit<ReturnType<typeof createInstrumentedIndexedDB>, 'stats'> & { readonly stats: Statistics };

export async function stackMetadataQueryFixtureV2(count = 130, patch: (index: number, photo: PhotoDocumentV1) => Record<string, unknown> = () => ({})) {
	const indexedDB = createInstrumentedIndexedDB() as Harness, factory = indexedDB as unknown as IDBFactory, databaseName = crypto.randomUUID();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName, verifyOriginal: async () => undefined });
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Metadata collapsed library', revision: 0, photoCount: 0, folders: [{ id: 'folder', name: 'Travel', parentId: null }],
		keywords: [{ id: 'keyword', name: 'Selected', parentId: null }], collections: [] });
	await repository.createCatalog(root);
	for (let offset = 0; offset < count; offset += 16) {
		root = await repository.publishPhotos(root.id, root.revision, Array.from({ length: Math.min(16, count - offset) }, (_, delta) => {
			const index = offset + delta + 1, source = photoArchiveFixture(index).photo;
			return normalizePhotoDocumentV1({ ...source, metadata: { ...source.metadata, fileName: `Photo ${String(index).padStart(4, '0')}.png`,
				cameraMake: 'Effective camera', iso: index === count ? 800 : 200 }, ...patch(index, source) });
		}));
	}
	const database = await openPhotoCatalogDatabaseV1(factory, databaseName, () => undefined);
	return { indexedDB, factory, databaseName, database, repository, root, count,
		async group(photoIds: readonly string[], coverPhotoId: string, stackId = 'stack', stateRevision = 0) {
			return repository.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id,
				id: stackId, revision: 0, photoIds, coverPhotoId }), null,
			{ expectedCatalogRevision: root.revision + stateRevision, expectedStateRevision: stateRevision });
		},
		async close() { database.close(); await repository.close(); } };
}

export async function mutateStackQueryStoreV2(database: IDBDatabase, storeName: string, operation: (store: IDBObjectStore) => void): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(storeName, 'readwrite');
		transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('Raw query witness mutation failed.'));
		operation(transaction.objectStore(storeName));
	});
}
