/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import { publishLargePhotoLibrarySeedBatchV1 } from './helpers/lightscaper-large-library-seed-publication.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { photoCatalogRestorePhotoRecordsV1 } from '../src/lightscaper/catalog/photo-catalog-restore-records-v1.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { PHOTO_QUERY_INDEXES_V1 } from '../src/lightscaper/catalog/photo-query-index-v1.ts';
import { PHOTO_QUERY_INDEXES_V2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createLargeLibraryPhotoBatchV1, PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC } from '../src/lightscaper/quality/large-library-workload-v1.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';

const DB = 'seed-test';
function template() {
	const { photo } = photoArchiveFixture();
	return normalizePhotoDocumentV1({ ...photo, original: { ...photo.original,
		width: SPEC.width, height: SPEC.height, byteLength: SPEC.sourceByteLength, contentSha256: SPEC.sourceSha256 } });
}
function initial() {
	return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Seed', revision: 0, photoCount: 0,
		folders: [{ id: 'folder-one', name: 'Fixture', parentId: null }],
		keywords: [{ id: 'landscape', name: 'Landscape', parentId: null }],
		collections: [{ id: 'manual', name: 'Manual', kind: 'manual' }] });
}
async function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: DB, verifyOriginal: async () => undefined });
	await repository.createCatalog(initial());
	const source = template(), first = createLargeLibraryPhotoBatchV1(source, 0)[0]!;
	const root = await repository.publishPhotos(first.catalogId, 0, [first]);
	const database = await openPhotoCatalogDatabaseV1(indexedDB as unknown as IDBFactory, DB, () => undefined);
	const records = () => Object.fromEntries(PHOTO_CATALOG_STORES.map(store => [store, indexedDB.records(DB, store) as unknown[]]));
	return { indexedDB, repository, database, root, source, records,
		close: async () => { database.close(); await repository.close(); } };
}

/** Owning native-request protocol/record equivalence; real browser timing is qualified separately. */
test('same sixteen-photo seed publications preserve every production row, build state and revision', async () => {
	const actual = await fixture(), expected = await fixture();
	try {
		let root = actual.root, reference = expected.root, retained = 0;
		const reads = actual.indexedDB.stats.getRequests.length;
		for (const offset of [1, 17]) {
			const batch = createLargeLibraryPhotoBatchV1(actual.source, offset);
			const result = await publishLargePhotoLibrarySeedBatchV1(actual.database, root, batch, async photos => {
				assert.equal(actual.indexedDB.recordCount(DB, 'photos'), root.photoCount);
				retained += photos.length;
			});
			root = result.root; reference = await expected.repository.publishPhotos(reference.id, reference.revision, batch);
			assert.deepEqual(root, reference); assert.deepEqual(actual.records(), expected.records());
			assert.equal(result.trace.photos, 16); assert.equal(result.trace.maximumResidentPhotos, 16);
			assert.equal(result.trace.pointReads, 4); assert.equal(result.trace.getAllRequests, 0);
			assert.equal(result.trace.cursorRequests, 0); assert.equal(result.trace.nativeTransactions, 1);
		}
		assert.equal(retained, 32); assert.equal(root.photoCount, 33); assert.equal(root.revision, 3);
		assert.equal(actual.indexedDB.stats.getRequests.length - reads, 8);
		assert.equal(actual.indexedDB.stats.getAllRequests.length, 0);
		assert.equal(actual.indexedDB.stats.cursorRequests.length, 0);
		assert.equal(actual.indexedDB.stats.activeTransactions, 0);
		await transact(actual.database, ['photoQueryRows', 'photoQueryRowsV2'], 'readonly', stores => {
			for (const [name, indexes] of [['photoQueryRows', PHOTO_QUERY_INDEXES_V1], ['photoQueryRowsV2', PHOTO_QUERY_INDEXES_V2]] as const) {
				assert.equal(stores[name].keyPath, 'key');
				for (const [sort, fields] of Object.entries(indexes)) {
					const index = stores[name].index(sort);
					assert.deepEqual(index.keyPath, [...fields]); assert.equal(index.unique, false); assert.equal(index.multiEntry, false);
				}
			}
		});
	} finally { await actual.close(); await expected.close(); }
});

