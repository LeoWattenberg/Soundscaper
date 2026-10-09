/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importManagedPhotosV2, recoverManagedPhotoImportV2 } from '../src/lightscaper/import/managed-import-v2.ts';
import type { PhotoManagedImportPortsV2, PhotoManagedImportReceiptV1 } from '../src/lightscaper/import/managed-import-ports-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { catalogOriginalPhotoIds } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture() {
	const backing = createInstrumentedIndexedDB(), indexedDB = backing as unknown as IDBFactory;
	const mediaName = `lightscaper-managed-recovery-media-${crypto.randomUUID()}`, catalogName = `managed-recovery-catalog-${crypto.randomUUID()}`;
	const open = async () => {
		const media = new PhotoMediaStoreV1({ indexedDB, databaseName: mediaName, locks: null, preferOpfs: false, syncWorkerClient: null });
		await media.ready(); const resources = await media.getCubeLutResources();
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: catalogName, verifyOriginal: media.verifyOriginal,
			verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
		return { media, catalog, resources };
	};
	let owner = await open(); const close = async () => { await owner.catalog.close(); await owner.media.close(); };
	const ports = (): PhotoManagedImportPortsV2 => ({ catalog: owner.catalog,
		media: { writeAsset: owner.media.mediaRepository.writeAsset, custody: owner.media.mediaRepository.catalogOriginals },
		journal: owner.media.settingsRepository, verifyResources: (photo, signal) => owner.resources.verifyPhoto(photo, signal),
		createImportId: () => 'import-current', exclusive: async (_catalog, run, signal) => run(signal) });
	await owner.catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current recovery',
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await owner.resources.put(LUT_REFERENCE, LUT_BODY);
	return { owner: () => owner, ports, close, reopen: async () => { await close(); owner = await open(); } };
}

for (const phase of ['staged', 'published'] as const) test(`native ${phase} interruption joins held work and recovers the exact mixed original after reopen`, async () => {
	const f = await fixture(), input = lutArchiveFixture().record, stop = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); } });
	const base = f.ports(), observed: PhotoManagedImportReceiptV1[] = [];
	const ports: PhotoManagedImportPortsV2 = phase === 'staged' ? { ...base, media: { ...base.media, custody: { ...base.media.custody,
		findDigestPage: (...args) => base.media.custody.findDigestPage(...args), readPage: (...args) => base.media.custody.readPage(...args),
		promote: (...args) => base.media.custody.promote(...args), releaseStaged: (...args) => base.media.custody.releaseStaged(...args),
		stage: async (...args) => { await base.media.custody.stage(...args); entered.resolve(); await release.promise; } } } }
		: { ...base, catalog: { loadCatalog: id => base.catalog.loadCatalog(id), loadPhoto: (...args) => base.catalog.loadPhoto(...args),
			publishPhotos: async (...args) => { const root = await base.catalog.publishPhotos(...args); entered.resolve(); await release.promise; return root; } } };
	const work = importManagedPhotosV2('catalog-1', [input], ports, { signal: stop.signal, onPublished: item => observed.push(item) });
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true);
		assert.ok(await f.owner().media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')));
		release.resolve(); assert.equal((await outcome).error, reason); assert.equal(traps, 0);
		assert.equal(observed.length, phase === 'published' ? 1 : 0);
		await f.reopen(); await recoverManagedPhotoImportV2('catalog-1', f.ports());
		assert.equal(await f.owner().media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
		assert.equal((await f.owner().media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: 'import-current' })).roots.length, 0);
		assert.equal((await f.owner().media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' })).roots.length, phase === 'published' ? 1 : 0);
		const stored = await f.owner().catalog.loadPhoto('catalog-1', input.photo.id);
		assert.deepEqual(stored, phase === 'published' ? input.photo : null);
		if (stored) await f.owner().media.verifyOriginal(stored.original);
	} finally { release.resolve(); await outcome; await f.close(); }
});

test('lost native publication ACK reconciles complete immutable facts while preserving later authored mixed revision', async () => {
	const f = await fixture(), input = lutArchiveFixture().record, base = f.ports();
	const ports: PhotoManagedImportPortsV2 = { ...base, catalog: { loadCatalog: id => base.catalog.loadCatalog(id), loadPhoto: (...args) => base.catalog.loadPhoto(...args),
		publishPhotos: async (...args) => {
			await base.catalog.publishPhotos(...args); const stored = await base.catalog.loadPhoto('catalog-1', input.photo.id); assert.ok(stored);
			await f.owner().catalog.savePhoto(normalizePhotoDocumentV1OrV2({ ...stored, rating: 5, metadata: { ...stored.metadata, caption: 'Later author' } }), stored.revision);
			throw new Error('lost publication ACK');
		} } };
	try {
		assert.equal((await importManagedPhotosV2('catalog-1', [input], ports))[0]?.status, 'imported');
		await f.reopen(); const stored = await f.owner().catalog.loadPhoto('catalog-1', input.photo.id); assert.ok(stored);
		assert.equal(stored.schemaVersion, 2); assert.equal(stored.revision, 1); assert.equal(stored.rating, 5); assert.equal(stored.metadata.caption, 'Later author');
		assert.deepEqual(stored.original, input.photo.original); assert.deepEqual(stored.versions, input.photo.versions);
	} finally { await f.close(); }
});

