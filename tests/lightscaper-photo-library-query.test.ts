/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogQueryV1, photoQueryDigestV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { admitPhotoLibraryQueryBuildRequestV1, admitPhotoLibraryQueryStepRequestV1, readPhotoLibraryQueryStepV1, rebuildPhotoLibraryQueryStepV1 } from '../src/lightscaper/controller/photo-library-query-v1.ts';
import { admitPhotoLibraryDefinitionPageRequestV1, readPhotoLibraryDefinitionPageV1 } from '../src/lightscaper/controller/photo-library-definition-pages-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });

async function fixture(count = 80) {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'photo-library-query', verifyOriginal: async () => undefined });
	await repository.createCatalog(queryCatalogRootV1());
	for (let offset = 0, revision = 0; offset < count; offset += 16, revision++) {
		await repository.publishPhotos('catalog', revision, Array.from({ length: Math.min(16, count - offset) }, (_, index) => queryPhotoV1(offset + index)));
	}
	return { repository, indexedDB };
}

test('scalar query pages preserve global ordering, bounded cursors and original-free rows', async () => {
	const { repository } = await fixture();
	try {
		const query = { sort: { field: 'file-name', direction: 'ascending' } };
		const first = await readPhotoLibraryQueryStepV1(repository, 'catalog', { query });
		assert.equal(first.rows.length, 64); assert.equal(first.scanned, 64); assert.equal(first.totalCount, 80);
		assert.equal(first.rows[0]?.id, queryPhotoV1(79).id);
		assert.deepEqual(Object.keys(first.rows[0]!).sort(), ['colorLabel', 'fileName', 'flag', 'height', 'id', 'rating', 'width']);
		assert.ok(first.cursor && new TextEncoder().encode(first.cursor).byteLength <= 2_048);
		const second = await readPhotoLibraryQueryStepV1(repository, 'catalog', { query, cursor: first.cursor });
		assert.equal(second.rows.length, 16); assert.equal(second.cursor, null);
		assert.equal(second.rows.at(-1)?.id, queryPhotoV1(0).id);
	} finally { await repository.close(); }
});

test('sparse empty steps preserve a usable continuation rather than claiming an empty library', async () => {
	const { repository } = await fixture();
	try {
		const query = { text: 'sparse needle', sort: { field: 'photo-id', direction: 'descending' } };
		const first = await readPhotoLibraryQueryStepV1(repository, 'catalog', { query });
		assert.equal(first.rows.length, 0); assert.equal(first.scanned, 64); assert.ok(first.cursor);
		const next = await readPhotoLibraryQueryStepV1(repository, 'catalog', { query, cursor: first.cursor });
		assert.deepEqual(next.rows.map(row => row.id), [queryPhotoV1(0).id]); assert.equal(next.cursor, null);
	} finally { await repository.close(); }
});

test('live smart collections project actual matching photos and reject stale query continuations', async () => {
	const { repository } = await fixture();
	try {
		const query = { filter: { kind: 'collection', id: 'smart' } };
		const first = await readPhotoLibraryQueryStepV1(repository, 'catalog', { query });
		assert.ok(first.rows.length > 0); assert.ok(first.rows.every(row => row.rating >= 4));
		assert.ok(first.cursor);
		const original = (await repository.loadPhoto('catalog', queryPhotoV1(0).id))!;
		await repository.savePhoto({ ...original, rating: 5 }, original.revision);
		await assert.rejects(readPhotoLibraryQueryStepV1(repository, 'catalog', { query, cursor: first.cursor }), /revision/iu);
		const fresh = await readPhotoLibraryQueryStepV1(repository, 'catalog', { query });
		assert.equal(fresh.rows[0]?.id, original.id);
	} finally { await repository.close(); }
});

