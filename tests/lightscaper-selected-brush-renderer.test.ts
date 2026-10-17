/* SPDX-License-Identifier: AGPL-3.0-only */

// Actual Session/storage/render/export owners; explicit Node frame/encoder/destination ports, no native decoder claim.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../src/common/editor/photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibrarySessionPortV2 } from '../src/common/editor/photo-library-session-port-v2.ts';
import { acquirePhotoLibraryWorkflowSlotV2, loadPhotoLibraryDevelopProxyV2, retirePhotoLibraryWorkflowSlotV2,
	type PhotoLibraryWorkflowSlotV2 } from '../src/common/editor/controller/shared/photo-library-workflow-slot-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { assertPhotoMaskRasterPortableV1 } from '../src/lightscaper/catalog/photo-mask-raster-portability-v1.ts';
import { PhotoRasterExport, type PhotoRasterExportRequest } from '../src/lightscaper/controller/photo-raster-export.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const ORIGINAL = [0, 0, 0, 128, 0, 0, 0, 255], EXPECTED = [0, 0, 0, 128, 255, 255, 255, 255];
type SelectedFactory = (source: Readonly<CubeLutSourcePortV1>, maskSource?: Readonly<MaskRasterSourcePortV1>) => Promise<Readonly<PhotoLibraryDevelopProxyRuntimeV2>>;
function outcome<Value>(operation: Promise<Value>) {
	return operation.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
function selectedSource(session: PhotoLibrarySessionPortV2): Readonly<MaskRasterSourcePortV1> {
	const value: unknown = Reflect.get(session, 'maskRasterSource');
	assert.ok(typeof value === 'object' && value !== null);
	const method = Object.getOwnPropertyDescriptor(value, 'withBytes');
	assert.ok(method && Object.hasOwn(method, 'value') && typeof method.value === 'function');
	return value as Readonly<MaskRasterSourcePortV1>; // Narrowed by the actual own-data callable check, not fabricated authority.
}
function frame(): PixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(ORIGINAL) };
}
function recipe(storageKey: string) {
	const effect = createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [effect],
		masks: [{ schemaVersion: 1, id: 'paint', kind: 'mask', inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: storageKey }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'Paint' }], outputNodeId: 'alpha' }],
		maskBindings: [{ effectId: 'invert', maskId: 'paint' }] });
}
function slot(session: PhotoLibrarySessionPortV2, proxyFactory: SelectedFactory): PhotoLibraryWorkflowSlotV2 {
	return { live: true, factory: async () => session, proxyFactory, backupLoader: undefined, lifetime: new AbortController(), beforeDrain: null,
		pending: null, active: null, query: null, savedCollectionId: null, stackCollapsed: false, page: null, batchRenamePlanner: null,
		backupRuntime: null, backupLoading: null, proxyPending: null, closeOwner: null, retirement: null };
}
async function closeAll(owners: readonly Readonly<{ close(): Promise<void> }>[]) {
	const results = await Promise.allSettled(owners.map(owner => owner.close()));
	const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (errors.length === 1) throw errors[0];
	if (errors.length) throw new AggregateError(errors, 'Selected renderer fixture cleanup failed.');
}
async function fixture() {
	const native = mediaRestoreFixture(), locks = new MemoryLockManager() as unknown as LockManager;
	const options = { name: 'Selected brush render', indexedDB: native.factory, locks };
	const bootstrap = await createPhotoLibrarySessionV3(options);
	try { assert.equal((await bootstrap.readPage()).totalCount, 0); } finally { await bootstrap.close(); }
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
	let catalog: PhotoCatalogRepositoryV2 | undefined;
	const body = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, prepared =>
		({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
	let photo: ReturnType<typeof normalizePhotoDocumentV2> | undefined;
	let mediaName: string | undefined, catalogName: string | undefined;
	try {
		const selected = await withPhotoLibraryInitializationLockV1(locks, authority => readPhotoLibrarySessionLocationV2({
			settings: media.settingsRepository, initializeDefault: () => Promise.reject(Error('Existing selected location required.')) }, authority.signal));
		assert.equal(selected.pointer.schemaVersion, 1); assert.equal(selected.allocation, null);
		mediaName = selected.location.mediaDatabaseName; catalogName = selected.location.catalogDatabaseName;
		const resources = await media.getMaskRasterResources(); await resources.put(body.reference, body.bytes);
		const input = photoArchiveFixture(), develop = recipe(body.reference.storageKey);
		photo = normalizePhotoDocumentV2({ ...input.photo, schemaVersion: 2, catalogId: selected.location.catalogId,
			original: { ...input.photo.original, width: 2, height: 1, hasAlpha: true },
			versions: [{ ...input.photo.versions[0]!, develop }] });
		const metadata = await media.mediaRepository.writeAsset(photo.original.storageKey, input.original);
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'fixture-import', [{ photoId: photo.id,
			assetId: metadata.sourceId, sourceId: photo.original.id, sha256: metadata.sha256, size: metadata.size }]);
		catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: catalogName,
			verifyOriginal: media.verifyOriginal, verifyResources: resources.verifyPhoto });
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root);
		await catalog.publishPhotos(root.id, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.promote(photo.catalogId, 'fixture-import', [photo.id]);
	} finally { await closeAll(catalog ? [catalog, media] : [media]); }
	assert.ok(photo); assert.ok(mediaName); assert.ok(catalogName);
	const published = photo, names = { media: mediaName, catalog: catalogName };
	const ledger = () => ({ photo: native.raw(names.catalog).records(names.catalog, 'photos'),
		original: native.raw(names.media).records(names.media, 'mediaAssets'), custody: native.raw(names.media).records(names.media, 'catalogOriginalRoots'),
		bodies: native.raw(names.media).records(names.media, 'analysis') });
	return { body, photo: published, options, ledger, session: await createPhotoLibrarySessionV3(options) };
}

