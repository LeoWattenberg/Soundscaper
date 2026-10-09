/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importManagedPhotosV2 } from '../src/lightscaper/import/managed-import-v2.ts';
import type { PhotoManagedImportPortsV2 } from '../src/lightscaper/import/managed-import-ports-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

async function fixture() {
	const backing = createInstrumentedIndexedDB(), indexedDB = backing as unknown as IDBFactory;
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: `lightscaper-managed-current-media-${crypto.randomUUID()}`, locks: null, preferOpfs: false, syncWorkerClient: null });
	await media.ready(); const resources = await media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: `managed-current-catalog-${crypto.randomUUID()}`,
		verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current import',
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	const ports: PhotoManagedImportPortsV2 = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal),
		createImportId: () => 'import-current', exclusive: async (_catalog, run, signal) => run(signal) };
	return { media, catalog, resources, ports, close: async () => { await catalog.close(); await media.close(); } };
}

test('actual current owners publish mixed1/2 with unchanged receipts, complete recipes, original dedupe and immutable body custody', async () => {
	const f = await fixture(), old = photoArchiveFixture(2), current = lutArchiveFixture().record;
	try {
		await f.resources.put(LUT_REFERENCE, LUT_BODY);
		const before = serializePhotoDocumentV1OrV2(current.photo), receipts = await importManagedPhotosV2('catalog-1', [current, old], f.ports);
		assert.deepEqual(receipts.map(({ status, reusedOriginal }) => [status, reusedOriginal]), [['imported', false], ['imported', true]]);
		assert.equal(serializePhotoDocumentV1OrV2(current.photo), before);
		assert.deepEqual(await f.catalog.loadPhoto('catalog-1', current.photo.id), current.photo);
		const stored = await f.catalog.loadPhoto('catalog-1', old.photo.id); assert.ok(stored);
		assert.deepEqual(stored, normalizePhotoDocumentV1OrV2({ ...old.photo, original: { ...old.photo.original, storageKey: current.photo.original.storageKey } }));
		const body = await f.media.mediaRepository.loadAsset(stored.original.storageKey); assert.ok(body);
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), new Uint8Array([1, 2, 3]));
		assert.equal((await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' })).roots.length, 2);
		assert.equal(await f.media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
		await f.resources.source.withBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); });
	} finally { await f.close(); }
});

test('nonnull disabled and redo/snapshot resource closure requires the captured actual verifier before publication', async () => {
	const f = await fixture(), current = lutArchiveFixture().record;
	try {
		const { verifyResources: _verify, ...missing } = f.ports;
		const results = await importManagedPhotosV2('catalog-1', [current], missing);
		assert.equal(results[0]?.status, 'failed'); assert.equal(await f.catalog.loadPhoto('catalog-1', current.photo.id), null);
		const absent = await importManagedPhotosV2('catalog-1', [current], f.ports);
		assert.equal(absent[0]?.status, 'failed'); assert.equal((await f.catalog.loadCatalog('catalog-1'))?.photoCount, 0);
		const version = current.photo.versions[0]!, legacy = photoArchiveFixture().photo.versions[0]!;
		const photo = normalizePhotoDocumentV1OrV2({ ...current.photo, versions: [{ ...version, develop: legacy.develop,
			workspace: { schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 0,
				entries: [legacy.develop, version.develop].map(develop => ({ label: 'State', createdAt: version.createdAt, develop })),
				snapshots: [{ id: 'snapshot', name: 'Saved', createdAt: version.createdAt, develop: version.develop }] } }] });
		assert.equal((await importManagedPhotosV2('catalog-1', [{ ...current, photo }], missing))[0]?.status, 'failed');
		await f.resources.put(LUT_REFERENCE, LUT_BODY);
		assert.equal((await importManagedPhotosV2('catalog-1', [{ ...current, photo }], f.ports))[0]?.status, 'imported');
		assert.deepEqual(await f.catalog.loadPhoto('catalog-1', photo.id), photo);
	} finally { await f.close(); }
});

test('complete mixed admission refuses future/process1 cube and aggregate history overflow before originals are written', async () => {
	const f = await fixture(), input = lutArchiveFixture().record; let writes = 0;
	const ports = { ...f.ports, media: { ...f.ports.media, writeAsset: (...args: Parameters<PhotoManagedImportPortsV2['media']['writeAsset']>) => {
		writes++; return Reflect.apply(f.ports.media.writeAsset, f.ports.media, args);
	} } };
	try {
		const develop = { ...input.photo.versions[0]!.develop, effects: Array.from({ length: 256 }, (_, index) => ({
			...input.photo.versions[0]!.develop.effects[0], id: `profile-${String(index)}`,
		})) };
		const workspace = { schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 0, snapshots: [],
			entries: Array.from({ length: 14 }, () => ({ label: 'LUT stack', createdAt: input.photo.versions[0]!.createdAt, develop })) };
		const version = { ...input.photo.versions[0], develop, workspace };
		const one = normalizePhotoDocumentV1OrV2({ ...input.photo, versions: [version] });
		assert.ok(new TextEncoder().encode(serializePhotoDocumentV1OrV2(one)).byteLength <= 2_097_152);
		const oversized = { ...input.photo, versions: [version, { ...version, id: 'copy', kind: 'virtual-copy' }] };
		assert.throws(() => normalizePhotoDocumentV1OrV2(oversized), /byte budget/u);
		for (const photo of [{ ...input.photo, schemaVersion: 3 }, { ...input.photo, schemaVersion: 1 }, oversized]) {
			assert.equal((await importManagedPhotosV2('catalog-1', [{ ...input, photo } as never], ports))[0]?.status, 'failed');
		}
		assert.equal(writes, 0); assert.equal((await f.catalog.loadCatalog('catalog-1'))?.photoCount, 0);
	} finally { await f.close(); }
});