test('invalid, foreign and future query cursors refuse before catalog loading or getters', async () => {
	let reads = 0, invoked = 0;
	const port = { loadCatalog: async () => { reads++; return queryCatalogRootV1(); }, readQueryPage: async () => { throw new Error('unexpected query'); } };
	for (const cursor of ['x'.repeat(2_049), '{', JSON.stringify({ schemaVersion: 2 })]) {
		await assert.rejects(readPhotoLibraryQueryStepV1(port, 'catalog', { cursor }));
	}
	const foreign = { schemaVersion: 1, catalogId: 'foreign', indexRevision: 0,
		querySha256: photoQueryDigestV1(normalizePhotoCatalogQueryV1()), captureBucket: 0, afterKey: ['foreign', 'photo-1'] };
	await assert.rejects(readPhotoLibraryQueryStepV1(port, 'catalog', { cursor: JSON.stringify(foreign) }), /another catalog/iu);
	await assert.rejects(readPhotoLibraryQueryStepV1(port, 'catalog', Object.defineProperty({}, 'query', {
		enumerable: true, get: () => { invoked++; return {}; },
	})));
	await assert.rejects(readPhotoLibraryQueryStepV1(port, 'catalog', { signal: AbortSignal.abort() }), { name: 'AbortError' });
	assert.equal(reads, 0); assert.equal(invoked, 0);
});

test('canceling a pending catalog read prevents its late result from admitting a query', async () => {
	const result = deferred<ReturnType<typeof queryCatalogRootV1>>(); let queried = 0;
	const controller = new AbortController();
	const port = { loadCatalog: async () => result.promise, readQueryPage: async () => { queried++; throw new Error('unexpected query'); } };
	const work = readPhotoLibraryQueryStepV1(port, 'catalog', { signal: controller.signal });
	const rejected = assert.rejects(work, { name: 'AbortError' }); controller.abort(); result.resolve(queryCatalogRootV1());
	await rejected; assert.equal(queried, 0);
});

test('index rebuilding is one explicit bounded step, never an implicit query side effect', async () => {
	let rebuilds = 0;
	const result = await rebuildPhotoLibraryQueryStepV1({ rebuildQueryIndexPage: async (_id, options) => {
		assert.equal(_id, 'catalog'); assert.ok(options?.signal); rebuilds++;
		return { processed: 16, bytes: 8_388_608, ready: false };
	} }, 'catalog', { signal: new AbortController().signal });
	assert.deepEqual(result, { processed: 16, readBytes: 8_388_608, ready: false }); assert.equal(rebuilds, 1);
});

test('definition pages keep one immediate-parent page and resolve an off-page selected label', async () => {
	const root = { ...queryCatalogRootV1(), folders: Array.from({ length: 70 }, (_, i) => ({
		id: `folder-${String(i).padStart(3, '0')}`, name: `Folder ${String(i)}`, parentId: null as string | null,
	})).concat([{ id: 'nested', name: 'Nested', parentId: 'folder-069' }]) };
	const port = { loadCatalog: async () => root };
	const first = await readPhotoLibraryDefinitionPageV1(port, 'catalog', { kind: 'folder', parentId: null, selectedId: 'folder-069' });
	assert.equal(first.rows.length, 64); assert.equal(first.parent, null);
	assert.equal(first.selected?.name, 'Folder 69'); assert.ok(first.cursor);
	const next = await readPhotoLibraryDefinitionPageV1(port, 'catalog', { kind: 'folder', parentId: null, cursor: first.cursor });
	assert.equal(next.rows.length, 6); assert.equal(next.cursor, null);
	const child = await readPhotoLibraryDefinitionPageV1(port, 'catalog', { kind: 'folder', parentId: 'folder-069' });
	assert.deepEqual(child.parent, { id: 'folder-069', name: 'Folder 69', parentId: null });
	assert.deepEqual(child.rows.map(row => row.id), ['nested']);
	await assert.rejects(readPhotoLibraryDefinitionPageV1({ loadCatalog: async () => ({ ...root, revision: 1 }) }, 'catalog', {
		kind: 'folder', parentId: null, cursor: first.cursor,
	}), /revision/iu);
});

