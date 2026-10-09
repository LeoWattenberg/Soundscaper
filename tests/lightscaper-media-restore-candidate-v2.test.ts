/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoMediaRestoreCandidateV2 } from '../src/lightscaper/storage/photo-media-restore-candidate-v2.ts';
import { createPhotoCatalogRestoreStageV2 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoCubeLutRepositoryV1 } from '../src/lightscaper/storage/photo-cube-lut-repository-v1.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture, mediaRestoreAllocation, mediaRestoreRoot, mediaRestorePhoto, mediaRestoreChunks } from './helpers/lightscaper-media-restore-fixture.ts';
import { LUT_BODY, LUT_REFERENCE, lutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const resources = () => [{ id: LUT_REFERENCE.storageKey, entry: `assets/luts/${LUT_REFERENCE.sha256}.cube`, reference: LUT_REFERENCE }];
function photo() {
	const source = mediaRestorePhoto(), develop = lutArchiveFixture().record.photo.versions[0]!.develop;
	return normalizePhotoDocumentV2({ ...source, schemaVersion: 2, versions: [{ ...source.versions[0]!, develop }] });
}
const options = (f: ReturnType<typeof mediaRestoreFixture>, signal?: AbortSignal) => ({ indexedDB: f.factory,
	allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(1), signal,
	developPresets: { rowSchemaVersion: 2 as const, revision: 29, presetCount: 1 }, lutResources: resources() });
async function catalog(f: ReturnType<typeof mediaRestoreFixture>, document = photo()) {
	const stage = await createPhotoCatalogRestoreStageV2({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
		root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	await stage.writePhoto(document); await stage.finish(); return stage;
}
async function database(f: ReturnType<typeof mediaRestoreFixture>): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = f.factory.open(f.names.mediaDatabaseName);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
}
async function fill(candidate: Awaited<ReturnType<typeof createPhotoMediaRestoreCandidateV2>>) {
	await candidate.writeOriginal(photo(), mediaRestoreChunks(new Uint8Array([1, 2, 3])));
	await candidate.writeDevelopPresets(lutArchiveFixture().row);
	await candidate.writeLut(LUT_REFERENCE, LUT_BODY);
}

test('fresh native candidate persists one exact LUT separately from unchanged original custody and reopens authenticated bytes', async () => {
	const f = mediaRestoreFixture(), candidate = await createPhotoMediaRestoreCandidateV2(options(f)), stage = await catalog(f);
	try {
		await fill(candidate);
		const raw = f.raw(f.names.mediaDatabaseName);
		raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { key: 'source-analysis:legitimate', value: { cached: true } });
		const before = raw.stats.getAllRequests.length;
		const ack = await candidate.finish(); assert.deepEqual(ack, { databaseName: f.names.mediaDatabaseName, catalogId: 'catalog-1',
			photoCount: 1, originalCount: 1, originalByteLength: 3, lutCount: 1, lutByteLength: LUT_BODY.byteLength });
		assert.equal(raw.records(f.names.mediaDatabaseName, 'mediaAssets').length, 1);
		assert.equal(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots')[0]!.importId, null);
		await candidate.close(); const db = await database(f), repository = new PhotoCubeLutRepositoryV1({
			memory: getMemoryDatabase('restore-v2-native-test'), database: async () => db });
		let borrowed: Uint8Array | undefined;
		try { await repository.withBytes(LUT_REFERENCE, bytes => { borrowed = bytes; assert.deepEqual(bytes, LUT_BODY); });
			assert.ok(borrowed?.every(byte => byte === 0)); } finally { await repository.close(); db.close(); }
		assert.equal(raw.stats.getAllRequests.length, before); assert.equal(raw.stats.activeTransactions, 0);
	} finally { await candidate.rollback(); await stage.rollback(); }
});

test('sealed completion authenticates complete reachable declarations, exact LUT namespace and delivered preset body', async () => {
	for (const mode of ['missing', 'body', 'geometry', 'extra', 'preset', 'absent-row'] as const) {
		const f = mediaRestoreFixture(), candidate = await createPhotoMediaRestoreCandidateV2(options(f)), stage = await catalog(f);
		try {
			await fill(candidate); const raw = f.raw(f.names.mediaDatabaseName), row = raw.records(f.names.mediaDatabaseName, 'analysis')[0]!;
			if (mode === 'missing') await f.remove(f.names.mediaDatabaseName, 'analysis', LUT_REFERENCE.storageKey);
			if (mode === 'body') raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { ...row, value: { ...row.value, bytes: new Uint8Array(LUT_BODY.byteLength) } });
			if (mode === 'geometry') raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { ...row, value: { ...row.value,
				reference: { ...LUT_REFERENCE, domainMax: [2, 1, 1] } } });
			if (mode === 'extra') raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { key: `lut-sha256:${'f'.repeat(64)}`, value: null });
			const key = 'photo-library:develop-presets:v1:catalog-1';
			if (mode === 'preset') {
				const preset = raw.records(f.names.mediaDatabaseName, 'settings').find(row => row.key === key)!;
				raw.seedRecord(f.names.mediaDatabaseName, 'settings', { ...preset, value: { ...preset.value, revision: 30 } });
			}
			if (mode === 'absent-row') await f.remove(f.names.mediaDatabaseName, 'settings', key);
			await assert.rejects(candidate.finish()); assert.ok(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots').every(row => row.importId !== null));
		} finally { await candidate.rollback(); await stage.rollback(); }
	}
});

