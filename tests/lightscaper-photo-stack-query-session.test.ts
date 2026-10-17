/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoQueryDigestV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import type { PhotoLibraryQueryV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const query: PhotoLibraryQueryV1 = { text: '', filter: null, sort: { field: 'photo-id', direction: 'ascending' } };

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = crypto.randomUUID();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory, databaseName, verifyOriginal: async () => undefined });
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Query library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	const source = photoArchiveFixture().photo;
	const photos = Array.from({ length: 4 }, (_, index) => normalizePhotoDocumentV1({ ...source, id: `photo-${String(index)}`, catalogId: root.id,
		original: { ...source.original, id: `original-${String(index)}`, storageKey: `body-${String(index)}` } }));
	await repository.createCatalog(root); await repository.publishPhotos(root.id, 0, photos); await repository.rebuildQueryIndexPage(root.id);
	await repository.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', id: 'stack-1', catalogId: root.id,
		revision: 0, photoIds: ['photo-0', 'photo-1', 'photo-2'], coverPhotoId: 'photo-2' }), null,
	{ expectedCatalogRevision: 1, expectedStateRevision: 0 });
	const calls = { initialize: 0, close: 0 };
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		catalog: repository, stacks: repository,
		initialize: async () => { calls.initialize++; return (await repository.loadCatalog(root.id))!; },
		closeResources: async () => { calls.close++; await repository.close(); },
		journal: { get: async () => undefined, putIfAbsent: async () => { throw new Error('Unexpected journal write'); },
			deleteIfCurrent: async () => { throw new Error('Unexpected journal write'); } },
		media: { writeAsset: async () => { throw new Error('Unexpected media write'); }, custody: {
			findDigestPage: async () => { throw new Error('Unexpected digest scan'); }, stage: async () => { throw new Error('Unexpected custody stage'); },
			promote: async () => { throw new Error('Unexpected custody promotion'); }, releaseStaged: async () => { throw new Error('Unexpected custody release'); },
			readPage: async () => { throw new Error('Unexpected custody scan'); },
		} },
	};
	return { repository, ports, calls, owner: new PhotoLibrarySessionV1(ports) };
}

test('real stack query Session returns only neutral scalar representatives through its existing owner', async () => {
	const f = await fixture();
	try {
		const page = await f.owner.readStackQueryStep({ query });
		assert.equal(page.catalogName, 'Query library'); assert.equal(page.totalCount, 4); assert.equal(page.cursor, null);
		assert.deepEqual(page.rows.map(row => row.id), ['photo-2', 'photo-3']);
		assert.deepEqual(Object.keys(page.rows[0]!).sort(), ['colorLabel', 'fileName', 'flag', 'height', 'id', 'rating', 'width']);
		assert.ok(Object.isFrozen(page)); assert.ok(Object.isFrozen(page.rows)); assert.ok(Object.isFrozen(page.rows[0]));
		assert.ok(page.scanned <= 64); assert.equal(f.calls.initialize, 1);
	} finally { await f.owner.close(); }
});

test('stack query admission refuses hostile requests, future cursors and cancellation before lazy initialization', async () => {
	const f = await fixture(); let getters = 0;
	try {
		const hostile = Object.defineProperty({ query }, 'query', { get() { getters++; return query; } });
		for (const request of [hostile, { query, cursor: 'x'.repeat(4097) }, { query, cursor: JSON.stringify({ schemaVersion: 2 }) },
			{ query, future: true }, { query, signal: AbortSignal.abort() }]) {
			await assert.rejects(f.owner.readStackQueryStep(request));
		}
		const signal = new AbortController().signal;
		Object.defineProperty(signal, 'aborted', { get() { getters++; return false; } });
		await assert.rejects(f.owner.readStackQueryStep({ query, signal }));
		assert.equal(getters, 0); assert.deepEqual(f.calls, { initialize: 0, close: 0 });
	} finally { await f.owner.close(); }
});

