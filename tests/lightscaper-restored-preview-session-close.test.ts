/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readBinaryDerivativeCacheRecordV1 } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import { transact, transactionCompletion } from '../src/common/editor/storage/indexeddb-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoCatalogRepositoryKernelV2 } from '../src/lightscaper/catalog/photo-catalog-repository-kernel-v2.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 as PROFILE } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as DEFAULT_CATALOG } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { normalizePhotoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { qualifyPhotoRestoredPreviewSessionCloseNativeV1, type PhotoRestoredPreviewSessionCloseCutV1 } from './helpers/lightscaper-restored-preview-session-close-native-v1.ts';

// These Node controls qualify selected ownership with an acknowledged cache
// fixture. They do not run a browser decoder or claim native transaction cuts.
const cutOutcomes = { 'payload-put': 'absent', 'inventory-put': 'absent', 'completed-ack': 'complete' } satisfies
	Record<PhotoRestoredPreviewSessionCloseCutV1, 'absent' | 'complete'>;
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQlNf/DwACAwFflwzAewAAAABJRU5ErkJggg==', 'base64'));
const PIXELS = Uint8Array.of(17, 31, 47, 255), PAYLOAD = 'videoDerivatives', INVENTORY = 'videoDerivativeCacheEntries';

function locks(): LockManager {
	const active = new Set<string>();
	return { async request(name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) {
		if (active.has(name)) return run(null);
		active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
}
function outcome<Value>(operation: Promise<Value>) {
	return operation.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

async function fixture() {
	const native = mediaRestoreFixture(), lockPort = locks(), options = { name: 'Restored preview Close', indexedDB: native.factory, locks: lockPort };
	const bootstrap = await createPhotoLibrarySessionV3(options);
	try { assert.equal((await bootstrap.readPage()).totalCount, 0); } finally { await bootstrap.close(); }
	const defaultRows = () => PHOTO_CATALOG_STORES.map(store => native.raw(DEFAULT_CATALOG).records(DEFAULT_CATALOG, store));
	const defaultBefore = defaultRows(), input = photoArchiveFixture(1, PNG);
	const archive = await exportPhotoCatalogArchiveV5(mediaRestoreRoot(1), [input], [], null, [], null, undefined);
	assert.ok(archive.blob); assert.equal(archive.document.schemaVersion, 5);
	const restore = createPhotoLibraryRestoreRuntimeV2(options);
	try { assert.equal((await restore.restoreArchive(archive.blob)).photoCount, 1); } finally { await restore.close(); }
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: lockPort });
	const selected = await (async () => {
		try {
			return await withPhotoLibraryInitializationLockV1(lockPort, authority => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
				initializeDefault: () => Promise.reject(new Error('Actual restore must have committed a selected pointer.')) }, authority.signal));
		} finally { await anchor.close(); }
	})();
	assert.equal(selected.pointer.schemaVersion, 2); assert.ok(selected.allocation);
	assert.notEqual(selected.location.catalogDatabaseName, DEFAULT_CATALOG); assert.equal(selected.location.catalogId, input.photo.catalogId);
	const namespaceToken = selected.allocation.namespaceToken;
	const commitKey = photoLibraryRestoreCommitKeyV1(namespaceToken);
	function owners() {
		const fixed = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: lockPort });
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: lockPort,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		return { fixed, media, catalog, async close() {
			const settled = await Promise.allSettled([catalog.close(), media.close(), fixed.close()]);
			const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (errors.length) throw new AggregateError(errors, 'Restored Node fixture cleanup failed.');
		} };
	}
	const original = input.photo.original, binding = { catalogId: input.photo.catalogId, photoId: input.photo.id, originalId: original.id,
		storageKey: original.storageKey, contentSha256: original.contentSha256, byteLength: original.byteLength, width: original.width, height: original.height };
	const descriptor = { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };
	const plan = planPhotoPreviewV1({ binding, source: descriptor, tier: 'thumbnail' });
	const prepared = await preparePhotoPreviewV1({ plan, binding, frame: { descriptor, pixels: PIXELS.slice() } });
	const setup = owners();
	try { assert.equal((await setup.media.getPreviewCache().store(prepared)).outcome, 'stored'); } finally { await setup.close(); }
	async function snapshot() {
		const reader = owners();
		try {
			const photo = await reader.catalog.loadPhoto(input.photo.catalogId, input.photo.id); assert.deepEqual(photo, input.photo);
			const blob = await reader.media.mediaRepository.loadAsset(original.storageKey); assert.ok(blob);
			const bytes = new Uint8Array(await blob.arrayBuffer()); assert.deepEqual(bytes, PNG);
			assert.equal(createHash('sha256').update(bytes).digest('hex'), original.contentSha256);
			const database = selected.location.mediaDatabaseName, raw = native.raw(database);
			assert.equal(raw.recordCount(database, PAYLOAD), 1); assert.equal(raw.recordCount(database, INVENTORY), 1);
			const payloads: unknown[] = raw.records(database, PAYLOAD), inventories: unknown[] = raw.records(database, INVENTORY);
			const payload = readBinaryDerivativeCacheRecordV1(payloads[0], plan.key, PROFILE, true);
			const inventory = readBinaryDerivativeCacheRecordV1(inventories[0], plan.key, PROFILE);
			assert.deepEqual(payload, inventory); assert.equal(inventory.storage, 'indexeddb-blob'); assert.equal(inventory.path, null);
			assert.equal(inventory.size, PIXELS.byteLength); assert.equal(inventory.outputSha256, prepared.outputSha256);
			const roots = await reader.media.mediaRepository.catalogOriginals.readPage({ catalogId: input.photo.catalogId });
			assert.equal(roots.roots.length, 1); assert.equal(roots.afterKey, null);
			assert.equal(inventory.originalMediaContentToken, roots.roots[0]?.mediaContentToken);
			const commit = normalizePhotoLibraryRestoreCommitV1(await reader.fixed.settingsRepository.get(commitKey));
			assert.deepEqual(commit.allocation, selected.allocation); assert.deepEqual(commit.replacementPointer, selected.pointer);
			assert.equal(commit.candidateReceipt.photoCount, 1); assert.equal(commit.candidateReceipt.originalByteLength, PNG.byteLength);
			assert.deepEqual(defaultRows(), defaultBefore);
			return { photo, original: await reader.media.mediaRepository.getAssetMetadata(original.storageKey), bytes, roots, payload, inventory, commit, defaultRows: defaultRows() };
		} finally { await reader.close(); }
	}
	return { options, photo: input.photo, plan, prepared, snapshot, before: await snapshot() };
}