test('disabled redo and snapshot references require custody even when the current Photo state is legacy', async () => {
	const f = mediaRestoreFixture(), source = mediaRestorePhoto(), current = source.versions[0]!.develop, lut = photo().versions[0]!.develop;
	const document = normalizePhotoDocumentV2({ ...source, schemaVersion: 2, versions: [{ ...source.versions[0]!, develop: current, workspace: {
		schemaVersion: 2, kind: 'photo-develop-workspace', entries: [{ label: 'Initial', createdAt: source.versions[0]!.createdAt, develop: current },
			{ label: 'LUT', createdAt: source.versions[0]!.createdAt, develop: lut }], cursor: 0,
		snapshots: [{ id: 'saved', name: 'LUT snapshot', createdAt: source.versions[0]!.createdAt, develop: lut }],
	} }] });
	const candidate = await createPhotoMediaRestoreCandidateV2({ ...options(f), developPresets: null }), stage = await catalog(f, document);
	try {
		await candidate.writeOriginal(document, mediaRestoreChunks(new Uint8Array([1, 2, 3]))); await candidate.writeLut(LUT_REFERENCE, LUT_BODY);
		assert.equal((await candidate.finish()).lutCount, 1);
	} finally { await candidate.rollback(); await stage.rollback(); }
});

test('LUT native completion is joined before Close and durable insertion survives late native abort', async () => {
	const f = mediaRestoreFixture(), stop = new AbortController(), candidate = await createPhotoMediaRestoreCandidateV2(options(f, stop.signal));
	const entered = deferred<void>(), release = deferred<void>(), reason = Object.freeze({ late: 'LUT ACK' });
	f.observeTransactions((transaction, stores, mode) => {
		if (mode !== 'readwrite' || [...(typeof stores === 'string' ? [stores] : stores)].join(',') !== 'analysis') return;
		let handler: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
			get() { return (event: Event) => { entered.resolve(); stop.abort(reason);
				void release.promise.then(() => { if (handler) Reflect.apply(handler, transaction, [event]); }); }; } });
	});
	const bytes = LUT_BODY.slice(), writing = candidate.writeLut(LUT_REFERENCE, bytes); bytes.fill(0); await entered.promise;
	const closing = candidate.close();
	try { assert.equal(await remainsPending(writing), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); await writing; await closing;
		assert.deepEqual(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'analysis')[0]!.value.bytes, LUT_BODY);
	} finally { release.resolve(); await candidate.rollback(); }
});

test('the final native five-store ACK survives an exact opaque late abort without changing original receipt counts', async () => {
	const f = mediaRestoreFixture(), stop = new AbortController(), candidate = await createPhotoMediaRestoreCandidateV2(options(f, stop.signal)), stage = await catalog(f);
	let traps = 0, completions = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('Reason inspected'); }, getPrototypeOf() { traps++; throw new Error('Reason reflected'); } });
	await fill(candidate);
	f.observeTransactions((transaction, stores, mode) => {
		if (mode !== 'readwrite' || typeof stores === 'string' || [...stores].sort().join(',') !== 'analysis,catalogOriginalRoots,mediaAssetChunks,mediaAssets,settings') return;
		let handler: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
			get() { return (event: Event) => { if (handler) Reflect.apply(handler, transaction, [event]); completions++; stop.abort(reason); }; } });
	});
	try { const ack = await candidate.finish(); assert.equal(ack.lutCount, 1); assert.equal(ack.originalCount, 1); assert.equal(completions, 1);
		assert.equal(await candidate.finish(), ack); assert.equal(traps, 0); } finally { await candidate.rollback(); await stage.rollback(); }
});