test('query criteria detach before held initialization allows a caller to rewrite its request', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const initialize = f.ports.initialize;
	f.ports.initialize = async signal => { entered.resolve(); await release.promise; return initialize(signal); };
	const mutable = { text: '', filter: null, sort: { field: 'photo-id' as const, direction: 'ascending' as 'ascending' | 'descending' } };
	const work = f.owner.readStackQueryStep({ query: mutable }); await entered.promise;
	mutable.text = 'absent'; mutable.sort.direction = 'descending'; release.resolve();
	try { assert.deepEqual((await work).rows.map(row => row.id), ['photo-2', 'photo-3']); }
	finally { await f.owner.close(); }
});

test('Close joins a held collapsed read, refuses its late scalar response and then releases resources', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const read = f.repository.readStackQueryPage.bind(f.repository);
	f.repository.readStackQueryPage = async (...args) => { const page = await read(...args); entered.resolve(); await release.promise; return page; };
	const work = f.owner.readStackQueryStep({ query }); await entered.promise;
	const refused = assert.rejects(work, { name: 'AbortError' }), closing = f.owner.close();
	assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
	await assert.rejects(f.owner.readStackQueryStep({ query }), /closed/iu);
	release.resolve(); await refused; await closing; assert.equal(f.calls.close, 1);
});

test('caller cancellation during a held result refuses after settlement without closing the shared Session', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const read = f.repository.readStackQueryPage.bind(f.repository);
	f.repository.readStackQueryPage = async (...args) => { const page = await read(...args); entered.resolve(); await release.promise; return page; };
	const work = f.owner.readStackQueryStep({ query, signal: stop.signal }); await entered.promise;
	const refused = assert.rejects(work, { name: 'AbortError' }); stop.abort();
	assert.equal(await remainsPending(work), true); assert.equal(f.calls.close, 0); release.resolve(); await refused;
	f.repository.readStackQueryPage = read;
	try { assert.deepEqual((await f.owner.readStackQueryStep({ query })).rows.map(row => row.id), ['photo-2', 'photo-3']); }
	finally { await f.owner.close(); }
});

test('foreign continuations refuse at the selected catalog before a repository query starts', async () => {
	const f = await fixture(); let reads = 0;
	const read = f.repository.readStackQueryPage.bind(f.repository);
	f.repository.readStackQueryPage = (...args) => { reads++; return read(...args); };
	const cursor = JSON.stringify({ schemaVersion: 1, kind: 'collapsed-photo-query', catalogId: 'foreign', catalogRevision: 2,
		indexRevision: 1, stateRevision: 1, querySha256: photoQueryDigestV1(query), captureBucket: 0, afterKey: ['foreign', 'photo-0'], pending: null,
		stackAudit: null, progressSha256: '0'.repeat(64) });
	try { await assert.rejects(f.owner.readStackQueryStep({ query, cursor }), /catalog/iu); assert.equal(reads, 0); }
	finally { await f.owner.close(); }
});

test('hostile and foreign repository responses refuse before neutral rows are published', async () => {
	const f = await fixture(); let getters = 0;
	const read = f.repository.readStackQueryPage.bind(f.repository);
	f.repository.readStackQueryPage = async (...args) => Object.defineProperty({ ...await read(...args) }, 'items', {
		get() { getters++; return []; },
	});
	try {
		await assert.rejects(f.owner.readStackQueryStep({ query }), /data property/iu); assert.equal(getters, 0);
		f.repository.readStackQueryPage = async (...args) => {
			const page = await read(...args); return { ...page, items: [{ ...page.items[0]!, catalogId: 'foreign',
				key: photoStorageKey('foreign', page.items[0]!.photoId) }] };
		};
		await assert.rejects(f.owner.readStackQueryStep({ query }), /another catalog/iu);
	} finally { await f.owner.close(); }
});

test('missing stack capability refuses before initialization while ordinary library reads remain usable', async () => {
	const f = await fixture(); delete f.ports.stacks;
	try {
		await assert.rejects(f.owner.readStackQueryStep({ query }), /unavailable/iu); assert.equal(f.calls.initialize, 0);
		assert.equal((await f.owner.readPage()).rows.length, 4);
	} finally { await f.owner.close(); }
});