test('actual selected lazy factory shares one brush-capable runtime across proxy and full output', async t => {
	const f = await fixture(); t.after(() => f.session.close()); const before = f.ledger(); let factories = 0;
	const current = slot(f.session, async (source, maskSource) => {
		assert.ok(maskSource, 'Selected factory must receive the brush capability.'); factories++;
		return createPhotoDevelopRenderRuntimeV2({ source, maskSource });
	});
	t.after(() => retirePhotoLibraryWorkflowSlotV2(current, async () => undefined));
	assert.equal(factories, 0); const first = loadPhotoLibraryDevelopProxyV2(current), second = loadPhotoLibraryDevelopProxyV2(current);
	assert.equal(first, second); const runtime = await first; assert.equal(runtime, await second); assert.equal(factories, 1);
	for (const method of [runtime.withProxy, runtime.withFullResolution]) {
		const original = frame(); let pixels: PixelFrameV1['pixels'] | undefined, coverage: Uint8Array | undefined;
		assert.deepEqual(await method({ frame: original, develop: recipe(f.body.reference.storageKey), signal: current.lifetime.signal,
			maskOverlay: { maskId: 'paint', effectId: 'invert' } }, view => {
			assert.ok(view.maskOverlay); pixels = view.frame.pixels; coverage = view.maskOverlay.coverage;
			return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
		}), { pixels: EXPECTED, coverage: [0, 255] });
		assert.ok(pixels?.every(value => value === 0)); assert.ok(coverage?.every(value => value === 0));
		assert.deepEqual([...original.pixels], ORIGINAL);
	}
	assert.deepEqual(f.ledger(), before);
});

