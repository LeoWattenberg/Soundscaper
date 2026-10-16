/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { IMAGE_IMPORT_LIMITS } from '../src/common/editor/image-import-admission.ts';
import { importManagedPhotosCurrentV1 } from '../src/lightscaper/import/managed-import-current-v1.ts';
import { recoverManagedPhotoImportCurrentV1 } from '../src/lightscaper/import/photo-import-recovery-current-v1.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';

const MIME = 'image/x-lightscaper-hdr', IMPORT_ID = 'hdr-managed-result';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const owner = () => import('../src/lightscaper/import/managed-hdr-publication-current-v1.ts');

async function managedFixture() {
	const f = await repairSettingsFixture(2), anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	try {
		const selected = await (async () => { try { await anchor.ready(); return await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('HDR publisher cannot initialize another namespace.'); } }); } finally { await anchor.close(); } })();
		const storage = { indexedDB: f.native.factory, locks: f.options.locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false };
		media = new PhotoMediaStoreV1(storage); await media.ready();
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		const actualMedia = media, actualCatalog = catalog, sources = await Promise.all(f.photos.map(photo => actualCatalog.loadPhoto(photo.catalogId, photo.id)));
		assert.ok(sources.every(photo => photo !== null));
		const photos = sources.map(photo => { assert.ok(photo); return photo; }), catalogId = photos[0]!.catalogId;
		const selections = photos.map(photo => ({ photoId: photo.id, revision: photo.revision, original: photo.original }));
		const provenance = { schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: 0 },
			inputs: photos.map((photo, index) => ({ product: 'lightscaper', ownerId: photo.catalogId, sourceId: photo.id, revision: photo.revision,
				original: { fileName: photo.original.name, mimeType: photo.original.mimeType, sha256: photo.original.contentSha256,
					byteLength: photo.original.byteLength, width: 3, height: 1 }, profile: 'encoded-srgb8', exposureMultiplier: index === 0 ? 1 : 4,
				offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 3 })), output: { x: 0, y: 0, width: 3, height: 1 } };
		const frame = { descriptor: { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
			pixels: Float32Array.of(3, .5, .25, 1, .25, .125, 1e-30, 1, .75, .5, .25, 1) };
		const bytes = await encodeImageHdrOriginalV1(frame, provenance), seed = photoArchiveFixture(90, bytes).photo;
		const photo = normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3, catalogId, extractedMetadata: null, metadata: { ...seed.metadata, fileName: 'Merged.lshdr' },
			original: { ...seed.original, name: 'Merged.lshdr', mimeType: MIME, width: 3, height: 1 } });
		const entry = { photo, original: new Blob([bytes], { type: MIME }) };
		const calls = { writes: 0, stages: 0, publishes: 0, promotions: 0, leases: 0 };
		const hooks = { beforePublish: async (): Promise<void> => undefined, afterPublish: async (): Promise<void> => undefined,
			promote: async (): Promise<void> => undefined };
		const guardedCatalog = {
			loadCatalog: actualCatalog.loadCatalog.bind(actualCatalog), loadPhoto: actualCatalog.loadPhoto.bind(actualCatalog),
			async publishDerivedPhotoCurrentV1(...args: Parameters<PhotoCatalogRepositoryCurrentV1['publishDerivedPhotoCurrentV1']>) {
				assert.equal(this, guardedCatalog); calls.publishes++; await hooks.beforePublish();
				const result = await actualCatalog.publishDerivedPhotoCurrentV1(...args); await hooks.afterPublish(); return result;
			},
		};
		const ports = { catalog: guardedCatalog, media: { writeAsset: async (...args: Parameters<typeof actualMedia.mediaRepository.writeAsset>) => {
			calls.writes++; return actualMedia.mediaRepository.writeAsset(...args);
		}, custody: {
			findDigestPage: actualMedia.mediaRepository.catalogOriginals.findDigestPage.bind(actualMedia.mediaRepository.catalogOriginals),
			readPage: actualMedia.mediaRepository.catalogOriginals.readPage.bind(actualMedia.mediaRepository.catalogOriginals),
			releaseStaged: actualMedia.mediaRepository.catalogOriginals.releaseStaged.bind(actualMedia.mediaRepository.catalogOriginals),
			stage: async (...args: Parameters<typeof actualMedia.mediaRepository.catalogOriginals.stage>) => { calls.stages++; return actualMedia.mediaRepository.catalogOriginals.stage(...args); },
			promote: async (...args: Parameters<typeof actualMedia.mediaRepository.catalogOriginals.promote>) => { calls.promotions++; await hooks.promote(); return actualMedia.mediaRepository.catalogOriginals.promote(...args); },
		} }, journal: actualMedia.settingsRepository, createImportId: () => IMPORT_ID,
		exclusive: async <Result>(_catalogId: string, run: (signal?: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> => { calls.leases++; return run(signal); } };
		const recovery = { ...ports, catalog: { loadCatalog: guardedCatalog.loadCatalog, loadPhoto: guardedCatalog.loadPhoto,
			publishPhotos: actualCatalog.publishPhotos.bind(actualCatalog) } };
		const inspect = async () => {
			const root = await actualCatalog.loadCatalog(catalogId); assert.ok(root);
			return { root, photo: await actualCatalog.loadPhoto(catalogId, photo.id),
				roots: await actualMedia.mediaRepository.catalogOriginals.readPage({ catalogId }),
				intent: await actualMedia.settingsRepository.get(photoImportIntentKeyV1(catalogId)) };
		};
		return { f, catalogId, selections, sources: photos, entry, bytes, frame, provenance, calls, hooks, ports, recovery, inspect,
			media: actualMedia, catalog: actualCatalog,
			async close() { try { await Promise.all([actualCatalog.close(), actualMedia.close()]); } finally { await f.close(); } } };
	} catch (error) { await Promise.allSettled([catalog?.close(), media?.close(), anchor.close()]); await f.close(); throw error; }
}