test('closed batch admission refuses excess, invalid references and source bounds before custody or native requests', async () => {
	const f = await fixture();
	try {
		const batch = createLargeLibraryPhotoBatchV1(f.source, 1), reads = f.indexedDB.stats.getRequests.length;
		let retained = 0; const retain = async () => { retained++; };
		for (const values of [[], [...batch, batch[0]], [{ ...batch[0], keywordIds: ['missing'] }],
			[{ ...batch[0], revision: 1 }], [{ ...batch[0], metadata: { ...batch[0]!.metadata, caption: 'a'.repeat(16_384) } }]]) {
			await assert.rejects(publishLargePhotoLibrarySeedBatchV1(f.database, f.root, values, retain));
		}
		let gets = 0; const hostile = [...batch]; Object.defineProperty(hostile, '0', { get() { gets++; return batch[0]; } });
		await assert.rejects(publishLargePhotoLibrarySeedBatchV1(f.database, f.root, hostile, retain));
		assert.equal(gets, 0); assert.equal(retained, 0); assert.equal(f.indexedDB.stats.getRequests.length, reads);
	} finally { await f.close(); }
});

test('custody settlement precedes native publication and blocks another admitted batch', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	try {
		const reads = f.indexedDB.stats.getRequests.length, batch = createLargeLibraryPhotoBatchV1(f.source, 1);
		const work = publishLargePhotoLibrarySeedBatchV1(f.database, f.root, batch, async () => { entered.resolve(); await release.promise; });
		await entered.promise; assert.equal(await remainsPending(work), true);
		assert.equal(f.indexedDB.stats.getRequests.length, reads); assert.equal(f.indexedDB.recordCount(DB, 'photos'), 1);
		await assert.rejects(publishLargePhotoLibrarySeedBatchV1(f.database, f.root, batch, async () => undefined), /pending/u);
		release.resolve(); assert.equal((await work).root.photoCount, 17);
	} finally { release.resolve(); await f.close(); }
});