async function heldRestoredCacheRead(injectFailure: boolean) {
	const keyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	try {
		const value = await fixture(), session = await createPhotoLibrarySessionV3(value.options), release = deferred<void>();
		const revoked = Proxy.revocable(Object.create(null) as object, {}); revoked.revoke(); const opaque: unknown = revoked.proxy;
		const state = { reads: 0, otherReads: 0, mediaCloses: 0, catalogCloses: 0 }, events: string[] = [];
		const loadDescriptor = Object.getOwnPropertyDescriptor(OpfsRepository.prototype, 'loadBinaryRecord');
		const mediaDescriptor = Object.getOwnPropertyDescriptor(PhotoMediaStoreV1.prototype, 'close');
		const catalogDescriptor = Object.getOwnPropertyDescriptor(PhotoCatalogRepositoryKernelV2.prototype, 'close');
		assert.ok(loadDescriptor); assert.ok(mediaDescriptor); assert.ok(catalogDescriptor);
		const load = OpfsRepository.prototype.loadBinaryRecord, closeMedia = PhotoMediaStoreV1.prototype.close, closeCatalog = PhotoCatalogRepositoryKernelV2.prototype.close;
		Object.defineProperty(OpfsRepository.prototype, 'loadBinaryRecord', { ...loadDescriptor,
			value: async function(this: OpfsRepository, ...args: Parameters<OpfsRepository['loadBinaryRecord']>) {
				const body = await Reflect.apply(load, this, args) as Blob;
				if (args[0].key !== value.plan.key || args[2] !== 'derivative-payload-read') { state.otherReads++; return body; }
				assert.equal(args[0].storage, 'indexeddb-blob'); assert.equal(body.size, PIXELS.byteLength);
				state.reads++; events.push('actual-read-ack'); await release.promise; events.push('held-read-released');
				if (injectFailure) throw opaque;
				return body;
			} });
		Object.defineProperty(PhotoMediaStoreV1.prototype, 'close', { ...mediaDescriptor,
			value: function(this: PhotoMediaStoreV1) { state.mediaCloses++; events.push('media-close'); return Reflect.apply(closeMedia, this, []) as Promise<void>; } });
		Object.defineProperty(PhotoCatalogRepositoryKernelV2.prototype, 'close', { ...catalogDescriptor,
			value: function(this: PhotoCatalogRepositoryKernelV2) { state.catalogCloses++; events.push('catalog-close'); return Reflect.apply(closeCatalog, this, []) as Promise<void>; } });
		const preview = outcome(session.readPreview(value.photo.id, 'thumbnail'));
		let closing: ReturnType<typeof outcome<void>> | undefined;
		try {
			await waitFor(() => state.reads === 1, 'the actual restored runtime3 IndexedDB cache read');
			const close = session.close(); closing = outcome(close); assert.equal(session.close(), close);
			assert.equal(await remainsPending(close), true); assert.equal(state.mediaCloses, 0); assert.equal(state.catalogCloses, 0);
			await assert.rejects(session.readPreview(value.photo.id, 'thumbnail'), /closed/u); await assert.rejects(session.readPage(), /closed/u);
			assert.equal((await preview).ok, false); assert.equal(await remainsPending(close), true);
			assert.equal(state.otherReads, 0); assert.equal(state.mediaCloses, 0); assert.equal(state.catalogCloses, 0);
			release.resolve(); const closed = await closing;
			if (injectFailure) { assert.equal(closed.ok, false); if (!closed.ok) assert.equal(Object.is(closed.error, opaque), true); }
			else assert.equal(closed.ok, true);
			assert.equal(state.mediaCloses, 2); assert.equal(state.catalogCloses, 1);
			assert.ok(events.indexOf('held-read-released') < events.indexOf('media-close'));
			assert.ok(events.indexOf('held-read-released') < events.indexOf('catalog-close'));
		} finally {
			release.resolve(); await preview; await (closing ?? outcome(session.close()));
			Object.defineProperty(OpfsRepository.prototype, 'loadBinaryRecord', loadDescriptor);
			Object.defineProperty(PhotoMediaStoreV1.prototype, 'close', mediaDescriptor);
			Object.defineProperty(PhotoCatalogRepositoryKernelV2.prototype, 'close', catalogDescriptor);
		}
		const reopened = await createPhotoLibrarySessionV3(value.options);
		try {
			const cached = await reopened.readPreview(value.photo.id, 'thumbnail'); assert.equal(cached.outcome, 'ready');
			if (cached.outcome !== 'ready') assert.fail('Acknowledged restored cache must remain readable.');
			assert.equal(cached.cache, 'hit'); assert.deepEqual(cached.notices, []);
			assert.equal(cached.preview.outputSha256, value.prepared.outputSha256);
			assert.deepEqual(new Uint8Array(await cached.preview.body.arrayBuffer()), PIXELS);
		} finally { await reopened.close(); }
		assert.deepEqual(await value.snapshot(), value.before);
	} finally { if (keyRange) Object.defineProperty(globalThis, 'IDBKeyRange', keyRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); }
}

