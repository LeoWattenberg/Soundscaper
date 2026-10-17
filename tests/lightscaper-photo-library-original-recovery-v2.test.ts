/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoLibraryOriginalInspectionPageV2 } from '../src/lightscaper/controller/photo-library-original-inspection-v2.ts';
import { restorePhotoLibraryOriginalBodyV2 } from '../src/lightscaper/controller/photo-library-original-restoration-v2.ts';
import { readPhotoLibraryOriginalInspectionPageV1 } from '../src/lightscaper/controller/photo-library-original-inspection-v1.ts';
import { restorePhotoLibraryOriginalBodyV1 } from '../src/lightscaper/controller/photo-library-original-restoration-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { request, transact, openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture() {
	const raw = createInstrumentedIndexedDB(), mediaName = `lightscaper-current-repair-${crypto.randomUUID()}`, indexedDB = raw as unknown as IDBFactory;
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: mediaName, locks: null, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: `${mediaName}-catalog`, verifyOriginal: media.verifyOriginal, verifyResources: async () => undefined });
	const first = photoArchiveFixture(), second = photoArchiveFixture(2);
	const current = normalizePhotoDocumentV2({ ...second.photo, schemaVersion: 2, versions: [{ ...second.photo.versions[0], develop: currentRecipe() }] });
	await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	for (const item of [first, second]) {
		await media.mediaRepository.writeAsset(item.photo.original.storageKey, item.original);
		await media.mediaRepository.catalogOriginals.retain('catalog-1', [{ photoId: item.photo.id, sourceId: item.photo.original.id, assetId: item.photo.original.storageKey,
			sha256: item.photo.original.contentSha256, size: item.photo.original.byteLength }]);
	}
	await catalog.publishPhotos('catalog-1', 0, [first.photo, current]);
	const database = await openDatabase(indexedDB, mediaName), signal = new AbortController().signal;
	const inspection = { async inspect(this: unknown, binding: Parameters<typeof media.mediaRepository.inspectCatalogOriginalBody>[0], admitted: AbortSignal) {
		assert.equal(this, inspection); return media.mediaRepository.inspectCatalogOriginalBody(binding, { signal: admitted });
	} };
	const restoration = { async restoreCatalogOriginalBody(this: unknown, ...args: Parameters<typeof media.mediaRepository.restoreCatalogOriginalBody>) {
		assert.equal(this, restoration); return Reflect.apply(media.mediaRepository.restoreCatalogOriginalBody, media.mediaRepository, args);
	} };
	const ports = { catalog, journal: media.settingsRepository, media: { custody: media.mediaRepository.catalogOriginals }, originalInspection: inspection, originalRestoration: restoration };
	return { raw, mediaName, media, catalog, database, ports, signal, current, second,
		close: async () => { database.close(); await catalog.close(); await media.close(); } };
}

test('current original scan/repair admits complete mixed photos and preserves all document and custody bytes', async () => {
	const f = await fixture();
	try {
		const page = await readPhotoLibraryOriginalInspectionPageV2('catalog-1', f.ports, null, null, f.signal);
		assert.equal(page.schemaVersion, 1); assert.equal(page.rows.length, 2); assert.ok(page.rows.every(row => row.inspection.status === 'present'));
		await assert.rejects(readPhotoLibraryOriginalInspectionPageV1('catalog-1', f.ports as never, null, null, f.signal));
		const row = page.rows.find(row => row.photoId === 'photo-2'); assert.ok(row);
		const target = { schemaVersion: 1 as const, catalogRevision: page.revision, activeImportId: page.activeImportId, photoRevision: row.revision, binding: row.binding };
		await transact(f.database, 'mediaAssets', 'readwrite', stores => request(stores.mediaAssets!.delete(row.binding.assetId)));
		await assert.rejects(restorePhotoLibraryOriginalBodyV1('catalog-1', f.ports as never, target, f.second.original, f.signal));
		const roots = f.raw.records(f.mediaName, 'catalogOriginalRoots');
		const ack = await restorePhotoLibraryOriginalBodyV2('catalog-1', f.ports, target, f.second.original, f.signal);
		assert.equal(ack.sha256, row.binding.sha256); assert.deepEqual(await f.catalog.loadPhoto('catalog-1', 'photo-2'), f.current);
		assert.deepEqual(f.raw.records(f.mediaName, 'catalogOriginalRoots'), roots);
		assert.equal((await readPhotoLibraryOriginalInspectionPageV2('catalog-1', f.ports, null, null, f.signal)).rows[1]?.inspection.status, 'present');
	} finally { await f.close(); }
});