test('snapshot admission is synchronous, and a retained custody failure leaves the catalog byte-identical', async () => {
	const f = await fixture();
	try {
		const original = createLargeLibraryPhotoBatchV1(f.source, 1)[0]!, mutable = structuredClone(original);
		const work = publishLargePhotoLibrarySeedBatchV1(f.database, f.root, [mutable], async () => undefined);
		Reflect.set(mutable.metadata, 'title', 'Changed after admission');
		const result = await work; assert.deepEqual(await f.repository.loadPhoto(f.root.id, original.id), original);
		const before = f.records(), reason = new Proxy({}, { getPrototypeOf() { throw Error('Opaque reason reflected'); } });
		await publishLargePhotoLibrarySeedBatchV1(f.database, result.root, createLargeLibraryPhotoBatchV1(f.source, 17),
			async () => { throw reason; }).then(() => assert.fail('Expected refusal'), failure => { assert.ok(failure === reason); });
		assert.deepEqual(f.records(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

test('stale context, duplicate native keys and row-write faults never partially publish', async () => {
	for (const store of ['photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryRowsV2']) {
		const f = await fixture();
		try {
			const packet = photoCatalogRestorePhotoRecordsV1(f.root, createLargeLibraryPhotoBatchV1(f.source, 1)[0]);
			const collision = { photos: packet.photo, summaries: packet.summary, memberships: packet.memberships[0],
				photoQueryRows: packet.queryV1, photoQueryRowsV2: packet.queryV2 }[store];
			f.indexedDB.seedRecord(DB, store, collision); const before = f.records();
			await assert.rejects(publishLargePhotoLibrarySeedBatchV1(f.database, f.root, createLargeLibraryPhotoBatchV1(f.source, 1), async () => undefined));
			assert.deepEqual(f.records(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await f.close(); }
	}
	for (const store of ['catalogs', 'catalogStates', 'photoQueryBuildStates', 'photoQueryBuildStatesV2']) {
		const f = await fixture();
		try {
			const before = f.records(); f.indexedDB.failNextPutForStore(store);
			await assert.rejects(publishLargePhotoLibrarySeedBatchV1(f.database, f.root, createLargeLibraryPhotoBatchV1(f.source, 1), async () => undefined));
			assert.deepEqual(f.records(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await f.close(); }
	}
	const f = await fixture();
	try {
		const before = f.records();
		await assert.rejects(publishLargePhotoLibrarySeedBatchV1(f.database, { ...f.root, revision: 0 }, createLargeLibraryPhotoBatchV1(f.source, 1), async () => undefined));
		await assert.rejects(publishLargePhotoLibrarySeedBatchV1(f.database, f.root, [createLargeLibraryPhotoBatchV1(f.source, 0)[0]], async () => undefined));
		assert.deepEqual(f.records(), before);
	} finally { await f.close(); }
});

test('native completion remains the release boundary after all request successes', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const native = f.database.transaction.bind(f.database);
	f.database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const transaction = native(...args); let complete: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { configurable: true,
			get: () => complete === null ? null : function (this: IDBTransaction, event: Event) {
				entered.resolve(); void release.promise.then(() => { complete?.call(this, event); });
			}, set: (callback: IDBTransaction['oncomplete']) => { complete = callback; } });
		return transaction;
	}) as IDBDatabase['transaction'];
	try {
		const work = publishLargePhotoLibrarySeedBatchV1(f.database, f.root, createLargeLibraryPhotoBatchV1(f.source, 1), async (_photos: readonly PhotoDocumentV1[]) => undefined);
		await entered.promise; assert.equal(await remainsPending(work), true);
		await assert.rejects(publishLargePhotoLibrarySeedBatchV1(f.database, f.root, createLargeLibraryPhotoBatchV1(f.source, 17), async () => undefined), /pending/u);
		release.resolve(); await work;
	} finally { release.resolve(); f.database.transaction = native; await f.close(); }
});

test('the actual seed helper closure has exact nightly staging and package admission', async () => {
	const entry = 'tests/helpers/lightscaper-large-library-native-fixture.ts', leaf = 'tests/helpers/lightscaper-large-library-seed-publication.ts';
	const result = await build({ entryPoints: [fileURLToPath(new URL('./helpers/lightscaper-large-library-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', external: ['module'], logLevel: 'silent' });
	assert.ok(Object.keys(result.metafile.inputs).includes(entry)); assert.ok(Object.keys(result.metafile.inputs).includes(leaf));
	const { default: config } = await import('../electron-builder.nightly-tests.config.cjs');
	const resources = config.extraResources; assert.ok(Array.isArray(resources));
	const payload = resources.find(resource => typeof resource === 'object' && resource.to === 'nightly-tests');
	assert.ok(payload && typeof payload === 'object'); assert.ok(Array.isArray(payload.filter)); const filter = payload.filter;
	function check(inputs: typeof NIGHTLY_TEST_PAYLOAD_INPUTS) {
		for (const input of Object.keys(result.metafile.inputs)) {
			if (input.startsWith('node_modules/')) continue;
			const owner = inputs.find(item => item.kind === 'file' ? item.source === input : input.startsWith(item.source + '/'));
			assert.ok(owner, 'Nightly staging omits ' + input);
			const destination = owner.kind === 'file' ? owner.destination : owner.destination + input.slice(owner.source.length);
			assert.equal(destination, input); assert.ok(filter.some(pattern => matchesGlob(destination, pattern)));
		}
	}
	check(NIGHTLY_TEST_PAYLOAD_INPUTS);
	assert.throws(() => check(NIGHTLY_TEST_PAYLOAD_INPUTS.filter(item => item.source !== entry)), /large-library-native-fixture/u);
	assert.throws(() => check(NIGHTLY_TEST_PAYLOAD_INPUTS.filter(item => item.source !== leaf)), /seed-publication/u);
	assert.throws(() => check(NIGHTLY_TEST_PAYLOAD_INPUTS.filter(item => item.source !== 'tests/helpers/lightscaper-large-library-seed-diagnostic.ts')), /seed-diagnostic/u);
	assert.equal(NIGHTLY_TEST_PAYLOAD_INPUTS.some(item => item.source === 'tests/helpers' && item.kind === 'directory'), false);
});
