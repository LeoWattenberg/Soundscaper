/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { readPhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-pages-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import type { PhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';

type Harness = Omit<ReturnType<typeof createInstrumentedIndexedDB>, 'stats'> & { readonly stats: {
	readonly getRequests: readonly { readonly store: string }[]; readonly getAllRequests: readonly unknown[];
	readonly activeTransactions: number;
} };
const ordinary: PhotoCatalogQueryV1 = { text: '', filter: null, sort: { field: 'file-name', direction: 'ascending' } };
Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });

async function fixture(count = 130, patch: (index: number) => Record<string, unknown> = () => ({})) {
	const indexedDB = createInstrumentedIndexedDB() as Harness, databaseName = crypto.randomUUID();
	const factory = indexedDB as unknown as IDBFactory;
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName, verifyOriginal: async () => undefined });
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Collapsed library', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: 'Travel', parentId: null }], keywords: [{ id: 'keyword', name: 'Selected', parentId: null }], collections: [] });
	await repository.createCatalog(root);
	for (let offset = 0; offset < count; offset += 16) {
		const photos = Array.from({ length: Math.min(16, count - offset) }, (_, n) => {
			const index = offset + n + 1, source = photoArchiveFixture(index).photo;
			return normalizePhotoDocumentV1({ ...source, metadata: { ...source.metadata, fileName: `Photo ${String(index).padStart(4, '0')}.png` }, ...patch(index) });
		});
		root = await repository.publishPhotos(root.id, root.revision, photos);
	}
	await repository.rebuildQueryIndexPage(root.id);
	const database = await openPhotoCatalogDatabaseV1(factory, databaseName, () => undefined);
	return { indexedDB, repository, database, root,
		close: async () => { database.close(); await repository.close(); } };
}

async function saveStack(f: Awaited<ReturnType<typeof fixture>>, photoIds: readonly string[], coverPhotoId: string) {
	return f.repository.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: f.root.id,
		id: 'stack', revision: 0, photoIds, coverPhotoId }), null, { expectedCatalogRevision: f.root.revision, expectedStateRevision: 0 });
}

async function collect(f: Awaited<ReturnType<typeof fixture>>, query = ordinary) {
	const ids: string[] = [], steps = [];
	let continuation = null as Awaited<ReturnType<typeof readPhotoStackQueryPageV1>>['continuation'];
	do {
		const page = await readPhotoStackQueryPageV1(f.database, f.root.id, { query, continuation });
		assert.ok(page.scanned <= 64); assert.ok(page.items.length <= 64);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
		ids.push(...page.items.map(item => item.photoId)); steps.push(page); continuation = page.continuation;
		assert.ok(steps.length < 1_100, 'bounded continuation must make progress');
	} while (continuation !== null);
	return { ids, steps };
}

test('collapsed queries choose the eligible cover once across distant pages in global sort order', async () => {
	const f = await fixture();
	try {
		await saveStack(f, ['photo-1', 'photo-65', 'photo-129'], 'photo-129');
		const before = f.indexedDB.stats.getRequests.length, result = await collect(f);
		const expected = Array.from({ length: 130 }, (_, n) => `photo-${String(n + 1)}`).filter(id => !['photo-1', 'photo-65'].includes(id));
		assert.deepEqual(result.ids, expected); assert.equal(new Set(result.ids).size, result.ids.length);
		assert.ok(result.steps.length >= 3);
		assert.deepEqual(f.indexedDB.stats.getRequests.slice(before).filter(row => row.store === 'photos'), []);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
	} finally { await f.close(); }
});

test('a filtered cover falls back to the first matching member in the global order in both directions', async () => {
	const f = await fixture(130, index => ({ rating: index === 129 ? 5 : 4 }));
	try {
		await saveStack(f, ['photo-65', 'photo-129', 'photo-1'], 'photo-129');
		for (const direction of ['ascending', 'descending'] as const) {
			const query = { ...ordinary, filter: { kind: 'rating' as const, value: 4 }, sort: { ...ordinary.sort, direction } };
			const result = await collect(f, query), winner = direction === 'ascending' ? 'photo-1' : 'photo-65';
			const expected = Array.from({ length: 130 }, (_, n) => `photo-${String(n + 1)}`)
				.filter(id => id !== 'photo-129' && (!['photo-1', 'photo-65'].includes(id) || id === winner));
			assert.deepEqual(result.ids, direction === 'ascending' ? expected : expected.reverse());
		}
	} finally { await f.close(); }
});

