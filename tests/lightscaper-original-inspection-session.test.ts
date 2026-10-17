/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { catalogOriginalKey, catalogOriginalScope, normalizeCatalogOriginalRoot, type CatalogOriginalRootV1 } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { MediaCatalogOriginalInspectionRepositoryV1 } from '../src/common/editor/storage/media-catalog-original-inspection-repository.ts';
import { MediaAssetLifecycleCoordinator } from '../src/common/editor/storage/media-asset-lifecycle-coordinator.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import type { PhotoLibraryOriginalInspectionPortV1 } from '../src/lightscaper/controller/photo-library-original-inspection-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { importManagedPhotosV1 } from '../src/lightscaper/import/managed-import-v1.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createRepairFixture } from './helpers/media-catalog-original-repair-fixture.ts';

const intent = Object.freeze({ schemaVersion: 1, kind: 'photo-import', catalogId: 'catalog-1', importId: 'import-1' });

function fixture(count = 1) {
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Library', revision: 1, photoCount: count, folders: [], keywords: [], collections: [] });
	let journal: unknown = intent;
	const photos = new Map(Array.from({ length: count }, (_, index) => {
		const photo = photoArchiveFixture(index + 1).photo; return [photo.id, photo] as const;
	}));
	const roots: CatalogOriginalRootV1[] = [...photos.values()].map(photo => makeRoot(photo.id, 'import-1'));
	const calls: string[] = [];
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected mutation'); };
	const originalInspection: { inspect: PhotoLibraryOriginalInspectionPortV1['inspect'] } = {
		inspect: async binding => { calls.push(`inspect:${binding.photoId}`); return { status: 'missing', reason: 'media-row' }; },
	};
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] }
		& { originalInspection: PhotoLibraryOriginalInspectionPortV1 } = {
		initialize: async () => { calls.push('initialize'); return root; },
		closeResources: async () => { calls.push('close'); },
		exclusive: async (_catalog, operation, signal) => { calls.push('lock'); return operation(signal); },
		catalog: { loadCatalog: async () => root, loadPhoto: async (_catalog, photoId) => photos.get(photoId) ?? null,
			readSummaryPage: async () => { calls.push('ordinary-page'); return { items: [], continuation: null }; },
			readQueryPage: unexpected, rebuildQueryIndexPage: unexpected,
			publishPhotos: unexpected, savePhoto: unexpected, saveCatalog: unexpected },
		journal: { get: async () => journal, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
		media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected,
			promote: async () => { calls.push('promote'); throw new Error('Media asset missing at promotion'); },
			releaseStaged: unexpected,
			readPage: async query => {
				calls.push(`roots:${query.importId ?? 'committed'}`);
				const selected = roots.filter(row => row.importId === (query.importId ?? null)
					&& (query.afterKey == null || row.key > query.afterKey)).sort((a, b) => a.key < b.key ? -1 : 1).slice(0, 64);
				return { roots: selected, afterKey: selected.length === 64 ? selected.at(-1)!.key : null };
			} } }, originalInspection,
	};
	function makeRoot(photoId: string, importId: string | null): CatalogOriginalRootV1 {
		const photo = photos.get(photoId)!;
		return normalizeCatalogOriginalRoot({ schemaVersion: 1, catalogId: root.id, importId, photoId,
			key: catalogOriginalKey(root.id, importId, photoId), scope: catalogOriginalScope(root.id, importId),
			assetId: photo.original.storageKey, sourceId: photo.original.id, sha256: photo.original.contentSha256,
			size: photo.original.byteLength, mediaContentToken: 'media-content-abcdefghijklmnop' });
	}
	return { ports, roots, photos, calls, originalInspection, makeRoot,
		setIntent: (value: unknown) => { journal = value; },
		setRevision: () => { root = normalizePhotoCatalogRootV1({ ...root, revision: root.revision + 1 }); } };
}

