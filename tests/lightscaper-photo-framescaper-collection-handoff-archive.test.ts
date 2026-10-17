/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { exportPhotoFramescaperCollectionHandoffArchiveV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-archive-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV1 } from '../src/common/editor/photo-library-collection-handoff-port-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { createPhotoCubeLutClosureV1 } from '../src/lightscaper/catalog/photo-cube-lut-closure-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { metadataCrc32 } from '../src/common/editor/imaging/image-metadata-binary.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const PIXELS = Uint8Array.of(0, 0, 0, 255), PNG = encodedPng();
const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

async function fixture(count = 3, originalBytes = PNG) {
	const native = mediaRestoreFixture(), base = photoArchiveFixture(1, originalBytes), name = `lightscaper-collection-archive-${crypto.randomUUID()}`;
	const photos = Array.from({ length: count }, (_, index) => {
		const version = base.photo.versions[0]!, processVersion = index === 0 ? 1 : 2;
		const develop = { ...version.develop, processVersion, effects: index === 0 ? [] : [
			{ id: 'saved-lut', type: 'cube-lut-profile-v1', enabled: index === 1, params: { lut: LUT_REFERENCE } },
			...(index === 1 ? [createVideoEffect('point-curves-v1', { id: 'saved-curve', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } })] : []),
		] };
		return normalizePhotoDocumentV1OrV2({ ...base.photo, id: `photo-${String(index).padStart(4, '0')}`, schemaVersion: processVersion,
			collectionIds: ['selected'], activeVersionId: `version-${String(index)}`,
			versions: [{ ...version, id: `version-${String(index)}`, name: `Saved ${String(index)}`, develop }] });
	});
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `${name}-media`, preferOpfs: false, locks: null });
	const resources = await media.getCubeLutResources(); await resources.put(LUT_REFERENCE, LUT_BODY);
	await media.mediaRepository.writeAsset(base.photo.original.storageKey, base.original);
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: `${name}-catalog`, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: base.photo.catalogId,
		name: 'Unchanged sending library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [
			{ kind: 'manual', id: 'selected', name: 'Ordered collection' },
			{ kind: 'manual', id: 'empty', name: 'Empty collection' },
		] });
	if (photos.length) {
		await catalog.publishPhotos(base.photo.catalogId, 0, photos);
		await media.mediaRepository.catalogOriginals.retain(base.photo.catalogId, photos.map(photo => ({ photoId: photo.id,
			assetId: photo.original.storageKey, sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
	}
	while (!(await catalog.rebuildQueryIndexPageV2(base.photo.catalogId)).ready) { /* Existing bounded index owner. */ }
	const ports: PhotoLibrarySessionPortsV2 = { catalog, journal: media.settingsRepository,
		media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		backup: { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
			loadOriginal: (original, signal) => media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength }) },
		cubeLutResources: async () => resources, initialize: async () => (await catalog.loadCatalog(base.photo.catalogId))!,
		exclusive: async (_id, run, signal) => run(signal), closeResources: async () => { await catalog.close(); await media.close(); } };
	const session = new PhotoLibrarySessionV2(ports); assert.ok(session.collectionHandoff);
	const root = (await catalog.loadCatalog(base.photo.catalogId))!;
	const binding = { catalogId: root.id, collectionId: 'selected', scope: 'catalog' as const, expectedCatalogRevision: root.revision };
	const events: string[] = [];
	// Literal native extraction for Node custody/lifecycle controls only. The
	// PNG, admission, pack producer, Scape writer/importer and renderers are real.
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		assert.deepEqual(request.bytes, originalBytes); events.push('open');
		return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'literal-png-node-fixture' },
			decodeFrame: async () => { events.push('decode'); return { rgba: PIXELS, durationMicroseconds: null }; }, close: () => { events.push('close'); } };
	};
	let ids = 0;
	return { native, name, photos, media, catalog, session, binding, events, openImage,
		request: { capture: session.collectionHandoff, binding }, deps: { openImage, createId: () => `collection-${String(++ids)}`, now: () => '2026-10-11T00:00:00.000Z' },
		change(photo: unknown, photoId = photos[photos.length - 1]!.id) { native.raw(`${name}-catalog`).seedRecord(`${name}-catalog`, 'photos', { key: `${root.id}|${photoId}`, document: photo }); },
		corruptLut() { native.raw(`${name}-media`).seedRecord(`${name}-media`, 'analysis', { key: LUT_REFERENCE.storageKey,
			value: { schemaVersion: 1, kind: 'photo-cube-lut-body', reference: LUT_REFERENCE, bytes: new Uint8Array(LUT_BODY.length) } }); } };
}

