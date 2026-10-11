/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readBinaryDerivativeCacheRecordV1 } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { importManagedPhotosV2 } from '../src/lightscaper/import/managed-import-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { createPhotoLibrarySelectedExclusiveV2 } from '../src/lightscaper/storage/photo-library-selected-exclusive-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import type { qualifyPhotoPreviewSessionCloseNativeV1 } from './helpers/lightscaper-preview-session-close-native-v1.ts';

// Bind the real native helper to configured strict typing without executing a
// browser helper in Node. These controls start with an acknowledged cache hit;
// native staging/transaction cuts are qualified by the separate browser spec.
const nativeCuts = {
	'after-write': 'absent', 'after-close': 'absent', 'payload-put': 'absent', 'inventory-put': 'absent',
	'completed-ack': 'complete', 'cleanup-ack': 'complete',
} satisfies Record<Parameters<typeof qualifyPhotoPreviewSessionCloseNativeV1>[0], 'absent' | 'complete'>;

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQlNf/DwACAwFflwzAewAAAABJRU5ErkJggg==', 'base64'));
const PIXELS = Uint8Array.of(17, 31, 47, 255), IMPORT_ID = 'preview-close-import';
const PAYLOAD = 'videoDerivatives', INVENTORY = 'videoDerivativeCacheEntries';

function lockManager(): LockManager {
	const active = new Set<string>();
	return { async request(name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) {
		if (active.has(name)) return run(null);
		active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
}

function settlement<Value>(operation: Promise<Value>) {
	return operation.then(value => ({ ok: true as const, value }), (reason: unknown) => ({ ok: false as const, reason }));
}

async function fixture() {
	const current = mediaRestoreFixture(), locks = lockManager();
	const options = { name: 'Selected preview close', indexedDB: current.factory, locks };
	const bootstrap = await createPhotoLibrarySessionV3(options);
	try { assert.equal((await bootstrap.readPage()).totalCount, 0); } finally { await bootstrap.close(); }
	const anchor = new PhotoMediaStoreV1({ indexedDB: current.factory, locks });
	const selected = await (async () => {
		try {
			return await withPhotoLibraryInitializationLockV1(locks, authority => readPhotoLibrarySessionLocationV2({
				settings: anchor.settingsRepository,
				initializeDefault: () => Promise.reject(new Error('Runtime3 must already have selected its library.')),
			}, authority.signal));
		} finally { await anchor.close(); }
	})();
	function owners() {
		const anchor = new PhotoMediaStoreV1({ indexedDB: current.factory, locks });
		const media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB: current.factory, locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false }) : anchor;
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB: current.factory,
			databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		return { media, catalog, exclusive: createPhotoLibrarySelectedExclusiveV2(anchor.settingsRepository, selected, locks),
			close: async () => {
				const failures: unknown[] = [];
				try { await catalog.close(); } catch (failure) { failures.push(failure); }
				const results = await Promise.allSettled([...new Set([anchor, media])].map(owner => owner.close()));
				failures.push(...results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []));
				if (failures.length) throw new AggregateError(failures, 'Selected preview fixture cleanup failed.');
			} };
	}
	const input = photoArchiveFixture(1, PNG), photo = normalizePhotoDocumentV1({ ...input.photo, catalogId: selected.location.catalogId });
	const binding = { catalogId: photo.catalogId, photoId: photo.id, originalId: photo.original.id,
		storageKey: photo.original.storageKey, contentSha256: photo.original.contentSha256,
		byteLength: photo.original.byteLength, width: photo.original.width, height: photo.original.height };
	const descriptor = { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const,
		primaries: 'srgb' as const, transfer: 'srgb' as const };
	const plan = planPhotoPreviewV1({ binding, source: descriptor, tier: 'thumbnail' });
	const prepared = await preparePhotoPreviewV1({ plan, binding, frame: { descriptor, pixels: PIXELS.slice() } });
	const setup = owners();
	try {
		const receipts = await importManagedPhotosV2(photo.catalogId, [{ photo, original: input.original }], {
			catalog: setup.catalog, media: { writeAsset: setup.media.mediaRepository.writeAsset,
				custody: setup.media.mediaRepository.catalogOriginals }, journal: setup.media.settingsRepository,
			createImportId: () => IMPORT_ID, exclusive: setup.exclusive,
		});
		assert.equal(receipts.length, 1); assert.equal(receipts[0]?.status, 'imported');
		assert.equal((await setup.media.getPreviewCache().store(prepared)).outcome, 'stored');
	} finally { await setup.close(); }
	async function readState() {
		const reader = owners();
		try {
			const body = await reader.media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body);
			const originalBytes = new Uint8Array(await body.arrayBuffer());
			assert.deepEqual(originalBytes, PNG);
			assert.equal(createHash('sha256').update(originalBytes).digest('hex'), photo.original.contentSha256);
			const databaseName = selected.location.mediaDatabaseName, raw = current.raw(databaseName);
			assert.equal(raw.recordCount(databaseName, PAYLOAD), 1); assert.equal(raw.recordCount(databaseName, INVENTORY), 1);
			assert.equal(raw.recordCount(databaseName, 'mediaAssets'), 1);
			const payloads: unknown[] = raw.records(databaseName, PAYLOAD), inventories: unknown[] = raw.records(databaseName, INVENTORY);
			const payload = readBinaryDerivativeCacheRecordV1(payloads[0], plan.key, PHOTO_PREVIEW_CACHE_PROFILE_V1, true);
			const inventory = readBinaryDerivativeCacheRecordV1(inventories[0], plan.key, PHOTO_PREVIEW_CACHE_PROFILE_V1);
			assert.deepEqual(payload, inventory);
			assert.equal(inventory.outputSha256, prepared.outputSha256); assert.equal(inventory.size, PIXELS.byteLength);
			const roots = await reader.media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
			assert.equal(roots.roots.length, 1); assert.equal(roots.afterKey, null);
			assert.equal(inventory.originalMediaContentToken, roots.roots[0]?.mediaContentToken);
			const staged = await reader.media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId, importId: IMPORT_ID });
			assert.equal(staged.roots.length, 0); assert.equal(staged.afterKey, null);
			const stored = await reader.catalog.loadPhoto(photo.catalogId, photo.id); assert.deepEqual(stored, photo);
			return { photo: stored, originalBytes, original: await reader.media.mediaRepository.getAssetMetadata(photo.original.storageKey),
				roots, staged, payload, inventory };
		} finally { await reader.close(); }
	}
	return { options, photo, plan, prepared, readState, before: await readState() };
}

