/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { emptyPhotoMetadataV1 } from '../src/lightscaper/catalog/photo-metadata.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { indexState, photoStorageKey } from '../src/lightscaper/catalog/repository-records.ts';
import { savePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-repository-v1.ts';
import { photoStackRecordV1 } from '../src/lightscaper/catalog/photo-stack-record-v1.ts';
import { request } from '../src/common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from '../src/lightscaper/catalog/catalog-transaction.ts';

type Harness = Omit<ReturnType<typeof createInstrumentedIndexedDB>, 'stats'> & { readonly stats: {
	readonly getRequests: readonly { readonly store: string }[]; readonly getAllRequests: readonly unknown[];
	readonly cursorRequests: readonly { readonly delivered: number }[]; readonly activeTransactions: number;
	readonly countRequests: readonly { readonly store: string; readonly index: string | null }[];
	readonly keyCursorRequests: readonly { readonly store: string; readonly delivered: number }[];
} };
const databaseName = 'photo-stack-test';
function root() {
	return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog', name: 'Test', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
}
function photo(index: number) {
	const id = `photo-${String(index).padStart(4, '0')}`;
	return normalizePhotoDocumentV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo', id,
		catalogId: 'catalog', revision: 0, original: { schemaVersion: 1, kind: 'still', id: `source-${String(index)}`,
			name: `${id}.jpg`, mimeType: 'image/jpeg', storageKey: `original-${String(index)}`, contentSha256: 'a'.repeat(64),
			width: 10, height: 10, hasAlpha: false, byteLength: 123, retention: 'managed' },
		metadata: emptyPhotoMetadataV1(`${id}.jpg`), folderId: null, collectionIds: [], keywordIds: [], rating: 0,
		flag: 'unflagged', colorLabel: 'none', activeVersionId: 'master', versions: [{ id: 'master', kind: 'master',
			name: 'Original', createdAt: '2026-01-01T00:00:00.000Z', develop: defaultPhotoDevelopV1() }] });
}
function stack(ids = [photo(0).id, photo(1).id], id = 'stack') {
	return { schemaVersion: 1 as const, kind: 'photo-stack' as const, catalogId: 'catalog', id, revision: 0,
		photoIds: ids, coverPhotoId: ids[0]! };
}
function repository(indexedDB: Harness) {
	return new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory, databaseName,
		verifyOriginal: async () => undefined });
}
async function fixture(count = 4) {
	const indexedDB = createInstrumentedIndexedDB() as Harness;
	const repo = repository(indexedDB);
	await repo.createCatalog(root());
	for (let offset = 0; offset < count; offset += 16) {
		await repo.publishPhotos('catalog', offset / 16, Array.from({ length: Math.min(16, count - offset) }, (_, n) => photo(offset + n)));
	}
	return { indexedDB, repo, expectedCatalogRevision: Math.ceil(count / 16), expectedStateRevision: 0 };
}
function records(indexedDB: Harness) {
	return Object.fromEntries(PHOTO_CATALOG_STORES.map((name) => [name, indexedDB.records(databaseName, name)]));
}

test('stack creation, reorder, cover and dissolve survive reopen without changing photo originals or documents', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	const photosBefore = indexedDB.records(databaseName, 'photos');
	assert.deepEqual(await repo.readStackState('catalog'), { schemaVersion: 1, kind: 'photo-stack-state', catalogId: 'catalog', revision: 0, stackCount: 0 });
	const saved = await repo.saveStack(stack(), null, options);
	assert.equal(saved.revision, 0);
	const edited = await repo.saveStack({ ...saved, photoIds: [...saved.photoIds].reverse(), coverPhotoId: saved.photoIds[1] }, 0,
		{ expectedCatalogRevision: 2, expectedStateRevision: 1 });
	assert.equal(edited.revision, 1);
	assert.deepEqual(indexedDB.records(databaseName, 'photos'), photosBefore);
	assert.equal((await repo.readSnapshot('catalog'))?.indexRevision, 3);
	await repo.close();
	const reopened = repository(indexedDB);
	assert.deepEqual(await reopened.loadStack('catalog', 'stack'), edited);
	assert.equal((await reopened.readStackMembershipPage('catalog')).items.length, 2);
	const empty = await reopened.dissolveStack('catalog', 'stack', 1, { expectedCatalogRevision: 3, expectedStateRevision: 2 });
	assert.equal(empty.stackCount, 0); assert.equal(empty.revision, 3);
	assert.equal(await reopened.loadStack('catalog', 'stack'), null);
	assert.deepEqual(indexedDB.records(databaseName, 'photos'), photosBefore);
	await assert.rejects(reopened.saveStack(stack(), null, { expectedCatalogRevision: 4, expectedStateRevision: 0 }), /revision/iu);
	assert.equal((await reopened.readStackState('catalog')).revision, 3);
	await reopened.close();
});