test('restored native cut admission refuses unknown/default/opaque values before any browser acquisition', { concurrency: false }, async () => {
	const names = ['navigator', 'indexedDB'] as const, saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
	let acquisitions = 0, reflections = 0;
	const opaque = Symbol('browser acquisition must not occur');
	for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get() { acquisitions++; throw opaque; } });
	const hostile = new Proxy({}, { get() { reflections++; throw opaque; }, getPrototypeOf() { reflections++; throw opaque; }, ownKeys() { reflections++; throw opaque; } });
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	try {
		for (const value of [undefined, null, false, 0, NaN, '', 'after-write', 'after-close', 'cleanup-ack', 'default', 'payload-put ', Symbol('cut'),
			{ get cut() { reflections++; throw opaque; } }, hostile, revoked.proxy]) {
			await assert.rejects(qualifyPhotoRestoredPreviewSessionCloseNativeV1(value), (error: unknown) => error instanceof Error && /cut/iu.test(error.message));
		}
		assert.equal(acquisitions, 0); assert.equal(reflections, 0);
	} finally { for (const [index, name] of names.entries()) { const descriptor = saved[index]; if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } }
});

test(`V5 restored allocated runtime3 Close joins an acknowledged IndexedDB read and retains the ${cutOutcomes['completed-ack']} pair`,
	{ concurrency: false }, async () => { await heldRestoredCacheRead(false); });