test('normal readiness still refuses blocked promotion while opted-in inspection exposes exact published provisional identity', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports);
	await assert.rejects(owner.readPage(), /missing at promotion/iu);
	const first = await owner.inspectOriginals();
	assert.equal(first.rows.length, 0); assert.equal(first.scanned, 0); assert.ok(first.cursor);
	const second = await owner.inspectOriginals({ cursor: first.cursor });
	assert.equal(second.startupFailure?.message, 'Media asset missing at promotion');
	assert.equal(second.rows.length, 1); assert.equal(second.cursor, null);
	assert.deepEqual(second.rows[0]?.inspection, { status: 'missing', reason: 'media-row' });
	assert.deepEqual(second.rows[0]?.binding, { catalogId: 'catalog-1', importId: 'import-1', photoId: 'photo-1',
		sourceId: 'source-1', assetId: 'original-1', sha256: photoArchiveFixture().photo.original.contentSha256,
		size: 3, name: 'Photo 1.png', mimeType: 'image/png' });
	assert.equal(Object.hasOwn(second.rows[0]!.binding, 'mediaContentToken'), false);
	await assert.rejects(owner.readPage(), /missing at promotion/iu);
	assert.equal(f.calls.includes('ordinary-page'), false);
	assert.equal(f.roots.length, 1); await owner.close();
});

test('committed originals can be inspected without attempting ordinary recovery and use immutable source names', async () => {
	const f = fixture(); f.setIntent(undefined); f.roots.splice(0, 1, f.makeRoot('photo-1', null));
	const photo = f.photos.get('photo-1')!;
	f.photos.set(photo.id, normalizePhotoDocumentV1({ ...photo, metadata: { ...photo.metadata, fileName: 'Authored name.png' } }));
	f.originalInspection.inspect = async () => ({ status: 'present' });
	const owner = new PhotoLibrarySessionV1(f.ports), page = await owner.inspectOriginals();
	assert.equal(page.rows[0]?.fileName, 'Authored name.png'); assert.equal(page.rows[0]?.binding.name, 'Photo 1.png');
	assert.equal(page.rows[0]?.binding.importId, null); assert.equal(page.startupFailure, null);
	assert.equal(f.calls.includes('promote'), false); await owner.close();
});

test('unsupported or foreign intent refuses before custody scanning or body inspection', async () => {
	for (const value of [{ ...intent, schemaVersion: 2 }, { ...intent, kind: 'foreign-import' },
		{ ...intent, catalogId: 'foreign' }, { ...intent, extra: true }]) {
		const f = fixture(); f.setIntent(value); const owner = new PhotoLibrarySessionV1(f.ports);
		await assert.rejects(owner.inspectOriginals());
		assert.equal(f.calls.some(call => call.startsWith('roots:') || call.startsWith('inspect:')), false);
		await owner.close();
	}
});

test('root/photo original mismatches and malformed roots refuse the page rather than appearing as media errors', async () => {
	for (const changes of [{ sourceId: 'other-source' }, { assetId: 'other-key' }, { sha256: 'f'.repeat(64) },
		{ size: 999 }, { photoId: 'different-photo' }, { scope: 'corrupt' }]) {
		const f = fixture(); f.setIntent(undefined); f.roots.splice(0, 1, { ...f.makeRoot('photo-1', null), ...changes });
		const owner = new PhotoLibrarySessionV1(f.ports);
		await assert.rejects(owner.inspectOriginals(), /root|original|published/iu);
		assert.equal(f.calls.some(call => call.startsWith('inspect:')), false); await owner.close();
	}
});

test('unpublished staged roots remain intact but are not offered as published repair candidates', async () => {
	const f = fixture(); f.photos.clear(); const owner = new PhotoLibrarySessionV1(f.ports);
	const first = await owner.inspectOriginals(); const page = await owner.inspectOriginals({ cursor: first.cursor });
	assert.equal(page.rows.length, 0); assert.equal(page.scanned, 1); assert.equal(f.roots.length, 1);
	assert.equal(f.calls.includes('promote'), false); await owner.close();
});

test('metadata scan is page bounded, serial and revision/intent fenced', async () => {
	const f = fixture(65); const owner = new PhotoLibrarySessionV1(f.ports);
	let active = 0, maximum = 0;
	f.originalInspection.inspect = async () => { maximum = Math.max(maximum, ++active); await Promise.resolve(); active--; return { status: 'present' }; };
	const first = await owner.inspectOriginals(); const second = await owner.inspectOriginals({ cursor: first.cursor });
	assert.equal(second.scanned, 64); assert.equal(second.rows.length, 64); assert.equal(maximum, 1);
	const final = await owner.inspectOriginals({ cursor: second.cursor }); assert.equal(final.rows.length, 1); assert.equal(final.cursor, null);
	f.setRevision(); await assert.rejects(owner.inspectOriginals({ cursor: second.cursor }), /revision|changed/iu);
	f.setIntent({ ...intent, importId: 'replacement-import' });
	await assert.rejects(owner.inspectOriginals({ cursor: first.cursor }), /intent|changed/iu); await owner.close();
});