test('global and per-stack CAS plus exclusive membership reject stale or foreign writes across owners', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	const saved = await repo.saveStack(stack(), null, options);
	const other = repository(indexedDB);
	const before = records(indexedDB);
	await assert.rejects(other.saveStack(stack([photo(1).id, photo(2).id], 'other'), null,
		{ expectedCatalogRevision: 2, expectedStateRevision: 1 }), /already|member|stack/iu);
	await assert.rejects(other.saveStack(saved, 0, options), /revision/iu);
	await assert.rejects(other.saveStack({ ...saved, revision: 1 }, 1,
		{ expectedCatalogRevision: 2, expectedStateRevision: 1 }), /revision/iu);
	await assert.rejects(other.saveStack(stack([photo(2).id, 'missing'], 'other'), null,
		{ expectedCatalogRevision: 2, expectedStateRevision: 1 }), /photo|missing/iu);
	assert.deepEqual(records(indexedDB), before);
	await repo.close(); await other.close();
});

test('every participating store failure atomically rolls back stack, reverse rows and all revision counters', async () => {
	for (const store of ['photoStacks', 'photoStackMemberships', 'photoStackStates', 'catalogs', 'catalogStates']) {
		const { indexedDB, repo, ...options } = await fixture();
		const before = records(indexedDB);
		indexedDB.failNextPutForStore(store, new DOMException('quota refused', 'QuotaExceededError'));
		await assert.rejects(repo.saveStack(stack(), null, options), { name: 'QuotaExceededError' });
		assert.deepEqual(records(indexedDB), before, store);
		assert.equal(indexedDB.stats.activeTransactions, 0);
		await repo.close();
	}
});

test('dissolve and changed-membership failures retain the previous ordered stack and reverse rows', async () => {
	for (const store of ['photoStackMemberships', 'photoStacks']) {
		const { indexedDB, repo, ...options } = await fixture();
		const saved = await repo.saveStack(stack(), null, options);
		const before = records(indexedDB);
		indexedDB.failNextDeleteForStore(store, new Error('delete refused'));
		await assert.rejects(repo.dissolveStack('catalog', 'stack', 0, { expectedCatalogRevision: 2, expectedStateRevision: 1 }), /delete refused/u);
		assert.deepEqual(records(indexedDB), before);
		indexedDB.failNextPutForStore('photoStackStates', new Error('counter refused'));
		await assert.rejects(repo.saveStack({ ...saved, photoIds: [photo(1).id, photo(2).id], coverPhotoId: photo(2).id }, 0,
			{ expectedCatalogRevision: 2, expectedStateRevision: 1 }), /counter refused/u);
		assert.deepEqual(records(indexedDB), before); await repo.close();
	}
});

