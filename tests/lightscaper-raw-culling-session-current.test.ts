/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readBinaryDerivativeCacheRecordV1 } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { PHOTO_CULLING_PREVIEW_RECIPE_CURRENT_V1 } from '../src/lightscaper/preview/photo-culling-preview-plan-current-v1.ts';
import { PHOTO_PREVIEW_RECIPE_V1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof repairSettingsFixture>>;
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

/** Inspect only genuine selected catalog/media state. The instrumented native
 * database supplies transport, never cache ACKs, body hashes or native pixels. */
async function state(f: Fixture, photoId: string) {
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	const selection = await (async () => {
		try { await anchor.ready(); return await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Culling observation cannot initialize a namespace.'); } }); }
		finally { await anchor.close(); }
	})();
	const media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: selection.location.mediaDatabaseName, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selection.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	try {
		const photo = await catalog.loadPhoto(selection.location.catalogId, photoId); assert.ok(photo);
		const body = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
		const metadata = await media.mediaRepository.getAssetMetadata(photo.original.storageKey); assert.ok(metadata);
		const bytes = new Uint8Array(await body.arrayBuffer()); assert.equal(digest(bytes), photo.original.contentSha256);
		const native = f.native.raw(selection.location.mediaDatabaseName);
		const rows = (store: string) => (native.records(selection.location.mediaDatabaseName, store) as Record<string, unknown>[])
			.filter(row => row.sourceId === photo.original.storageKey || row.photoId === photoId);
		const nativeOriginal = rows('mediaAssets'); assert.equal(nativeOriginal.length, 1);
		const originalToken = nativeOriginal[0]?.mediaContentToken; assert.ok(typeof originalToken === 'string');
		const inventory = rows('videoDerivativeCacheEntries'), payloads = rows('videoDerivatives');
		assert.equal(payloads.length, inventory.length); assert.ok(inventory.length <= 2);
		const caches = await Promise.all(inventory.map(async row => {
			assert.ok(typeof row.key === 'string'); const key = row.key;
			const inventory = readBinaryDerivativeCacheRecordV1(row, key, PHOTO_PREVIEW_CACHE_PROFILE_V1);
			const raw = payloads.find(value => value.key === key); assert.ok(raw);
			const payload = readBinaryDerivativeCacheRecordV1(raw, key, PHOTO_PREVIEW_CACHE_PROFILE_V1, true); assert.deepEqual(payload, inventory);
			assert.equal(payload.originalSha256, digest(bytes)); assert.equal(payload.originalByteLength, bytes.length);
			assert.equal(payload.originalMediaContentToken, originalToken);
			const blob = raw.blob; assert.ok(blob instanceof Blob); const pixels = new Uint8Array(await blob.arrayBuffer());
			assert.equal(pixels.length, inventory.size); assert.equal(digest(pixels), inventory.outputSha256);
			const manifest = JSON.parse(inventory.binaryDerivativeManifest) as { metadata: string };
			return { record: inventory, plan: JSON.parse(manifest.metadata) as unknown, pixels };
		}));
		return { photo, bytes, metadata, nativeOriginal, roots: rows('catalogOriginalRoots'), caches: caches.sort((a, b) => a.record.key.localeCompare(b.record.key)),
			mediaDatabaseName: selection.location.mediaDatabaseName };
	} finally { await Promise.all([catalog.close(), media.close()]); }
}

test('Actual selected Current Session RAW culling fallback warms separate native caches without changing deep Develop or Original custody, and Close joins a retained hit',
	{ concurrency: false, timeout: 30_000 }, async () => {
	const f = await repairSettingsFixture(1), workers = await rawWorkerFixtureV1(), jobs: string[] = [];
	const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
	const loadDescriptor = Object.getOwnPropertyDescriptor(OpfsRepository.prototype, 'loadBinaryRecord'); assert.ok(loadDescriptor);
	let retainedMedia: PhotoMediaStoreV1 | undefined, reopened: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	const release = deferred<void>(); let pending: Promise<unknown> | undefined, closing: Promise<void> | undefined;
	let primary: Readonly<{ error: unknown }> | undefined;
	try {
		const wasm = new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)));
		Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: RequestInfo | URL) => {
			assert.equal(String(url), 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm'); return new Response(wasm, { status: 200 });
		} });
		Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function () {
			const port = workers.createWorker(), post = port.postMessage;
			Object.defineProperty(port, 'postMessage', { enumerable: true, configurable: true, value: function (this: typeof port, ...args: Parameters<typeof post>) {
				assert.equal(this, port); const kind = Object.getOwnPropertyDescriptor(args[0] as object, 'kind')?.value as unknown;
				assert.ok(typeof kind === 'string'); jobs.push(kind); return Reflect.apply(post, port, args);
			} });
			return port;
		} });
		const bytes = rawDngFixtureV1(6).bytes, acknowledgements = await f.session.importFiles([new File([bytes], 'Culling sensor.DNG', { type: 'image/png' })]);
		assert.equal(acknowledgements.length, 1); assert.equal(acknowledgements[0]?.status, 'imported');
		const photoId = acknowledgements[0]?.photoId; assert.ok(typeof photoId === 'string'); assert.deepEqual(jobs, ['original']);
		const initial = await f.session.develop.read({ schemaVersion: 3, photoId });
		const applied = await f.session.develop.apply({ schemaVersion: 3, photoId, expectedRevision: initial.revision,
			command: { type: 'record-develop', versionId: initial.versionId, develop: repairRecipe(), label: 'Native repair remains authored', createdAt: '2026-10-16T00:00:00.000Z' } });
		const before = await state(f, photoId); assert.deepEqual(before.bytes, bytes); assert.equal(before.roots.length, 1); assert.deepEqual(before.caches, []);
		const camera = await f.session.readPreview(photoId, 'thumbnail', { rawPreviewSource: 'camera-embedded' });
		assert.equal(camera.outcome, 'ready'); assert.ok(camera.outcome === 'ready'); assert.equal(camera.cache, 'stored'); assert.deepEqual(camera.notices, []);
		assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, 3); assert.deepEqual(jobs, ['original', 'preview', 'original']);
		const warmed = await state(f, photoId); assert.equal(warmed.caches.length, 1);
		assert.equal(warmed.caches[0]?.record.recipeId, PHOTO_CULLING_PREVIEW_RECIPE_CURRENT_V1.id);
		assert.equal(warmed.caches[0]?.record.outputSha256, camera.preview.outputSha256);
		assert.deepEqual([camera.preview.descriptor.width, camera.preview.descriptor.height, camera.preview.descriptor.sampleFormat, camera.preview.descriptor.transfer], [32, 32, 'unorm8', 'srgb']);
		const hit = await f.session.readPreview(photoId, 'thumbnail', { rawPreviewSource: 'camera-embedded' });
		assert.ok(hit.outcome === 'ready'); assert.equal(hit.cache, 'hit'); assert.equal(hit.preview.outputSha256, camera.preview.outputSha256); assert.equal(jobs.length, 3);
		const neutral = await f.session.readPreview(photoId, 'thumbnail', { rawPreviewSource: 'neutral-original' });
		assert.ok(neutral.outcome === 'ready'); assert.equal(neutral.cache, 'stored'); assert.equal(neutral.preview.outputSha256, camera.preview.outputSha256);
		assert.deepEqual(jobs, ['original', 'preview', 'original', 'original']); assert.equal(workers.statistics.joined, 4);
		const both = await state(f, photoId); assert.equal(both.caches.length, 2);
		assert.deepEqual(both.caches.map(value => value.record.recipeId).sort(), [PHOTO_CULLING_PREVIEW_RECIPE_CURRENT_V1.id, PHOTO_PREVIEW_RECIPE_V1.id].sort());
		assert.notEqual(both.caches[0]?.record.key, both.caches[1]?.record.key);
		assert.deepEqual(both.photo, before.photo); assert.deepEqual(both.bytes, before.bytes); assert.deepEqual(both.metadata, before.metadata); assert.deepEqual(both.roots, before.roots);
		assert.deepEqual(both.nativeOriginal, before.nativeOriginal);
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId }), applied.snapshot);
		const original = f.session.develop.original; assert.ok(original); let words: ArrayBuffer | undefined;
		await original.withFrame({ schemaVersion: 1, photoId, expectedRevision: applied.snapshot.revision }, view => {
			assert.equal(workers.active(), 0); assert.equal(view.frame.descriptor.sampleFormat, 'unorm16'); assert.equal(view.frame.descriptor.transfer, 'linear');
			assert.ok(view.frame.pixels instanceof Uint16Array); words = view.frame.pixels.buffer;
			assert.ok(view.frame.pixels.some(sample => sample > 0 && sample % 257 !== 0), 'Develop still borrows true native words after camera-cache warming.');
		});
		assert.ok(words); assert.ok(new Uint8Array(words).every(byte => byte === 0)); assert.equal(workers.statistics.joined, 5);
		const counts = { ...workers.statistics };
		for (const rawPreviewSource of ['camera-embedded', 'neutral-original'] as const) {
			const cached = await f.session.readPreview(photoId, 'thumbnail', { rawPreviewSource }); assert.ok(cached.outcome === 'ready'); assert.equal(cached.cache, 'hit');
		}
		assert.deepEqual(workers.statistics, counts); assert.deepEqual((await state(f, photoId)).caches, both.caches);
		const cameraCache = both.caches.find(value => value.record.recipeId === PHOTO_CULLING_PREVIEW_RECIPE_CURRENT_V1.id); assert.ok(cameraCache);
		retainedMedia = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: both.mediaDatabaseName, preferOpfs: false });
		await retainedMedia.ready(); const retainedCache = await retainedMedia.getCullingPreviewCacheCurrentV1();
		assert.ok(await retainedCache.load(cameraCache.plan)); await retainedMedia.close();
		await assert.rejects(async () => retainedCache.load(cameraCache.plan), /closed/u);
		const entered = deferred<void>(), load = OpfsRepository.prototype.loadBinaryRecord;
		Object.defineProperty(OpfsRepository.prototype, 'loadBinaryRecord', { ...loadDescriptor, value: async function (this: OpfsRepository, ...args: Parameters<typeof load>) {
			const body = await Reflect.apply(load, this, args) as Blob;
			if (args[0].key === cameraCache.record.key && args[2] === 'derivative-payload-read') { entered.resolve(undefined); await release.promise; }
			return body;
		} });
		pending = observed(f.session.readPreview(photoId, 'thumbnail', { rawPreviewSource: 'camera-embedded' }));
		await entered.promise; closing = f.session.close(); assert.equal(await remainsPending(closing), true);
		await assert.rejects(f.session.readPreview(photoId, 'thumbnail', { rawPreviewSource: 'camera-embedded' }), /closed/u);
		release.resolve(undefined); await closing; const refused = await pending;
		assert.ok(refused && typeof refused === 'object' && Object.getOwnPropertyDescriptor(refused, 'ok')?.value === false);
		Object.defineProperty(OpfsRepository.prototype, 'loadBinaryRecord', loadDescriptor);
		reopened = await createPhotoLibrarySessionCurrentV1(f.options);
		for (const rawPreviewSource of ['camera-embedded', 'neutral-original'] as const) {
			const cached = await reopened.readPreview(photoId, 'thumbnail', { rawPreviewSource }); assert.ok(cached.outcome === 'ready'); assert.equal(cached.cache, 'hit');
		}
		assert.deepEqual(workers.statistics, counts); assert.equal(workers.active(), 0);
		const after = await state(f, photoId); assert.deepEqual(after.photo, before.photo); assert.deepEqual(after.bytes, before.bytes);
		assert.deepEqual(after.metadata, before.metadata); assert.deepEqual(after.roots, before.roots); assert.deepEqual(after.caches, both.caches);
		assert.deepEqual(after.nativeOriginal, before.nativeOriginal);
	} catch (error) { primary = { error }; }
	const failures: unknown[] = primary ? [primary.error] : [];
	const remember = (error: unknown) => { if (!failures.some(value => Object.is(value, error))) failures.push(error); };
	release.resolve(undefined);
	for (const result of await Promise.allSettled([pending, closing])) if (result.status === 'rejected') remember(result.reason);
	try { Object.defineProperty(OpfsRepository.prototype, 'loadBinaryRecord', loadDescriptor); } catch (error) { remember(error); }
	for (const result of await Promise.allSettled([() => reopened?.close(), () => retainedMedia?.close(), () => f.close()]
		.map(retire => Promise.resolve().then(retire)))) if (result.status === 'rejected') remember(result.reason);
	try { await workers.close(); } catch (error) { remember(error); }
	for (const [key, descriptor] of [['Worker', previousWorker], ['fetch', previousFetch]] as const) {
		try { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
		catch (error) { remember(error); }
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Culling Session qualification and retirement failed.', { cause: failures[0] });
});