test('definition projections retain manual and smart kind without exposing their document bodies', async () => {
	const page = await readPhotoLibraryDefinitionPageV1({ loadCatalog: async () => queryCatalogRootV1() }, 'catalog', { kind: 'collection' });
	assert.deepEqual(page.rows.map(row => row.kind === 'collection' ? row.collectionKind : null), ['manual', 'smart']);
	assert.ok(page.rows.every(row => !Object.hasOwn(row, 'query'))); assert.equal(page.rootRevision, 0);
	await assert.rejects(readPhotoLibraryDefinitionPageV1({ loadCatalog: async () => queryCatalogRootV1() }, 'catalog', {
		kind: 'keyword', parentId: null, selectedId: 'missing',
	}), /missing/iu);
});

test('definition request admission rejects scope/future/oversize cursor and getter before root reads', async () => {
	let reads = 0, invoked = 0;
	const port = { loadCatalog: async () => { reads++; return queryCatalogRootV1(); } };
	for (const cursor of ['x'.repeat(1_025), JSON.stringify({ schemaVersion: 2, catalogId: 'catalog', rootRevision: 0,
		kind: 'folder', parentId: null, afterId: 'folder' })]) {
		await assert.rejects(readPhotoLibraryDefinitionPageV1(port, 'catalog', { kind: 'folder', parentId: null, cursor }));
	}
	await assert.rejects(readPhotoLibraryDefinitionPageV1(port, 'catalog', { kind: 'collection', parentId: 'folder' }), /parent/iu);
	await assert.rejects(readPhotoLibraryDefinitionPageV1(port, 'catalog', Object.defineProperty({}, 'kind', {
		enumerable: true, get: () => { invoked++; return 'folder'; },
	})));
	await assert.rejects(readPhotoLibraryDefinitionPageV1(port, 'catalog', { kind: 'folder', signal: AbortSignal.abort() }), { name: 'AbortError' });
	assert.equal(reads, 0); assert.equal(invoked, 0);
});

test('native signal overrides never execute and cannot disguise pre-aborted demand at admission', () => {
	let invoked = 0;
	const admissions = [
		(signal: AbortSignal) => admitPhotoLibraryQueryStepRequestV1({ signal }),
		(signal: AbortSignal) => admitPhotoLibraryQueryBuildRequestV1({ signal }),
		(signal: AbortSignal) => admitPhotoLibraryDefinitionPageRequestV1({ kind: 'folder', signal }),
	];
	for (const admit of admissions) {
		const aborted = AbortSignal.abort();
		Object.defineProperty(aborted, 'throwIfAborted', { value: () => { invoked++; } });
		assert.throws(() => admit(aborted), { name: 'AbortError' });
		for (const key of ['throwIfAborted', 'aborted', 'reason', 'addEventListener', 'removeEventListener']) {
			const signal = new AbortController().signal;
			Object.defineProperty(signal, key, { get: () => { invoked++; throw new Error('signal accessor ran'); } });
			assert.throws(() => admit(signal), TypeError);
		}
	}
	assert.equal(invoked, 0);
});

test('late caller signal mutation refuses without executing overrides after an admitted catalog read', async () => {
	let invoked = 0;
	const selected = new AbortController(), result = deferred<ReturnType<typeof queryCatalogRootV1>>();
	const work = readPhotoLibraryQueryStepV1({ loadCatalog: async () => result.promise,
		readQueryPage: async () => ({ items: [], scanned: 0, continuation: null }) }, 'catalog', { signal: selected.signal });
	for (const key of ['throwIfAborted', 'aborted', 'reason', 'addEventListener', 'removeEventListener']) {
		Object.defineProperty(selected.signal, key, { get: () => { invoked++; throw new Error('late signal accessor ran'); } });
	}
	result.resolve(queryCatalogRootV1());
	await assert.rejects(work, TypeError); assert.equal(invoked, 0);
});