test('cover and reorder edits preserve reverse rows without issuing their put or delete requests', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	const created = await repo.saveStack(stack(), null, options);
	const reverse = indexedDB.records(databaseName, 'photoStackMemberships');
	indexedDB.failNextPutForStore('photoStackMemberships', new Error('unexpected reverse put'));
	indexedDB.failNextDeleteForStore('photoStackMemberships', new Error('unexpected reverse delete'));
	const reordered = await repo.saveStack({ ...created, photoIds: [...created.photoIds].reverse() }, 0,
		{ expectedCatalogRevision: 2, expectedStateRevision: 1 });
	const cover = await repo.saveStack({ ...reordered, coverPhotoId: reordered.photoIds[0] }, 1,
		{ expectedCatalogRevision: 3, expectedStateRevision: 2 });
	assert.equal(cover.revision, 2); assert.deepEqual(indexedDB.records(databaseName, 'photoStackMemberships'), reverse);
	assert.deepEqual(await repo.loadStack('catalog', 'stack'), cover); await repo.close();
});

test('native signal method shadows after admission cannot lose a committed stack acknowledgment', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	const stop = new AbortController(); let getters = 0;
	indexedDB.onNextGetForStore('catalogs', () => {
		Object.defineProperty(stop.signal, 'removeEventListener', { get() { getters += 1; throw new Error('signal getter ran'); } });
	});
	const saved = await repo.saveStack(stack(), null, { ...options, signal: stop.signal });
	assert.equal(saved.revision, 0); assert.equal(getters, 0);
	assert.equal((await repo.readStackState('catalog')).revision, 1); await repo.close();
});

test('cancel before admission and during transaction rolls back; completed transaction wins a late abort', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	const stopped = new AbortController(); stopped.abort();
	const before = records(indexedDB);
	await assert.rejects(repo.saveStack(stack(), null, { ...options, signal: stopped.signal }), { name: 'AbortError' });
	const during = new AbortController();
	indexedDB.onNextGetForStore('catalogs', () => during.abort());
	await assert.rejects(repo.saveStack(stack(), null, { ...options, signal: during.signal }), { name: 'AbortError' });
	assert.deepEqual(records(indexedDB), before);
	const database = await openPhotoCatalogDatabaseV1(indexedDB as unknown as IDBFactory, databaseName, () => undefined);
	const late = new AbortController(); const original = database.transaction.bind(database);
	database.transaction = (names, mode, transactionOptions) => {
		const transaction = original(names, mode, transactionOptions);
		let complete: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { get: () => complete, set: (callback: IDBTransaction['oncomplete']) => {
			complete = function (event) { callback?.call(transaction, event); late.abort(); };
		} });
		return transaction;
	};
	const saved = await savePhotoStackV1(database, stack(), null, { ...options, signal: late.signal });
	assert.equal(saved.revision, 0); assert.ok(late.signal.aborted);
	assert.equal((await repo.readStackState('catalog')).stackCount, 1);
	database.close(); await repo.close();
});

test('corrupt or extra reverse membership refuses reads and writes without implicit repair', async () => {
	for (const corrupt of [
		{ key: `catalog|${photo(0).id}`, catalogId: 'catalog', photoId: photo(0).id, stackId: 'wrong', scope: 'catalog|wrong' },
		{ key: `catalog|${photo(2).id}`, catalogId: 'catalog', photoId: photo(2).id, stackId: 'stack', scope: 'catalog|stack' },
	]) {
		const { indexedDB, repo, ...options } = await fixture();
		const saved = await repo.saveStack(stack(), null, options);
		indexedDB.seedRecord(databaseName, 'photoStackMemberships', corrupt);
		const before = records(indexedDB);
		await assert.rejects(repo.loadStack('catalog', 'stack'), /membership|reverse|stack/iu);
		await assert.rejects(repo.dissolveStack('catalog', 'stack', 0, { expectedCatalogRevision: 2, expectedStateRevision: 1 }), /membership|reverse|stack/iu);
		await assert.rejects(repo.saveStack(saved, 0, { expectedCatalogRevision: 2, expectedStateRevision: 1 }), /membership|reverse|stack/iu);
		assert.deepEqual(records(indexedDB), before);
		await repo.close();
	}
});