test('selected slot captures real source receiver before a held factory yields and ignores later method/property replacement', async t => {
	const f = await fixture(); t.after(() => f.session.close()); const actual = selectedSource(f.session), nativeMethod = actual.withBytes;
	const originalProperty = Object.getOwnPropertyDescriptor(f.session, 'maskRasterSource'); assert.ok(originalProperty);
	let calls = 0, reflections = 0;
	const forwarding: MaskRasterSourcePortV1 = { withBytes<Result>(reference: Parameters<MaskRasterSourcePortV1['withBytes']>[0],
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) {
		assert.equal(this, forwarding); calls++; return Reflect.apply(nativeMethod, actual, [reference, consume, options]) as Promise<Result>;
	} };
	forwarding.withBytes = new Proxy(forwarding.withBytes, { get() { reflections++; throw Error('Function metadata reflected'); } });
	Object.defineProperty(f.session, 'maskRasterSource', { ...originalProperty, value: forwarding });
	const entered = deferred<void>(), release = deferred<void>(), joining: { work?: Promise<unknown> } = {};
	const current = slot(f.session, async (source, maskSource) => {
		assert.ok(maskSource); entered.resolve(); await release.promise; return createPhotoDevelopRenderRuntimeV2({ source, maskSource });
	});
	t.after(async () => { release.resolve(); await joining.work; Object.defineProperty(f.session, 'maskRasterSource', originalProperty);
		await retirePhotoLibraryWorkflowSlotV2(current, async () => undefined); });
	const loading = loadPhotoLibraryDevelopProxyV2(current); joining.work = outcome(loading); await Promise.race([entered.promise, loading]);
	forwarding.withBytes = () => Promise.reject(Error('Replacement method used'));
	Object.defineProperty(f.session, 'maskRasterSource', { ...originalProperty, value: { withBytes() { throw Error('Replacement source used'); } } });
	release.resolve(); const runtime = await loading;
	assert.deepEqual(await runtime.withProxy({ frame: frame(), develop: recipe(f.body.reference.storageKey), signal: current.lifetime.signal }, view => [...view.frame.pixels]), EXPECTED);
	assert.equal(calls, 1); assert.equal(reflections, 0);
});

test('retired selected generation joins a held actual body consumer and retains its opaque first caller reason', async t => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const revoked = Proxy.revocable({}, {}), joining: { work?: Promise<unknown> } = {}; revoked.revoke();
	const current = slot(f.session, async (source, maskSource) => {
		assert.ok(maskSource); await maskSource.withBytes(f.body.reference, async bytes => { assert.deepEqual([...bytes], [...f.body.bytes]); entered.resolve(); await release.promise; }, { signal: stop.signal });
		return createPhotoDevelopRenderRuntimeV2({ source, maskSource });
	});
	t.after(async () => { release.resolve(); await joining.work; await retirePhotoLibraryWorkflowSlotV2(current, async () => undefined); await f.session.close(); });
	const loading = loadPhotoLibraryDevelopProxyV2(current), result = outcome(loading); joining.work = result;
	await Promise.race([entered.promise, loading]); stop.abort(revoked.proxy);
	const closing = retirePhotoLibraryWorkflowSlotV2(current, async () => undefined);
	assert.equal(retirePhotoLibraryWorkflowSlotV2(current, async () => assert.fail('Duplicate retirement')), closing);
	assert.equal(current.live, false); assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(loading), true);
	await assert.rejects(loadPhotoLibraryDevelopProxyV2(current), { name: 'AbortError' });
	release.resolve(); const settled = await result; assert.equal(settled.ok, false);
	if (!settled.ok) assert.equal(Object.is(settled.error, revoked.proxy), true);
	await closing; await assert.rejects(selectedSource(f.session).withBytes(f.body.reference, () => assert.fail('Retired source reused')), /closed/iu);
});