test('Light collection archive imports real distinct editable placements and preserves shared original, recipes and sender', async () => {
	const f = await fixture(), recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	const before = JSON.stringify(await f.catalog.readSnapshot(f.binding.catalogId));
	try {
		const result = await exportPhotoFramescaperCollectionHandoffArchiveV1(f.request, f.deps);
		assert.ok(Object.isFrozen(result)); assert.equal(result.fileName, 'Ordered collection.fscape'); assert.equal(result.photoCount, 3);
		assert.equal(result.projectId, 'collection-1'); assert.equal(result.sequenceId, 'collection-2'); assert.ok(result.blob.size <= 256 * 1024 * 1024);
		const imported = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(result.blob, recipient);
		assert.equal(imported.readOnly, false); const project = cloneFramescaperProject(PROFILE, imported.project);
		assert.equal(project.title, 'Ordered collection'); assert.equal(project.primarySequenceId, result.sequenceId);
		assert.equal(project.sources.length, 3); assert.equal(project.clips.length, 3); assert.equal(new Set(project.sources.map(source => source.id)).size, 3);
		const imageClips = project.clips.map(clip => { if (clip.kind !== 'image') assert.fail('An actual image clip is required.'); return clip; });
		assert.deepEqual(imageClips.map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount]), [[0, 150], [150, 150], [300, 150]]);
		assert.deepEqual(project.tracks[0]!.clipIds, project.clips.map(clip => clip.id));
		for (const [index, value] of project.sources.entries()) {
			const source = normalizeFramescaperImageSourceV2(value), photo = f.photos[index]!;
			assert.deepEqual(source.develop, photo.versions[0]!.develop); assert.equal(source.provenance.original.exactName, photo.original.name);
			assert.equal(source.provenance.origin.schemaFamily, 'lightscaper');
			if (source.provenance.origin.schemaFamily !== 'lightscaper') assert.fail('Actual Light provenance is required.');
			assert.equal(source.provenance.origin.photoId, photo.id);
			const body = (await recipient.loadMediaAsset(source.storageKey))!, bytes = new Uint8Array(await body.arrayBuffer());
			const { develop: _develop, developed: _developed, provenance: _provenance, ...pack } = source;
			const raw = await openFramescaperImageFramePackV1({ source: { ...pack, schemaVersion: 1 }, read: (offset, length) => bytes.subarray(offset, offset + length) });
			assert.deepEqual(await raw.readOriginal(), PNG); const original = await raw.readFrame(0); assert.deepEqual(original, PIXELS); original.fill(0);
			const reader = await openFramescaperCurrentImageFrameSource(recipient, source, new AbortController().signal);
			try { const pixels = await reader.readFrame(0); assert.deepEqual([...pixels], index === 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]); pixels.fill(0); }
			finally { await reader.closeAndJoin(); bytes.fill(0); }
		}
		assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(LUT_REFERENCE.storageKey))!.arrayBuffer()), LUT_BODY);
		assert.equal(JSON.stringify(await f.catalog.readSnapshot(f.binding.catalogId)), before);
		assert.deepEqual(new Uint8Array(await (await f.media.mediaRepository.loadAsset(f.photos[0]!.original.storageKey))!.arrayBuffer()), PNG);
		assert.deepEqual(f.events, Array.from({ length: 3 }, () => ['open', 'decode', 'close']).flat()); assert.deepEqual([...PIXELS], [0, 0, 0, 255]);
	} finally { await f.session.close(); await recipient.close(); }
});

