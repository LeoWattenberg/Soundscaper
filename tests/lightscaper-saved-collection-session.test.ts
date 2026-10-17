/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibrarySavedCollectionCommandV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { createPhotoLibrarySavedCollectionsSessionV1 } from '../src/lightscaper/controller/photo-library-saved-collections-session-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const query = normalizePhotoCatalogQueryV2({ ...normalizePhotoCatalogQueryV2(), filter: { kind: 'collection', id: 'manual' },
	sort: { field: 'rating', direction: 'descending' }, predicate: { kind: 'text', column: 'title', operator: 'equals', value: 'Ordinary' } });

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), repository = new PhotoCatalogRepositoryV1({
		indexedDB: indexedDB as unknown as IDBFactory, databaseName: 'saved-collection-session', verifyOriginal: async () => undefined });
	await repository.createCatalog(queryCatalogRootV1());
	await repository.publishPhotos('catalog', 0, [queryPhotoV1(0), queryPhotoV1(1)]);
	const calls = { initialize: 0, close: 0, locks: 0, ids: 0 };
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		catalog: repository, stacks: repository, smartCollections: repository,
		initialize: async () => { calls.initialize++; return (await repository.loadCatalog('catalog'))!; },
		closeResources: async () => { calls.close++; await repository.close(); },
		exclusive: async (_catalog, operation, signal) => { calls.locks++; return operation(signal); },
		createId: () => `saved-${++calls.ids}`,
		journal: { get: async () => undefined, putIfAbsent: async () => { throw new Error('Unexpected journal write'); },
			deleteIfCurrent: async () => { throw new Error('Unexpected journal write'); } },
		media: { writeAsset: async () => { throw new Error('Unexpected media write'); }, custody: {
			findDigestPage: async () => { throw new Error('Unexpected digest scan'); }, stage: async () => { throw new Error('Unexpected custody stage'); },
			promote: async () => { throw new Error('Unexpected custody promotion'); }, releaseStaged: async () => { throw new Error('Unexpected custody release'); },
			readPage: async () => { throw new Error('Unexpected custody scan'); },
		} },
	};
	const owner = new PhotoLibrarySessionV1(ports);
	const create = async () => {
		const snapshot = await owner.savedCollections.readSnapshot({ collectionId: null });
		return owner.savedCollections.apply({ type: 'create', context: snapshot.context, name: 'Ordinary manual photos', queryJson: JSON.stringify(query) });
	};
	return { indexedDB, repository, ports, calls, owner, create };
}

test('saved Session facade has only four frozen scalar methods and missing capability refuses before readiness', async () => {
	let calls = 0;
	const facade = createPhotoLibrarySavedCollectionsSessionV1({ repositories: {}, createId: () => 'saved',
		ready: async () => { calls++; return 'catalog'; }, operation: async run => { calls++; return run(new AbortController().signal); },
		mutation: async run => { calls++; return run('catalog', new AbortController().signal); } });
	assert.deepEqual(Object.keys(facade).sort(), ['apply', 'readPage', 'readQueryStep', 'readSnapshot']);
	assert.ok(Object.isFrozen(facade));
	for (const run of [() => facade.readPage(), () => facade.readSnapshot({ collectionId: null }),
		() => facade.readQueryStep({ collectionId: 'saved', mode: 'ordinary' })]) await assert.rejects(run(), /unavailable/iu);
	assert.equal(calls, 0);
});

test('saved Session creates and executes full Query2 through scalar snapshots and one existing writer', async () => {
	const f = await fixture();
	try {
		assert.equal(f.calls.initialize, 0); assert.ok(Object.isFrozen(f.owner.savedCollections));
		const acknowledged = await f.create();
		assert.deepEqual(acknowledged.summary, { id: 'saved-1', revision: 0, name: 'Ordinary manual photos' });
		assert.equal(Object.hasOwn(acknowledged, 'definition'), false); assert.equal(Object.hasOwn(acknowledged, 'queryJson'), false);
		assert.deepEqual((await f.owner.savedCollections.readPage()).items, [acknowledged.summary]);
		const snapshot = await f.owner.savedCollections.readSnapshot({ collectionId: 'saved-1' });
		assert.deepEqual(snapshot.context, acknowledged.context); assert.deepEqual(JSON.parse(snapshot.definition!.queryJson), query);
		for (const mode of ['ordinary', 'collapsed'] as const) {
			const page = await f.owner.savedCollections.readQueryStep({ collectionId: 'saved-1', mode });
			assert.deepEqual(page.rows.map(row => row.id), [queryPhotoV1(1).id]); assert.equal(page.cursor, null);
			assert.equal(page.collectionName, 'Ordinary manual photos'); assert.equal(page.mode, mode);
			assert.equal(Object.hasOwn(page.context, 'collectionCount'), false);
			assert.deepEqual(Object.keys(page.rows[0]!).sort(), ['colorLabel', 'fileName', 'flag', 'height', 'id', 'rating', 'width']);
		}
		// Readiness takes one recovery lease; the saved command takes one writer lease.
		assert.equal(f.calls.initialize, 1); assert.equal(f.calls.locks, 2);
	} finally { await f.owner.close(); }
});