for (const format of ['png', 'jpeg'] as const) test(`actual ${format} export uses the selected cached brush renderer and retains output through destination Close ACK`, async t => {
	const f = await fixture(), before = f.ledger(), owner = new PhotoRasterExport(format), closeEntered = deferred<void>(), closeRelease = deferred<void>();
	const encoded = new Uint8Array(format === 'png' ? [137, 80, 78, 71, 1] : [255, 216, 1, 255, 217]);
	let factories = 0; const joining: { work?: Promise<unknown> } = {}, events: string[] = [];
	const current = slot(f.session, async (source, maskSource) => { assert.ok(maskSource); factories++; return createPhotoDevelopRenderRuntimeV2({ source, maskSource }); });
	t.after(async () => { closeRelease.resolve(); await joining.work; await owner.cancelAndJoin(); await retirePhotoLibraryWorkflowSlotV2(current, async () => undefined); await f.session.close(); });
	const request: PhotoRasterExportRequest = { photoId: f.photo.id, versionId: f.photo.activeVersionId, expectedRevision: f.photo.revision,
		fileName: 'Brush', fileTypeDescription: format, prepareSave(save) {
			events.push('picker'); assert.equal(save.mimeType, owner.mimeType);
			const fileName = save.suggestedName; assert.ok(typeof fileName === 'string');
			return createFileSystemPreparedSave({ fileName, signal: save.signal, target: { createWritable: async () => ({
				write: async value => { assert.ok(value instanceof Uint8Array); assert.deepEqual([...value], [...encoded]); events.push('write'); },
				close: async () => { events.push('close-enter'); closeEntered.resolve(); await closeRelease.promise; events.push('close-ack'); },
				abort: async () => { assert.fail('Successful destination cannot abort'); },
			}) } });
		}, saveFile: () => { throw Error('Real prepared stream must not fall back to download'); },
		execute: async (action, signal) => { const admitted = signal ?? new AbortController().signal;
			return action({ signal: admitted, isCurrent: () => current.live,
				acquire: async () => (await acquirePhotoLibraryWorkflowSlotV2(current)).develop, refresh: async () => undefined }); },
		withOriginalFrame: async (binding, consume, options) => { assert.equal(binding.photoId, f.photo.id); assert.equal(binding.expectedRevision, f.photo.revision);
			options?.signal?.throwIfAborted(); const original = frame();
			try { return await consume({ photoId: f.photo.id, revision: f.photo.revision, frame: original }); } finally { original.pixels.fill(0); } },
		loadRenderer: () => loadPhotoLibraryDevelopProxyV2(current), encode: async output => {
			assert.deepEqual([...output.pixels], EXPECTED); events.push('encode'); return encoded;
		} };
	const work = owner.start(request); joining.work = outcome(work); assert.deepEqual(events, ['picker']);
	await Promise.race([closeEntered.promise, work]); assert.equal(await remainsPending(work), true); assert.equal(encoded[0] !== 0, true);
	assert.equal(factories, 1); assert.equal(await loadPhotoLibraryDevelopProxyV2(current), await loadPhotoLibraryDevelopProxyV2(current));
	closeRelease.resolve(); const receipt = await work; assert.equal(receipt.status, 'saved');
	assert.equal(receipt.width, 2); assert.equal(receipt.height, 1); assert.equal(receipt.method, 'file-system-access');
	assert.deepEqual(events, ['picker', 'encode', 'write', 'close-enter', 'close-ack']); assert.ok(encoded.every(value => value === 0));
	assert.deepEqual(f.ledger(), before);
});

test('selected forwarding preserves strict default authority and complete Photo portable body refusal', async t => {
	const f = await fixture(); t.after(() => f.session.close()); const strict = createPhotoDevelopRenderRuntimeV2();
	let inspected = 0, consumed = 0;
	const hostile = new Proxy({}, { ownKeys() { inspected++; throw Error('Brush default inspected original'); } });
	const work = Reflect.apply(strict.withProxy, strict, [{ frame: hostile, develop: recipe(f.body.reference.storageKey), signal: new AbortController().signal },
		() => { consumed++; }]) as Promise<void>;
	await assert.rejects(work, /authority|external|mask/iu); assert.equal(inspected, 0); assert.equal(consumed, 0);
	assert.throws(() => assertPhotoMaskRasterPortableV1(f.photo), /portable body transport/iu);
});
