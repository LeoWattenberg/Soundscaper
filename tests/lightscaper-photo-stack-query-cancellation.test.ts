/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { readPhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-pages-v1.ts';
import type { PhotoStackQueryContinuationV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const query = { text: '', filter: null, sort: { field: 'photo-id' as const, direction: 'ascending' as const } };
type Harness = ReturnType<typeof createInstrumentedIndexedDB> & { stats: { readonly activeTransactions: number } };

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB() as Harness, databaseName = crypto.randomUUID();
	const factory = indexedDB as unknown as IDBFactory;
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName, verifyOriginal: async () => undefined });
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Cancellation witness', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.createCatalog(root);
	root = await repository.publishPhotos(root.id, root.revision, [photoArchiveFixture(1).photo, photoArchiveFixture(2).photo]);
	await repository.rebuildQueryIndexPage(root.id);
	await repository.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id, id: 'stack', revision: 0,
		photoIds: ['photo-1', 'photo-2'], coverPhotoId: 'photo-1' }, null,
	{ expectedCatalogRevision: root.revision, expectedStateRevision: 0 });
	const database = await openPhotoCatalogDatabaseV1(factory, databaseName, () => undefined);
	return { indexedDB, repository, database, root, close: async () => { database.close(); await repository.close(); } };
}

test('a native signal shadowed during an actual member request aborts intrinsically and joins the transaction', async () => {
	const f = await fixture(), stop = new AbortController(), reason = new DOMException('Stop this exact query.', 'AbortError');
	let inspected = false, getters = 0, failure: unknown;
	try {
		f.indexedDB.onNextGetForStore('photoQueryRows', () => {
			inspected = true; assert.equal(f.indexedDB.stats.activeTransactions, 1);
			for (const key of ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener']) {
				Object.defineProperty(stop.signal, key, { get() { getters++; throw new Error(`Shadow ${key} was evaluated.`); } });
			}
			stop.abort(reason);
		});
		let continuation: PhotoStackQueryContinuationV1 | null = null;
		try {
			for (let step = 0; step < 4 && !inspected; step++) {
				const page = await readPhotoStackQueryPageV1(f.database, f.root.id, { query, continuation, signal: stop.signal });
				continuation = page.continuation;
			}
		} catch (error) { failure = error; }
		assert.equal(inspected, true); assert.equal(getters, 0, 'Caller-owned signal accessors must remain inert after admission.');
		assert.equal(failure, reason); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.close(); }
});

for (const scenario of [
	{ label: 'opaque proxy', create: () => {
		let inspections = 0;
		return { reason: new Proxy({}, {
			getPrototypeOf() { inspections++; throw new Error('The native reason prototype was inspected.'); },
			get() { inspections++; throw new Error('The native reason property was inspected.'); },
		}), inspections: () => inspections };
	} },
	...([17, 'cancel', null] as const).map(reason => ({ label: String(reason), create: () => ({ reason, inspections: () => 0 }) })),
]) {
	test(`native ${scenario.label} abort reason stays exact through actual member-request transaction cleanup`, async () => {
		const f = await fixture(), stop = new AbortController(), { reason, inspections } = scenario.create();
		let inspected = false, failure: unknown;
		try {
			f.indexedDB.onNextGetForStore('photoQueryRows', () => {
				inspected = true; assert.equal(f.indexedDB.stats.activeTransactions, 1); stop.abort(reason);
			});
			let continuation: PhotoStackQueryContinuationV1 | null = null;
			try {
				for (let step = 0; step < 4 && !inspected; step++) {
					const page = await readPhotoStackQueryPageV1(f.database, f.root.id, { query, continuation, signal: stop.signal });
					continuation = page.continuation;
				}
			} catch (error) { failure = error; }
			assert.equal(inspected, true); assert.equal(inspections(), 0, 'A native abort reason must remain opaque.');
			assert.equal(failure, reason); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await f.close(); }
	});
}

