/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeferredCatalogQueryScaleFixtureV1 } from './helpers/lightscaper-catalog-query-native-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

/** Open/upgrade protocol only. Real index construction remains a native browser assertion. */
function fixture(existingVersion = 0, holdUpgrade = false) {
	const entered = deferred<void>(), release = deferred<void>();
	const stores = new Map<string, { indexes: Map<string, unknown> }>();
	let version = existingVersion, closes = 0, upgrades = 0, aborts = 0;
	const opens: number[] = [];
	const database = {
		get version() { return version; }, close() { closes++; },
		objectStoreNames: { contains: (name: string) => stores.has(name) },
		createObjectStore(name: string) { const data = { indexes: new Map<string, unknown>() }; stores.set(name, data); return store(name); },
	};
	function store(name: string) {
		const data = stores.get(name)!;
		return { indexNames: [...data.indexes.keys()], deleteIndex: (name: string) => { data.indexes.delete(name); },
			createIndex(index: string, keyPath: unknown, options: unknown = {}) { data.indexes.set(index, { keyPath, options }); } };
	}
	const factory = { open(_name: string, requested: number) {
		opens.push(requested);
		const request = { result: database as unknown as IDBDatabase, error: null as DOMException | null,
			transaction: null as IDBTransaction | null, onupgradeneeded: null as IDBOpenDBRequest['onupgradeneeded'],
			onsuccess: null as IDBOpenDBRequest['onsuccess'], onerror: null as IDBOpenDBRequest['onerror'], onblocked: null as IDBOpenDBRequest['onblocked'] };
		queueMicrotask(() => { void begin(); });
		async function begin() {
			if (requested < version) {
				request.error = new DOMException('Future fixture.', 'VersionError');
				request.onerror?.call(request as unknown as IDBOpenDBRequest, new Event('error')); return;
			}
			const old = version; let aborted = false;
			if (requested > version) {
				version = requested; upgrades++;
				request.transaction = { objectStore: store, abort() { aborted = true; aborts++; } } as unknown as IDBTransaction;
				const event: IDBVersionChangeEvent = Object.assign(new Event('upgradeneeded'), { oldVersion: old, newVersion: requested });
				request.onupgradeneeded?.call(request as unknown as IDBOpenDBRequest, event);
				if (requested === 5 && holdUpgrade) { entered.resolve(); await release.promise; }
			}
			if (aborted) {
				version = old; request.error = new DOMException('Upgrade aborted.', 'AbortError');
				request.onerror?.call(request as unknown as IDBOpenDBRequest, new Event('error'));
			} else request.onsuccess?.call(request as unknown as IDBOpenDBRequest, new Event('success'));
		}
		return request as unknown as IDBOpenDBRequest;
	} } as unknown as IDBFactory;
	return { factory, stores, entered, release, opens, stats: () => ({ version, closes, upgrades, aborts }) };
}

test('fresh temporary seed has no query indexes, then joins the exact final native upgrade', async () => {
	const f = fixture(0, true), events: string[] = [];
	const work = createDeferredCatalogQueryScaleFixtureV1(f.factory, 'fresh', async database => {
		events.push('seed'); assert.equal(database.version, 4);
		assert.equal(f.stores.size, 15); assert.equal(f.stores.get('photoQueryRows')!.indexes.size, 0);
	});
	await f.entered.promise;
	assert.equal(await remainsPending(work), true); assert.deepEqual(events, ['seed']);
	assert.equal(f.stats().closes, 1); assert.deepEqual(f.opens, [4, 5]);
	f.release.resolve(); const database = await work;
	assert.equal(database.version, 5);
	assert.deepEqual([...f.stores.get('photoQueryRows')!.indexes], [
		['catalogId', { keyPath: 'catalogId', options: {} }],
		['photo-id', { keyPath: ['catalogId', 'photoId'], options: {} }],
		['file-name', { keyPath: ['catalogId', 'fileNameSort', 'photoId'], options: {} }],
		['capture-time', { keyPath: ['catalogId', 'captureBucket', 'captureSort', 'photoId'], options: {} }],
		['rating', { keyPath: ['catalogId', 'ratingSort', 'photoId'], options: {} }],
	]);
	database.close(); assert.equal(f.stats().closes, 2);
});

test('existing earlier, same-version and future databases remain untouched and never enter seed', async () => {
	for (const version of [1, 4, 6]) {
		const f = fixture(version); let seeded = 0;
		f.stores.set('foreign', { indexes: new Map([['retained-index', 'retained-value']]) });
		await assert.rejects(createDeferredCatalogQueryScaleFixtureV1(f.factory, 'existing', async () => { seeded++; }), /fresh|Future/u);
		assert.equal(seeded, 0); assert.equal(f.stats().version, version); assert.equal(f.stats().upgrades, version === 1 ? 1 : 0);
		assert.deepEqual([...f.stores], [['foreign', { indexes: new Map([['retained-index', 'retained-value']]) }]]);
		assert.deepEqual(f.opens, [4]);
	}
});

test('held seed keeps its open connection, and opaque seed failure closes without upgrading', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(); let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Reason read.'); }, getPrototypeOf() { inspected++; throw new Error('Reason inspected.'); } });
	const work = createDeferredCatalogQueryScaleFixtureV1(f.factory, 'fresh', async () => { entered.resolve(); await release.promise; throw reason; });
	const rejected = work.then(() => assert.fail('Failed seed returned.'), (error: unknown) => { assert.equal(error, reason); });
	await entered.promise; assert.equal(await remainsPending(work), true); assert.equal(f.stats().closes, 0);
	release.resolve(); await rejected; assert.equal(f.stats().closes, 1); assert.deepEqual(f.opens, [4]); assert.equal(inspected, 0);
});
