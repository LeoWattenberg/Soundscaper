/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { readPhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-pages-v2.ts';
import { readPhotoStackQueryPageV2 } from '../src/lightscaper/catalog/photo-stack-query-v2.ts';
import { readPhotoSmartCollectionQueryPageV1, readPhotoSmartCollectionStackQueryPageV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-v1.ts';
import { normalizePhotoCatalogQueryV1, type PhotoCatalogQueryV1, type PhotoQueryContinuationV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { migratePhotoCatalogQueryV1ToV2, normalizePhotoCatalogQueryV2, type PhotoQueryContinuationV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { SMART_COLLECTION_TEST_DATABASE as DB, smartCollectionRepositoryFixtureV1 } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

const sparse = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'Sparse needle' });
type Fixture = Awaited<ReturnType<typeof prepare>>;
type MatchedPage = Awaited<ReturnType<typeof readPhotoQueryPageV2 | typeof readPhotoStackQueryPageV2 | typeof readPhotoSmartCollectionQueryPageV1>>;

async function prepare(count = 65, transform: (index: number, photo: PhotoDocumentV1) => PhotoDocumentV1 = (_, photo) => photo,
	root = queryCatalogRootV1()) {
	const f = await smartCollectionRepositoryFixtureV1(root);
	for (let offset = 0, revision = 0; offset < count; offset += 16, revision++) {
		await f.repository.publishPhotos('catalog', revision, Array.from({ length: Math.min(16, count - offset) }, (_, delta) => {
			const index = offset + delta; return transform(index, queryPhotoV1(index));
		}));
	}
	return f;
}
async function close(f: Fixture) { f.database.close(); await f.repository.close(); }

/** Observe the owning summary byte check, preserving the intrinsic receiver/result. */
async function observeSummaryChecks<Result>(run: () => Promise<Result>, onSummary?: (source: string) => void) {
	const encode = TextEncoder.prototype.encode;
	let checks = 0;
	TextEncoder.prototype.encode = function (input?: string): Uint8Array<ArrayBuffer> {
		const result = Reflect.apply(encode, this, [input]) as Uint8Array<ArrayBuffer>;
		if (input?.startsWith('{"key":') && input.includes('"originalSha256":')) { checks++; onSummary?.(input); }
		return result;
	};
	try { return { result: await run(), checks }; }
	finally { TextEncoder.prototype.encode = encode; }
}

for (const route of ['ordinary', 'collapsed', 'saved', 'saved-collapsed'] as const) {
	test(`${route} Query2 checks each authenticated candidate summary once plus delivered matches`, async () => {
		const f = await prepare();
		try {
			await f.repository.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog',
				id: 'saved', revision: 0, name: 'Sparse filter', query: sparse }, null, await f.writeOptions());
			const before = f.indexedDB.stats.cursorRequests.length;
			const { result, checks } = await observeSummaryChecks<MatchedPage>(() => {
				switch (route) {
					case 'ordinary': return readPhotoQueryPageV2(f.database, 'catalog', { query: sparse });
					case 'collapsed': return readPhotoStackQueryPageV2(f.database, 'catalog', { query: sparse });
					case 'saved': return readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved');
					case 'saved-collapsed': return readPhotoSmartCollectionStackQueryPageV1(f.database, 'catalog', 'saved');
				}
			});
			assert.equal(result.scanned, 64); assert.deepEqual(result.items.map(row => row.photoId), [queryPhotoV1(0).id]);
			assert.ok(result.continuation); assert.equal(f.indexedDB.stats.activeTransactions, 0);
			assert.ok(f.indexedDB.stats.cursorRequests.slice(before).every((cursor: { delivered: number }) => cursor.delivered <= 64));
			assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
			assert.equal(f.indexedDB.stats.getRequests.some((entry: { store: string }) => entry.store === 'photos'), false);
			assert.equal(checks, result.scanned + result.items.length, 'full validation belongs to row admission and output, with no repeated matcher validation');
		} finally { await close(f); }
	});
}

test('a later nonmatching candidate still authenticates complete metadata, summary identity and projections', async () => {
	for (const patch of [{ iso: -1 }, { originalSha256: 'z'.repeat(64) }, { ratingSort: 5 },
		{ photoId: 'foreign' }, { future: true }]) {
		const f = await prepare();
		try {
			const row = projectPhotoQueryRowV2(queryPhotoV1(40));
			f.indexedDB.seedRecord(DB, 'photoQueryRowsV2', { ...row, ...patch }, row.key);
			await assert.rejects(readPhotoQueryPageV2(f.database, 'catalog', { query: sparse }));
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
			assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
		} finally { await close(f); }
	}
});

async function collectV1(f: Fixture, query: PhotoCatalogQueryV1) {
	let continuation: PhotoQueryContinuationV1 | null = null;
	const found: string[] = [];
	do {
		const page = await f.repository.readQueryPage('catalog', { query, continuation });
		assert.ok(page.scanned <= 64 && page.items.length <= 64); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		found.push(...page.items.map(row => row.photoId)); continuation = page.continuation;
	} while (continuation);
	return found;
}
async function collectV2(f: Fixture, query: PhotoCatalogQueryV1) {
	let continuation: PhotoQueryContinuationV2 | null = null;
	const found: string[] = [], migrated = migratePhotoCatalogQueryV1ToV2(query);
	do {
		const page = await f.repository.readQueryPageV2('catalog', { query: migrated, continuation });
		assert.ok(page.scanned <= 64 && page.items.length <= 64); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		found.push(...page.items.map(row => row.photoId)); continuation = page.continuation;
	} while (continuation);
	return found;
}

