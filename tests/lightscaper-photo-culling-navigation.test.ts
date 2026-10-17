/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoLibraryCullingNavigationContextV1 } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoCatalogContinuationV1 } from '../src/lightscaper/catalog/repository-types.ts';
import { deferred } from './helpers/async-test-control.ts';
import { stackMetadataQueryFixtureV2, mutateStackQueryStoreV2 } from './helpers/lightscaper-photo-stack-query-v2-fixture.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', sort: { field: 'file-name', direction: 'ascending' } });
const context = (collapsed = false): PhotoLibraryCullingNavigationContextV1 => ({ kind: 'query', query, collapsed });
async function fixture(count = 130, patch?: Parameters<typeof stackMetadataQueryFixtureV2>[1]) {
	const f = await stackMetadataQueryFixtureV2(count, patch), repository = new PhotoCatalogRepositoryV2({ indexedDB: f.factory,
		databaseName: f.databaseName, verifyOriginal: async () => undefined });
	return { ...f, repository, close: async () => { await repository.close(); await f.close(); } };
}
async function destination(f: Fixture, selection: PhotoLibraryCullingNavigationContextV1, photoId: string, signal?: AbortSignal): Promise<Readonly<PhotoLibraryPageV1> | null> {
	const read: unknown = Reflect.get(f.repository, 'readCullingDestinationPage');
	assert.equal(typeof read, 'function', 'the actual current repository must expose the fresh indexed destination reader');
	return Reflect.apply(read as (...args: unknown[]) => Promise<Readonly<PhotoLibraryPageV1> | null>, f.repository,
		[f.root.id, selection, { photoId, ...(signal === undefined ? {} : { signal }) }]);
}

test('plain destination uses the current scalar index and emits a usable fresh continuation', async () => {
	const f = await fixture();
	try {
		const expected = f.indexedDB.records(f.databaseName, 'summaries').map(row => (row as { photoId: string }).photoId).sort();
		const page = await destination(f, { kind: 'plain' }, expected[64]!);
		assert.deepEqual(page?.rows.map(row => row.id), expected.slice(64, 128));
		const next = await f.repository.readSummaryPage(f.root.id, { continuation: JSON.parse(page!.cursor!) as PhotoCatalogContinuationV1 });
		assert.deepEqual(next.items.map(row => row.photoId), expected.slice(128));
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
	} finally { await f.close(); }
});

test('Query1 and Query2 seek inclusively in both directions after an edit invalidates the old cursor', async () => {
	const f = await fixture();
	try {
		const old = await f.repository.readQueryPageV2(f.root.id, { query });
		const photo = (await f.repository.loadPhoto(f.root.id, 'photo-1'))!;
		await f.repository.savePhoto({ ...photo, rating: 5 }, photo.revision);
		await assert.rejects(f.repository.readQueryPageV2(f.root.id, { query, continuation: old.continuation }));
		for (const version of [1, 2] as const) for (const direction of ['ascending', 'descending'] as const) {
			const selected = version === 1 ? { text: '', filter: null, sort: { field: 'file-name' as const, direction } }
				: normalizePhotoCatalogQueryV2({ ...query, sort: { field: 'file-name', direction } });
			const page = await destination(f, { kind: 'query', query: selected, collapsed: false }, 'photo-65');
			assert.equal(page?.rows[0]?.id, 'photo-65'); assert.equal(page?.rows.length, 64);
			assert.equal(page?.rows[1]?.id, direction === 'ascending' ? 'photo-66' : 'photo-64');
			const continuation: unknown = JSON.parse(page!.cursor!);
			const next = version === 1 ? await f.repository.readQueryPage(f.root.id, { query: selected, continuation })
				: await f.repository.readQueryPageV2(f.root.id, { query: selected, continuation });
			assert.equal(next.items[0]?.photoId, direction === 'ascending' ? 'photo-129' : 'photo-1');
		}
	} finally { await f.close(); }
});

test('unknown capture bucket starts at the actual target without revisiting dated rows', async () => {
	const f = await fixture();
	try {
		for (const direction of ['ascending', 'descending'] as const) {
			const page = await destination(f, { kind: 'query', query: normalizePhotoCatalogQueryV2({ ...query,
				sort: { field: 'capture-time', direction } }), collapsed: false }, 'photo-65');
			assert.equal(page?.rows[0]?.id, 'photo-65'); assert.ok(page!.rows.length <= 64);
		}
	} finally { await f.close(); }
});

test('dated and unknown capture positions keep actual bucket order for both query protocols and directions', async () => {
	const f = await fixture(130, (index, source) => ({ metadata: { ...source.metadata,
		captureTime: index % 3 === 0 ? null : { local: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString().slice(0, 19), offsetMinutes: null } } }));
	try {
		for (const version of [1, 2] as const) for (const direction of ['ascending', 'descending'] as const) for (const photoId of ['photo-65', 'photo-66']) {
			const selected = version === 1 ? { text: '', filter: null, sort: { field: 'capture-time' as const, direction } }
				: normalizePhotoCatalogQueryV2({ ...query, sort: { field: 'capture-time', direction } });
			const page = await destination(f, { kind: 'query', query: selected, collapsed: false }, photoId);
			assert.equal(page?.rows[0]?.id, photoId); assert.ok(page!.rows.length <= 64);
			if (photoId === 'photo-66') assert.ok(page!.rows.every(row => Number(row.id.slice(6)) % 3 === 0));
		}
	} finally { await f.close(); }
});