test('Light collection archive pins bindings, capability receivers and dependencies before capture yields', async () => {
	const f = await fixture(1), entered = deferred<void>(), release = deferred<void>(), target = f.request.capture;
	const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(...args) { assert.equal(this, capture); entered.resolve(); await release.promise; return target.withCapture(...args); } };
	const binding = { ...f.binding }, deps = { ...f.deps }, work = exportPhotoFramescaperCollectionHandoffArchiveV1({ capture, binding }, deps);
	try { await entered.promise; binding.collectionId = 'missing'; capture.withCapture = async () => { throw Symbol('replaced capture'); };
		deps.createId = () => 'replaced'; deps.now = () => 'invalid'; deps.openImage = async () => { throw Symbol('replaced native'); };
		release.resolve(); assert.equal((await work).projectId, 'collection-1');
	} finally { release.resolve(); await f.session.close(); }
});

test('Light collection archive pins the default native UUID method before held capture yields', async () => {
	const f = await fixture(1), entered = deferred<void>(), release = deferred<void>(), target = f.request.capture;
	const prior = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
	const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(...args) { entered.resolve(); await release.promise; return target.withCapture(...args); } };
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	const restore = () => { if (prior) Object.defineProperty(crypto, 'randomUUID', prior); else Reflect.deleteProperty(crypto, 'randomUUID'); };
	const work = exportPhotoFramescaperCollectionHandoffArchiveV1({ capture, binding: f.binding }, { openImage: f.openImage, now: f.deps.now });
	try {
		await entered.promise; let substituted = 0;
		Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => `substituted-${String(++substituted)}` }); release.resolve();
		const result = await work; restore();
		const project = (await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(result.blob, recipient)).project;
		for (const value of [...project.sources, ...project.clips]) assert.match(value.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
	} finally { restore(); release.resolve(); await f.session.close(); await recipient.close(); }
});

test('Light collection archive cancellation joins native decode and selected Session retirement', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = new Proxy({}, {});
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; return native.decodeFrame(0); } }; };
	const work = exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, signal: stop.signal }, { ...f.deps, openImage });
	const refused = assert.rejects(work, error => error === reason);
	try { await entered.promise; stop.abort(reason); const closing = f.session.close(); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); await refused; await closing; assert.deepEqual(f.events, ['open', 'decode', 'close']);
	} finally { release.resolve(); await f.session.close(); }
});

test('Light collection archive refuses complete same-revision facts drift after decode without a prefix', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; return native.decodeFrame(0); } }; };
	const work = exportPhotoFramescaperCollectionHandoffArchiveV1(f.request, { ...f.deps, openImage }), refused = assert.rejects(work, /changed/iu);
	try { await entered.promise; const photo = f.photos[2]!; f.change(normalizePhotoDocumentV1OrV2({ ...photo, metadata: { ...photo.metadata, title: 'Changed while held' } }));
		release.resolve(); await refused;
	} finally { release.resolve(); await f.session.close(); }
});

test('Light collection archive refuses corrupt disabled LUT and empty collection before native work', async () => {
	const f = await fixture();
	try { await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, binding: { ...f.binding, collectionId: 'empty' } }, f.deps), /empty|source|photo/iu);
		f.corruptLut(); await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1(f.request, f.deps)); assert.deepEqual(f.events, []);
	} finally { await f.session.close(); }
});

