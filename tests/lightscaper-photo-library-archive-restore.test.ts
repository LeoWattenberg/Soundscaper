/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { restorePhotoLibraryArchiveV1 } from '../src/lightscaper/controller/photo-library-archive-restore-v1.ts';
import { recoverPhotoLibraryRestoreV1 } from '../src/lightscaper/storage/photo-library-restore-recovery-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 as POINTER } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1 as JOURNAL, photoLibraryRestoreCommitKeyV1,
	normalizePhotoLibraryRestoreCommitV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { photoLibraryRestoreNamespacesV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { mediaRestoreFixture, mediaRestoreAllocation } from './helpers/lightscaper-media-restore-fixture.ts';
import { savedArchiveFixtureV3 as archive, savedArchiveRootV3, savedArchiveDefinitionV3,
	savedArchiveReaderV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { rewriteStackArchive } from './helpers/lightscaper-stack-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previousKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previousKeyRange) Object.defineProperty(globalThis, 'IDBKeyRange', previousKeyRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const old = { catalogId: 'old-library', kind: 'photo-library', schemaVersion: 1 };
const later = { schemaVersion: 1, kind: 'photo-library', catalogId: 'later-library' };
const key = photoLibraryRestoreCommitKeyV1('a'.repeat(32));
async function fixture(cold = false) {
	const native = mediaRestoreFixture(), active = new Set<string>(), calls: string[] = [];
	const locks = { async request(name: string, _options: unknown, run: (lock: Lock | null) => Promise<unknown>) {
		calls.push(name); if (active.has(name)) return run(null); active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false }); await anchor.ready();
	if (!cold) await anchor.settingsRepository.put(POINTER, old);
	let token = 0; const settings = { ...anchor.settingsRepository };
	return { ...native, locks, active, calls, anchor, settings, options: { name: 'Library', settings,
		indexedDB: native.factory, locks, allocateToken: () => (++token === 1 ? 'a' : 'b').repeat(32) } };
}

test('whole V3 restore preserves catalog/photo/stack/saved identities and original bytes before atomic V2 publication', async () => {
	const f = await fixture();
	try {
		const receipt = await restorePhotoLibraryArchiveV1(await archive(), f.options);
		assert.deepEqual(receipt, { catalogId: 'catalog-1', catalogName: savedArchiveRootV3().name,
			photoCount: 2, stackCount: 1, savedCollectionCount: 1, originalCount: 2, originalByteLength: 6, notices: [] });
		const commit = normalizePhotoLibraryRestoreCommitV1(await f.settings.get(key));
		assert.deepEqual(commit.previousPointer, old); assert.equal(commit.candidateReceipt.catalogRevision, 23);
		assert.deepEqual(await f.settings.get(POINTER), commit.replacementPointer); assert.equal(await f.settings.get(JOURNAL), undefined);
		const catalog = f.raw(f.names.catalogDatabaseName), media = f.raw(f.names.mediaDatabaseName);
		assert.deepEqual(catalog.records(f.names.catalogDatabaseName, 'photos').map(row => row.document.revision), [13, 14]);
		assert.equal(catalog.records(f.names.catalogDatabaseName, 'photoStacks')[0]!.document.revision, 3);
		assert.deepEqual(catalog.records(f.names.catalogDatabaseName, 'photoSmartCollections')[0]!.document, savedArchiveDefinitionV3());
		assert.equal(media.records(f.names.mediaDatabaseName, 'catalogOriginalRoots').length, 2);
		assert.ok(media.records(f.names.mediaDatabaseName, 'catalogOriginalRoots').every(row => row.importId === null));
		assert.deepEqual(media.records(f.names.mediaDatabaseName, 'mediaAssetChunks').map(row => Array.from(new Uint8Array(row.payloadBytes))), [[1, 2, 3], [1, 2, 3]]);
		assert.deepEqual(f.deleted, []); assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false);
		assert.ok(f.calls.includes('lightscaper-photo-catalog:old-library'));
	} finally { await f.anchor.close(); }
});

test('journal is durable before the first candidate schema and reader closure precedes readiness/publication', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), source = await archive();
	const open = f.factory.open.bind(f.factory); let checked = 0;
	f.factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		if (args[0].includes('-restore-')) {
			const rows = f.raw('lightscaper-photo-media-v2').records('lightscaper-photo-media-v2', 'settings');
			assert.ok(rows.some(row => row.key === JOURNAL)); checked++;
		} return open(...args);
	}) as IDBFactory['open'];
	const work = restorePhotoLibraryArchiveV1(source, { ...f.options,
		readerFactories: { blob: savedArchiveReaderV3(async () => { entered.resolve(); await release.promise; }) } });
	try {
		await entered.promise; assert.equal(await remainsPending(work), true); assert.ok(checked > 0);
		assert.deepEqual(await f.settings.get(POINTER), old); assert.equal(await f.settings.get(key), undefined);
		assert.equal((await f.settings.get(JOURNAL) as { phase: string }).phase, 'staging');
		release.resolve(); assert.equal((await work).photoCount, 2);
	} finally { release.resolve(); await work; await f.anchor.close(); }
});