test('catalog or intent changes during body inspection invalidate the entire page', async () => {
	for (const kind of ['catalog', 'intent'] as const) {
		const f = fixture(); f.setIntent(undefined); f.roots.splice(0, 1, f.makeRoot('photo-1', null));
		f.originalInspection.inspect = async () => { if (kind === 'catalog') f.setRevision(); else f.setIntent(intent); return { status: 'present' }; };
		const owner = new PhotoLibrarySessionV1(f.ports);
		await assert.rejects(owner.inspectOriginals(), /revision|intent|changed/iu); await owner.close();
	}
});

test('body absence, corruption and unsupported layouts remain scalar while thrown inspection failures retain identity', async () => {
	const outcomes = [{ status: 'missing', reason: 'chunk' }, { status: 'corrupt', reason: 'digest' },
		{ status: 'unsupported', storage: 'future-layout' }] as const;
	for (const outcome of outcomes) {
		const f = fixture(); f.setIntent(undefined); f.roots.splice(0, 1, f.makeRoot('photo-1', null));
		f.originalInspection.inspect = async () => outcome;
		const owner = new PhotoLibrarySessionV1(f.ports);
		assert.deepEqual((await owner.inspectOriginals()).rows[0]?.inspection, outcome); await owner.close();
	}
	const f = fixture(); f.setIntent(undefined); f.roots.splice(0, 1, f.makeRoot('photo-1', null));
	const failure = new Error('Permission/IO failure'.repeat(300));
	f.originalInspection.inspect = async () => { throw failure; };
	const owner = new PhotoLibrarySessionV1(f.ports);
	await assert.rejects(owner.inspectOriginals(), error => error === failure);
	await owner.close();
});

test('malformed requests refuse before initialization and close/abort join held body work with single writer admission', async () => {
	const f = fixture(); f.setIntent(undefined); f.roots.splice(0, 1, f.makeRoot('photo-1', null));
	const owner = new PhotoLibrarySessionV1(f.ports);
	await assert.rejects(owner.inspectOriginals({ cursor: 'x'.repeat(2049) })); assert.equal(f.calls.length, 0);
	const entered = deferred<void>(), held = deferred<void>();
	f.originalInspection.inspect = async () => { entered.resolve(); await held.promise; return { status: 'present' }; };
	const pending = owner.inspectOriginals(); await entered.promise;
	await assert.rejects(owner.inspectOriginals(), /pending/iu);
	const rejected = assert.rejects(pending, { name: 'AbortError' }); const closing = owner.close();
	assert.equal(await remainsPending(closing), true); assert.equal(f.calls.includes('close'), false);
	held.resolve(); await rejected; await closing; assert.equal(f.calls.at(-1), 'close');
	await assert.rejects(owner.inspectOriginals(), /closed/iu);
});

test('sparse, oversized and nonadvancing custody pages reject without exposing a partial page', async () => {
	for (const kind of ['sparse', 'oversized', 'continuation', 'order'] as const) {
		const f = fixture(65); f.setIntent(undefined);
		const root = f.makeRoot('photo-1', null);
		f.ports.media.custody.readPage = async () => ({
			roots: kind === 'sparse' ? Array<CatalogOriginalRootV1>(1) : kind === 'oversized' ? Array(65).fill(root) as CatalogOriginalRootV1[]
				: kind === 'order' ? [root, root] : [root],
			afterKey: kind === 'continuation' ? 'foreign-key' : null,
		});
		const owner = new PhotoLibrarySessionV1(f.ports);
		await assert.rejects(owner.inspectOriginals());
		assert.equal(f.calls.some(call => call.startsWith('inspect:')), kind === 'order');
		await owner.close();
	}
});