test('cursor pages cap 64, bind catalog/index/stack state, use indexes and never materialize catalog photo aggregates', async () => {
	const { indexedDB, repo, expectedCatalogRevision } = await fixture(132);
	for (let index = 0; index < 66; index += 1) {
		await repo.saveStack(stack([photo(index * 2).id, photo(index * 2 + 1).id], `stack-${String(index).padStart(4, '0')}`), null,
			{ expectedCatalogRevision: expectedCatalogRevision + index, expectedStateRevision: index });
	}
	const getBefore = indexedDB.stats.getRequests.length;
	const page = await repo.readStackPage('catalog');
	assert.equal(page.items.length, 64); assert.ok(page.continuation);
	assert.equal((await repo.readStackPage('catalog', { continuation: page.continuation })).items.length, 2);
	const membership = await repo.readStackMembershipPage('catalog');
	assert.equal(membership.items.length, 64); assert.ok(membership.continuation);
	assert.equal(indexedDB.stats.getAllRequests.length, 0);
	assert.equal(indexedDB.stats.getRequests.slice(getBefore).filter((entry) => entry.store === 'photos').length, 0);
	assert.ok(indexedDB.stats.cursorRequests.every((entry) => entry.delivered <= 65));
	await assert.rejects(repo.readStackMembershipPage('catalog', { continuation: page.continuation }), /scope/iu);
	const edited = await repo.savePhoto({ ...photo(0), rating: 5 }, 0);
	assert.equal(edited.revision, 1);
	await assert.rejects(repo.readStackPage('catalog', { continuation: page.continuation }), /revision/iu);
	await repo.close();
});

test('invalid closed write and cursor input refuses before lazy IndexedDB acquisition', async () => {
	let opens = 0; let accesses = 0;
	const repo = new PhotoCatalogRepositoryV1({ indexedDB: { open() { opens += 1; throw new Error('opened'); } } as unknown as IDBFactory,
		verifyOriginal: async () => undefined });
	const options = { expectedCatalogRevision: 0, expectedStateRevision: 0 };
	await assert.rejects(repo.saveStack(Object.defineProperty(stack(), 'photoIds', { get() { accesses += 1; return []; } }), null, options));
	await assert.rejects(repo.saveStack(stack(), null, Object.defineProperty({ ...options }, 'signal', { get() { accesses += 1; return undefined; } })));
	await assert.rejects(repo.saveStack({ ...stack(), revision: 2 }, null, options));
	await assert.rejects(repo.dissolveStack('catalog', 'stack', -1, options));
	await assert.rejects(repo.readStackPage('catalog', { continuation: { catalogId: 'foreign' } } as never));
	assert.equal(opens, 0); assert.equal(accesses, 0);
	await repo.close();
});

test('admitted stack and revision options detach before a reentrant lazy database port mutates caller objects', async () => {
	const { indexedDB, repo, ...options } = await fixture(); await repo.close();
	const candidate = stack(); const opening = indexedDB.open.bind(indexedDB); let calls = 0;
	const wrapper = { open(name: string, version: number) {
		calls += 1; candidate.photoIds[0] = 'absent'; candidate.coverPhotoId = 'absent'; options.expectedCatalogRevision = 999;
		return opening(name, version);
	} };
	const reopened = new PhotoCatalogRepositoryV1({ indexedDB: wrapper as unknown as IDBFactory, databaseName, verifyOriginal: async () => undefined });
	const saved = await reopened.saveStack(candidate, null, options);
	assert.deepEqual(saved.photoIds, [photo(0).id, photo(1).id]); assert.equal(saved.coverPhotoId, photo(0).id);
	assert.equal(calls, 1); await reopened.close();
});