test('all port objects and receiver-bound methods are pinned before held demand and metadata is never read', async () => {
	const f = await fixture(), held = deferred<void>(), entered = deferred<void>(); let gets = 0, metadata = 0;
	const catalog = { ...f.ports.catalog, loadCatalog: new Proxy(async function (this: unknown, id: string) {
		assert.equal(this, catalog); entered.resolve(); await held.promise; return f.catalog.loadCatalog(id);
	}, { get() { metadata++; throw new Error('function metadata'); } }),
		loadPhoto: (...args: Parameters<PhotoManagedImportPortsV2['catalog']['loadPhoto']>) => f.catalog.loadPhoto(...args),
		publishPhotos: (...args: Parameters<PhotoManagedImportPortsV2['catalog']['publishPhotos']>) => f.catalog.publishPhotos(...args) };
	const ports = { ...f.ports, get catalog() { gets++; return gets === 1 ? catalog : Object.freeze({}); } } as PhotoManagedImportPortsV2;
	const work = importManagedPhotosV2('catalog-1', [photoArchiveFixture()], ports);
	try { await entered.promise; held.resolve(); assert.equal((await work)[0]?.status, 'imported'); assert.equal(gets, 1); assert.equal(metadata, 0); }
	finally { held.resolve(); await work; await f.close(); }
});

test('cold observed opaque cancellation and hostile options refuse before port acquisition or writer authority', async () => {
	let reflections = 0, leases = 0;
	const stop = new AbortController(), reason = new Proxy({}, { get() { reflections++; throw Error('get'); }, getPrototypeOf() { reflections++; throw Error('prototype'); } });
	stop.abort(reason);
	const ports = new Proxy({}, { get() { leases++; throw Error('ports acquired'); } }) as PhotoManagedImportPortsV2;
	const outcome = await importManagedPhotosV2('catalog-1', [], ports, { signal: stop.signal }).then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.equal(outcome.error, reason); assert.equal(reflections, 0); assert.equal(leases, 0);
	let getters = 0;
	const accessor = Object.defineProperty({}, 'onPublished', { enumerable: true, get() { getters++; return () => undefined; } });
	await assert.rejects(importManagedPhotosV2('catalog-1', [], ports, accessor), /own data|accessor/u);
	const active = new AbortController(); Object.defineProperty(active.signal, 'throwIfAborted', { value: () => { getters++; } });
	await assert.rejects(importManagedPhotosV2('catalog-1', [], ports, { signal: active.signal }), /overrides/u);
	assert.equal(getters, 0); assert.equal(leases, 0);
});

for (const boundary of ['journal', 'catalog'] as const) test(`native cancellation after held ${boundary} admission prevents later capabilities and owning reflection`, async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	let calls = 0, allocated = 0, reflected = 0;
	const reason = new Proxy({}, { get() { reflected++; throw Error('Opaque get'); }, getPrototypeOf() { reflected++; throw Error('Opaque prototype'); } });
	const catalog = { loadPhoto: (...args: Parameters<typeof f.catalog.loadPhoto>) => f.catalog.loadPhoto(...args),
		publishPhotos: (...args: Parameters<typeof f.catalog.publishPhotos>) => f.catalog.publishPhotos(...args),
		loadCatalog: async (catalogId: string) => {
			calls++;
			if (boundary === 'journal') throw Error('Later catalog refusal must not replace native cancellation');
			const root = await f.catalog.loadCatalog(catalogId); assert.ok(root); entered.resolve(); await release.promise;
			return new Proxy(root, { ownKeys() { reflected++; throw Error('Late catalog reflection'); } });
		} };
	const journal = { putIfAbsent: (...args: Parameters<typeof f.ports.journal.putIfAbsent>) => f.ports.journal.putIfAbsent(...args),
		deleteIfCurrent: (...args: Parameters<typeof f.ports.journal.deleteIfCurrent>) => f.ports.journal.deleteIfCurrent(...args),
		get: async (key: string) => {
			const absent = await f.ports.journal.get(key); assert.equal(absent, undefined);
			if (boundary === 'journal') { entered.resolve(); await release.promise; } return absent;
		} };
	const work = importManagedPhotosV2('catalog-1', [], { ...f.ports, catalog, journal,
		createImportId: () => { allocated++; return 'import-current'; } }, { signal: stop.signal });
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	try {
		await entered.promise; stop.abort(reason); release.resolve(); assert.equal((await outcome).error === reason, true);
		assert.equal(calls, boundary === 'journal' ? 0 : 1); assert.equal(allocated, 0); assert.equal(reflected, 0);
	} finally { release.resolve(); await outcome; await f.close(); }
});

test('native abort during final options detachment precedes every port capability read', async () => {
	const stop = new AbortController(); let reads = 0, descriptors = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
	const options = new Proxy({ signal: stop.signal, onPublished: () => undefined }, {
		getOwnPropertyDescriptor(target, key) {
			if (key === 'onPublished' && ++descriptors === 2) stop.abort(reason);
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	const ports = new Proxy({}, { get() { reads++; throw Error('Port capability after cancellation'); } }) as PhotoManagedImportPortsV2;
	const outcome = await importManagedPhotosV2('catalog-1', [], ports, options)
		.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.equal(outcome.error === reason, true); assert.equal(reads, 0); assert.equal(traps, 0);
});