test('closed saved requests and opaque already-cancelled signals refuse without initialization, leases, IDs or getter probes', async () => {
	const f = await fixture(); let probes = 0;
	const context = { catalogId: 'catalog', catalogRevision: 1, indexRevision: 1, collectionStateRevision: 0, collectionCount: 0 };
	const command = { type: 'create', context, name: 'Saved', queryJson: JSON.stringify(query) } as const;
	try {
		const hostile = Object.defineProperty({}, 'collectionId', { enumerable: true, get() { probes++; return null; } });
		for (const run of [() => f.owner.savedCollections.readPage({ cursor: 'x'.repeat(4_097) }),
			() => f.owner.savedCollections.readSnapshot(hostile as { collectionId: null }),
			() => f.owner.savedCollections.readQueryStep({ collectionId: 'saved', mode: 'ordinary', query } as never),
			() => f.owner.savedCollections.apply({ ...command, queryJson: '{' }),
			() => f.owner.savedCollections.apply(command, { future: true } as never)]) await assert.rejects(run());
		const reason = new Proxy({}, { get() { probes++; throw new Error('Opaque reason'); }, getPrototypeOf() { probes++; throw new Error('Opaque reason'); } });
		for (const run of [() => f.owner.savedCollections.readPage({ signal: AbortSignal.abort(reason) }),
			() => f.owner.savedCollections.readSnapshot({ collectionId: null, signal: AbortSignal.abort(reason) }),
			() => f.owner.savedCollections.readQueryStep({ collectionId: 'saved', mode: 'collapsed', signal: AbortSignal.abort(reason) }),
			() => f.owner.savedCollections.apply(command, { signal: AbortSignal.abort(reason) })]) {
			await run().then(() => assert.fail('Expected cancellation'), error => { assert.ok(error === reason); });
		}
		assert.deepEqual(f.calls, { initialize: 0, close: 0, locks: 0, ids: 0 }); assert.equal(probes, 0);
	} finally { await f.owner.close(); }
});

test('saved commands detach before held readiness and share the Session writer with photo attributes', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), initialize = f.ports.initialize;
	f.ports.initialize = async signal => { entered.resolve(); await release.promise; return initialize(signal); };
	const mutable = { type: 'create' as const, context: { catalogId: 'catalog', catalogRevision: 1, indexRevision: 1, collectionStateRevision: 0, collectionCount: 0 },
		name: 'Original recipe', queryJson: JSON.stringify(query) };
	const work = f.owner.savedCollections.apply(mutable);
	try {
		await Promise.race([entered.promise, work]);
		mutable.context.catalogRevision = 99; mutable.name = 'Mutated recipe'; mutable.queryJson = '{}';
		await assert.rejects(f.owner.setRating(queryPhotoV1(0).id, 5), /already pending/iu);
		assert.equal(f.calls.locks, 0); release.resolve();
		assert.equal((await work).summary?.name, 'Original recipe');
		const loaded = await f.owner.savedCollections.readSnapshot({ collectionId: 'saved-1' });
		assert.deepEqual(JSON.parse(loaded.definition!.queryJson), query);
		await f.owner.setRating(queryPhotoV1(0).id, 5); assert.equal(f.calls.locks, 3);
	} finally { release.resolve(); await Promise.allSettled([work]); await f.owner.close(); }
});

test('saved query Close joins ordinary and collapsed terminal reads, suppresses late pages and preserves actual errors', async () => {
	for (const mode of ['ordinary', 'collapsed'] as const) for (const outcome of ['page', 'error'] as const) {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), terminal = new Error('Saved terminal read failed');
		await f.create();
		const key = mode === 'ordinary' ? 'readSmartCollectionQueryPageV1' : 'readSmartCollectionStackQueryPageV1';
		const read = f.repository[key];
		f.repository[key] = async function (this: PhotoCatalogRepositoryV1, ...args) {
			assert.equal(this, f.repository); const page = await read.apply(this, args); assert.equal(page.continuation, null);
			entered.resolve(); await release.promise; if (outcome === 'error') throw terminal; return page;
		};
		const work = f.owner.savedCollections.readQueryStep({ collectionId: 'saved-1', mode });
		try {
			await Promise.race([entered.promise, work]);
			const refused = outcome === 'error' ? assert.rejects(work, error => error === terminal) : assert.rejects(work, { name: 'AbortError' });
			const closing = f.owner.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
			await assert.rejects(f.owner.savedCollections.readPage(), /closed/iu);
			release.resolve(); await refused; await closing; assert.equal(f.calls.close, 1);
		} finally { release.resolve(); await Promise.allSettled([work]); await f.owner.close(); }
	}
});