test('one maximum stack is bounded independently from 64 targeted annotations and refuses oversized target batches', async () => {
	const { indexedDB, repo, ...options } = await fixture(1024);
	const ids = Array.from({ length: 1024 }, (_, n) => photo(n).id);
	await repo.saveStack(stack(ids), null, options);
	const before = indexedDB.stats.getRequests.length;
	const loaded = await repo.loadStack('catalog', 'stack'); assert.equal(loaded?.photoIds.length, 1024);
	assert.equal(indexedDB.stats.getRequests.slice(before).filter(row => row.store === 'photoStackMemberships').length, 1024);
	const annotationBefore = indexedDB.stats.getRequests.length;
	const annotations = await repo.readStackMembershipPage('catalog', { photoIds: ids.slice(0, 64) });
	assert.equal(annotations.items.length, 64); assert.equal(annotations.continuation, null);
	assert.equal(indexedDB.stats.getRequests.slice(annotationBefore).filter(row => row.store === 'photoStackMemberships').length, 64);
	await assert.rejects(repo.readStackMembershipPage('catalog', { photoIds: ids.slice(0, 65) }));
	assert.equal(indexedDB.stats.getAllRequests.length, 0);
	assert.equal(indexedDB.stats.activeTransactions, 0); await repo.close();
});

test('member name pages read only64 scalar summaries, authenticate the stack binding and reject foreign IDs', async () => {
	const { indexedDB, repo, ...options } = await fixture(80);
	const ids = Array.from({ length: 79 }, (_, n) => photo(n).id);
	await repo.saveStack(stack(ids), null, options);
	const before = indexedDB.stats.getRequests.length;
	const rows = await repo.readStackMemberPage('catalog', 'stack', 0, ids.slice(0, 64));
	assert.equal(rows.length, 64); assert.deepEqual(rows[0], { photoId: photo(0).id, fileName: photo(0).metadata.fileName, photoRevision: 0 });
	assert.ok(Object.isFrozen(rows) && Object.isFrozen(rows[0]));
	const gets = indexedDB.stats.getRequests.slice(before);
	assert.equal(gets.filter(row => row.store === 'summaries').length, 64); assert.equal(gets.filter(row => row.store === 'photos').length, 0);
	await assert.rejects(repo.readStackMemberPage('catalog', 'stack', 1, ids.slice(0, 64)), /revision/iu);
	await assert.rejects(repo.readStackMemberPage('catalog', 'stack', 0, [photo(79).id]), /member/iu);
	await assert.rejects(repo.readStackMemberPage('catalog', 'stack', 0, ids.slice(0, 65)));
	assert.equal(indexedDB.stats.activeTransactions, 0); await repo.close();
});

test('corrupt scope probes stop at one legacy key or the first extra admitted-member key instead of native count scans', async () => {
	const { indexedDB, repo, ...options } = await fixture(1024);
	const ids = Array.from({ length: 1024 }, (_, n) => photo(n).id);
	await repo.saveStack(stack(ids), null, options);
	for (let index = 0; index < 2000; index += 1) {
		const photoId = `z-${String(index).padStart(4, '0')}`;
		indexedDB.seedRecord(databaseName, 'photoStackMemberships', { key: `catalog|${photoId}`, catalogId: 'catalog', photoId, stackId: 'stack', scope: 'catalog|stack' });
	}
	const before = indexedDB.stats.keyCursorRequests.length;
	await assert.rejects(repo.loadStack('catalog', 'stack'), /membership|reverse/iu);
	const probes = indexedDB.stats.keyCursorRequests.slice(before);
	assert.ok(probes.length > 0); assert.ok(probes.every(row => row.delivered <= 1025));
	assert.equal(indexedDB.stats.countRequests.length, 0); await repo.close();
	const legacy = await fixture();
	for (let index = 0; index < 2000; index += 1) {
		const photoId = `z-${String(index)}`;
		legacy.indexedDB.seedRecord(databaseName, 'photoStackMemberships', { key: `catalog|${photoId}`, catalogId: 'catalog', photoId, stackId: 'stack', scope: 'catalog|stack' });
	}
	await assert.rejects(legacy.repo.readStackState('catalog'), /retained/iu);
	assert.ok(legacy.indexedDB.stats.keyCursorRequests.every(row => row.delivered <= 1));
	assert.equal(legacy.indexedDB.stats.countRequests.length, 0); await legacy.repo.close();
});

