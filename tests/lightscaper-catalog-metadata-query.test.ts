/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogQueryV2, type PhotoQueryContinuationV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });

function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'metadata-query', verifyOriginal: async () => undefined });
	return { indexedDB, repository };
}

async function fill(repository: PhotoCatalogRepositoryV1, count: number) {
	await repository.createCatalog(queryCatalogRootV1());
	for (let offset = 0, revision = 0; offset < count; offset += 16, revision++) {
		await repository.publishPhotos('catalog', revision, Array.from({ length: Math.min(16, count - offset) }, (_, index) => {
			const photo = queryPhotoV1(offset + index);
			return { ...photo, metadata: { ...photo.metadata, cameraMake: 'Canon', cameraModel: 'EOS R', lens: '50 mm',
				iso: offset + index === 130 ? 800 : null, copyright: offset + index === 130 ? 'Photographer café' : '',
				modifiedTime: '2026-10-08T10:00:00.000Z' } };
		}));
	}
}

const metadataQuery = () => normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', predicate: {
	kind: 'all', terms: [{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'CANON' },
		{ kind: 'number', column: 'iso', minimum: 400, maximum: 1600 },
		{ kind: 'text', column: 'copyright', operator: 'contains', value: 'CAFÉ' }],
} });

test('sparse metadata conjunctions cross native-index pages with bounded candidate delivery and no photo aggregates', async () => {
	const { repository, indexedDB } = fixture(); await fill(repository, 145);
	try {
		const before = indexedDB.stats.getRequests.length, query = metadataQuery();
		const ids: string[] = []; let empty = 0, continuation: PhotoQueryContinuationV2 | null = null;
		do {
			const page = await repository.readQueryPageV2('catalog', { query, continuation });
			assert.equal(page.schemaVersion, 2); assert.equal(page.kind, 'photo-query-page');
			assert.equal(page.catalogId, 'catalog'); assert.equal(page.totalCount, 145);
			assert.ok(page.items.length <= 64 && page.scanned <= 64);
			if (page.continuation && !page.items.length) empty++;
			ids.push(...page.items.map(row => row.photoId)); continuation = page.continuation;
		} while (continuation);
		assert.deepEqual(ids, [queryPhotoV1(130).id]); assert.equal(empty, 2);
		assert.equal(indexedDB.stats.getRequests.slice(before).some((entry: { store: string }) => entry.store === 'photos'), false);
		assert.equal(indexedDB.stats.getAllRequests.length, 0);
		assert.ok(indexedDB.stats.cursorRequests.filter((entry: { store: string }) => entry.store === 'photoQueryRowsV2')
			.every((entry: { delivered: number }) => entry.delivered <= 64));
	} finally { await repository.close(); }
});

test('metadata edits update predicates atomically and retire old continuation scopes', async () => {
	const { repository } = fixture(); await fill(repository, 145);
	try {
		const query = metadataQuery(), first = await repository.readQueryPageV2('catalog', { query });
		const photo = (await repository.loadPhoto('catalog', queryPhotoV1(130).id))!;
		await repository.savePhoto({ ...photo, metadata: { ...photo.metadata, copyright: 'Another photographer' } }, photo.revision);
		await assert.rejects(repository.readQueryPageV2('catalog', { query, continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
		let continuation: PhotoQueryContinuationV2 | null = null; const ids: string[] = [];
		do { const page = await repository.readQueryPageV2('catalog', { query, continuation }); ids.push(...page.items.map(row => row.photoId)); continuation = page.continuation; } while (continuation);
		assert.deepEqual(ids, []); assert.deepEqual((await repository.loadPhoto('catalog', photo.id))!.original, photo.original);
	} finally { await repository.close(); }
});

test('every metadata hierarchy reference is checked before scanning even behind a false branch', async () => {
	const { repository, indexedDB } = fixture(); await fill(repository, 1);
	try {
		const before = indexedDB.stats.cursorRequests.length;
		const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', predicate: {
			kind: 'all', terms: [{ kind: 'rating', minimum: 5, maximum: 5 }, { kind: 'keyword', id: 'missing' }],
		} });
		await assert.rejects(repository.readQueryPageV2('catalog', { query }), /missing/iu);
		assert.equal(indexedDB.stats.cursorRequests.length, before);
	} finally { await repository.close(); }
});

test('native abort reasons remain opaque during metadata-row read and prevent page publication', async () => {
	for (const reason of [17, 'metadata-abort', null, new Proxy({}, { getPrototypeOf() { throw new Error('Abort reasons are opaque.'); } })]) {
		const { repository, indexedDB } = fixture(); await fill(repository, 1);
		const controller = new AbortController();
		try {
			indexedDB.onNextGetForStore('photoQueryBuildStatesV2', () => controller.abort(reason));
			let returned = false;
			try { await repository.readQueryPageV2('catalog', { query: normalizePhotoCatalogQueryV2(), signal: controller.signal }); returned = true; }
			catch (error) { assert.equal(error, reason); }
			assert.equal(returned, false); assert.equal(indexedDB.stats.activeTransactions, 0);
		} finally { await repository.close(); }
	}
});

test('metadata projection and count corruption refuse a page rather than publish plausible results', async () => {
	for (const corruption of ['projection', 'count'] as const) {
		const { repository, indexedDB } = fixture(); await fill(repository, 1);
		try {
			if (corruption === 'projection') {
				const row = indexedDB.records('metadata-query', 'photoQueryRowsV2')[0] as Record<string, unknown>;
				indexedDB.seedRecord('metadata-query', 'photoQueryRowsV2', { ...row, fileNameSort: 'forged' });
			} else indexedDB.seedRecord('metadata-query', 'photoQueryBuildStatesV2', { id: 'catalog', schemaVersion: 2, ready: true, afterKey: null, indexedCount: 2 });
			await assert.rejects(repository.readQueryPageV2('catalog'), /projection|count/iu);
		} finally { await repository.close(); }
	}
});