test('media abort reentry shares one rollback join and retains the namespace until its single deletion ACK', async () => {
	const f = mediaRestoreFixture(), remove = f.factory.deleteDatabase, deletion = deferred<void>(), deleted = deferred<void>();
	f.factory.deleteDatabase = (...args) => {
		const result = Reflect.apply(remove, f.factory, args) as IDBOpenDBRequest; let handler: IDBOpenDBRequest['onsuccess'] = null;
		Object.defineProperty(result, 'onsuccess', { configurable: true, set(value: IDBOpenDBRequest['onsuccess']) { handler = value; },
			get() { return (event: Event) => { deleted.resolve(); void deletion.promise.then(() => { if (handler) Reflect.apply(handler, result, [event]); }); }; } });
		return result;
	};
	const candidate = await createPhotoMediaRestoreCandidateV2(options(f)), entered = deferred<void>(), release = deferred<void>();
	let nested: Promise<void> | undefined, held = false;
	f.observeTransactions((transaction, stores, mode) => {
		if (held || mode !== 'readonly' || typeof stores === 'string' || [...stores].join(',') !== 'settings,catalogOriginalRoots') return;
		held = true; const abort = transaction.abort; transaction.abort = () => { nested ??= candidate.rollback(); Reflect.apply(abort, transaction, []); };
		let handler: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
			get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => { if (handler) Reflect.apply(handler, transaction, [event]); }); }; } });
	});
	const writing = candidate.writeOriginal(photo(), mediaRestoreChunks(new Uint8Array([1, 2, 3]))); await entered.promise;
	const rollback = candidate.rollback();
	try {
		assert.equal(nested, rollback); assert.equal(candidate.rollback(), rollback); release.resolve(); await assert.rejects(writing);
		await deleted.promise; assert.equal(await remainsPending(rollback), true); assert.deepEqual(f.deleted, [f.names.mediaDatabaseName]);
		await assert.rejects(createPhotoMediaRestoreCandidateV2(options(f)), /already owns/iu);
	} finally { release.resolve(); deletion.resolve(); await Promise.allSettled([writing, rollback, ...(nested ? [nested] : [])]); }
});

test('malformed native LUT metadata still retires the complete owned point-read body before refusing promotion', async () => {
	const f = mediaRestoreFixture(), candidate = await createPhotoMediaRestoreCandidateV2(options(f)), stage = await catalog(f);
	const captured: Uint8Array[] = [];
	try {
		await fill(candidate); const raw = f.raw(f.names.mediaDatabaseName), row = raw.records(f.names.mediaDatabaseName, 'analysis')[0]!;
		raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { ...row, value: { ...row.value, reference: { ...LUT_REFERENCE, domainMax: [2, 1, 1] } } });
		f.observeTransactions((transaction, stores, mode) => {
			if (mode !== 'readonly' || typeof stores === 'string' || ![...stores].includes('analysis')) return;
			const objectStore = transaction.objectStore;
			transaction.objectStore = name => {
				const store = Reflect.apply(objectStore, transaction, [name]) as IDBObjectStore; if (name !== 'analysis') return store;
				const get = store.get; store.get = key => {
					const result = Reflect.apply(get, store, [key]) as IDBRequest; let value: unknown;
					Object.defineProperty(result, 'result', { configurable: true, get() { return value; }, set(next: unknown) {
						value = next; captured.push((next as { value: { bytes: Uint8Array } }).value.bytes);
					} }); return result;
				}; return store;
			};
		});
		await assert.rejects(candidate.finish(), /reference differs/iu); assert.equal(captured.length, 1);
		assert.ok(captured.every(bytes => bytes.every(byte => byte === 0)));
		assert.deepEqual(raw.records(f.names.mediaDatabaseName, 'analysis')[0]!.value.bytes, LUT_BODY);
		assert.ok(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots').every(row => row.importId !== null));
	} finally { await candidate.rollback(); await stage.rollback(); }
});
