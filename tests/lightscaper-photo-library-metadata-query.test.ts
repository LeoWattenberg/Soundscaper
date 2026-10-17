/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogQueryV2, photoQueryDigestV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { projectPhotoQueryRowV2, photoQuerySummaryV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { admitPhotoLibraryQueryStepRequestV2, readPhotoLibraryQueryStepV2,
	rebuildPhotoLibraryQueryStepV2 } from '../src/lightscaper/controller/photo-library-query-v2.ts';
import { readPhotoLibraryStackQueryStepV2 } from '../src/lightscaper/controller/photo-library-stack-query-v2.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const query = normalizePhotoCatalogQueryV2();
const summary = photoQuerySummaryV2(projectPhotoQueryRowV2(queryPhotoV1(0)));
const page = Object.freeze({ schemaVersion: 2, kind: 'photo-query-page', catalogId: 'catalog', catalogName: 'Fresh library',
	totalCount: 1, catalogRevision: 3, indexRevision: 4, items: [summary], scanned: 1, continuation: null });

test('metadata query projection uses the atomic page context and never loads a separate catalog generation', async () => {
	let reads = 0;
	const repository = { loadCatalog: async () => { throw new Error('Separate root read is forbidden'); },
		readQueryPageV2: async (catalogId: string) => { reads++; assert.equal(catalogId, 'catalog'); return page; } };
	const result = await readPhotoLibraryQueryStepV2(repository, 'catalog', { query });
	assert.equal(result.catalogName, 'Fresh library'); assert.equal(result.totalCount, 1); assert.equal(reads, 1);
	assert.deepEqual(Object.keys(result.rows[0]!).sort(), ['colorLabel', 'fileName', 'flag', 'height', 'id', 'rating', 'width']);
	assert.equal(result.cursor, null); assert.ok(Object.isFrozen(result.rows[0]));
});

test('the actual metadata repository preserves sparse steps and bounded scalar continuation through the library port', async () => {
	const indexedDB = createInstrumentedIndexedDB(), repository = new PhotoCatalogRepositoryV1({
		indexedDB: indexedDB as unknown as IDBFactory, databaseName: 'metadata-query-port', verifyOriginal: async () => undefined });
	try {
		await repository.createCatalog(queryCatalogRootV1());
		for (let offset = 0, revision = 0; offset < 80; offset += 16, revision++) {
			await repository.publishPhotos('catalog', revision, Array.from({ length: 16 }, (_, index) => {
				const photo = queryPhotoV1(offset + index);
				return { ...photo, metadata: { ...photo.metadata, cameraModel: offset + index === 79 ? 'Distant camera' : null } };
			}));
		}
		const criteria = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query',
			predicate: { kind: 'text', column: 'camera-model', operator: 'equals', value: 'Distant camera' } });
		const first = await readPhotoLibraryQueryStepV2(repository, 'catalog', { query: criteria });
		assert.equal(first.rows.length, 0); assert.equal(first.scanned, 64); assert.ok(first.cursor);
		const next = await readPhotoLibraryQueryStepV2(repository, 'catalog', { query: criteria, cursor: first.cursor });
		assert.deepEqual(next.rows.map(row => row.id), [queryPhotoV1(79).id]); assert.equal(next.cursor, null);
	} finally { await repository.close(); }
});

test('future, foreign, accessor and oversized requests refuse before the metadata repository', async () => {
	let reads = 0, invoked = 0;
	const repository = { readQueryPageV2: async () => { reads++; return page; } };
	const foreign = { schemaVersion: 2, kind: 'photo-query', catalogId: 'foreign', catalogRevision: 3,
		indexRevision: 4, querySha256: photoQueryDigestV2(query), captureBucket: 0, afterKey: null };
	for (const request of [{ query, cursor: 'x'.repeat(4_097) }, { query, cursor: JSON.stringify(foreign) },
		{ query: { ...query, schemaVersion: 3 } }, Object.defineProperty({}, 'query', {
			enumerable: true, get: () => { invoked++; return query; },
		})]) await assert.rejects(readPhotoLibraryQueryStepV2(repository, 'catalog', request));
	assert.equal(reads, 0); assert.equal(invoked, 0);
	assert.deepEqual(admitPhotoLibraryQueryStepRequestV2({ query }).query, query);
});