test('orphan reverse rows and absent state cannot be overwritten as an empty legacy catalog', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	indexedDB.seedRecord(databaseName, 'photoStackMemberships', { key: `catalog|${photo(0).id}`, catalogId: 'catalog',
		photoId: photo(0).id, stackId: 'stack', scope: 'catalog|stack' });
	const before = records(indexedDB);
	await assert.rejects(repo.readStackState('catalog'), /retained|state/iu);
	await assert.rejects(repo.saveStack(stack(), null, options), /retained|state/iu);
	assert.deepEqual(records(indexedDB), before); await repo.close();
});

test('revision exhaustion and future/corrupt stack state preserve every store', async () => {
	for (const owner of ['catalog', 'index', 'state', 'stack']) {
		const { indexedDB, repo, ...options } = await fixture();
		const saved = await repo.saveStack(stack(), null, options);
		const currentRoot = (await repo.loadCatalog('catalog'))!;
		const catalogRevision = owner === 'catalog' ? Number.MAX_SAFE_INTEGER : 2;
		indexedDB.seedRecord(databaseName, 'catalogs', { ...currentRoot, revision: catalogRevision });
		indexedDB.seedRecord(databaseName, 'catalogStates', indexState({ ...currentRoot, revision: catalogRevision }, owner === 'index' ? Number.MAX_SAFE_INTEGER : 2));
		indexedDB.seedRecord(databaseName, 'photoStackStates', { schemaVersion: 1, kind: 'photo-stack-state', catalogId: 'catalog',
			revision: owner === 'state' ? Number.MAX_SAFE_INTEGER : 1, stackCount: 1 });
		const candidate = { ...saved, revision: owner === 'stack' ? Number.MAX_SAFE_INTEGER : 0 };
		indexedDB.seedRecord(databaseName, 'photoStacks', photoStackRecordV1(candidate));
		const before = records(indexedDB);
		await assert.rejects(repo.saveStack(candidate, candidate.revision,
			{ expectedCatalogRevision: catalogRevision, expectedStateRevision: owner === 'state' ? Number.MAX_SAFE_INTEGER : 1 }), /revision|integer|between/iu);
		assert.deepEqual(records(indexedDB), before); await repo.close();
	}
	const { indexedDB, repo } = await fixture();
	indexedDB.seedRecord(databaseName, 'photoStackStates', { schemaVersion: 2, kind: 'photo-stack-state', catalogId: 'catalog', revision: 0, stackCount: 0 });
	await assert.rejects(repo.readStackState('catalog'), /version/iu); await repo.close();
});

test('DB1 and DB2 upgrades add empty stack stores without reading or rewriting old aggregates', async () => {
	for (const version of [1, 2]) {
		const indexedDB = createInstrumentedIndexedDB() as Harness;
		const factory = indexedDB as unknown as IDBFactory;
		const old = await new Promise<IDBDatabase>((resolve, reject) => {
			const opening = factory.open(databaseName, version);
			opening.onupgradeneeded = () => {
				for (const name of ['catalogs', 'catalogStates', 'photos', 'summaries', 'memberships', ...(version === 2 ? ['photoQueryRows', 'photoQueryBuildStates'] : [])]) {
					opening.result.createObjectStore(name, { keyPath: ['catalogs', 'catalogStates', 'photoQueryBuildStates'].includes(name) ? 'id' : 'key' });
				}
			};
			opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
		});
		indexedDB.seedRecord(databaseName, 'catalogs', root());
		indexedDB.seedRecord(databaseName, 'photos', { key: photoStorageKey('catalog', photo(0).id), document: photo(0) });
		const before = indexedDB.records(databaseName, 'photos'); old.close();
		const upgraded = await openPhotoCatalogDatabaseV1(factory, databaseName, () => undefined);
		assert.equal(upgraded.version, 5);
		for (const name of ['photoStacks', 'photoStackMemberships', 'photoStackStates']) assert.ok(upgraded.objectStoreNames.contains(name));
		const index = upgraded.transaction('photoStacks').objectStore('photoStacks').index('memberKey');
		assert.equal(index.keyPath, 'memberKeys'); assert.equal(index.unique, true); assert.equal(index.multiEntry, true);
		assert.deepEqual(indexedDB.records(databaseName, 'photos'), before);
		assert.equal(indexedDB.stats.getRequests.length, 0); assert.equal(indexedDB.stats.cursorRequests.length, 0);
		assert.equal(indexedDB.stats.getAllRequests.length, 0); upgraded.close();
	}
});

