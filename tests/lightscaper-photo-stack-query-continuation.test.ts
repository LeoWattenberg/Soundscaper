/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { readPhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-pages-v1.ts';
import { PHOTO_STACK_QUERY_LIMITS_V1, type PhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import type { PhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const ordinary: PhotoCatalogQueryV1 = { text: '', filter: null, sort: { field: 'file-name', direction: 'ascending' } };
type Harness = Omit<ReturnType<typeof createInstrumentedIndexedDB>, 'stats'> & { stats: {
	readonly activeTransactions: number; readonly getAllRequests: readonly unknown[];
	readonly getRequests: readonly { readonly store: string; readonly key: string }[];
} };

async function fixture(count: number, mixedCapture = false) {
	const indexedDB = createInstrumentedIndexedDB() as Harness, databaseName = crypto.randomUUID();
	const factory = indexedDB as unknown as IDBFactory;
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName, verifyOriginal: async () => undefined });
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Resumable stack', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.createCatalog(root);
	for (let offset = 0; offset < count; offset += 16) {
		const photos = Array.from({ length: Math.min(16, count - offset) }, (_, n) => {
			const index = offset + n + 1, source = photoArchiveFixture(index).photo;
			const local = new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString().slice(0, 19);
			return normalizePhotoDocumentV1({ ...source, rating: index === count ? 5 : 4, metadata: { ...source.metadata,
				fileName: `Photo ${String(index).padStart(4, '0')}.png`, captureTime: mixedCapture && index % 3 !== 0 ? { local, offsetMinutes: null } : null } });
		});
		root = await repository.publishPhotos(root.id, root.revision, photos);
	}
	await repository.rebuildQueryIndexPage(root.id);
	const database = await openPhotoCatalogDatabaseV1(factory, databaseName, () => undefined);
	return { indexedDB, repository, database, root, count,
		close: async () => { database.close(); await repository.close(); } };
}
async function group(f: Awaited<ReturnType<typeof fixture>>, cover: string, reverse = false) {
	const ids = Array.from({ length: f.count }, (_, n) => `photo-${String(n + 1)}`);
	await f.repository.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId: f.root.id, id: 'stack', revision: 0,
		photoIds: reverse ? ids.reverse() : ids, coverPhotoId: cover }, null,
	{ expectedCatalogRevision: f.root.revision, expectedStateRevision: 0 });
}
async function deleteRow(database: IDBDatabase, storeName: string, photoId: string) {
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(storeName, 'readwrite');
		transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
		transaction.objectStore(storeName).delete(`catalog-1|${photoId}`);
	});
}
function bounded(f: Awaited<ReturnType<typeof fixture>>, page: PhotoStackQueryPageV1, before: number) {
	assert.ok(page.scanned > 0 && page.scanned <= PHOTO_STACK_QUERY_LIMITS_V1.candidates);
	assert.ok(page.items.length <= 64); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
	assert.ok(f.indexedDB.stats.getRequests.slice(before).filter(row => row.store === 'photoQueryRows').length <= 64);
	if (page.continuation) assert.ok(new TextEncoder().encode(JSON.stringify(page.continuation)).byteLength <= 4096);
}

for (const storeName of ['photoStackMemberships', 'photoQueryRows']) {
	test(`eligible cover authenticates beyond the first64 probes before output; resumed missing ${storeName} refuses`, async () => {
		const f = await fixture(130);
		try {
			await group(f, 'photo-1'); const before = f.indexedDB.stats.getRequests.length;
			const first = await readPhotoStackQueryPageV1(f.database, f.root.id, { query: ordinary }); bounded(f, first, before);
			assert.deepEqual(first.items, []); assert.ok(first.continuation?.pending);
			assert.ok(first.continuation.pending.nextMember > 0 && first.continuation.pending.nextMember < 100);
			assert.equal(f.indexedDB.stats.getRequests.slice(before).some(row => row.store === storeName && row.key === 'catalog-1|photo-100'), false);
			await deleteRow(f.database, storeName, 'photo-100');
			await assert.rejects(readPhotoStackQueryPageV1(f.database, f.root.id, { query: ordinary, continuation: first.continuation }), /membership|reverse|missing/iu);
		} finally { await f.close(); }
	});
}

test('eligible cover is emitted only after all130 members have authenticated across bounded empty steps', async () => {
	const f = await fixture(130);
	try {
		await group(f, 'photo-1'); const inspectionStart = f.indexedDB.stats.getRequests.length;
		let continuation: PhotoStackQueryPageV1['continuation'] = null;
		const ids: string[] = []; let steps = 0;
		do {
			const before = f.indexedDB.stats.getRequests.length;
			const page = await readPhotoStackQueryPageV1(f.database, f.root.id, { query: ordinary, continuation }); bounded(f, page, before);
			ids.push(...page.items.map(row => row.photoId)); continuation = page.continuation; steps++;
			if (ids.length) break;
			assert.ok(continuation?.pending); assert.ok(steps < 10);
		} while (continuation);
		assert.deepEqual(ids, ['photo-1']); assert.ok(steps >= 3);
		const checked = new Set(f.indexedDB.stats.getRequests.slice(inspectionStart).filter(row => row.store === 'photoStackMemberships').map(row => row.key));
		for (let n = 1; n <= 130; n++) assert.ok(checked.has(`catalog-1|photo-${String(n)}`));
	} finally { await f.close(); }
});

test('dense1024-member reversed-order fallback follows global capture order with unknown dates last both ways', async () => {
	const f = await fixture(1024, true);
	try {
		await group(f, 'photo-1024', true);
		for (const direction of ['ascending', 'descending'] as const) {
			const query: PhotoCatalogQueryV1 = { text: '', filter: { kind: 'rating', value: 4 }, sort: { field: 'capture-time', direction } };
			let continuation: PhotoStackQueryPageV1['continuation'] = null; const ids: string[] = []; let steps = 0;
			do {
				const before = f.indexedDB.stats.getRequests.length;
				const page = await readPhotoStackQueryPageV1(f.database, f.root.id, { query, continuation }); bounded(f, page, before);
				ids.push(...page.items.map(row => row.photoId)); continuation = page.continuation; steps++;
				if (ids.length) break;
				assert.ok(continuation?.pending); assert.ok(steps < 25);
			} while (continuation);
			assert.deepEqual(ids, [direction === 'ascending' ? 'photo-1' : 'photo-1022']); assert.ok(steps >= 17);
		}
	} finally { await f.close(); }
});

test('cancellation during an actual pending fake-IDB member request rejects without output and joins its transaction', async () => {
	const f = await fixture(130), stop = new AbortController(), reason = new DOMException('Stop this query.', 'AbortError');
	try {
		await group(f, 'photo-1'); let observed = false;
		f.indexedDB.onNextGetForStore('photoQueryRows', () => {
			assert.equal(f.indexedDB.stats.activeTransactions, 1); observed = true; stop.abort(reason);
		});
		await assert.rejects(readPhotoStackQueryPageV1(f.database, f.root.id, { query: ordinary, signal: stop.signal }), error => error === reason);
		assert.equal(observed, true); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		const retry = await readPhotoStackQueryPageV1(f.database, f.root.id, { query: ordinary });
		assert.deepEqual(retry.items, []); assert.ok(retry.continuation?.pending);
	} finally { await f.close(); }
});