test('external cancellation before/during initialization remains joined and never turns into missing originals', async () => {
	const f = fixture(), entered = deferred<void>(), held = deferred<void>(), stop = new AbortController();
	f.ports.initialize = async () => { entered.resolve(); await held.promise; return normalizePhotoCatalogRootV1({
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Library',
		revision: 1, photoCount: 1, folders: [], keywords: [], collections: [] }); };
	const owner = new PhotoLibrarySessionV1(f.ports), pending = owner.inspectOriginals({ signal: stop.signal });
	await entered.promise; const reason = new Error('Withdraw inspection'); stop.abort(reason);
	const rejected = assert.rejects(pending, error => error === reason);
	assert.equal(await remainsPending(pending), true); held.resolve(); await rejected;
	assert.equal(f.calls.some(call => call.startsWith('roots:')), false);
	await assert.rejects(owner.inspectOriginals({ signal: stop.signal }), error => error === reason);
	await owner.close();
});

test('shape-valid oversized catalog/photo aggregates refuse before original inspection', async () => {
	for (const kind of ['catalog', 'photo'] as const) {
		const f = fixture(); f.setIntent(undefined); f.roots.splice(0, 1, f.makeRoot('photo-1', null));
		if (kind === 'catalog') {
			const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
				id: 'catalog-1', name: 'Library', revision: 1, photoCount: 1, folders: [], collections: [],
				keywords: Array.from({ length: 10_000 }, (_, index) => ({ id: `keyword-${index}`, name: 'x'.repeat(256), parentId: null })) });
			assert.ok(new TextEncoder().encode(JSON.stringify(root)).length > 2 * 1024 ** 2);
			f.ports.catalog.loadCatalog = async () => root;
		} else {
			const photo = f.photos.get('photo-1')!, version = photo.versions[0]!;
			const develop = { ...version.develop, effects: Array.from({ length: 256 }, (_, index) => ({
				id: `effect-${index}`, type: 'color-adjust', enabled: true, params: { brightness: 0.1 } })) };
			const large = normalizePhotoDocumentV1({ ...photo, versions: Array.from({ length: 128 }, (_, index) => ({
				...version, id: `version-${index + 1}`, kind: index === 0 ? 'master' : 'virtual-copy', develop })) });
			assert.ok(new TextEncoder().encode(JSON.stringify(large)).length > 2 * 1024 ** 2);
			f.photos.set(photo.id, large);
		}
		const owner = new PhotoLibrarySessionV1(f.ports);
		await assert.rejects(owner.inspectOriginals(), /byte budget/iu);
		assert.equal(f.calls.some(call => call.startsWith('inspect:')), false); await owner.close();
	}
});

test('hostile body rejections retain identity and startup failure formatting remains bounded', async () => {
	for (const stage of ['body', 'startup'] as const) {
		const f = fixture(); let traps = 0;
		const rejection = new Proxy({}, { getOwnPropertyDescriptor() { traps++; throw new Error('No error property inspection'); } });
		if (stage === 'body') {
			f.setIntent(undefined); f.roots.splice(0, 1, f.makeRoot('photo-1', null));
			f.originalInspection.inspect = async () => { throw rejection; };
		} else f.ports.media.custody.promote = async () => { throw rejection; };
		const owner = new PhotoLibrarySessionV1(f.ports);
		if (stage === 'startup') await assert.rejects(owner.readPage(), error => error === rejection);
		if (stage === 'body') { await assert.rejects(owner.inspectOriginals(), error => error === rejection); assert.equal(traps, 0); }
		else { assert.deepEqual((await owner.inspectOriginals()).startupFailure, { message: 'Original inspection failed.' }); assert.ok(traps > 0); }
		await owner.close();
	}
});