test('saved caller cancellation joins reads, preserves opaque reason and never consults late signal shadows', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let probes = 0;
	await f.create(); const read = f.repository.readSmartCollectionSnapshotV1.bind(f.repository);
	const reason = new Proxy({}, { get() { probes++; throw new Error('Opaque reason'); }, getPrototypeOf() { probes++; throw new Error('Opaque reason'); } });
	f.repository.readSmartCollectionSnapshotV1 = async (...args) => { const page = await read(...args); entered.resolve(); await release.promise; return page; };
	const work = f.owner.savedCollections.readSnapshot({ collectionId: 'saved-1', signal: stop.signal });
	try {
		await Promise.race([entered.promise, work]);
		Object.defineProperty(stop.signal, 'aborted', { get() { probes++; return false; } });
		Object.defineProperty(stop.signal, 'reason', { get() { probes++; return {}; } }); stop.abort(reason);
		assert.equal(await remainsPending(work), true);
		const refused = work.then(() => assert.fail('Expected cancellation'), error => { assert.ok(error === reason); });
		release.resolve(); await refused; assert.equal(probes, 0);
		f.repository.readSmartCollectionSnapshotV1 = read;
		assert.equal((await f.owner.savedCollections.readPage()).items.length, 1);
	} finally { release.resolve(); await Promise.allSettled([work]); await f.owner.close(); }
});

test('saved durable ACK survives caller cancellation, Session Close and lease release failure', async () => {
	for (const failure of ['abort', 'close', 'release'] as const) {
		const f = await fixture(), stop = new AbortController(), save = f.repository.saveSmartCollection.bind(f.repository);
		let closing: Promise<void> | null = null;
		f.repository.saveSmartCollection = async (...args) => {
			const receipt = await save(...args);
			if (failure === 'abort') stop.abort('cancel after native completion');
			if (failure === 'close') closing = f.owner.close();
			return receipt;
		};
		try {
			const snapshot = await f.owner.savedCollections.readSnapshot({ collectionId: null });
			if (failure === 'release') f.ports.exclusive = async (_catalog, run, signal) => { await run(signal); throw new Error('Writer release failed'); };
			const acknowledged = await f.owner.savedCollections.apply({ type: 'create', context: snapshot.context, name: 'Durable recipe', queryJson: JSON.stringify(query) }, { signal: stop.signal });
			assert.equal(acknowledged.outcome, 'created'); assert.equal(acknowledged.summary?.name, 'Durable recipe');
			assert.deepEqual(acknowledged.notices, failure === 'release' ? ['cleanup-failed'] : []);
			if (failure !== 'close') assert.equal((await f.owner.savedCollections.readSnapshot({ collectionId: 'saved-1' })).definition?.name, 'Durable recipe');
			await closing;
		} finally { await f.owner.close(); }
	}
});

test('saved lease cancellation before writes preserves exact reason and releases the shared writer', async () => {
	const f = await fixture(), exclusive = f.ports.exclusive, save = f.repository.saveSmartCollection.bind(f.repository);
	let writes = 0; f.repository.saveSmartCollection = async (...args) => { writes++; return save(...args); };
	const reason = { leaseLost: true };
	try {
		const snapshot = await f.owner.savedCollections.readSnapshot({ collectionId: null });
		f.ports.exclusive = async (_catalog, run) => run(AbortSignal.abort(reason));
		const command: PhotoLibrarySavedCollectionCommandV1 = { type: 'create', context: snapshot.context, name: 'Recipe', queryJson: JSON.stringify(query) };
		await f.owner.savedCollections.apply(command).then(() => assert.fail('Expected lost lease'), error => { assert.equal(error, reason); });
		assert.equal(writes, 0); f.ports.exclusive = exclusive;
		assert.equal((await f.owner.savedCollections.apply(command)).outcome, 'created'); assert.equal(writes, 1);
	} finally { await f.owner.close(); }
});

test('saved update and delete honor atomic context, stale CAS and retained empty selection state', async () => {
	const f = await fixture();
	try {
		const created = await f.create(), snapshot = await f.owner.savedCollections.readSnapshot({ collectionId: created.collectionId });
		const update: PhotoLibrarySavedCollectionCommandV1 = { type: 'update', context: snapshot.context, collectionId: created.collectionId,
			expectedDefinitionRevision: snapshot.definition!.revision, name: 'Edited recipe', queryJson: snapshot.definition!.queryJson };
		const edited = await f.owner.savedCollections.apply(update); assert.equal(edited.summary?.revision, 1);
		await assert.rejects(f.owner.savedCollections.apply(update), /changed|revision/iu);
		await assert.rejects(f.owner.savedCollections.apply({ type: 'delete', context: { ...edited.context, catalogId: 'other' },
			collectionId: edited.collectionId, expectedDefinitionRevision: 1 }), /another selected catalog/iu);
		const deleted = await f.owner.savedCollections.apply({ type: 'delete', context: edited.context, collectionId: edited.collectionId, expectedDefinitionRevision: 1 });
		assert.equal(deleted.outcome, 'deleted'); assert.equal(deleted.summary, null); assert.equal(deleted.context.collectionCount, 0);
		const missing = await f.owner.savedCollections.readSnapshot({ collectionId: deleted.collectionId });
		assert.equal(missing.definition, null); assert.deepEqual(missing.context, deleted.context);
	} finally { await f.owner.close(); }
});
