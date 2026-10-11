/* SPDX-License-Identifier: AGPL-3.0-only */

// Real Session/replay/resource/render owners with controlled Node storage and explicit pixels; no native decoder claim.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { PhotoLibraryBrushMaskAuthoringV1 } from '../src/common/editor/controller/shared/photo-library-brush-mask-authoring-v1.ts';
import { PhotoLibraryDevelopWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { withBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { BrushMaskStrokeV1 } from '../src/common/editor/imaging/brush-mask-plane-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from '../src/common/editor/photo-library-develop-mask-raster-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
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
function outcome<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
const CROSS = [0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0];
function stamp(mode: 'paint' | 'erase' = 'paint', opacity = 1): BrushMaskStrokeV1 {
	return { mode, radius: 0.25, hardness: 1, opacity, points: [{ x: 0.375, y: 0.375 }] };
}
function edgeStroke(): BrushMaskStrokeV1 {
	return { mode: 'paint', radius: 0.5, hardness: 1, opacity: 1, points: [{ x: 0.625, y: 0.5 }, { x: 0.875, y: 0.5 }] };
}
async function display(owner: PhotoLibraryBrushMaskAuthoringV1): Promise<number[]> {
	return owner.withDisplay(alpha => [...alpha]);
}
function compose(reference: Readonly<BrushMaskResourceReferenceV1>) {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 0.5 } }),
		createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }),
		createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } }),
	], masks: [{ schemaVersion: 1, id: 'paint', kind: 'matte', inputs: [{ name: 'Coverage', kind: 'alpha', sourceRef: reference.storageKey }],
		nodes: [{ id: 'retained-output', kind: 'alpha', inputName: 'Coverage' }], outputNodeId: 'retained-output' }],
	maskBindings: [{ effectId: 'invert', maskId: 'paint' }] });
}
async function fixture() {
	const native = mediaRestoreFixture(), locks = new MemoryLockManager() as unknown as LockManager;
	const options = { name: 'Brush authoring', indexedDB: native.factory, locks };
	const first = await createPhotoLibrarySessionV3(options);
	try { await first.readPage(); } finally { await first.close(); }
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
	let catalog: PhotoCatalogRepositoryV2 | undefined;
	let photo: ReturnType<typeof normalizePhotoDocumentV2> | undefined, mediaName = '', catalogName = '';
	let setupFailure: { error: unknown } | undefined;
	const cleanupErrors: unknown[] = [];
	try {
		const selected = await withPhotoLibraryInitializationLockV1(locks, authority => readPhotoLibrarySessionLocationV2({
			settings: media.settingsRepository, initializeDefault: () => Promise.reject(Error('Existing selection required.')) }, authority.signal));
		assert.equal(selected.pointer.schemaVersion, 1); assert.equal(selected.allocation, null);
		mediaName = selected.location.mediaDatabaseName; catalogName = selected.location.catalogDatabaseName;
		const input = photoArchiveFixture();
		photo = normalizePhotoDocumentV2({ ...input.photo, schemaVersion: 2, catalogId: selected.location.catalogId,
			original: { ...input.photo.original, width: 4, height: 1, hasAlpha: false },
			versions: [{ ...input.photo.versions[0]!, develop: defaultImageDevelopStateV2() }] });
		const metadata = await media.mediaRepository.writeAsset(photo.original.storageKey, input.original);
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'authoring-fixture', [{ photoId: photo.id,
			assetId: metadata.sourceId, sourceId: photo.original.id, sha256: metadata.sha256, size: metadata.size }]);
		const resources = await media.getMaskRasterResources();
		catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: catalogName,
			verifyOriginal: media.verifyOriginal, verifyResources: resources.verifyPhoto });
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root);
		await catalog.publishPhotos(root.id, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.promote(photo.catalogId, 'authoring-fixture', [photo.id]);
	} catch (error: unknown) {
		setupFailure = { error };
	} finally {
		const results = await Promise.allSettled([catalog?.close(), media.close()]);
		cleanupErrors.push(...results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []));
	}
	if (setupFailure && cleanupErrors.length) throw new AggregateError([setupFailure.error, ...cleanupErrors],
		'Authoring setup and cleanup failed.', { cause: setupFailure.error });
	if (setupFailure) throw setupFailure.error;
	if (cleanupErrors.length === 1) throw cleanupErrors[0];
	if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Authoring setup cleanup failed.');
	assert.ok(photo);
	const session = await createPhotoLibrarySessionV3(options), port = session.develop.maskRasters;
	if (!port) { await session.close(); assert.fail('Actual selected Develop must supply brush installation.'); }
	const workflow = new PhotoLibraryDevelopWorkflowV2({ now: () => '2026-10-11T00:00:00.000Z',
		execute: async (action, signal) => { await action({ signal: signal ?? new AbortController().signal,
			acquire: async () => session.develop, isCurrent: () => true, refresh: async () => undefined }); } });
	const ledger = () => ({ photos: native.raw(catalogName).records(catalogName, 'photos'),
		originals: native.raw(mediaName).records(mediaName, 'mediaAssets'), roots: native.raw(mediaName).records(mediaName, 'catalogOriginalRoots'),
		bodies: native.raw(mediaName).records(mediaName, 'analysis') });
	return { session, port, workflow, ledger, photo, close: async () => { await workflow.close(); await session.close(); } };
}
function forwardPort(port: Readonly<PhotoLibraryDevelopMaskRasterPortV1>, source: MaskRasterSourcePortV1,
	install: PhotoLibraryDevelopMaskRasterPortV1['install'] = (reference, bytes, options) => port.install(reference, bytes, options)) {
	return Object.freeze({ schemaVersion: 1 as const, source, install });
}