test('large-stack representative probes resume through empty steps within the same64-candidate budget', async () => {
	const f = await fixture(130, index => {
		const metadata = photoArchiveFixture(index).photo.metadata;
		return { metadata: { ...metadata, fileName: `Photo ${String(index).padStart(4, '0')}.png`, title: index === 1 ? 'Needle' : '' } };
	});
	try {
		await saveStack(f, Array.from({ length: 130 }, (_, index) => `photo-${String(index + 1)}`), 'photo-130');
		const result = await collect(f, { ...ordinary, text: 'needle' });
		assert.deepEqual(result.ids, ['photo-1']);
		assert.ok(result.steps.some(step => step.items.length === 0 && step.continuation !== null));
		assert.ok(result.steps.some(step => step.continuation?.pending !== null));
		for (const page of result.steps) assert.ok(new TextEncoder().encode(JSON.stringify(page.continuation)).byteLength <= 4_096);
	} finally { await f.close(); }
});

test('capture-time fallback keeps unknown dates last for ascending and descending queries', async () => {
	const f = await fixture(4, index => {
		const metadata = photoArchiveFixture(index).photo.metadata;
		return { rating: index === 4 ? 5 : 4, metadata: { ...metadata, captureTime: index === 3 ? null
			: { local: `2026-10-0${String(index)}T12:00:00.000`, offsetMinutes: null } } };
	});
	try {
		await saveStack(f, ['photo-3', 'photo-1', 'photo-4', 'photo-2'], 'photo-4');
		for (const direction of ['ascending', 'descending'] as const) {
			const result = await collect(f, { text: '', filter: { kind: 'rating', value: 4 }, sort: { field: 'capture-time', direction } });
			assert.deepEqual(result.ids, [direction === 'ascending' ? 'photo-1' : 'photo-2']);
		}
	} finally { await f.close(); }
});

test('stack member eligibility uses the same folder, keyword and text predicate as the ordinary query', async () => {
	const f = await fixture(3, index => ({ folderId: index === 3 ? null : 'folder', keywordIds: index === 3 ? [] : ['keyword'] }));
	try {
		await saveStack(f, ['photo-2', 'photo-1', 'photo-3'], 'photo-3');
		for (const query of [{ ...ordinary, filter: { kind: 'folder' as const, id: 'folder' } },
			{ ...ordinary, filter: { kind: 'keyword' as const, id: 'keyword' } }, { ...ordinary, text: 'selected' }]) {
			assert.deepEqual((await collect(f, query)).ids, ['photo-1']);
		}
	} finally { await f.close(); }
});

test('pending and ordinary collapsed cursors reject photo or stack revisions and different queries', async () => {
	for (const owner of ['photo', 'stack'] as const) {
		const f = await fixture();
		try {
			const stack = await saveStack(f, Array.from({ length: 130 }, (_, index) => `photo-${String(index + 1)}`), 'photo-130');
			const query = { ...ordinary, text: 'photo 0001' }, page = await readPhotoStackQueryPageV1(f.database, f.root.id, { query });
			assert.ok(page.continuation?.pending);
			await assert.rejects(readPhotoStackQueryPageV1(f.database, f.root.id, { query: ordinary, continuation: page.continuation }), /query/iu);
			if (owner === 'photo') {
				const photo = await f.repository.loadPhoto(f.root.id, 'photo-1'); assert.ok(photo);
				await f.repository.savePhoto({ ...photo, rating: 5 }, photo.revision);
			} else { await f.repository.saveStack({ ...stack, coverPhotoId: 'photo-1' }, stack.revision,
				{ expectedCatalogRevision: f.root.revision + 1, expectedStateRevision: 1 }); }
			await assert.rejects(readPhotoStackQueryPageV1(f.database, f.root.id, { query, continuation: page.continuation }), /revision/iu);
		} finally { await f.close(); }
	}
});

test('hostile collapsed query options and pre-cancellation refuse without reading any catalog rows', async () => {
	const f = await fixture(2);
	try {
		const before = f.indexedDB.stats.getRequests.length;
		await assert.rejects(readPhotoStackQueryPageV1(f.database, f.root.id, Object.defineProperty({}, 'query', {
			enumerable: true, get() { assert.fail('Hostile query getter must not run.'); } })));
		await assert.rejects(readPhotoStackQueryPageV1(f.database, f.root.id, { signal: AbortSignal.abort() }), { name: 'AbortError' });
		assert.equal(f.indexedDB.stats.getRequests.length, before);
	} finally { await f.close(); }
});
