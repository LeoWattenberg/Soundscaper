/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const query = normalizePhotoCatalogQueryV2();

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), repository = new PhotoCatalogRepositoryV1({
		indexedDB: indexedDB as unknown as IDBFactory, databaseName: 'metadata-query-session', verifyOriginal: async () => undefined });
	await repository.createCatalog(queryCatalogRootV1());
	await repository.publishPhotos('catalog', 0, [queryPhotoV1(0), queryPhotoV1(1)]);
	const calls = { initialize: 0, close: 0 };
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		catalog: repository, stacks: repository,
		initialize: async () => { calls.initialize++; return (await repository.loadCatalog('catalog'))!; },
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

test('metadata Session exposes actual scalar query and explicit bounded rebuild without borrowing original media', async () => {
	const f = await fixture();
	try {
		assert.equal(f.calls.initialize, 0);
		const page = await f.owner.readQueryStepV2({ query });
		assert.equal(page.totalCount, 2); assert.equal(page.rows.length, 2); assert.equal(page.cursor, null);
		assert.deepEqual(Object.keys(page.rows[0]!).sort(), ['colorLabel', 'fileName', 'flag', 'height', 'id', 'rating', 'width']);
		assert.deepEqual(await f.owner.rebuildQueryStepV2(), { processed: 0, readBytes: 0, writtenBytes: 0, ready: true });
		assert.equal(f.calls.initialize, 1);
	} finally { await f.owner.close(); }
});

test('invalid metadata Session criteria and hostile signals refuse before lazy initialization', async () => {
	const f = await fixture(); let getters = 0;
	try {
		const hostile = Object.defineProperty({}, 'query', { enumerable: true, get() { getters++; return query; } });
		for (const value of [hostile, { query: { ...query, schemaVersion: 3 } }, { query, cursor: 'x'.repeat(4_097) },
			{ query, future: true }, { query, signal: AbortSignal.abort(17) }]) await assert.rejects(f.owner.readQueryStepV2(value as { query: typeof query }));
		const signal = new AbortController().signal;
		Object.defineProperty(signal, 'aborted', { get() { getters++; return false; } });
		await assert.rejects(f.owner.readQueryStepV2({ query, signal }));
		assert.equal(getters, 0); assert.equal(f.calls.initialize, 0);
	} finally { await f.owner.close(); }
});

test('metadata criteria are detached before held initialization permits caller mutation', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), initialize = f.ports.initialize;
	f.ports.initialize = async signal => { entered.resolve(); await release.promise; return initialize(signal); };
	const mutable = { ...query, predicate: { kind: 'number' as const, column: 'width' as const, minimum: 1, maximum: null as number | null } };
	const work = f.owner.readQueryStepV2({ query: mutable }); await entered.promise;
	mutable.predicate.minimum = 65_536; release.resolve();
	try { assert.equal((await work).rows.length, 2); }
	finally { await f.owner.close(); }
});

test('metadata Close joins a held repository read and refuses late scalar publication', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), read = f.repository.readQueryPageV2.bind(f.repository);
	f.repository.readQueryPageV2 = async (...args) => { const page = await read(...args); entered.resolve(); await release.promise; return page; };
	const work = f.owner.readQueryStepV2({ query }); await entered.promise;
	const refused = assert.rejects(work, { name: 'AbortError' }), closing = f.owner.close();
	assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
	await assert.rejects(f.owner.readQueryStepV2({ query }), /closed/iu);
	release.resolve(); await refused; await closing; assert.equal(f.calls.close, 1);
});

test('metadata caller cancellation preserves an opaque reason and leaves the shared Session usable', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const read = f.repository.readQueryPageV2.bind(f.repository), reason = new Proxy({}, { getPrototypeOf() { throw new Error('Reason reflected'); } });
	f.repository.readQueryPageV2 = async (...args) => { const page = await read(...args); entered.resolve(); await release.promise; return page; };
	const work = f.owner.readQueryStepV2({ query, signal: stop.signal }); await entered.promise;
	const refused = assert.rejects(work, error => error === reason); stop.abort(reason);
	assert.equal(await remainsPending(work), true); release.resolve(); await refused;
	f.repository.readQueryPageV2 = read;
	try { assert.equal((await f.owner.readQueryStepV2({ query })).rows.length, 2); }
	finally { await f.owner.close(); }
});

test('collapsed metadata Session binds the actual repository and chooses a matching member instead of an excluded cover', async () => {
	const f = await fixture();
	try {
		await f.repository.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'stack', revision: 0,
			photoIds: [queryPhotoV1(0).id, queryPhotoV1(1).id], coverPhotoId: queryPhotoV1(0).id }, null,
		{ expectedCatalogRevision: 1, expectedStateRevision: 0 });
		const unfiltered = await f.owner.readStackQueryStepV2({ query });
		assert.deepEqual(unfiltered.rows.map(row => row.id), [queryPhotoV1(0).id]);
		const criteria = normalizePhotoCatalogQueryV2({ ...query,
			predicate: { kind: 'text', column: 'title', operator: 'equals', value: 'Ordinary' } });
		const filtered = await f.owner.readStackQueryStepV2({ query: criteria });
		assert.deepEqual(filtered.rows.map(row => row.id), [queryPhotoV1(1).id]);
		assert.equal(filtered.cursor, null); assert.equal(filtered.totalCount, 2);
		assert.deepEqual(Object.keys(filtered.rows[0]!).sort(), ['colorLabel', 'fileName', 'flag', 'height', 'id', 'rating', 'width']);
		assert.equal(f.calls.initialize, 1);
	} finally { await f.owner.close(); }
});

test('collapsed metadata Session Close joins actual held terminal reads and preserves repository failures', async () => {
	for (const outcome of ['page', 'error'] as const) {
		const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), terminalError = new Error('Collapsed terminal read failed');
		const read = f.repository.readStackQueryPageV2;
		f.repository.readStackQueryPageV2 = async function (this: PhotoCatalogRepositoryV1, ...args) {
			assert.equal(this, f.repository);
			const page = await read.apply(this, args); assert.equal(page.continuation, null);
			entered.resolve(); await release.promise;
			if (outcome === 'error') throw terminalError;
			return page;
		};
		const work = f.owner.readStackQueryStepV2({ query });
		try {
			await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true);
			const refused = outcome === 'page' ? assert.rejects(work, { name: 'AbortError' }) : assert.rejects(work, error => error === terminalError);
			const closing = f.owner.close();
			assert.equal(await remainsPending(closing), true); assert.equal(f.calls.close, 0);
			await assert.rejects(f.owner.readStackQueryStepV2({ query }), /closed/iu);
			release.resolve(); await refused; await closing; assert.equal(f.calls.close, 1);
		} finally { release.resolve(); await Promise.allSettled([work]); await f.owner.close(); }
	}
});