test('unchanged ordinary managed Current publication retains its file-import policy and real native ACK/custody behavior', async () => {
	const f = await managedFixture();
	try {
		assert.equal(IMAGE_IMPORT_LIMITS.maximumFileInputBytes, 64 * 1024 * 1024);
		const receipts = await importManagedPhotosCurrentV1(f.catalogId, [f.entry], f.recovery);
		assert.equal(receipts.length, 1); assert.equal(receipts[0]!.status, 'imported');
		const state = await f.inspect(); assert.ok(state.photo); assert.equal(state.intent, undefined);
		assert.equal(state.roots.roots.filter(root => root.photoId === f.entry.photo.id && root.importId === null).length, 1);
	} finally { await f.close(); }
});

test('named managed HDR publication persists a default Photo3, immutable body and exact provenance through native promotion and reopen', async () => {
	const api = await owner(), f = await managedFixture();
	try {
		const before = await f.inspect(), acknowledged: unknown[] = [];
		const receipts = await api.publishManagedHdrPhotoCurrentV1(f.catalogId, f.selections, f.entry, f.ports, { onPublished: value => { acknowledged.push(value); } });
		assert.equal(receipts.length, 1); assert.equal(receipts[0]!.status, 'imported'); assert.deepEqual(acknowledged, receipts);
		const state = await f.inspect(); assert.ok(state.photo); assert.equal(state.photo.schemaVersion, 3); assert.equal(state.photo.revision, 0);
		assert.equal(state.photo.versions.length, 1); assert.deepEqual(state.photo.versions[0]!.develop, defaultImageDevelopStateV1()); assert.equal(state.photo.extractedMetadata, null);
		assert.equal(state.root.photoCount, before.root.photoCount + 1); assert.equal(state.intent, undefined);
		assert.equal(state.roots.roots.filter(root => root.photoId === state.photo!.id && root.importId === null).length, 1);
		await f.media.verifyOriginal(state.photo.original); const body = await f.media.mediaRepository.loadAsset(state.photo.original.storageKey); assert.ok(body instanceof Blob);
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), f.bytes);
		assert.deepEqual(await Promise.all(f.sources.map(photo => f.catalog.loadPhoto(f.catalogId, photo.id))), f.sources);
		assert.deepEqual(f.calls, { writes: 1, stages: 1, publishes: 1, promotions: 1, leases: 1 });
		await Promise.all([f.catalog.close(), f.media.close(), f.f.session.close()]);
		const reopened = await createPhotoLibrarySessionCurrentV1(f.f.options); let plane: Float32Array | undefined;
		try {
			const original = reopened.develop.original; assert.ok(original);
			await original.withFrame({ schemaVersion: 1, photoId: f.entry.photo.id, expectedRevision: 0 }, view => {
				assert.ok(view.frame.pixels instanceof Float32Array); plane = view.frame.pixels; assert.deepEqual([...plane], [...f.frame.pixels]);
			});
			assert.ok(plane?.every(value => value === 0));
		} finally { await reopened.close(); }
	} finally { await f.close(); }
});