async function qualifyHeldRead(injectFailure: boolean) {
	const keyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	try {
		const value = await fixture(), session = await createPhotoLibrarySessionV3(value.options);
		const release = deferred<void>(), events: string[] = [];
		const state = { reads: 0, otherReads: 0, mediaCloses: 0, catalogCloses: 0, bodyBytes: 0 };
		const revoked = Proxy.revocable(Object.create(null) as object, {}); revoked.revoke(); const primary: unknown = revoked.proxy;
		const loadDescriptor = Object.getOwnPropertyDescriptor(OpfsRepository.prototype, 'loadBinaryRecord');
		const mediaDescriptor = Object.getOwnPropertyDescriptor(PhotoMediaStoreV1.prototype, 'close');
		const catalogDescriptor = Object.getOwnPropertyDescriptor(PhotoCatalogRepositoryV2.prototype, 'close');
		assert.ok(loadDescriptor); assert.ok(mediaDescriptor); assert.ok(catalogDescriptor);
		const load = OpfsRepository.prototype.loadBinaryRecord;
		const closeMedia = PhotoMediaStoreV1.prototype.close, closeCatalog = PhotoCatalogRepositoryV2.prototype.close;
		Object.defineProperty(OpfsRepository.prototype, 'loadBinaryRecord', { ...loadDescriptor,
			value: async function (this: OpfsRepository, ...args: Parameters<OpfsRepository['loadBinaryRecord']>) {
				const body = await load.call(this, ...args);
				if (args[0].key !== value.plan.key || args[2] !== 'derivative-payload-read') { state.otherReads += 1; return body; }
				state.reads += 1; state.bodyBytes = body.size; events.push('actual-cache-read-settled');
				await release.promise; events.push('held-cache-read-released');
				if (injectFailure) throw primary;
				return body;
			} });
		Object.defineProperty(PhotoMediaStoreV1.prototype, 'close', { ...mediaDescriptor,
			value: function (this: PhotoMediaStoreV1) { state.mediaCloses += 1; events.push('selected-media-close'); return closeMedia.call(this); } });
		Object.defineProperty(PhotoCatalogRepositoryV2.prototype, 'close', { ...catalogDescriptor,
			value: function (this: PhotoCatalogRepositoryV2) { state.catalogCloses += 1; events.push('selected-catalog-close'); return closeCatalog.call(this); } });
		const preview = settlement(session.readPreview(value.photo.id, 'thumbnail'));
		let closing: ReturnType<typeof settlement<void>> | undefined;
		try {
			await waitFor(() => state.reads === 1, 'the actual selected runtime3 cache body read');
			assert.equal(state.bodyBytes, PIXELS.byteLength); assert.equal(state.otherReads, 0);
			const close = session.close(); closing = settlement(close); events.push('session-close-requested');
			assert.equal(session.close(), close);
			assert.equal(await remainsPending(close), true);
			assert.equal(state.mediaCloses, 0); assert.equal(state.catalogCloses, 0);
			await assert.rejects(session.readPreview(value.photo.id, 'thumbnail'), /closed/u);
			await assert.rejects(session.readPage(), /closed/u);
			const cancelled = await preview; assert.equal(cancelled.ok, false);
			assert.equal(await remainsPending(close), true);
			assert.equal(state.reads, 1); assert.equal(state.otherReads, 0);
			assert.equal(state.mediaCloses, 0); assert.equal(state.catalogCloses, 0);
			release.resolve();
			const closed = await closing;
			if (injectFailure) { assert.equal(closed.ok, false); if (!closed.ok) assert.equal(Object.is(closed.reason, primary), true); }
			else assert.equal(closed.ok, true);
			assert.equal(state.mediaCloses, 1); assert.equal(state.catalogCloses, 1);
			assert.ok(events.indexOf('held-cache-read-released') < events.indexOf('selected-media-close'));
			assert.ok(events.indexOf('held-cache-read-released') < events.indexOf('selected-catalog-close'));
		} finally {
			release.resolve(); await preview;
			await (closing ?? settlement(session.close()));
			Object.defineProperty(OpfsRepository.prototype, 'loadBinaryRecord', loadDescriptor);
			Object.defineProperty(PhotoMediaStoreV1.prototype, 'close', mediaDescriptor);
			Object.defineProperty(PhotoCatalogRepositoryV2.prototype, 'close', catalogDescriptor);
		}
		const reopened = await createPhotoLibrarySessionV3(value.options);
		try {
			const cached = await reopened.readPreview(value.photo.id, 'thumbnail');
			assert.equal(cached.outcome, 'ready');
			if (cached.outcome !== 'ready') assert.fail('The acknowledged cache pair must remain readable.');
			assert.equal(cached.cache, 'hit'); assert.deepEqual(cached.notices, []);
			assert.equal(cached.preview.outputSha256, value.prepared.outputSha256);
			assert.equal(cached.preview.byteLength, PIXELS.byteLength);
			assert.deepEqual(new Uint8Array(await cached.preview.body.arrayBuffer()), PIXELS);
		} finally { await reopened.close(); }
		assert.deepEqual(await value.readState(), value.before);
	} finally {
		if (keyRange) Object.defineProperty(globalThis, 'IDBKeyRange', keyRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange');
	}
}

test(`selected runtime3 Close joins the actual held cache read and preserves the ${nativeCuts['completed-ack']} acknowledged pair`,
	{ concurrency: false }, async () => { await qualifyHeldRead(false); });

test(`selected runtime3 Close retains a distinct opaque held-read failure and the ${nativeCuts['cleanup-ack']} acknowledged pair`,
	{ concurrency: false }, async () => { await qualifyHeldRead(true); });