test('current original owners pin callable receiver capabilities before held reads and refuse malformed full recipes before repair', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), load = f.catalog.loadCatalog;
	const catalog = { loadCatalog: async (...args: Parameters<typeof load>) => { entered.resolve(); await release.promise; return Reflect.apply(load, f.catalog, args); },
		loadPhoto: new Proxy(async (...args: Parameters<typeof f.catalog.loadPhoto>) => f.catalog.loadPhoto(...args), {
			get() { throw Error('Borrowed function metadata'); }, apply(target, receiver, args) { assert.equal(receiver, catalog); return Reflect.apply(target, receiver, args); } }) };
	const work = readPhotoLibraryOriginalInspectionPageV2('catalog-1', { ...f.ports, catalog }, null, null, f.signal);
	try {
		await entered.promise; catalog.loadPhoto = async () => { throw Error('Late replacement'); }; release.resolve(); assert.equal((await work).rows.length, 2);
		let repaired = false; const malformed = { ...f.current, versions: [{ ...f.current.versions[0], develop: { processVersion: 99 } }] };
		const page = await readPhotoLibraryOriginalInspectionPageV2('catalog-1', f.ports, null, null, f.signal), row = page.rows[1]!;
		await assert.rejects(restorePhotoLibraryOriginalBodyV2('catalog-1', { ...f.ports, catalog: { loadCatalog: (...args) => f.catalog.loadCatalog(...args), loadPhoto: async () => malformed },
			originalRestoration: { restoreCatalogOriginalBody: async () => { repaired = true; throw Error('Unexpected repair'); } } },
			{ schemaVersion: 1, catalogRevision: page.revision, activeImportId: null, photoRevision: row.revision, binding: row.binding }, f.second.original, f.signal));
		assert.equal(repaired, false);
	} finally { release.resolve(); await f.close(); }
});

test('current inspection joins held native body reads and preserves opaque intrinsic cancellation without reflection', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque'); }, getPrototypeOf() { traps++; throw Error('Opaque'); } });
	const ports = { ...f.ports, originalInspection: { inspect: async () => { entered.resolve(); await release.promise; return { status: 'present' as const }; } } };
	const work = readPhotoLibraryOriginalInspectionPageV2('catalog-1', ports, null, null, stop.signal), settled = work.then(() => ({ error: null }), error => ({ error: error as unknown }));
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(settled), true); release.resolve();
		assert.equal((await settled).error === reason, true); assert.equal(traps, 0);
	} finally { release.resolve(); await f.close(); }
});

test('current original repair retains the completed native body ACK through a held return and late opaque abort', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque'); }, getOwnPropertyDescriptor() { traps++; throw Error('Opaque'); } });
	try {
		const page = await readPhotoLibraryOriginalInspectionPageV2('catalog-1', f.ports, null, null, f.signal), row = page.rows[1]!;
		await transact(f.database, 'mediaAssets', 'readwrite', stores => request(stores.mediaAssets!.delete(row.binding.assetId)));
		const restore = f.ports.originalRestoration.restoreCatalogOriginalBody;
		const ports = { ...f.ports, originalRestoration: { async restoreCatalogOriginalBody(...args: Parameters<typeof restore>) {
			const ack = await Reflect.apply(restore, f.ports.originalRestoration, args); entered.resolve(); await release.promise; return ack;
		} } };
		const work = restorePhotoLibraryOriginalBodyV2('catalog-1', ports, { schemaVersion: 1, catalogRevision: page.revision,
			activeImportId: null, photoRevision: row.revision, binding: row.binding }, f.second.original, stop.signal);
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve();
		assert.equal((await work).sha256, row.binding.sha256); assert.equal(traps, 0);
		assert.deepEqual(await f.catalog.loadPhoto('catalog-1', 'photo-2'), f.current);
	} finally { release.resolve(); await f.close(); }
});

test('original root reflection cancellation prevents any later borrowed journal or body demand', async () => {
	const f = await fixture(), stop = new AbortController(), root = await f.catalog.loadCatalog('catalog-1'); assert.ok(root);
	let reads = 0, traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('Opaque'); } });
	const document = new Proxy(root, { ownKeys(target) { stop.abort(reason); return Reflect.ownKeys(target); } });
	const ports = { ...f.ports, catalog: { loadCatalog: async () => document, loadPhoto: (...args: Parameters<typeof f.catalog.loadPhoto>) => f.catalog.loadPhoto(...args) },
		journal: { get: async () => { reads++; return undefined; } } };
	try {
		const result = await readPhotoLibraryOriginalInspectionPageV2('catalog-1', ports, null, null, stop.signal).then(() => ({ error: null }), error => ({ error: error as unknown }));
		assert.equal(result.error === reason, true); assert.equal(reads, 0); assert.equal(traps, 0);
	} finally { await f.close(); }
});

test('fixed legacy wrappers retain their original non-photo refusal policy after private core extraction', async () => {
	const f = await fixture();
	try {
		const page = await readPhotoLibraryOriginalInspectionPageV2('catalog-1', f.ports, null, null, f.signal), row = page.rows[0]!;
		const root = await f.catalog.loadCatalog('catalog-1'); assert.ok(root);
		const ports = { ...f.ports, catalog: { loadCatalog: async () => root, loadPhoto: async () => root } };
		await assert.rejects(readPhotoLibraryOriginalInspectionPageV1('catalog-1', ports as never, null, null, f.signal),
			{ name: 'TypeError', message: 'Original inspection requires a published photo document.' });
		await assert.rejects(restorePhotoLibraryOriginalBodyV1('catalog-1', ports as never, { schemaVersion: 1,
			catalogRevision: page.revision, activeImportId: null, photoRevision: row.revision, binding: row.binding }, f.second.original, f.signal),
			{ name: 'Error', message: 'Restoration photo identity or revision changed.' });
	} finally { await f.close(); }
});