test('unique native forward membership prevents a second raw stack even after reverse-row deletion', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	await repo.saveStack(stack(), null, options);
	const database = await openPhotoCatalogDatabaseV1(indexedDB as unknown as IDBFactory, databaseName, () => undefined);
	try {
		await catalogTransaction(database, ['photoStackMemberships'], 'readwrite', async stores => {
			await request(stores.photoStackMemberships.delete(`catalog|${photo(1).id}`));
		});
		const before = records(indexedDB);
		await assert.rejects(catalogTransaction(database, ['photoStacks'], 'readwrite', async stores => {
			await request(stores.photoStacks.put(photoStackRecordV1(stack([photo(1).id, photo(2).id], 'second'))));
		}), { name: 'ConstraintError' });
		assert.deepEqual(records(indexedDB), before);
		await assert.rejects(repo.readStackMembershipPage('catalog', { photoIds: [photo(1).id] }), /forward|reverse/iu);
		await assert.rejects(repo.saveStack(stack([photo(1).id, photo(2).id], 'second'), null,
			{ expectedCatalogRevision: 2, expectedStateRevision: 1 }), /forward|reverse/iu);
		assert.deepEqual(records(indexedDB), before);
	} finally { database.close(); await repo.close(); }
});

test('every stored-stack reader and mutation rejects a corrupted private forward projection', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	const saved = await repo.saveStack(stack(), null, options);
	indexedDB.seedRecord(databaseName, 'photoStacks', { ...photoStackRecordV1(saved), memberKeys: [...photoStackRecordV1(saved).memberKeys].reverse() });
	const before = records(indexedDB);
	await assert.rejects(repo.loadStack('catalog', 'stack'), /forward|projection/iu);
	await assert.rejects(repo.readStackPage('catalog'), /forward|projection/iu);
	await assert.rejects(repo.readStackMembershipPage('catalog', { photoIds: [photo(0).id] }), /forward|projection/iu);
	await assert.rejects(repo.readStackMemberPage('catalog', 'stack', 0, [photo(0).id]), /forward|projection/iu);
	await assert.rejects(repo.saveStack(saved, 0, { expectedCatalogRevision: 2, expectedStateRevision: 1 }), /forward|projection/iu);
	await assert.rejects(repo.dissolveStack('catalog', 'stack', 0, { expectedCatalogRevision: 2, expectedStateRevision: 1 }), /forward|projection/iu);
	assert.deepEqual(records(indexedDB), before); await repo.close();
});

test('failed membership-change publication rolls back both directions of the native forward index', async () => {
	const { indexedDB, repo, ...options } = await fixture();
	const saved = await repo.saveStack(stack(), null, options), before = records(indexedDB);
	indexedDB.failNextPutForStore('catalogStates', new Error('Late state write refused.'));
	await assert.rejects(repo.saveStack({ ...saved, photoIds: [photo(0).id, photo(2).id] }, 0,
		{ expectedCatalogRevision: 2, expectedStateRevision: 1 }), /Late state/iu);
	assert.deepEqual(records(indexedDB), before);
	assert.deepEqual((await repo.readStackMembershipPage('catalog', { photoIds: [photo(1).id] })).items.map(row => row.stackId), ['stack']);
	assert.deepEqual((await repo.readStackMembershipPage('catalog', { photoIds: [photo(2).id] })).items, []);
	assert.deepEqual(await repo.loadStack('catalog', 'stack'), saved); await repo.close();
});