test('Light collection archive refuses external mask inputs before decoding any photo', async () => {
	const f = await fixture(2), photo = f.photos[1]!, version = photo.versions[0]!;
	f.change(normalizePhotoDocumentV1OrV2({ ...photo, versions: [{ ...version, develop: { ...version.develop,
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'Body', sourceRef: 'body', kind: 'raster' }], outputNodeId: 'raster',
			nodes: [{ id: 'raster', kind: 'raster', inputName: 'Body', channel: 'luma' }] }],
		maskBindings: [{ effectId: 'saved-lut', maskId: 'mask' }] } }] }));
	try { await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1(f.request, f.deps), /external|input/iu); assert.deepEqual(f.events, []); }
	finally { await f.session.close(); }
});

test('Light collection archive retains a masked recipe and LUT and renders from the original after actual import', async () => {
	const f = await fixture(2), photo = f.photos[1]!, version = photo.versions[0]!;
	const changed = normalizePhotoDocumentV1OrV2({ ...photo, versions: [{ ...version, develop: { ...version.develop,
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'gradient',
			nodes: [{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] }],
		maskBindings: [{ effectId: 'saved-curve', maskId: 'mask' }] } }] });
	f.change(changed);
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	try {
		const result = await exportPhotoFramescaperCollectionHandoffArchiveV1(f.request, f.deps);
		const imported = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(result.blob, recipient);
		const project = cloneFramescaperProject(PROFILE, imported.project), source = normalizeFramescaperImageSourceV2(project.sources[1]);
		assert.deepEqual(source.develop, changed.versions[0]!.develop);
		const reader = await openFramescaperCurrentImageFrameSource(recipient, source, new AbortController().signal);
		try {
			const pixels = await reader.readFrame(0);
			try { assert.deepEqual([...pixels], [188, 188, 188, 255]); } finally { pixels.fill(0); }
		}
		finally { await reader.closeAndJoin(); }
		assert.equal(source.original.sha256, photo.original.contentSha256);
	} finally { await recipient.close(); await f.session.close(); }
});

test('Light collection archive refuses own getter requests and mutated native signals before capture', async () => {
	const f = await fixture(); let getters = 0;
	try { const deps = Object.defineProperty({}, 'openImage', { enumerable: true, get() { getters++; return f.openImage; } });
		await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1(f.request, deps));
		await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1(Object.create(f.request) as typeof f.request, f.deps));
		const signal = Object.defineProperty(new AbortController().signal, 'reason', { get() { getters++; return undefined; } });
		await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, signal }, f.deps)); assert.equal(getters, 0); assert.deepEqual(f.events, []);
	} finally { await f.session.close(); }
});

test('Light collection archive requires one actual joined capture delivery and rejects a fabricated transport result', async () => {
	const f = await fixture(1), capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture() { return { blob: new Blob(), fileName: 'forged.fscape' } as never; } };
	try { await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, f.deps), /deliver/iu); assert.deepEqual(f.events, []); }
	finally { await f.session.close(); }
});

test('Light collection archive joins an ignored callback and refuses reentrant capture delivery before second decode', async () => {
	const f = await fixture(1), target = f.request.capture, entered = deferred<void>(), release = deferred<void>();
	const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => { const work = consume(view); assert.throws(() => consume(view), /exactly one/iu); void Promise.resolve(work); return undefined as never; }, options);
	} };
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; return native.decodeFrame(0); } }; };
	const work = exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, { ...f.deps, openImage });
	try { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); assert.equal((await work).photoCount, 1); assert.deepEqual(f.events, ['open', 'decode', 'close']); }
	finally { release.resolve(); await f.session.close(); }
});

test('Light collection archive joins ignored decode refusal and preserves distinct opaque transport failures', async () => {
	const f = await fixture(1), target = f.request.capture, entered = deferred<void>(), release = deferred<void>(), primary = new Proxy({}, {}), nativeFailure = Symbol('native');
	const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, async view => { void Promise.resolve(consume(view)).catch(() => undefined); await entered.promise; throw primary; }, options);
	} };
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; throw nativeFailure; } }; };
	const work = exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, { ...f.deps, openImage });
	const refused = assert.rejects(work, error => {
		// The real selected Session also joins its forgotten original child.
		// Keep that aggregate intact, with both exact opaque causes retained.
		return error instanceof AggregateError && error.errors[1] === nativeFailure && error.cause instanceof AggregateError
			&& error.errors[0] === error.cause && error.cause.cause === primary && error.cause.errors[0] === primary && error.cause.errors[1] === nativeFailure;
	});
	try { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); await refused; assert.deepEqual(f.events, ['open', 'close']); }
	finally { release.resolve(); await f.session.close(); }
});

