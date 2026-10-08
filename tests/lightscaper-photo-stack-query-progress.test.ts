/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { readPhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-pages-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
type Harness = Omit<ReturnType<typeof createInstrumentedIndexedDB>, 'stats'> & { readonly stats: {
	readonly countRequests: readonly { readonly store: string }[]; readonly activeTransactions: number;
} };

async function fixture(pairs = false) {
	const indexedDB = createInstrumentedIndexedDB() as Harness, factory = indexedDB as unknown as IDBFactory, databaseName = crypto.randomUUID();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName, verifyOriginal: async () => undefined });
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Progress witness', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.createCatalog(root);
	for (let offset = 0; offset < 130; offset += 16) {
		root = await repository.publishPhotos(root.id, root.revision, Array.from({ length: Math.min(16, 130 - offset) }, (_, index) => {
			const source = photoArchiveFixture(offset + index + 1).photo;
			return normalizePhotoDocumentV1({ ...source, metadata: { ...source.metadata,
				fileName: `Photo ${String(offset + index + 1).padStart(4, '0')}.png` } });
		}));
	}
	await repository.rebuildQueryIndexPage(root.id);
	for (let group = 0; group < (pairs ? 65 : 1); group++) {
		const photoIds = pairs ? [`photo-${String(group * 2 + 1)}`, `photo-${String(group * 2 + 2)}`]
			: Array.from({ length: 130 }, (_, index) => `photo-${String(index + 1)}`);
		await repository.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', id: `stack-${String(group).padStart(3, '0')}`, catalogId: root.id,
			revision: 0, photoIds, coverPhotoId: photoIds[0] }), null,
		{ expectedCatalogRevision: root.revision + group, expectedStateRevision: group });
	}
	const database = await openPhotoCatalogDatabaseV1(factory, databaseName, () => undefined);
	return { indexedDB, factory, databaseName, database, repository, root,
		close: async () => { database.close(); await repository.close(); } };
}
const query = { text: '', filter: null, sort: { field: 'file-name' as const, direction: 'ascending' as const } };

test('altered progress cannot skip membership authentication before a cover is published', async () => {
	const f = await fixture();
	try {
		const first = await readPhotoStackQueryPageV1(f.database, f.root.id, { query });
		assert.equal(first.items.length, 0); assert.ok(first.continuation?.pending);
		const forged = { ...first.continuation, pending: { ...first.continuation.pending, nextMember: 130 } };
		await assert.rejects(readPhotoStackQueryPageV1(f.database, f.root.id, { query, continuation: forged }), /progress|signature|authentication/iu);
	} finally { await f.close(); }
});

test('a continuation from another connection identity cannot authorize a member position', async () => {
	const f = await fixture();
	// The fake factory reuses one database object; give this unit witness a distinct connection identity.
	// The browser witness uses two actual native IDBDatabase connections.
	const other = new Proxy(f.database, {});
	try {
		const first = await readPhotoStackQueryPageV1(f.database, f.root.id, { query }); assert.ok(first.continuation);
		await assert.rejects(readPhotoStackQueryPageV1(other, f.root.id, { query, continuation: first.continuation }), /progress|signature|authentication/iu);
		let continuation = first.continuation, representative = false;
		for (let step = 0; step < 4 && !representative; step++) {
			const next = await readPhotoStackQueryPageV1(f.database, f.root.id, { query, continuation });
			representative = next.items.some(item => item.photoId === 'photo-1');
			assert.ok(next.scanned <= 64); assert.ok(next.continuation); continuation = next.continuation;
		}
		assert.equal(representative, true, 'authentic progress remains resumable on its original connection');
	} finally { await f.close(); }
});

test('stack count authentication resumes in bounded key pages before publishing any photo, without native count scans', async () => {
	const f = await fixture(true);
	try {
		const before = f.indexedDB.stats.countRequests.length;
		const first = await readPhotoStackQueryPageV1(f.database, f.root.id, { query });
		assert.deepEqual(first.items, []); assert.equal(first.scanned, 64); assert.ok(first.continuation);
		assert.equal(first.continuation.pending, null);
		assert.deepEqual(f.indexedDB.stats.countRequests.slice(before).filter(row => row.store === 'photoStacks'), []);
		const second = await readPhotoStackQueryPageV1(f.database, f.root.id, { query, continuation: first.continuation });
		assert.ok(second.items.length > 0); assert.ok(second.scanned <= 64);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});