test('a stale selected Photo releases staged HDR custody and never returns a positive native publication ACK', async () => {
	const api = await owner(), f = await managedFixture(), acknowledged: unknown[] = [];
	f.hooks.beforePublish = async () => { const source = f.sources[0]!; await f.catalog.savePhoto({ ...source, rating: 4 }, source.revision); };
	try {
		const before = await f.inspect(), receipts = await api.publishManagedHdrPhotoCurrentV1(f.catalogId, f.selections, f.entry, f.ports, { onPublished: value => { acknowledged.push(value); } });
		assert.equal(receipts.length, 1); assert.equal(receipts[0]!.status, 'failed'); assert.deepEqual(acknowledged, []);
		const state = await f.inspect(); assert.equal(state.photo, null); assert.equal(state.root.photoCount, before.root.photoCount); assert.equal(state.intent, undefined);
		assert.equal(state.roots.roots.some(root => root.photoId === f.entry.photo.id), false);
		assert.equal(f.calls.writes, 1); assert.equal(f.calls.stages, 1); assert.equal(f.calls.publishes, 1);
		await f.f.session.close();
		await f.media.mediaRepository.deleteAsset(f.entry.photo.original.storageKey);
		assert.equal(await f.media.mediaRepository.loadAsset(f.entry.photo.original.storageKey), null);
	} finally { await f.close(); }
});

test('managed HDR preserves a real positive ACK across postcommit cancellation and recovers promotion without rechecking changed sources', async () => {
	const api = await owner(), f = await managedFixture(), stop = new AbortController(), acknowledged: unknown[] = [];
	const opaque = Proxy.revocable({}, {}); opaque.revoke();
	f.hooks.afterPublish = async () => { const source = f.sources[0]!; await f.catalog.savePhoto({ ...source, rating: 5 }, source.revision); stop.abort(opaque.proxy); };
	try {
		const work = api.publishManagedHdrPhotoCurrentV1(f.catalogId, f.selections, f.entry, f.ports, { signal: stop.signal, onPublished: value => { acknowledged.push(value); } });
		const result = await work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); assert.equal(acknowledged.length, 1);
		const committed = await f.inspect(); assert.ok(committed.photo); assert.ok(committed.intent);
		await recoverManagedPhotoImportCurrentV1(f.catalogId, f.recovery);
		const settled = await f.inspect(); assert.deepEqual(settled.photo, committed.photo); assert.equal(settled.intent, undefined);
		assert.equal(settled.roots.roots.filter(root => root.photoId === f.entry.photo.id && root.importId === null).length, 1);
		await f.media.verifyOriginal(f.entry.photo.original);
	} finally { await f.close(); }
});

for (const failure of ['promotion', 'lost-ack'] as const) test(`managed HDR ${failure} recovery retains the real catalog result and acknowledges it exactly once`, async () => {
	const api = await owner(), f = await managedFixture(), acknowledged: unknown[] = []; let first = true;
	if (failure === 'promotion') f.hooks.promote = async () => { if (first) { first = false; throw new Error('Promotion notification failed.'); } };
	else f.hooks.afterPublish = async () => { throw new Error('Native commit notification was lost.'); };
	try {
		const receipts = await api.publishManagedHdrPhotoCurrentV1(f.catalogId, f.selections, f.entry, f.ports, { onPublished: value => { acknowledged.push(value); } });
		assert.equal(receipts[0]!.status, 'imported'); assert.deepEqual(acknowledged, receipts);
		const state = await f.inspect(); assert.ok(state.photo); assert.equal(state.intent, undefined);
		assert.equal(state.roots.roots.filter(root => root.photoId === f.entry.photo.id && root.importId === null).length, 1); await f.media.verifyOriginal(state.photo.original);
	} finally { await f.close(); }
});