test('recovery refuses a fully admitted conflicting original and retains the interrupted journal and staged root', async () => {
	const f = await fixture(), input = lutArchiveFixture().record, stop = new AbortController(), base = f.ports();
	const ports: PhotoManagedImportPortsV2 = { ...base, catalog: { loadCatalog: id => base.catalog.loadCatalog(id), loadPhoto: (...args) => base.catalog.loadPhoto(...args),
		publishPhotos: async (...args) => { const root = await base.catalog.publishPhotos(...args); stop.abort(); return root; } } };
	try {
		await assert.rejects(importManagedPhotosV2('catalog-1', [input], ports, { signal: stop.signal }), { name: 'AbortError' });
		const recovery = f.ports(); const conflicting = normalizePhotoDocumentV1OrV2({ ...input.photo, original: { ...input.photo.original, storageKey: 'foreign-original' } });
		const { verifyResources: _verify, ...missing } = recovery;
		await assert.rejects(recoverManagedPhotoImportV2('catalog-1', missing), /resources require/u);
		assert.equal((await f.owner().media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: 'import-current' })).roots.length, 1);
		await assert.rejects(recoverManagedPhotoImportV2('catalog-1', { ...recovery, catalog: { loadCatalog: id => recovery.catalog.loadCatalog(id),
			publishPhotos: (...args) => recovery.catalog.publishPhotos(...args), loadPhoto: async () => conflicting } }), /conflict/iu);
		assert.ok(await f.owner().media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')));
		assert.equal((await f.owner().media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: 'import-current' })).roots.length, 1);
		await recoverManagedPhotoImportV2('catalog-1', recovery);
	} finally { await f.close(); }
});

test('actual recovery pages removed mixed roots while each native promotion or release stays within sixteen', async () => {
	const f = await fixture(), input = lutArchiveFixture().record, base = f.ports();
	const assetId = input.photo.original.storageKey, references = Array.from({ length: 130 }, (_, index) => ({
		photoId: `photo-${String(index).padStart(3, '0')}`, sourceId: input.photo.original.id, assetId,
		sha256: input.photo.original.contentSha256, size: input.photo.original.byteLength,
	}));
	const batches: number[] = []; let pages = 0;
	try {
		await f.owner().media.mediaRepository.writeAsset(assetId, input.original);
		await f.owner().media.settingsRepository.put(photoImportIntentKeyV1('catalog-1'), {
			schemaVersion: 1, kind: 'photo-import', catalogId: 'catalog-1', importId: 'import-current',
		});
		for (let offset = 0; offset < references.length; offset += 16) {
			await base.media.custody.stage('catalog-1', 'import-current', references.slice(offset, offset + 16));
			const photos = references.slice(offset, offset + 16).filter((_, index) => (offset + index) % 2 === 0)
				.map(reference => normalizePhotoDocumentV1OrV2({ ...input.photo, id: reference.photoId }));
			const root = await base.catalog.loadCatalog('catalog-1'); assert.ok(root);
			await base.catalog.publishPhotos('catalog-1', root.revision, photos);
		}
		await f.reopen(); const current = f.ports(), custody = current.media.custody;
		await recoverManagedPhotoImportV2('catalog-1', { ...current, media: { ...current.media, custody: {
			findDigestPage: (...args) => custody.findDigestPage(...args), stage: (...args) => custody.stage(...args),
			readPage: (...args) => { pages++; return custody.readPage(...args); },
			promote: (...args) => { batches.push(catalogOriginalPhotoIds(args[2]).length); return custody.promote(...args); },
			releaseStaged: (...args) => { batches.push(catalogOriginalPhotoIds(args[2]).length); return custody.releaseStaged(...args); },
		} } });
		assert.equal(pages, 3); assert.ok(batches.length > 2); assert.ok(batches.every(count => count > 0 && count <= 16));
		assert.equal((await f.owner().catalog.loadCatalog('catalog-1'))?.photoCount, 65);
		assert.equal((await custody.readPage({ catalogId: 'catalog-1', importId: 'import-current' })).roots.length, 0);
		assert.equal(await f.owner().media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
	} finally { await f.close(); }
});