test('a corrupt pack rolls back only unpublished candidate namespaces and keeps the old pointer', async () => {
	const f = await fixture(), source = await rewriteStackArchive(await archive(), entries => {
		const bytes = entries.get('assets/photo-pack-000001.bin')!; bytes[bytes.length - 1] ^= 1;
	});
	try {
		await assert.rejects(restorePhotoLibraryArchiveV1(source, f.options));
		assert.deepEqual(await f.settings.get(POINTER), old); assert.equal(await f.settings.get(key), undefined);
		assert.equal(await f.settings.get(JOURNAL), undefined);
		assert.deepEqual(new Set(f.deleted), new Set([f.names.catalogDatabaseName, f.names.mediaDatabaseName])); assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false);
	} finally { await f.anchor.close(); }
});

test('a refused atomic pointer CAS retains a later winner and removes the unpublished candidate', async () => {
	const f = await fixture();
	f.settings.replaceIfCurrentAndPutIfAbsent = async () => { await f.anchor.settingsRepository.put(POINTER, later); return false; };
	try {
		await assert.rejects(restorePhotoLibraryArchiveV1(await archive(), f.options));
		assert.deepEqual(await f.settings.get(POINTER), later); assert.equal(await f.settings.get(key), undefined);
		assert.equal(await f.settings.get(JOURNAL), undefined); assert.equal(f.deleted.length, 2);
	} finally { await f.anchor.close(); }
});

test('lost publication ACK is reconciled after a later winner and never deletes published originals', async () => {
	const f = await fixture(), publish = f.settings.replaceIfCurrentAndPutIfAbsent; let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Opaque value.'); }, getPrototypeOf() { inspected++; throw new Error('Opaque prototype.'); } });
	f.settings.replaceIfCurrentAndPutIfAbsent = async (...args) => {
		assert.equal(await publish(...args), true); await f.anchor.settingsRepository.put(POINTER, later); throw reason;
	};
	try {
		const receipt = await restorePhotoLibraryArchiveV1(await archive(), f.options);
		assert.equal(receipt.photoCount, 2); assert.deepEqual(receipt.notices, ['publication-reconciled']); assert.equal(inspected, 0);
		assert.deepEqual(await f.settings.get(POINTER), later); assert.ok(await f.settings.get(key)); assert.deepEqual(f.deleted, []);
		assert.equal(await f.settings.get(JOURNAL), undefined);
	} finally { await f.anchor.close(); }
});

test('known native publication ACK wins a cancellation arriving with completion', async () => {
	const f = await fixture(), stop = new AbortController(), publish = f.settings.replaceIfCurrentAndPutIfAbsent;
	f.settings.replaceIfCurrentAndPutIfAbsent = async (...args) => { const result = await publish(...args); stop.abort(null); return result; };
	try {
		assert.equal((await restorePhotoLibraryArchiveV1(await archive(), { ...f.options, signal: stop.signal })).photoCount, 2);
		assert.ok(await f.settings.get(key)); assert.deepEqual(f.deleted, []); assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false);
	} finally { await f.anchor.close(); }
});

test('any pre-existing permanent history rejects the allocation before candidate creation', async () => {
	const f = await fixture(); await f.settings.put(key, null); f.opens.length = 0;
	try {
		await assert.rejects(restorePhotoLibraryArchiveV1(await archive(), f.options));
		assert.equal(await f.settings.get(key), null); assert.deepEqual(await f.settings.get(POINTER), old);
		assert.equal(f.opens.some(row => row.name.includes('-restore-')), false); assert.deepEqual(f.deleted, []);
	} finally { await f.anchor.close(); }
});

test('opaque cancellation joins a held reader and leaves a recoverable unpublished journal', async () => {
	const f = await fixture(), stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(); let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Opaque value.'); }, getPrototypeOf() { inspected++; throw new Error('Opaque prototype.'); } });
	let failure: unknown;
	const work = restorePhotoLibraryArchiveV1(await archive(), { ...f.options, signal: stop.signal,
		readerFactories: { blob: savedArchiveReaderV3(async () => { entered.resolve(); await release.promise; }) } }).catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); assert.deepEqual(f.deleted, []);
		release.resolve(); await work; assert.equal(failure, reason); assert.equal(inspected, 0);
		assert.deepEqual(await f.settings.get(POINTER), old); assert.ok(await f.settings.get(JOURNAL)); assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false);
		assert.equal((await recoverPhotoLibraryRestoreV1({ settings: f.settings, indexedDB: f.factory, locks: f.locks })).outcome, 'discarded');
		assert.equal(await f.settings.get(JOURNAL), undefined); assert.equal(f.deleted.length, 2);
	} finally { release.resolve(); await work; await f.anchor.close(); }
});