test('Light collection archive admits captured scalar facts and resource closure without invoking accessors', async () => {
	for (const nested of [false, true]) {
		const f = await fixture(1), target = f.request.capture; let getters = 0;
		const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(binding, consume, options) {
			return target.withCapture(binding, view => consume(nested ? { ...view, photos: [{ ...view.photos[0]!,
				original: Object.defineProperty({ ...view.photos[0]!.original }, 'exactName', { enumerable: true, get() { getters++; return view.photos[0]!.original.exactName; } }) }] }
				: Object.defineProperty({ ...view }, 'photos', { enumerable: true, get() { getters++; return view.photos; } })), options);
		} };
		try { await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, f.deps)); assert.equal(getters, 0); assert.deepEqual(f.events, []); }
		finally { await f.session.close(); }
	}
});

test('Light collection archive pins each original reader and independently joins its ignored native work', async () => {
	const f = await fixture(1), target = f.request.capture, entered = deferred<void>(), release = deferred<void>();
	const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => {
			const mutable = { ...view, withOriginal: async <Value>(photoId: string, borrower: (body: Blob) => Value | Promise<Value>) => {
				assert.equal(photoId, view.photos[0]!.binding.photoId); await view.withOriginal(photoId, body => { void Promise.resolve(borrower(body)); return undefined as never; }); return undefined as Value;
			} };
			const work = consume(mutable); mutable.withOriginal = async () => { throw Symbol('late reader'); }; return work;
		}, options);
	} };
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; return native.decodeFrame(0); } }; };
	const work = exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, { ...f.deps, openImage });
	try { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); assert.equal((await work).photoCount, 1); }
	finally { release.resolve(); await f.session.close(); }
});

test('Light collection archive refuses missing original callback and inconsistent saved projection before native work', async () => {
	for (const mode of ['no-body', 'facts'] as const) {
		const f = await fixture(1), target = f.request.capture;
		const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(binding, consume, options) {
			return target.withCapture(binding, view => consume(mode === 'no-body' ? { ...view, withOriginal: async () => undefined as never }
				: { ...view, photos: [{ ...view.photos[0]!, binding: { ...view.photos[0]!.binding, photoId: 'foreign-photo' } }] }), options);
		} };
		try { await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, f.deps)); assert.deepEqual(f.events, []); }
		finally { await f.session.close(); }
	}
});

test('Light collection archive binds original reader receiver and rejects duplicate body delivery', async () => {
	const f = await fixture(1), target = f.request.capture;
	const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => {
			const scoped = { ...view, withOriginal: async function <Value>(this: unknown, photoId: string, borrower: (body: Blob) => Value | Promise<Value>) {
				assert.equal(this, scoped);
				return view.withOriginal(photoId, body => { const work = borrower(body); assert.throws(() => borrower(body), /exactly one/iu); return work; });
			} };
			return consume(scoped);
		}, options);
	} };
	try { assert.equal((await exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, f.deps)).photoCount, 1);
		assert.deepEqual(f.events, ['open', 'decode', 'close']); }
	finally { await f.session.close(); }
});

