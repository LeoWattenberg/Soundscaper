/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'photo-organization-session', verifyOriginal: async () => undefined });
	await repository.createCatalog(queryCatalogRootV1());
	await repository.publishPhotos('catalog', 0, [queryPhotoV1()]);
	const calls: string[] = [];
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		catalog: repository,
		initialize: async () => { calls.push('initialize'); return (await repository.loadCatalog('catalog'))!; },
		closeResources: async () => { calls.push('close'); await repository.close(); },
		exclusive: async (_id, operation, signal) => { calls.push('lock'); return operation(signal); },
		journal: { get: async () => undefined, putIfAbsent: async () => true, deleteIfCurrent: async () => true },
		media: { writeAsset: async () => { throw new Error('Organization must never write original media.'); }, custody: {
			findDigestPage: async () => ({ matches: [], afterAssetId: null }), stage: async () => undefined,
			promote: async () => undefined, releaseStaged: async () => undefined, readPage: async () => ({ roots: [], afterKey: null }),
		} },
	};
	return { repository, ports, calls, owner: new PhotoLibrarySessionV1(ports) };
}

test('organization requests refuse unknown fields, accessors and aborted signals before lazy storage or writer admission', async () => {
	const f = await fixture(); let invoked = 0;
	try {
		await assert.rejects(f.owner.readDefinition({ kind: 'future', id: 'folder' } as never));
		await assert.rejects(f.owner.applyDefinition(-1, { type: 'delete-empty-node', nodeKind: 'folder', id: 'folder' }));
		await assert.rejects(f.owner.applyDefinition(1, Object.defineProperty({}, 'type', {
			enumerable: true, get: () => { invoked++; return 'create-node'; },
		}) as never));
		await assert.rejects(f.owner.applyMemberships(queryPhotoV1().id, 0, { keywordIds: ['keyword', 'keyword'] }));
		await assert.rejects(f.owner.applyMemberships(queryPhotoV1().id, 0, { original: {} } as never));
		await assert.rejects(f.owner.readMemberships(queryPhotoV1().id, { signal: AbortSignal.abort() }), { name: 'AbortError' });
		assert.equal(invoked, 0); assert.deepEqual(f.calls, []);
	} finally { await f.owner.close(); }
});

test('definition commands share the session writer, compare a fresh root and return only scalar acknowledgements', async () => {
	const f = await fixture();
	try {
		const read = await f.owner.readDefinition({ kind: 'folder', id: 'folder' }); assert.equal(read.rootRevision, 1);
		const initialLocks = f.calls.filter(call => call === 'lock').length;
		const ack = await f.owner.applyDefinition(read.rootRevision,
			{ type: 'create-node', nodeKind: 'keyword', id: 'authored', name: 'Authored', parentId: null });
		assert.deepEqual(ack, { rootRevision: 2, row: { kind: 'keyword', id: 'authored', name: 'Authored', parentId: null } });
		await assert.rejects(f.owner.applyDefinition(read.rootRevision,
			{ type: 'rename-node', nodeKind: 'keyword', id: 'authored', name: 'Stale' }), { code: 'CATALOG_REVISION_CONFLICT' });
		assert.equal((await f.owner.readDefinition({ kind: 'keyword', id: 'authored' })).row.name, 'Authored');
		assert.equal((await f.repository.loadCatalog('catalog'))?.revision, 2);
		assert.equal(f.calls.filter(call => call === 'lock').length, initialLocks + 2);
	} finally { await f.owner.close(); }
});

test('membership edits recheck the selected photo revision and preserve original, extracted and develop state', async () => {
	const f = await fixture(), photoId = queryPhotoV1().id;
	try {
		const snapshot = await f.owner.readMemberships(photoId), before = (await f.repository.loadPhoto('catalog', photoId))!;
		await f.repository.savePhoto({ ...before, rating: 4 }, before.revision);
		await assert.rejects(f.owner.applyMemberships(photoId, snapshot.revision, { keywordIds: [] }), { code: 'PHOTO_REVISION_CONFLICT' });
		const fresh = await f.owner.readMemberships(photoId); assert.equal(fresh.revision, 1);
		const ack = await f.owner.applyMemberships(photoId, fresh.revision, { folderId: null, keywordIds: [], collectionIds: [] });
		assert.deepEqual(ack.snapshot, { photoId, revision: 2, folderId: null, keywordIds: [], collectionIds: [] });
		const after = (await f.repository.loadPhoto('catalog', photoId))!;
		assert.equal(ack.row.rating, 4); assert.deepEqual(after.original, before.original);
		assert.deepEqual(after.extractedMetadata, before.extractedMetadata); assert.deepEqual(after.versions, before.versions);
		assert.equal((await f.repository.readSummaryPage('catalog', { filter: { kind: 'keyword', id: 'keyword' } })).items.length, 0);
		await assert.rejects(f.owner.applyMemberships(photoId, 2, { collectionIds: ['smart'] }), /manual/iu);
	} finally { await f.owner.close(); }
});

test('a pending definition write refuses an overlapping membership write and close joins its durable acknowledgement', async () => {
	const f = await fixture(), entered = deferred<void>(), deliver = deferred<void>();
	const saved = f.repository.saveCatalog.bind(f.repository);
	f.ports.catalog = { ...f.ports.catalog,
		loadCatalog: f.repository.loadCatalog.bind(f.repository),
		loadPhoto: f.repository.loadPhoto.bind(f.repository),
		publishPhotos: f.repository.publishPhotos.bind(f.repository),
		savePhoto: f.repository.savePhoto.bind(f.repository),
		readSummaryPage: f.repository.readSummaryPage.bind(f.repository),
		readQueryPage: f.repository.readQueryPage.bind(f.repository),
		rebuildQueryIndexPage: f.repository.rebuildQueryIndexPage.bind(f.repository),
		saveCatalog: async (...args) => { const ack = await saved(...args); entered.resolve(); await deliver.promise; return ack; },
	};
	const write = f.owner.applyDefinition(1, { type: 'rename-node', nodeKind: 'keyword', id: 'keyword', name: 'Saved' });
	try {
		await entered.promise;
		await assert.rejects(f.owner.applyMemberships(queryPhotoV1().id, 0, { keywordIds: [] }), /pending/iu);
		const closing = f.owner.close(); await remainsPending(closing); assert.equal(f.calls.includes('close'), false);
		deliver.resolve(); const ack = await write; assert.equal(ack.row?.name, 'Saved'); assert.equal(ack.rootRevision, 2);
		await closing; assert.equal(f.calls.at(-1), 'close');
	} finally { deliver.resolve(); await write.catch(() => undefined); await f.owner.close(); }
});

test('the session preserves a membership acknowledgement when cancellation follows the commit', async () => {
	const f = await fixture(), controller = new AbortController(), photoId = queryPhotoV1().id;
	const save = f.repository.savePhoto.bind(f.repository);
	const wrap = new Proxy(f.repository, { get(target, key, receiver) {
		if (key === 'savePhoto') return async (...args: Parameters<typeof save>) => { const result = await save(...args); controller.abort(); return result; };
		const member: unknown = Reflect.get(target, key, receiver); return typeof member === 'function' ? member.bind(target) as unknown : member;
	} });
	f.ports.catalog = wrap;
	try {
		const ack = await f.owner.applyMemberships(photoId, 0, { keywordIds: [] }, { signal: controller.signal });
		assert.equal(controller.signal.aborted, true); assert.equal(ack.snapshot.revision, 1); assert.deepEqual(ack.snapshot.keywordIds, []);
	} finally { await f.owner.close(); }
});