test('real replay keeps one bounded local history with independent paint/erase/undo/redo coverage', async t => {
	const f = await fixture(), owner = new PhotoLibraryBrushMaskAuthoringV1({ port: f.port, isCurrent: () => true });
	t.after(async () => { await owner.cancelAndJoin(); await f.close(); });
	await owner.open({ width: 4, height: 4 }); assert.deepEqual(await display(owner), new Array<number>(16).fill(0));
	owner.append(stamp('paint', 0.5)); assert.deepEqual(await display(owner), CROSS.map(value => value ? 128 : 0));
	owner.append(stamp('erase', 0.5)); assert.deepEqual(await display(owner), CROSS.map(value => value ? 64 : 0));
	owner.undo(); assert.deepEqual(await display(owner), CROSS.map(value => value ? 128 : 0));
	owner.redo(); assert.deepEqual(await display(owner), CROSS.map(value => value ? 64 : 0));
	owner.undo(); owner.append(stamp('paint')); assert.equal(owner.snapshot().history.strokes.length, 2);
	assert.equal(owner.snapshot().history.cursor, 2); assert.deepEqual(await display(owner), CROSS);
	assert.equal(f.ledger().bodies.length, 0, 'Unpublished grid is not an installed or rendered resource.');
	let reflections = 0;
	assert.throws(() => owner.append({ ...stamp(), get radius() { reflections++; return 0.25; } }), /own|data|accessor/iu);
	assert.equal(reflections, 0); assert.throws(() => owner.append({ ...stamp(), radius: -0 }), /radius|fraction|canonical/iu);
	assert.equal(owner.snapshot().history.cursor, 2);
});