test('pre-aborted native reasons take precedence over shadow refusal without evaluating getters', async () => {
	const reasons: readonly unknown[] = [new DOMException('Stopped.', 'AbortError'), 'cancel', 17, null,
		new Proxy({}, { get() { throw new Error('The abort reason must stay opaque.'); } })];
	for (const reason of reasons) {
		const stop = new AbortController(); stop.abort(reason); let getters = 0, reads = 0;
		Object.defineProperty(stop.signal, 'throwIfAborted', { get() { getters++; throw new Error('Shadow ran.'); } });
		let admissionFailure: unknown, readFailure: unknown;
		try { assertPhotoStackQuerySignalV1(stop.signal); assert.fail('An aborted native signal was accepted.'); }
		catch (error) { admissionFailure = error; }
		try { await withPhotoStackQuerySignalV1(stop.signal, async () => { reads++; return 1; }); assert.fail('An aborted read was accepted.'); }
		catch (error) { readFailure = error; }
		assert.equal(admissionFailure, reason); assert.equal(readFailure, reason);
		assert.equal(getters, 0); assert.equal(reads, 0);
	}
});

test('unbranded, subclassed and shadowed signals are refused before the borrowed read', async () => {
	let getters = 0, reads = 0;
	class ForeignSignal extends AbortSignal {}
	const inherited = new AbortController().signal;
	Object.setPrototypeOf(inherited, ForeignSignal.prototype);
	const shadowed = new AbortController().signal;
	Object.defineProperty(shadowed, 'aborted', { get() { getters++; return false; } });
	const unbranded = Object.create(AbortSignal.prototype) as unknown;
	for (const value of [null, {}, unbranded, inherited, shadowed]) {
		assert.throws(() => assertPhotoStackQuerySignalV1(value), TypeError);
	}
	await assert.rejects(withPhotoStackQuerySignalV1(shadowed, async () => { reads++; return 1; }), TypeError);
	assert.equal(getters, 0); assert.equal(reads, 0);
});

test('external cancellation reaches a private signal immediately but the owner joins the held read', async () => {
	const stop = new AbortController(), reason = new DOMException('Cancel while reading.', 'AbortError');
	const entered = deferred<AbortSignal>(), held = deferred<number>(); let released = false;
	const work = withPhotoStackQuerySignalV1(stop.signal, async signal => {
		assert.ok(signal); assert.notEqual(signal, stop.signal); entered.resolve(signal);
		try { return await held.promise; } finally { released = true; }
	});
	const privateSignal = await entered.promise;
	Object.defineProperty(stop.signal, 'removeEventListener', { get() { throw new Error('Cleanup used an override.'); } });
	stop.abort(reason);
	assert.equal(privateSignal.aborted, true); assert.equal(privateSignal.reason, reason);
	assert.equal(await remainsPending(work), true); assert.equal(released, false);
	const rejected = assert.rejects(work, error => error === reason); held.resolve(1); await rejected;
	assert.equal(released, true);
});

test('a successful late read cannot publish after the original signal gains an override', async () => {
	const stop = new AbortController(), entered = deferred<void>(), held = deferred<number>(); let getters = 0;
	const work = withPhotoStackQuerySignalV1(stop.signal, async () => { entered.resolve(); return held.promise; });
	await entered.promise;
	Object.defineProperty(stop.signal, 'throwIfAborted', { get() { getters++; throw new Error('Late override ran.'); } });
	const rejected = assert.rejects(work, TypeError); held.resolve(42); await rejected; assert.equal(getters, 0);
});

test('borrowed cleanup failures remain visible and listeners retire after either outcome', async () => {
	const stop = new AbortController(), entered = deferred<AbortSignal>(), held = deferred<void>();
	const primary = new Error('Read failed.'), cleanup = new Error('Read cleanup failed.');
	const failure = new AggregateError([primary, cleanup], 'The borrowed owner could not settle cleanly.');
	const work = withPhotoStackQuerySignalV1(stop.signal, async signal => { assert.ok(signal); entered.resolve(signal); await held.promise; throw failure; });
	const privateSignal = await entered.promise;
	const rejected = assert.rejects(work, error => error === failure); held.resolve(); await rejected;
	stop.abort(); assert.equal(privateSignal.aborted, false, 'Settled work must release its original-signal subscription.');
	const success = new AbortController(); let completedSignal: AbortSignal | undefined;
	assert.equal(await withPhotoStackQuerySignalV1(success.signal, async signal => { completedSignal = signal; return 7; }), 7);
	success.abort(); assert.equal(completedSignal?.aborted, false);
	assert.equal(await withPhotoStackQuerySignalV1(undefined, async signal => { assert.equal(signal, undefined); return 9; }), 9);
});