test('generated HDR scalar capacity is explicit196MiB while existing file-import64MiB stays unchanged', async () => {
	const api = await owner(), f = await managedFixture();
	try {
		// Scalar metadata only: this does not claim a real >64MiB decode or write.
		const byteLength = 192 * 1024 * 1024 + 1024, large = normalizePhotoDocumentCurrentV1({ ...f.entry.photo,
			original: { ...f.entry.photo.original, width: 8192, height: 2048, byteLength } });
		assert.doesNotThrow(() => api.admitManagedHdrPhotoPublicationCurrentV1(f.catalogId, f.selections, large, byteLength));
		for (const size of [196 * 1024 * 1024 + 1, Number.MAX_SAFE_INTEGER]) assert.throws(() => api.admitManagedHdrPhotoPublicationCurrentV1(f.catalogId, f.selections,
			{ ...large, original: { ...large.original, byteLength: size } }, size), RangeError);
		assert.equal(IMAGE_IMPORT_LIMITS.maximumFileInputBytes, 64 * 1024 * 1024); assert.equal(f.calls.writes, 0); assert.equal(f.calls.stages, 0);
	} finally { await f.close(); }
});

test('managed HDR pins native publication, selected identities and observer receivers before body verification yields', async () => {
	const api = await owner(), f = await managedFixture(), acknowledged: unknown[] = [];
	const options = { onPublished(this: unknown, receipt: unknown) { assert.equal(this, options); acknowledged.push(receipt); } };
	try {
		const work = api.publishManagedHdrPhotoCurrentV1(f.catalogId, f.selections, f.entry, f.ports, options);
		f.ports.catalog.publishDerivedPhotoCurrentV1 = async () => { throw new Error('Replacement publisher must not run.'); };
		f.ports.createImportId = () => { throw new Error('Replacement allocator must not run.'); };
		f.selections[0]!.revision++;
		options.onPublished = () => { throw new Error('Replacement observer must not run.'); };
		const receipts = await work; assert.equal(receipts[0]!.status, 'imported'); assert.deepEqual(acknowledged, receipts);
		assert.equal(f.calls.publishes, 1); assert.ok((await f.inspect()).photo);
	} finally { await f.close(); }
});

test('managed HDR pre-abort preserves an opaque reason before hostile entry or capability metadata and has no durable side effects', async () => {
	const api = await owner(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
	let reads = 0;
	const hostile = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw new Error('Metadata must remain unread.'); },
		get() { reads++; throw new Error('Capability must remain unread.'); }, getPrototypeOf() { reads++; throw new Error('Prototype must remain unread.'); } });
	const result = await api.publishManagedHdrPhotoCurrentV1('catalog', [], hostile, hostile as Parameters<typeof api.publishManagedHdrPhotoCurrentV1>[3],
		{ signal: stop.signal }).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); assert.equal(reads, 0);
});

test('HDR body, provenance and default-result admission precede any journal, Original write or native publication', async () => {
	const api = await owner(), f = await managedFixture();
	try {
		const corrupt = f.bytes.slice(); corrupt[0] = 0;
		const unrelated = structuredClone(f.provenance); unrelated.inputs[0]!.sourceId = 'another-photo';
		const wrongProvenance = await encodeImageHdrOriginalV1(f.frame, unrelated);
		const nondefault = normalizePhotoDocumentCurrentV1({ ...f.entry.photo, versions: f.entry.photo.versions.map(version => ({ ...version,
			develop: { ...version.develop, effects: [createVideoEffectV2('tone-ladder-v1', { id: 'copied-develop', params: { exposure: 1 } })] } })) });
		for (const entry of [{ photo: nondefault, original: f.entry.original }, { ...f.entry, photo: { ...f.entry.photo, extractedMetadata: readImageMetadataV1(f.f.bytes) } },
			...[corrupt, wrongProvenance].map(bytes => ({ photo: normalizePhotoDocumentCurrentV1({ ...f.entry.photo,
				original: { ...f.entry.photo.original, byteLength: bytes.length, contentSha256: digest(bytes) } }), original: new Blob([bytes], { type: MIME }) }))]) {
			await assert.rejects(api.publishManagedHdrPhotoCurrentV1(f.catalogId, f.selections, entry, f.ports));
		}
		const state = await f.inspect(); assert.equal(state.intent, undefined); assert.equal(state.photo, null);
		assert.equal(f.calls.writes, 0); assert.equal(f.calls.stages, 0); assert.equal(f.calls.publishes, 0);
	} finally { await f.close(); }
});