test('actual selected installation ACK precedes current draft edit and Save; real crop/flip render samples the adjustment input', async t => {
	const f = await fixture(); await f.workflow.open(f.photo.id);
	const entry = f.workflow.snapshot(), owner = new PhotoLibraryBrushMaskAuthoringV1({ port: f.port,
		isCurrent: () => f.workflow.snapshot().document === entry.document && f.workflow.snapshot().draft === entry.draft });
	t.after(async () => { await owner.cancelAndJoin(); await f.close(); });
	const before = f.ledger(); await owner.open({ width: 4, height: 1 }); owner.append(edgeStroke());
	assert.deepEqual(await display(owner), [0, 0, 255, 255]); assert.equal(f.workflow.snapshot().draft, entry.draft);
	const receipt = await owner.install(); assert.equal(receipt.catalogId, f.photo.catalogId); assert.equal(receipt.created, true);
	assert.equal(f.workflow.snapshot().draft, entry.draft); assert.deepEqual(f.ledger().photos, before.photos);
	assert.deepEqual(f.ledger().originals, before.originals); assert.deepEqual(f.ledger().roots, before.roots);
	assert.equal(f.ledger().bodies.length, 1);
	assert.deepEqual(await f.port.source.withBytes(receipt.reference, bytes => withBrushMaskResourceV1({ reference: receipt.reference, bytes },
		resource => [...resource.alpha])), [0, 0, 255, 255]);
	const draft = compose(receipt.reference); f.workflow.edit(draft); assert.equal(f.workflow.snapshot().dirty, true);
	const saved = await f.workflow.save('Brush'); assert.ok(saved); assert.deepEqual(saved.snapshot.develop, draft);
	const renderer = createPhotoDevelopRenderRuntimeV2({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
	const original: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
		pixels: Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255) };
	assert.deepEqual(await renderer.withFullResolution({ frame: original, develop: saved.snapshot.develop, signal: new AbortController().signal,
		maskOverlay: { maskId: 'paint', effectId: 'invert' } }, view => ({ width: view.frame.descriptor.width, pixels: [...view.frame.pixels],
		coverage: [...view.maskOverlay!.coverage] })), { width: 2, pixels: [255, 255, 255, 255, 0, 0, 0, 255], coverage: [255, 0] });
	assert.deepEqual([...original.pixels], [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
	assert.deepEqual(f.ledger().originals, before.originals); assert.deepEqual(f.ledger().roots, before.roots);
});

test('existing immutable body is authenticated and copied as a base, then re-edited without changing the installed predecessor', async t => {
	const f = await fixture(), first = new PhotoLibraryBrushMaskAuthoringV1({ port: f.port, isCurrent: () => true });
	const second = new PhotoLibraryBrushMaskAuthoringV1({ port: f.port, isCurrent: () => true });
	t.after(async () => { await first.cancelAndJoin(); await second.cancelAndJoin(); await f.close(); });
	await first.open({ width: 4, height: 4 }); first.append(stamp()); const old = await first.install();
	await second.open({ width: 4, height: 4, reference: old.reference }); assert.deepEqual(await display(second), CROSS);
	assert.equal(second.snapshot().history.cursor, 0); second.append(stamp('erase')); assert.deepEqual(await display(second), new Array<number>(16).fill(0));
	second.undo(); assert.deepEqual(await display(second), CROSS); const reused = await second.install();
	assert.equal(reused.reference.storageKey, old.reference.storageKey); assert.equal(reused.created, false);
	assert.deepEqual(await f.port.source.withBytes(old.reference, bytes => withBrushMaskResourceV1({ reference: old.reference, bytes }, resource => [...resource.alpha])), CROSS);
});

test('retirement joins a genuine held body borrower, pins original methods and preserves exact opaque caller cancellation', async t => {
	const f = await fixture(), seed = new PhotoLibraryBrushMaskAuthoringV1({ port: f.port, isCurrent: () => true });
	await seed.open({ width: 4, height: 4 }); seed.append(stamp()); const receipt = await seed.install(); await seed.cancelAndJoin();
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	const observed: { bytes?: Uint8Array<ArrayBuffer>; work?: Promise<unknown> } = {}; let calls = 0;
	const source: MaskRasterSourcePortV1 = { withBytes(reference, consume, options) {
		assert.equal(this, source); calls++; return f.port.source.withBytes(reference, async bytes => {
			observed.bytes = bytes; entered.resolve(); await release.promise; return consume(bytes);
		}, options);
	} };
	const owner = new PhotoLibraryBrushMaskAuthoringV1({ port: forwardPort(f.port, source), isCurrent: () => true, signal: stop.signal });
	t.after(async () => { release.resolve(); await observed.work; await owner.cancelAndJoin(); await f.close(); });
	const opening = owner.open({ width: 4, height: 4, reference: receipt.reference }), result = outcome(opening); observed.work = result;
	await Promise.race([entered.promise, opening]); source.withBytes = () => Promise.reject(Error('Late replacement used'));
	stop.abort(revoked.proxy); const close = owner.cancelAndJoin(); assert.equal(owner.cancelAndJoin(), close);
	assert.equal(await remainsPending(opening), true); assert.equal(await remainsPending(close), true);
	release.resolve(); const settled = await result; assert.equal(settled.ok, false);
	if (!settled.ok) assert.equal(Object.is(settled.error, revoked.proxy), true);
	await close; assert.equal(calls, 1); assert.equal(owner.snapshot().ready, false); assert.ok(observed.bytes?.every(value => value === 0));
	await assert.rejects(owner.open({ width: 4, height: 4 }), /closed|retired/iu);
});

test('held replay consumer and opaque failure join before the disposable display plane is wiped', async t => {
	const f = await fixture(), owner = new PhotoLibraryBrushMaskAuthoringV1({ port: f.port, isCurrent: () => true });
	const entered = deferred<void>(), release = deferred<void>(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	const observed: { alpha?: Uint8Array<ArrayBuffer>; work?: Promise<unknown> } = {};
	t.after(async () => { release.resolve(); await observed.work; await owner.cancelAndJoin(); await f.close(); });
	await owner.open({ width: 4, height: 4 }); owner.append(stamp());
	const work = owner.withDisplay(async alpha => { observed.alpha = alpha; entered.resolve(); await release.promise; throw revoked.proxy; });
	const result = outcome(work); observed.work = result; await Promise.race([entered.promise, work]);
	const close = owner.cancelAndJoin(); assert.equal(await remainsPending(close), true); assert.deepEqual([...(observed.alpha ?? [])], CROSS);
	release.resolve(); const settled = await result; assert.equal(settled.ok, false);
	if (!settled.ok) assert.equal(Object.is(settled.error, revoked.proxy), true);
	await close; assert.ok(observed.alpha?.every(value => value === 0));
});

test('completed real body ACK survives late stale retirement without editing a draft or losing encoded cleanup', async t => {
	const f = await fixture(); await f.workflow.open(f.photo.id); const entry = f.workflow.snapshot(), beforePhotos = f.ledger().photos;
	const entered = deferred<void>(), release = deferred<void>(), observed: { bytes?: Uint8Array; work?: Promise<unknown> } = {};
	let current = true;
	const port = forwardPort(f.port, f.port.source, async (reference, bytes, options) => {
		assert.ok(bytes instanceof Uint8Array); observed.bytes = bytes;
		const receipt = await f.port.install(reference, bytes, options); entered.resolve(); await release.promise; return receipt;
	});
	const owner = new PhotoLibraryBrushMaskAuthoringV1({ port, isCurrent: () => current });
	t.after(async () => { release.resolve(); await observed.work; await owner.cancelAndJoin(); await f.close(); });
	await owner.open({ width: 4, height: 4 }); owner.append(stamp()); const installing = owner.install(), result = outcome(installing); observed.work = result;
	await Promise.race([entered.promise, installing]); assert.equal(f.ledger().bodies.length, 1); assert.equal(f.workflow.snapshot().draft, entry.draft);
	current = false; const close = owner.cancelAndJoin(); assert.equal(await remainsPending(close), true);
	release.resolve(); const settled = await result; assert.equal(settled.ok, true); assert.ok(settled.ok && settled.value.created);
	await close; assert.equal(owner.snapshot().receipt, settled.ok ? settled.value : null);
	assert.ok(observed.bytes?.every(value => value === 0)); assert.equal(f.workflow.snapshot().draft, entry.draft);
	assert.deepEqual(f.ledger().photos, beforePhotos);
});