test('a cold restore initializes only a default root and does not require a ready old Session', async () => {
	const f = await fixture(true);
	try {
		assert.equal((await restorePhotoLibraryArchiveV1(await archive(), f.options)).photoCount, 2);
		const commit = normalizePhotoLibraryRestoreCommitV1(await f.settings.get(key)); assert.equal(commit.previousPointer.schemaVersion, 1);
		const names = photoLibraryRestoreNamespacesV1(mediaRestoreAllocation()); assert.equal(commit.candidateReceipt.mediaDatabaseName, names.mediaDatabaseName);
	} finally { await f.anchor.close(); }
});

test('opaque original cancellation and reader cleanup failure are retained without inspecting the reason', async () => {
	const f = await fixture(), stop = new AbortController(), cleanup = new Error('Reader closure failed.'); let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Opaque reason.'); }, getPrototypeOf() { inspected++; throw new Error('Opaque prototype.'); } });
	f.raw(f.names.mediaDatabaseName).onNextGetForStore('mediaAssets', () => { stop.abort(reason); });
	try {
		let failure: unknown;
		try { await restorePhotoLibraryArchiveV1(await archive(), { ...f.options, signal: stop.signal,
			readerFactories: { blob: savedArchiveReaderV3(async () => { throw cleanup; }) } }); }
		catch (error) { failure = error; }
		assert.equal(inspected, 0); assert.ok(failure instanceof AggregateError);
		assert.equal((failure.errors as unknown[])[0], reason);
		assert.equal(failure.name, 'AbortError'); assert.deepEqual(await f.settings.get(POINTER), old);
		assert.ok(await f.settings.get(JOURNAL)); assert.deepEqual(f.deleted, []);
	} finally { await f.anchor.close(); }
});

test('candidate close failure prevents pointer publication and preserves its recoverable namespaces', async () => {
	const f = await fixture(), open = f.factory.open.bind(f.factory), failure = new Error('Candidate close failed.'); let decorated = false;
	f.factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		const opening = open(...args);
		if (args[0] === f.names.catalogDatabaseName && args[1] === 5 && !decorated) {
			decorated = true; const result = Object.getOwnPropertyDescriptor(opening, 'result')!;
			Object.defineProperty(opening, 'result', { configurable: true, get: result.get, set(database: IDBDatabase) {
				result.set!.call(opening, database); const close = database.close.bind(database);
				database.close = () => { close(); throw failure; };
			} });
		} return opening;
	}) as IDBFactory['open'];
	try {
		await assert.rejects(restorePhotoLibraryArchiveV1(await archive(), f.options));
		assert.deepEqual(await f.settings.get(POINTER), old); assert.equal(await f.settings.get(key), undefined);
		assert.ok(await f.settings.get(JOURNAL)); assert.deepEqual(f.deleted, []);
	} finally { await f.anchor.close(); }
});

test('journal retirement failure after publication keeps the installed receipt and permanent originals', async () => {
	const f = await fixture(); let inspected = 0;
	const failure = new Proxy({}, { get() { inspected++; throw new Error('Cleanup inspected.'); }, getPrototypeOf() { inspected++; throw new Error('Cleanup prototype.'); } });
	f.settings.deleteIfCurrent = () => Promise.reject(failure);
	try {
		const receipt = await restorePhotoLibraryArchiveV1(await archive(), f.options);
		assert.deepEqual(receipt.notices, ['cleanup-failed']); assert.equal(inspected, 0); assert.deepEqual(f.deleted, []);
		assert.ok(await f.settings.get(key)); assert.equal((await f.settings.get(JOURNAL) as { phase: string }).phase, 'ready');
		assert.equal((await f.settings.get(POINTER) as { schemaVersion: number }).schemaVersion, 2);
		const recovered = await recoverPhotoLibraryRestoreV1({ settings: f.settings, indexedDB: f.factory, locks: f.locks });
		assert.equal(recovered.outcome, 'published'); assert.equal(recovered.errors[0], failure); assert.deepEqual(f.deleted, []);
	} finally { await f.anchor.close(); }
});

test('history appearing at pointer publication protects both candidates and the ready journal', async () => {
	const f = await fixture();
	f.settings.replaceIfCurrentAndPutIfAbsent = async () => { await f.anchor.settingsRepository.put(key, null); return false; };
	try {
		await assert.rejects(restorePhotoLibraryArchiveV1(await archive(), f.options));
		assert.deepEqual(await f.settings.get(POINTER), old); assert.equal(await f.settings.get(key), null);
		assert.equal((await f.settings.get(JOURNAL) as { phase: string }).phase, 'ready'); assert.deepEqual(f.deleted, []);
		assert.equal((await recoverPhotoLibraryRestoreV1({ settings: f.settings, indexedDB: f.factory, locks: f.locks })).outcome, 'protected');
		assert.deepEqual(f.deleted, []);
	} finally { await f.anchor.close(); }
});