test('native V1 and V2 pages preserve the text universe, scalar filters and nested root1 smart clocks', async () => {
	const root = normalizePhotoCatalogRootV1({ ...queryCatalogRootV1(), collections: [...queryCatalogRootV1().collections,
		{ id: 'clock', name: 'Local clock', kind: 'smart', query: { kind: 'all', terms: [
			{ kind: 'capture-time', from: '2026-01-02T12:00:00.000', to: '2026-01-03T12:00:00.000' },
			{ kind: 'not', term: { kind: 'flag', value: 'reject' } },
			{ kind: 'any', terms: [{ kind: 'file-name', contains: 'IMAGE-' }, { kind: 'folder', id: 'folder' }] },
		] } }] });
	const f = await prepare(18, (index, photo) => normalizePhotoDocumentV1({ ...photo,
		flag: index % 6 === 1 ? 'pick' : index % 6 === 5 ? 'reject' : 'unflagged', colorLabel: index % 6 === 2 ? 'red' : 'none',
		folderId: index === 1 ? null : 'folder', collectionIds: index === 3 ? [] : ['manual'], metadata: { ...photo.metadata,
			caption: index === 2 ? 'Distant CAFÉ' : '', creator: index === 3 ? 'Author' : '', location: index === 4 ? 'Bay' : '',
			cameraMake: 'Metadata-only camera', copyright: 'Metadata-only rights' } }), root);
	try {
		const ids = (indices: readonly number[]) => indices.map(index => queryPhotoV1(index).id);
		const cases: readonly [unknown, readonly number[]][] = [
			[{ text: 'IMAGE-100000' }, [0]], [{ text: 'SPARSE NEEDLE' }, [0]], [{ text: 'café' }, [2]],
			[{ text: 'author' }, [3]], [{ text: 'bay' }, [4]], [{ text: 'LANDSCAPE' }, [0, 2, 4, 6, 8, 10, 12, 14, 16]],
			[{ text: 'Metadata-only' }, []], [{ text: 'DistantAuthor' }, []],
			[{ filter: { kind: 'rating', value: 4 } }, [4, 10, 16]], [{ filter: { kind: 'flag', value: 'pick' } }, [1, 7, 13]],
			[{ filter: { kind: 'label', value: 'red' } }, [2, 8, 14]],
			[{ filter: { kind: 'folder', id: 'folder' } }, Array.from({ length: 18 }, (_, n) => n).filter(n => n !== 1)],
			[{ filter: { kind: 'keyword', id: 'keyword' } }, [0, 2, 4, 6, 8, 10, 12, 14, 16]],
			[{ filter: { kind: 'collection', id: 'manual' } }, Array.from({ length: 18 }, (_, n) => n).filter(n => n !== 3)],
			[{ filter: { kind: 'collection', id: 'smart' } }, [4, 10, 16]], [{ filter: { kind: 'collection', id: 'clock' } }, [1]],
		];
		for (const [criteria, expected] of cases) {
			const query = normalizePhotoCatalogQueryV1(criteria);
			assert.deepEqual(await collectV1(f, query), ids(expected)); assert.deepEqual(await collectV2(f, query), ids(expected));
		}
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
	} finally { await close(f); }
});

test('all metadata references remain validated before a true branch can short-circuit', async () => {
	const f = await prepare();
	try {
		const before = f.indexedDB.stats.cursorRequests.length;
		const query = normalizePhotoCatalogQueryV2({ ...sparse, predicate: { kind: 'any', terms: [
			{ kind: 'presence', column: 'file-name', value: 'known' }, { kind: 'keyword', id: 'missing' },
		] } });
		await assert.rejects(readPhotoQueryPageV2(f.database, 'catalog', { query }), /missing/iu);
		assert.equal(f.indexedDB.stats.cursorRequests.length, before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await close(f); }
});

test('mid-scan intrinsic abort retains opaque reason identity and joins the native transaction', async () => {
	const f = await prepare();
	try {
		let traps = 0;
		const reason = new Proxy({}, { getPrototypeOf() { traps++; throw new Error('Opaque prototype.'); }, get() { traps++; throw new Error('Opaque property.'); } });
		const stop = new AbortController();
		await observeSummaryChecks(async () => {
			let rejected = false;
			try { await readPhotoQueryPageV2(f.database, 'catalog', { query: sparse, signal: stop.signal }); }
			catch (error) { rejected = true; assert.equal(error, reason); }
			assert.equal(rejected, true);
		}, source => { if (source.includes('"photoId":"photo-000031"')) stop.abort(reason); });
		assert.equal(stop.signal.aborted, true); assert.equal(traps, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await close(f); }
});

test('new owner revisions still retire ordinary and saved continuations after metadata edits', async () => {
	const f = await prepare();
	try {
		await f.repository.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog',
			id: 'saved', revision: 0, name: 'Sparse filter', query: sparse }, null, await f.writeOptions());
		const ordinary = await readPhotoQueryPageV2(f.database, 'catalog', { query: sparse });
		const saved = await readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved');
		const photo = await f.repository.loadPhoto('catalog', queryPhotoV1(64).id); assert.ok(photo);
		await f.repository.savePhoto({ ...photo, metadata: { ...photo.metadata, title: 'Sparse needle' } }, photo.revision);
		await assert.rejects(readPhotoQueryPageV2(f.database, 'catalog', { query: sparse, continuation: ordinary.continuation }), /revision/iu);
		await assert.rejects(readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved', { continuation: saved.continuation }), /revision/iu);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await close(f); }
});