test('missing or nonmatching destination returns null and unready derived indexes still refuse', async () => {
	const f = await fixture();
	try {
		assert.equal(await destination(f, context(), 'missing'), null);
		assert.equal(await destination(f, { kind: 'query', collapsed: false, query: normalizePhotoCatalogQueryV2({ ...query,
			filter: { kind: 'rating', value: 5 } }) }, 'photo-65'), null);
		await mutateStackQueryStoreV2(f.database, 'photoQueryBuildStatesV2', store => { store.put({ id: f.root.id,
			schemaVersion: 2, ready: false, afterKey: null, indexedCount: 130 }); });
		await assert.rejects(destination(f, context(), 'photo-65'), /not.*ready|prepare/iu);
	} finally { await f.close(); }
});

test('collapsed destination admits only the current representative and retains signed paging', async () => {
	const f = await fixture();
	try {
		await f.group(['photo-65', 'photo-66'], 'photo-65');
		assert.equal(await destination(f, context(true), 'photo-66'), null);
		for (const version of [1, 2] as const) {
			const selected = version === 1 ? { text: '', filter: null, sort: query.sort } : query;
			const page = await destination(f, { kind: 'query', query: selected, collapsed: true }, 'photo-65');
			assert.equal(page?.rows[0]?.id, 'photo-65'); assert.ok(!page!.rows.some(row => row.id === 'photo-66'));
			const next = version === 1 ? await f.repository.readStackQueryPage(f.root.id, { query: selected, continuation: JSON.parse(page!.cursor!) as unknown })
				: await f.repository.readStackQueryPageV2(f.root.id, { query: selected, continuation: JSON.parse(page!.cursor!) as unknown });
			assert.ok(next.items.every(row => !page!.rows.some(prior => prior.id === row.photoId)));
		}
	} finally { await f.close(); }
});

test('derived destination facts cannot disagree with the same-revision full Photo', async () => {
	for (const storeName of ['summaries', 'photoQueryRowsV2']) {
		const f = await fixture(2);
		try {
			const raw = f.indexedDB.records(f.databaseName, storeName)[0] as Record<string, unknown>;
			await mutateStackQueryStoreV2(f.database, storeName, store => { store.put({ ...raw, rating: 5, ...(storeName === 'photoQueryRowsV2' ? { ratingSort: 5 } : {}) }); });
			await assert.rejects(destination(f, context(), raw.photoId as string), /differs from its current Photo/u);
		} finally { await f.close(); }
	}
});

test('a real same-root Photo edit between private stack phases refuses the complete destination', async () => {
	const f = await fixture(260), changed = deferred<void>();
	try {
		await f.group(Array.from({ length: 130 }, (_, index) => `photo-${index + 65}`), 'photo-194');
		const rootBefore = await f.repository.loadCatalog(f.root.id);
		f.indexedDB.onNextGetForStore('catalogs', () => { setTimeout(() => {
			void (async () => { const photo = (await f.repository.loadPhoto(f.root.id, 'photo-1'))!;
				await f.repository.savePhoto({ ...photo, rating: 5 }, photo.revision); })().then(changed.resolve, changed.reject);
		}, 0); });
		await assert.rejects(destination(f, context(true), 'photo-194'), /revision|changed|conflict/iu);
		await changed.promise;
		assert.equal((await f.repository.loadCatalog(f.root.id))!.revision, rootBefore!.revision);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await Promise.allSettled([changed.promise]); await f.close(); }
});

test('a large stack proof advances in bounded phases without dropping the inclusive destination', async () => {
	const f = await fixture(260);
	try {
		await f.group(Array.from({ length: 130 }, (_, index) => `photo-${index + 65}`), 'photo-194');
		const page = await destination(f, context(true), 'photo-194');
		assert.equal(page?.rows[0]?.id, 'photo-194'); assert.ok(page!.rows.length <= 64);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
	} finally { await f.close(); }
});

test('saved ordinary and collapsed destinations retain actual definition and issuing connection authority', async () => {
	const f = await fixture();
	try {
		const snapshot = await f.repository.readSmartCollectionSnapshotV1(f.root.id, null);
		await f.repository.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: f.root.id,
			id: 'saved', revision: 0, name: 'Current saved query', query }, null, { expectedCatalogRevision: snapshot.context.catalogRevision,
			expectedIndexRevision: snapshot.context.indexRevision, expectedStateRevision: snapshot.context.collectionStateRevision });
		for (const collapsed of [false, true]) {
			const page = await destination(f, { kind: 'saved', collectionId: 'saved', collapsed }, 'photo-65');
			assert.equal(page?.rows[0]?.id, 'photo-65');
			const read = collapsed ? f.repository.readSmartCollectionStackQueryPageV1 : f.repository.readSmartCollectionQueryPageV1;
			const next = await read.call(f.repository, f.root.id, 'saved', { continuation: JSON.parse(page!.cursor!) as unknown });
			assert.equal(next.items[0]?.photoId, 'photo-129');
		}
	} finally { await f.close(); }
});

test('closed contexts and own-data requests refuse accessors and future fields before native reads', async () => {
	const f = await fixture(2);
	try {
		let accessed = 0; const before = f.indexedDB.stats.getRequests.length;
		for (const selected of [{ kind: 'plain', future: true }, { kind: 'query', query, collapsed: false, inclusive: true },
			{ kind: 'saved', get collectionId() { accessed++; return 'saved'; }, collapsed: false }]) {
			await assert.rejects(destination(f, selected as PhotoLibraryCullingNavigationContextV1, 'photo-1'));
		}
		assert.equal(accessed, 0); assert.equal(f.indexedDB.stats.getRequests.length, before);
	} finally { await f.close(); }
});
