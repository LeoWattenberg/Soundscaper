/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { publishPhotoLibraryRestorePointerV1 } from '../src/lightscaper/storage/photo-library-restore-publication-v1.ts';
import { photoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { photoLibraryRestoreNamespacesV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const POINTER_KEY = 'photo-library:default';
const allocation = { schemaVersion: 1 as const, kind: 'photo-library-restore-allocation' as const,
	operationId: 'a'.repeat(32), namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'catalog' };
const journal = { schemaVersion: 1, kind: 'photo-library-restore-journal', allocation,
	expectedPointer: { catalogId: 'old', kind: 'photo-library', schemaVersion: 1 }, phase: 'ready', candidateReceipt: {
		schemaVersion: 1, kind: 'photo-library-restore-ready', catalogId: 'catalog', ...photoLibraryRestoreNamespacesV1(allocation),
		catalogRevision: 17, photoCount: 3, stackCount: 1, savedCollectionCount: 2, indexRevision: 0, originalCount: 2, originalByteLength: 10 } };
const commit = photoLibraryRestoreCommitV1(journal), key = photoLibraryRestoreCommitKeyV1(allocation.namespaceToken);
async function fixture() {
	const raw = createInstrumentedIndexedDB(), name = `publication-native-${crypto.randomUUID()}`;
	const database = await openDatabase(raw as unknown as IDBFactory, name), memory = getMemoryDatabase(name);
	const values = new KeyValueRepository({ memory, database: async () => database }, 'settings');
	await values.put(POINTER_KEY, journal.expectedPointer);
	return { raw, name, database, values, settings: { get: values.get.bind(values), replaceIfCurrentAndPutIfAbsent: values.replaceIfCurrentAndPutIfAbsent.bind(values) } };
}

test('native publication preserves stored expected field order and acknowledges both rows atomically', async () => {
	const f = await fixture(); let guards = 0;
	try {
		const result = await publishPhotoLibraryRestorePointerV1({ settings: f.settings, journal, admitWrite: () => { guards++; } });
		assert.equal(result.outcome, 'acknowledged'); assert.equal(guards, 3);
		if (result.outcome === 'acknowledged') { assert.deepEqual(result.receipt, journal.candidateReceipt); assert.equal(result.reconciled, false); }
		assert.deepEqual(await f.values.get(POINTER_KEY), commit.replacementPointer); assert.deepEqual(await f.values.get(key), commit);
		assert.equal(Object.isFrozen(result), true); assert.equal(f.raw.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

test('lost ACK reconciles exact permanent history even after a later pointer winner, preserving opaque failure', async () => {
	const f = await fixture(); let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Opaque value.'); }, getPrototypeOf() { inspected++; throw new Error('Opaque prototype.'); } });
	const later = { schemaVersion: 1, kind: 'photo-library', catalogId: 'later' }, publish = f.settings.replaceIfCurrentAndPutIfAbsent;
	f.settings.replaceIfCurrentAndPutIfAbsent = async (...args) => { assert.equal(await publish(...args), true); await f.values.put(POINTER_KEY, later); throw reason; };
	try {
		const result = await publishPhotoLibraryRestorePointerV1({ settings: f.settings, journal, admitWrite: () => undefined });
		assert.equal(result.outcome, 'acknowledged'); assert.equal(result.errors[0], reason); assert.equal(inspected, 0);
		if (result.outcome === 'acknowledged') assert.equal(result.reconciled, true);
		assert.deepEqual(await f.values.get(POINTER_KEY), later); assert.deepEqual(await f.values.get(key), commit);
	} finally { f.database.close(); }
});

for (const history of [null, { ...commit, schemaVersion: 2 }, { ...commit, allocation: { ...allocation, ownerToken: 'c'.repeat(32) } }]) {
	test('existing malformed or different history protects the namespace and refuses overwrite', async () => {
		const f = await fixture(); await f.values.put(key, history);
		try {
			const result = await publishPhotoLibraryRestorePointerV1({ settings: f.settings, journal, admitWrite: () => undefined });
			assert.equal(result.outcome, 'protected-uncertain'); assert.deepEqual(await f.values.get(key), history);
			assert.deepEqual(await f.values.get(POINTER_KEY), journal.expectedPointer);
		} finally { f.database.close(); }
	});
}

test('native atomic failure and guarded conditional-read cancellation retain old pointer with absent history', async () => {
	for (const cancellation of [false, true]) {
		const f = await fixture(), stop = new AbortController(), reason = Object.freeze({ cancelled: true });
		if (cancellation) f.raw.onNextGetForStore('settings', () => { stop.abort(reason); });
		else f.raw.failNextPutForStore('settings', new Error('Write refused.'));
		try {
			const result = await publishPhotoLibraryRestorePointerV1({ settings: f.settings, journal, admitWrite: () => { stop.signal.throwIfAborted(); } });
			assert.equal(result.outcome, 'not-published'); assert.equal(result.errors.length, 1);
			if (cancellation) assert.equal(result.errors[0], reason);
			assert.deepEqual(await f.values.get(POINTER_KEY), journal.expectedPointer); assert.equal(await f.values.get(key), undefined);
			assert.equal(f.raw.stats.activeTransactions, 0);
		} finally { f.database.close(); }
	}
});

test('unreadable permanent history is uncertain and keeps exact primary and reconciliation failures', async () => {
	const primary = new Proxy({}, { get() { throw new Error('Primary inspected.'); }, getPrototypeOf() { throw new Error('Primary prototype.'); } });
	const readFailure = Object.freeze({ unreadable: true });
	const result = await publishPhotoLibraryRestorePointerV1({ journal, admitWrite: () => undefined, settings: {
		get() { return Promise.reject(readFailure); }, replaceIfCurrentAndPutIfAbsent() { return Promise.reject(primary); },
	} });
	assert.equal(result.outcome, 'protected-uncertain'); assert.equal(result.errors[0], primary); assert.equal(result.errors[1], readFailure);
});

test('complete journal, admission and bound settings callbacks detach before held transport', async () => {
	const f = await fixture(), raw = structuredClone(journal), entered = deferred<void>(), release = deferred<void>(), publish = f.settings.replaceIfCurrentAndPutIfAbsent;
	f.settings.replaceIfCurrentAndPutIfAbsent = async (...args) => { entered.resolve(); await release.promise; assert.equal(await publish(...args), true); throw 'lost-ack'; };
	const options = { settings: f.settings, journal: raw, admitWrite: () => undefined }, work = publishPhotoLibraryRestorePointerV1(options);
	try {
		await entered.promise; raw.allocation.ownerToken = 'c'.repeat(32); raw.candidateReceipt.photoCount = 8;
		options.admitWrite = () => { throw new Error('Replacement admission.'); };
		f.settings.get = () => { throw new Error('Replacement read.'); }; assert.equal(await remainsPending(work), true);
		release.resolve(); const result = await work; assert.equal(result.outcome, 'acknowledged'); assert.deepEqual(await f.values.get(key), commit);
	} finally { release.resolve(); await work; f.database.close(); }
});

test('true native ACK wins cancellation arriving with transport completion without another admission/read', async () => {
	const f = await fixture(), stop = new AbortController(), publish = f.settings.replaceIfCurrentAndPutIfAbsent; let gets = 0;
	f.settings.replaceIfCurrentAndPutIfAbsent = async (...args) => { const result = await publish(...args); stop.abort(null); return result; };
	f.settings.get = () => { gets++; throw new Error('Known ACK must not read.'); };
	try {
		const result = await publishPhotoLibraryRestorePointerV1({ settings: f.settings, journal, admitWrite: () => { stop.signal.throwIfAborted(); } });
		assert.equal(result.outcome, 'acknowledged'); assert.equal(gets, 0); assert.deepEqual(await f.values.get(key), commit);
	} finally { f.database.close(); }
});

test('closed malformed/staging publication refuses before invoking any borrowed callback', async () => {
	let calls = 0; const settings = { get: async () => { calls++; return undefined; }, replaceIfCurrentAndPutIfAbsent: async () => { calls++; return true; } };
	for (const value of [{ settings, journal: { ...journal, phase: 'staging', candidateReceipt: null }, admitWrite: () => undefined },
		{ settings, journal, admitWrite: () => undefined, extra: true }, { settings, get journal() { calls++; throw new Error('Getter.'); }, admitWrite: () => undefined }]) {
		await assert.rejects(publishPhotoLibraryRestorePointerV1(value));
	}
	assert.equal(calls, 0);
});

test('product settings atomic facade permits only the fixed anchor and retains native completion custody during close', async () => {
	const selected = new PhotoMediaStoreV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		databaseName: 'lightscaper-selected-media', locks: null, preferOpfs: false });
	try {
		await assert.rejects(selected.settingsRepository.replaceIfCurrentAndPutIfAbsent(POINTER_KEY, journal.expectedPointer, commit.replacementPointer, key, commit), /fixed.*anchor/u);
	} finally { await selected.close(); }
	const backing = createInstrumentedIndexedDB(), store = new PhotoMediaStoreV1({ indexedDB: backing as unknown as IDBFactory, locks: null, preferOpfs: false });
	await store.settingsRepository.put(POINTER_KEY, journal.expectedPointer);
	const database = await openDatabase(backing as unknown as IDBFactory, 'lightscaper-photo-media-v2');
	const transaction = database.transaction.bind(database), entered = deferred<void>(), release = deferred<void>();
	database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const current = transaction(...args); if (args[1] === 'readwrite') {
			let complete: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(current, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { complete = value; },
				get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => complete?.call(current, event)); }; } });
		} return current;
	}) as IDBDatabase['transaction'];
	const work = publishPhotoLibraryRestorePointerV1({ settings: store.settingsRepository, journal, admitWrite: () => undefined });
	try {
		await Promise.race([entered.promise, work]); const closing = store.close();
		assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); assert.equal((await work).outcome, 'acknowledged'); await closing;
		assert.deepEqual(backing.records('lightscaper-photo-media-v2', 'settings').filter(row => row.key === key), [{ key, value: commit }]);
	} finally { release.resolve(); await work; database.transaction = transaction; await store.close(); database.close(); }
});