test('closed metadata responses reject future fields, foreign rows, inconsistent counts and stale continuation revisions', async () => {
	const continuation = { schemaVersion: 2, kind: 'photo-query', catalogId: 'catalog', catalogRevision: 2,
		indexRevision: 4, querySha256: photoQueryDigestV2(query), captureBucket: 0, afterKey: ['catalog', summary.photoId] };
	for (const invalid of [{ ...page, future: true }, { ...page, schemaVersion: 3 }, { ...page, catalogId: 'foreign' },
		{ ...page, items: [{ ...summary, catalogId: 'foreign' }] }, { ...page, scanned: 0 }, { ...page, totalCount: 0 },
		{ ...page, items: [summary, summary], scanned: 2, totalCount: 2 }, { ...page, continuation }]) {
		await assert.rejects(readPhotoLibraryQueryStepV2({ readQueryPageV2: async () => invalid }, 'catalog', { query }));
	}
});

test('metadata port joins late native cancellation and preserves an opaque reason without reflection', async () => {
	for (const reason of [17, 'opaque', null, new Proxy({}, { getPrototypeOf() { throw new Error('Reason reflected'); } })]) {
		const controller = new AbortController(), pending = deferred<unknown>();
		const work = readPhotoLibraryQueryStepV2({ readQueryPageV2: async () => pending.promise }, 'catalog', { query, signal: controller.signal });
		const rejected = assert.rejects(work, error => error === reason);
		controller.abort(reason); pending.resolve(page); await rejected;
	}
});

test('resumed terminal metadata pages must retain every incoming cursor revision', async () => {
	const cursor = JSON.stringify({ schemaVersion: 2, kind: 'photo-query', catalogId: 'catalog', catalogRevision: 3,
		indexRevision: 4, querySha256: photoQueryDigestV2(query), captureBucket: 0, afterKey: ['catalog', summary.photoId] });
	for (const invalid of [{ ...page, catalogRevision: 9 }, { ...page, indexRevision: 10 }]) {
		await assert.rejects(readPhotoLibraryQueryStepV2({ readQueryPageV2: async () => invalid }, 'catalog', { query, cursor }), /revision/iu);
	}
});

test('resumed terminal collapsed pages must retain incoming catalog, index and grouping revisions', async () => {
	const cursor = JSON.stringify({ schemaVersion: 2, kind: 'collapsed-photo-query', catalogId: 'catalog', catalogRevision: 3,
		indexRevision: 4, stateRevision: 5, querySha256: photoQueryDigestV2(query), captureBucket: 0,
		afterKey: ['catalog', summary.photoId], pending: null, stackAudit: null, progressSha256: '0'.repeat(64) });
	const collapsed = { ...page, kind: 'collapsed-photo-query-page', stateRevision: 5 };
	for (const invalid of [{ ...collapsed, catalogRevision: 9 }, { ...collapsed, indexRevision: 10 }, { ...collapsed, stateRevision: 11 }]) {
		await assert.rejects(readPhotoLibraryStackQueryStepV2({ readStackQueryPageV2: async () => invalid }, 'catalog', { query, cursor }), /revision/iu);
	}
});

test('metadata rebuild reports both byte owners and rejects an oversized combined step', async () => {
	let calls = 0;
	const result = await rebuildPhotoLibraryQueryStepV2({ rebuildQueryIndexPageV2: async () => {
		calls++; return { processed: 16, bytes: 4_194_304, derivedBytes: 4_194_304, ready: false };
	} }, 'catalog');
	assert.deepEqual(result, { processed: 16, readBytes: 4_194_304, writtenBytes: 4_194_304, ready: false }); assert.equal(calls, 1);
	for (const invalid of [{ processed: 17, bytes: 0, derivedBytes: 0, ready: false },
		{ processed: 1, bytes: 8_388_608, derivedBytes: 1, ready: false },
		{ processed: 1, bytes: 1, derivedBytes: 1, ready: true, future: 1 }]) {
		await assert.rejects(rebuildPhotoLibraryQueryStepV2({ rebuildQueryIndexPageV2: async () => invalid }, 'catalog'));
	}
});
