/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { restorePhotoLibraryArchiveV2 } from '../src/lightscaper/controller/photo-library-archive-restore-v2.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { exportPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-export-v4.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 as POINTER } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1 as JOURNAL, photoLibraryRestoreCommitKeyV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { savedArchiveFixtureV3, savedArchiveReaderV3, savedArchiveRootV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE, rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const old = { catalogId: 'old-library', kind: 'photo-library', schemaVersion: 1 };
const later = { catalogId: 'later-library', kind: 'photo-library', schemaVersion: 1 };
const key = photoLibraryRestoreCommitKeyV1('a'.repeat(32));
async function fixture() {
	const native = mediaRestoreFixture(), active = new Set<string>();
	const locks = { async request(name: string, _options: unknown, run: (lock: Lock | null) => Promise<unknown>) {
		if (active.has(name)) return run(null); active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false }); await anchor.ready();
	await anchor.settingsRepository.put(POINTER, old); const settings = { ...anchor.settingsRepository }; let token = 0;
	return { ...native, active, locks, anchor, settings, options: { name: 'Library', indexedDB: native.factory, locks, settings,
		allocateToken: () => (++token === 1 ? 'a' : 'b').repeat(32) } };
}
async function archive() {
	const f = lutArchiveFixture(), result = await exportPhotoCatalogArchiveV5(f.root, [f.record], [], null, [], f.row,
		{ async withBytes(_reference, consume) { return consume(LUT_BODY); } });
	assert.ok(result.blob); return result.blob;
}

test('V5 private restoration delivers complete Photo2/preset2/LUT before pointer ACK and current repository reopen', async () => {
	const f = await fixture(), expected = lutArchiveFixture(); let journalObserved = 0;
	const open = f.factory.open;
	f.factory.open = new Proxy(function (this: unknown, ...args: Parameters<IDBFactory['open']>) {
		assert.equal(this, f.factory);
		if (args[0].includes('-restore-')) { journalObserved++; assert.ok(f.raw('lightscaper-photo-media-v2').records('lightscaper-photo-media-v2', 'settings').some(row => row.key === JOURNAL)); }
		return Reflect.apply(open, f.factory, args);
	}, { get() { throw new Error('Factory method metadata must not be inspected'); } });
	try {
		const receipt = await restorePhotoLibraryArchiveV2(await archive(), f.options);
		f.factory.open = open;
		assert.deepEqual(receipt, { catalogId: expected.root.id, catalogName: expected.root.name, photoCount: 1, stackCount: 0,
			savedCollectionCount: 0, originalCount: 1, originalByteLength: expected.record.photo.original.byteLength, notices: [] });
		assert.ok(journalObserved > 0); assert.ok(await f.settings.get(key)); assert.equal(await f.settings.get(JOURNAL), undefined);
		const media = f.raw(f.names.mediaDatabaseName);
		assert.deepEqual(media.records(f.names.mediaDatabaseName, 'analysis')[0]!.value.reference, LUT_REFERENCE);
		assert.deepEqual(media.records(f.names.mediaDatabaseName, 'analysis')[0]!.value.bytes, LUT_BODY);
		assert.deepEqual(media.records(f.names.mediaDatabaseName, 'settings').find(row => row.key === `photo-library:develop-presets:v1:${expected.root.id}`)!.value, expected.row);
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
			verifyOriginal: async () => undefined, verifyResources: async () => undefined });
		try { assert.deepEqual(await catalog.loadPhoto(expected.root.id, expected.record.photo.id), expected.record.photo); } finally { await catalog.close(); }
		assert.deepEqual(f.deleted, []); assert.equal([...f.active].some(value => value.startsWith('lightscaper-')), false);
	} finally { await f.anchor.close(); }
});