test('V5 restored allocated runtime3 Close preserves opaque held-read failure, committed cache, original custody and default library',
	{ concurrency: false }, async () => { await heldRestoredCacheRead(true); });

// This explicit Node event port exercises the owning transaction join. Browser
// cuts still provide the independent proof of native request/terminal ordering.
function transactionEventPort() {
	const target = new EventTarget(), events: string[] = [];
	let error: DOMException | null = null, abortRequests = 0;
	const native = target as unknown as IDBTransaction;
	Object.defineProperties(native, {
		error: { get: () => error },
		oncomplete: { value: null, writable: true }, onabort: { value: null, writable: true }, onerror: { value: null, writable: true },
		objectStore: { value: () => Object.create(null) as IDBObjectStore },
		abort: { value: () => { abortRequests++; queueMicrotask(() => { requestError(); }); } },
	});
	for (const kind of ['complete', 'abort', 'error'] as const) target.addEventListener(kind, event => {
		const handler = native[kind === 'complete' ? 'oncomplete' : kind === 'abort' ? 'onabort' : 'onerror'];
		if (handler) Reflect.apply(handler, native, [event]);
	});
	function requestError(handled = false): boolean {
		const event = new Event('error', { bubbles: true, cancelable: true });
		if (handled) event.preventDefault();
		events.push('request-error'); target.dispatchEvent(event); return event.defaultPrevented;
	}
	function terminal(kind: 'complete' | 'abort', failure?: DOMException): void {
		error = failure ?? null; events.push(kind); target.dispatchEvent(new Event(kind));
	}
	return { native, events, requestError, terminal, abortRequests: () => abortRequests,
		database: { transaction: () => native } as unknown as IDBDatabase };
}

test('restored preview transaction completion joins a bubbled request error until the actual abort event port settles', async () => {
	const port = transactionEventPort(), joined = outcome(transactionCompletion(port.native));
	const terminalFailure = new DOMException('Actual abort terminal', 'AbortError');
	try {
		assert.equal(port.requestError(), false); assert.equal(port.native.error, null);
		assert.equal(await remainsPending(joined), true);
		port.terminal('abort', terminalFailure); const result = await joined;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, terminalFailure), true);
		assert.deepEqual(port.events, ['request-error', 'abort']);
	} finally { port.terminal('abort', terminalFailure); await joined; }
});

test('restored preview transaction completion accepts a handled request error followed by a genuine complete event port', async () => {
	const port = transactionEventPort(), joined = outcome(transactionCompletion(port.native));
	try {
		assert.equal(port.requestError(true), true); assert.equal(port.native.error, null);
		assert.equal(await remainsPending(joined), true);
		port.terminal('complete'); const result = await joined; assert.equal(result.ok, true);
		assert.deepEqual(port.events, ['request-error', 'complete']);
	} finally { port.terminal('complete'); await joined; }
});

test('restored preview transact retains its opaque operation primary and joins later request error plus held native abort delivery', async () => {
	const port = transactionEventPort(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	const primary: unknown = revoked.proxy, terminalFailure = new DOMException('Abort after opaque operation failure', 'AbortError');
	const joined = outcome(transact(port.database, [PAYLOAD, INVENTORY], 'readwrite', () => Promise.reject(primary)));
	try {
		await waitFor(() => port.abortRequests() === 1 && port.events.includes('request-error'), 'the forwarded operation abort and bubbled pending-request error');
		assert.equal(await remainsPending(joined), true);
		port.terminal('abort', terminalFailure); const result = await joined;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, primary), true);
		assert.deepEqual(port.events, ['request-error', 'abort']);
	} finally { port.terminal('abort', terminalFailure); await joined; }
});