test('actual neutral inspector custody conflicts reject the entire Session page across separate durable owners', async context => {
	for (const kind of ['media-token', 'other-root-digest'] as const) await context.test(kind, async child => {
		const f = await createRepairFixture(child), binding = f.binding;
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB: f.indexedDB as unknown as IDBFactory,
			databaseName: `${f.databaseName}-catalog`, verifyOriginal: async () => undefined });
		const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
			id: binding.catalogId, name: 'Authority', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await catalog.createCatalog(root);
		const initial = photoArchiveFixture().photo;
		const photo = normalizePhotoDocumentV1({ ...initial, id: binding.photoId, catalogId: binding.catalogId,
			original: { ...initial.original, id: binding.sourceId, storageKey: binding.assetId, contentSha256: binding.sha256,
				byteLength: binding.size, name: binding.name, mimeType: binding.mimeType } });
		await catalog.publishPhotos(root.id, 0, [photo]);
		const inspector = new MediaCatalogOriginalInspectionRepositoryV1(f.port, f.storage, new MediaAssetLifecycleCoordinator());
		const owner = new PhotoLibrarySessionV1({ catalog, journal: new KeyValueRepository(f.port, 'settings'),
			media: { writeAsset: f.media.writeAsset.bind(f.media), custody: f.media.catalogOriginals },
			exclusive: async (_id, operation, signal) => operation(signal),
			initialize: async () => (await catalog.loadCatalog(root.id))!, closeResources: () => catalog.close(),
			originalInspection: { inspect: (selected, signal) => inspector.inspect(selected, { signal }) } });
		try {
			assert.equal((await owner.inspectOriginals()).rows[0]?.inspection.status, 'present');
			if (kind === 'media-token') f.indexedDB.seedRecord(f.databaseName, 'mediaAssets', {
				...f.row(), mediaContentToken: 'media-content-differentidentity' });
			else {
				const retained = normalizeCatalogOriginalRoot(f.roots()[0]);
				f.indexedDB.seedRecord(f.databaseName, 'catalogOriginalRoots', { ...retained, catalogId: 'other-catalog',
					photoId: 'other-photo', key: catalogOriginalKey('other-catalog', null, 'other-photo'),
					scope: catalogOriginalScope('other-catalog', null), sha256: 'a'.repeat(64) });
			}
			const before = f.roots();
			await assert.rejects(owner.inspectOriginals(), /identity|inconsistent/iu);
			assert.deepEqual(f.roots(), before);
		} finally { await owner.close(); }
	});
});

test('actual separate durable databases retain blocked recovery state while opted-in inspection finds the published provisional photo', async () => {
	const backing = createInstrumentedIndexedDB(), indexedDB = backing as unknown as IDBFactory;
	const databaseName = `lightscaper-inspection-media-${crypto.randomUUID()}`;
	const openMedia = () => new PhotoMediaStoreV1({ indexedDB, databaseName, locks: null, preferOpfs: false, syncWorkerClient: null });
	let media = openMedia();
	const openCatalog = () => new PhotoCatalogRepositoryV1({ indexedDB, databaseName: `${databaseName}-catalog`, verifyOriginal: media.verifyOriginal });
	let catalog = openCatalog();
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Recovery', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await catalog.createCatalog(root);
	const exclusive: NonNullable<PhotoLibrarySessionPortsV1['exclusive']> = async (_id, operation, signal) => operation(signal);
	const managed = () => ({ catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, exclusive, createImportId: () => 'import-1' });
	const stop = new AbortController();
	await assert.rejects(importManagedPhotosV1(root.id, [photoArchiveFixture()], { ...managed(), catalog: {
		loadCatalog: id => catalog.loadCatalog(id), loadPhoto: (id, photo) => catalog.loadPhoto(id, photo),
		publishPhotos: async (...args) => { const saved = await catalog.publishPhotos(...args); stop.abort(); return saved; },
	} }, { signal: stop.signal }), { name: 'AbortError' });
	const database = await openDatabase(indexedDB, databaseName);
	await transact(database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => request(mediaAssets!.delete('original-1')));
	const before = backing.records(databaseName, 'catalogOriginalRoots');
	await catalog.close(); await media.close(); media = openMedia(); catalog = openCatalog();
	const owner = new PhotoLibrarySessionV1({ ...managed(),
		initialize: async () => (await catalog.loadCatalog(root.id))!, closeResources: async () => { await catalog.close(); await media.close(); },
		originalInspection: { inspect: async binding => {
			const value = await media.mediaRepository.getAssetMetadata(binding.assetId);
			return value === null ? { status: 'missing', reason: 'media-row' } : { status: 'present' };
		} },
	});
	try {
		await assert.rejects(owner.readPage(), /verified durable media/iu);
		const first = await owner.inspectOriginals(), page = await owner.inspectOriginals({ cursor: first.cursor });
		assert.equal(page.rows[0]?.binding.importId, 'import-1');
		assert.deepEqual(page.rows[0]?.inspection, { status: 'missing', reason: 'media-row' });
		assert.deepEqual(backing.records(databaseName, 'catalogOriginalRoots'), before);
		assert.deepEqual(await media.settingsRepository.get(photoImportIntentKeyV1(root.id)), intent);
		assert.equal(backing.recordCount(databaseName, 'mediaAssets'), 0);
		await assert.rejects(owner.readPage(), /verified durable media/iu);
	} finally { await owner.close(); database.close(); }
});