test('corrupt authenticated LUT body cannot publish and rolls back only the fresh candidate namespaces', async () => {
	const f = await fixture(), source = await rewriteLutArchiveFixture(await archive(), files => {
		const body = files.get(`assets/luts/${LUT_REFERENCE.sha256}.cube`)!; body[body.length - 2] ^= 1;
	});
	try { await assert.rejects(restorePhotoLibraryArchiveV2(source, f.options));
		assert.deepEqual(await f.settings.get(POINTER), old); assert.equal(await f.settings.get(key), undefined); assert.equal(await f.settings.get(JOURNAL), undefined);
		assert.deepEqual(new Set(f.deleted), new Set([f.names.catalogDatabaseName, f.names.mediaDatabaseName]));
		assert.equal([...f.active].some(value => value.startsWith('lightscaper-')), false);
	} finally { await f.anchor.close(); }
});

test('codec reader retirement is joined before readiness, pointer publication or permanent history', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const work = restorePhotoLibraryArchiveV2(await archive(), { ...f.options, readerFactories: {
		blob: savedArchiveReaderV3(async () => { entered.resolve(); await release.promise; }),
	} });
	try { await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true);
		assert.deepEqual(await f.settings.get(POINTER), old); assert.equal(await f.settings.get(key), undefined);
		assert.equal((await f.settings.get(JOURNAL) as { phase: string }).phase, 'staging'); release.resolve(); assert.equal((await work).photoCount, 1);
	} finally { release.resolve(); await work; await f.anchor.close(); }
});

test('late pointer ACK cancellation wins and opaque lost ACK remains protected after a later winner', async () => {
	for (const mode of ['late-abort', 'lost-ack'] as const) {
		const f = await fixture(), stop = new AbortController(), publish = f.settings.replaceIfCurrentAndPutIfAbsent; let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw new Error('Reason inspected'); }, getPrototypeOf() { traps++; throw new Error('Reason reflected'); } });
		f.settings.replaceIfCurrentAndPutIfAbsent = async (...args) => {
			const result = await Reflect.apply(publish, f.settings, args);
			if (mode === 'late-abort') { stop.abort(reason); return result; }
			await f.anchor.settingsRepository.put(POINTER, later); throw reason;
		};
		try { const receipt = await restorePhotoLibraryArchiveV2(await archive(), { ...f.options, signal: stop.signal });
			assert.equal(receipt.photoCount, 1); assert.deepEqual(receipt.notices, mode === 'lost-ack' ? ['publication-reconciled'] : []);
			assert.ok(await f.settings.get(key)); assert.equal(traps, 0); assert.deepEqual(f.deleted, []);
			if (mode === 'lost-ack') assert.deepEqual(await f.settings.get(POINTER), later);
		} finally { await f.anchor.close(); }
	}
});

test('new named private restore preserves V3 absence and V4/V5 positive-empty preset row schema and revision', async () => {
	for (const version of [3, 4, 5] as const) {
		const f = await fixture();
		const row = { schemaVersion: 1 as const, kind: 'photo-develop-presets' as const, catalogId: 'catalog-1', revision: 91, presets: [] };
		const current = { ...row, schemaVersion: 2 as const };
		const source = version === 3 ? await savedArchiveFixtureV3() : version === 4
			? (await exportPhotoCatalogArchiveV4(savedArchiveRootV3(0), [], [], null, [], row)).blob
			: (await exportPhotoCatalogArchiveV5(savedArchiveRootV3(0), [], [], null, [], current, undefined)).blob;
		assert.ok(source);
		try { const receipt = await restorePhotoLibraryArchiveV2(source, f.options); assert.equal(receipt.photoCount, version === 3 ? 2 : 0);
			const media = f.raw(f.names.mediaDatabaseName);
			assert.equal(media.records(f.names.mediaDatabaseName, 'analysis').length, 0);
			assert.deepEqual(media.records(f.names.mediaDatabaseName, 'settings').find(value => value.key === 'photo-library:develop-presets:v1:catalog-1')?.value,
				version === 3 ? undefined : version === 4 ? row : current);
		} finally { await f.anchor.close(); }
	}
});