test('Light collection archive independently caps disabled LUT bytes and actual file inventory before decoding', async () => {
	for (const mode of ['bytes', 'entries'] as const) {
		const f = await fixture(1), target = f.request.capture;
		const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(binding, consume, options) {
			return target.withCapture(binding, view => {
				if (mode === 'entries') return consume({ ...view, photos: Array.from({ length: 4_095 }, () => view.photos[0]!) });
				const photo = view.photos[0]!, facts = parsePhotoExportSidecarV1(photo.factsJson), effects = Array.from({ length: 9 }, (_, index) => {
					const sha256 = index.toString(16).padStart(64, '0'); return { id: `lut-${String(index)}`, type: 'cube-lut-profile-v1', enabled: false,
						params: { lut: { ...LUT_REFERENCE, storageKey: `lut-sha256:${sha256}`, sha256, byteLength: 16_777_216 } } };
				});
				const develop = { ...facts.version.develop, processVersion: 2, effects }, closure = createPhotoCubeLutClosureV1(); closure.addDevelop(develop);
				return consume({ ...view, photos: [{ ...photo, factsJson: serializePhotoExportSidecarV1({ ...facts, photoSchemaVersion: 2, version: { ...facts.version, develop } }) }], lutReferences: closure.finish() });
			}, options);
		} };
		try { await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, f.deps), /capacity|entries|length/iu); assert.deepEqual(f.events, []); }
		finally { await f.session.close(); }
	}
});

test('Light collection archive pins and caches one joined LUT reader with its native receiver', async () => {
	const f = await fixture(3), target = f.request.capture; let reads = 0;
	const capture: PhotoLibraryCollectionHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => {
			const scoped = { ...view, withLutBytes: async function <Value>(this: unknown, reference: typeof LUT_REFERENCE,
				borrower: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>) {
				assert.equal(this, scoped); reads++;
				return view.withLutBytes(reference, bytes => { const work = borrower(bytes); assert.throws(() => borrower(bytes), /exactly one/iu); void Promise.resolve(work); return undefined as Value; });
			} };
			const work = consume(scoped); scoped.withLutBytes = async () => { throw Symbol('late LUT reader'); }; return work;
		}, options);
	} };
	try { assert.equal((await exportPhotoFramescaperCollectionHandoffArchiveV1({ ...f.request, capture }, f.deps)).photoCount, 3); assert.equal(reads, 1); }
	finally { await f.session.close(); }
});

test('Light collection archive counts repeated actual pack entries beyond the capture unique-original limit', async () => {
	const original = encodedPng(32 * 1024 * 1024), f = await fixture(4, original);
	try { await assert.rejects(exportPhotoFramescaperCollectionHandoffArchiveV1(f.request, f.deps), /capacity/iu);
		assert.deepEqual(f.events, Array.from({ length: 4 }, () => ['open', 'decode', 'close']).flat());
		assert.equal((await f.media.mediaRepository.loadAsset(f.photos[0]!.original.storageKey))!.size, original.byteLength);
	} finally { await f.session.close(); }
});

function encodedPng(padding = 0): Uint8Array<ArrayBuffer> {
	const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6, 0, 0, 0], 8);
	const scanline = Buffer.from([0, ...PIXELS]);
	let compressed = deflateSync(scanline);
	if (padding) {
		// Genuine DEFLATE empty stored blocks enlarge image data without adding
		// metadata or changing the one literal pixel. The independent inflater
		// proves the padded capacity fixture remains an actual valid PNG stream.
		const stored = deflateSync(scanline, { level: 0 }), empty = Buffer.alloc(Math.ceil(padding / 5) * 5);
		stored[2] = 0;
		for (let offset = 0; offset < empty.length; offset += 5) { empty[offset + 3] = 255; empty[offset + 4] = 255; }
		empty[empty.length - 5] = 1;
		compressed = Buffer.concat([stored.subarray(0, -4), empty, stored.subarray(-4)]);
		assert.deepEqual(inflateSync(compressed), scanline);
	}
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
		chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]));
}
function chunk(type: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), bytes = Buffer.alloc(body.byteLength + 8);
	bytes.writeUInt32BE(data.byteLength); bytes.set(body, 4); bytes.writeUInt32BE(metadataCrc32(body), body.byteLength + 4); return bytes;
}
