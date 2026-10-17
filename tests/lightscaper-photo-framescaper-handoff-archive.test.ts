/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { exportPhotoFramescaperHandoffArchiveV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-archive-v1.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import type { PhotoLibraryImageHandoffPortV1, PhotoLibraryImageHandoffViewV1 } from '../src/common/editor/photo-library-image-handoff-port-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { createPhotoCubeLutClosureV1 } from '../src/lightscaper/catalog/photo-cube-lut-closure-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

async function fixture(processVersion: 1 | 2 = 2, enabled = false) {
	const native = mediaRestoreFixture(), base = photoArchiveFixture(1, PNG), name = `lightscaper-handoff-archive-${crypto.randomUUID()}`;
	const version = base.photo.versions[0]!, photo = normalizePhotoDocumentV1OrV2({ ...base.photo, schemaVersion: processVersion,
		versions: [{ ...version, develop: { ...version.develop, processVersion,
			effects: processVersion === 2 ? [{ id: 'saved-lut', type: 'cube-lut-profile-v1', enabled, params: { lut: LUT_REFERENCE } }] : [] } }] });
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `${name}-media`, preferOpfs: false, locks: null });
	const resources = await media.getCubeLutResources(); await resources.put(LUT_REFERENCE, LUT_BODY);
	await media.mediaRepository.writeAsset(photo.original.storageKey, base.original);
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: `${name}-catalog`, verifyOriginal: media.verifyOriginal,
		verifyResources: (value, signal) => resources.verifyPhoto(value, signal) });
	await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: photo.catalogId, name: 'Sender', revision: 0,
		photoCount: 0, folders: [], keywords: [], collections: [] }); await catalog.publishPhotos(photo.catalogId, 0, [photo]);
	const ports: PhotoLibrarySessionPortsV2 = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, backup: { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
			loadOriginal: (original, signal) => media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength }) },
		cubeLutResources: async () => resources, initialize: async () => (await catalog.loadCatalog(photo.catalogId))!, exclusive: async (_id, run, signal) => run(signal),
		closeResources: async () => { await catalog.close(); await media.close(); } };
	const session = new PhotoLibrarySessionV2(ports); assert.ok(session.imageHandoff);
	const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	const events: string[] = [], pixels = Uint8Array.of(23, 71, 149, 255);
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		events.push('open'); assert.deepEqual(request.bytes, PNG);
		return { metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'native-injection-fixture' },
			decodeFrame: async () => { events.push('decode'); return { rgba: pixels, durationMicroseconds: null }; }, close: () => { events.push('close'); } };
	};
	let ids = 0;
	return { session, catalog, media, resources, photo, binding, events, pixels, openImage,
		request: { capture: session.imageHandoff, binding }, deps: { openImage, createId: () => `handoff-${String(++ids)}`, now: () => '2026-10-10T00:00:00.000Z' },
		corruptLut() { native.raw(`${name}-media`).seedRecord(`${name}-media`, 'analysis', { key: LUT_REFERENCE.storageKey,
			value: { schemaVersion: 1, kind: 'photo-cube-lut-body', reference: LUT_REFERENCE, bytes: new Uint8Array(LUT_BODY.length) } }); },
		change(value: unknown) { native.raw(`${name}-catalog`).seedRecord(`${name}-catalog`, 'photos', { key: `${photo.catalogId}|${photo.id}`, document: value }); } };
}

for (const [processVersion, enabled] of [[1, false], [2, false], [2, true]] as const) test(`Light Photo${processVersion} editable archive opens with ${processVersion === 1 ? 'legacy recipe' : enabled ? 'active saved LUT' : 'disabled saved LUT'} and unchanged sender`, async () => {
	const f = await fixture(processVersion, enabled), before = JSON.stringify(await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id));
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	try { const result = await exportPhotoFramescaperHandoffArchiveV1(f.request, f.deps);
		assert.ok(Object.isFrozen(result)); assert.equal(result.fileName, 'Photo 1.fscape'); assert.equal(result.projectId, 'handoff-1');
		assert.equal(result.blob.type, 'application/vnd.soundscaper.scape+zip');
		const imported = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(result.blob, recipient); assert.equal(imported.readOnly, false);
		const loaded = await recipient.loadProject(result.projectId); assert.ok(loaded); const project = cloneFramescaperProject(PROFILE, loaded); assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 1);
		const image = normalizeFramescaperImageSourceV2(project.sources[0]); assert.deepEqual(image.develop, f.photo.versions[0]!.develop);
		assert.equal(image.provenance.original.exactName, f.photo.original.name); assert.deepEqual(image.developed, { width: 1, height: 1 });
		const body = await recipient.loadMediaAsset(image.storageKey); assert.ok(body); const bytes = new Uint8Array(await body.arrayBuffer());
		const { develop: _develop, developed: _developed, provenance: _provenance, ...pack } = image;
		const reader = await openFramescaperImageFramePackV1({ source: { ...pack, schemaVersion: 1 }, read: (offset, length) => bytes.slice(offset, offset + length) });
		assert.deepEqual(await reader.readOriginal(), PNG); assert.deepEqual(await reader.readFrame(0), f.pixels);
		if (processVersion === 2) assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(LUT_REFERENCE.storageKey))!.arrayBuffer()), LUT_BODY);
		else assert.equal(await recipient.loadMediaAsset(LUT_REFERENCE.storageKey), null);
		assert.equal(JSON.stringify(await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id)), before);
		assert.deepEqual(new Uint8Array(await (await f.media.mediaRepository.loadAsset(f.photo.original.storageKey))!.arrayBuffer()), PNG);
		assert.deepEqual(f.events, ['open', 'decode', 'close']);
	} finally { await f.session.close(); await recipient.close(); }
});

test('Light archive pins the caller binding, capture receiver and dependency methods before yielding', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), target = f.request.capture;
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(...args) { assert.equal(this, capture); entered.resolve(); await release.promise; return target.withCapture(...args); } };
	const binding = { ...f.binding }, deps = { ...f.deps }, work = exportPhotoFramescaperHandoffArchiveV1({ capture, binding }, deps);
	try { await entered.promise; binding.photoId = 'changed'; capture.withCapture = async () => { throw Symbol('late capture'); };
		deps.openImage = async () => { throw Symbol('late decoder'); }; deps.createId = () => 'late-id'; deps.now = () => 'invalid';
		release.resolve(); assert.equal((await work).projectId, 'handoff-1');
	} finally { release.resolve(); await f.session.close(); }
});

test('Light archive cancellation joins a held native decode and Session close before refusing', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('cancel-handoff');
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; return native.decodeFrame(0); } }; };
	const work = exportPhotoFramescaperHandoffArchiveV1({ ...f.request, signal: stop.signal }, { ...f.deps, openImage });
	const refused = assert.rejects(work, error => error === reason);
	try { await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); const closing = f.session.close(); assert.equal(await remainsPending(closing), true);
		release.resolve(); await refused; await closing; assert.deepEqual(f.events, ['open', 'decode', 'close']);
	} finally { release.resolve(); await f.session.close(); }
});

test('Light archive refuses saved facts drift after native decode and never returns an archive', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; return native.decodeFrame(0); } }; };
	const work = exportPhotoFramescaperHandoffArchiveV1(f.request, { ...f.deps, openImage }); const refused = assert.rejects(work, /changed/iu);
	try { await entered.promise; f.change(normalizePhotoDocumentV1OrV2({ ...f.photo, metadata: { ...f.photo.metadata, title: 'Changed while held' } }));
		release.resolve(); await refused; assert.deepEqual(f.events, ['open', 'decode', 'close']);
	} finally { release.resolve(); await f.session.close(); }
});

test('Light archive refuses corrupt disabled LUT custody before any decoder work', async () => {
	const f = await fixture();
	try { f.corruptLut();
		await assert.rejects(exportPhotoFramescaperHandoffArchiveV1(f.request, f.deps)); assert.deepEqual(f.events, []);
	} finally { await f.session.close(); }
});

test('Light archive rejects accessor, inherited and native-signal shadows without invoking host work', async () => {
	const f = await fixture(); let getters = 0;
	try { const deps = Object.defineProperty({}, 'openImage', { enumerable: true, get() { getters++; return f.openImage; } });
		await assert.rejects(exportPhotoFramescaperHandoffArchiveV1(f.request, deps));
		await assert.rejects(exportPhotoFramescaperHandoffArchiveV1(Object.create(f.request) as typeof f.request, f.deps));
		const signal = Object.defineProperty(new AbortController().signal, 'reason', { get() { getters++; return undefined; } });
		await assert.rejects(exportPhotoFramescaperHandoffArchiveV1({ ...f.request, signal }, f.deps));
		assert.equal(getters, 0); assert.deepEqual(f.events, []);
	} finally { await f.session.close(); }
});

test('Light archive requires an actual authenticated callback delivery instead of a transport return', async () => {
	const f = await fixture(), capture: PhotoLibraryImageHandoffPortV1 = { async withCapture() { return { blob: new Blob(), fileName: 'forged.fscape', projectId: 'forged' } as never; } };
	try { await assert.rejects(exportPhotoFramescaperHandoffArchiveV1({ ...f.request, capture }, f.deps), /deliver/iu); assert.deepEqual(f.events, []); }
	finally { await f.session.close(); }
});

test('Light archive independently joins an ignored held callback and returns only its real result', async () => {
	const f = await fixture(1), entered = deferred<void>(), release = deferred<void>(), target = f.request.capture;
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => { void Promise.resolve(consume(view)); return undefined as never; }, options);
	} };
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; return native.decodeFrame(0); } }; };
	const work = exportPhotoFramescaperHandoffArchiveV1({ ...f.request, capture }, { ...f.deps, openImage });
	try { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); const result = await work;
		assert.equal(result.projectId, 'handoff-1'); assert.ok(result.blob.size > 0); assert.deepEqual(f.events, ['open', 'decode', 'close']);
	} finally { release.resolve(); await f.session.close(); }
});

test('Light archive refuses callback view accessors before any getter or native work', async () => {
	const f = await fixture(), target = f.request.capture; let getters = 0;
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => consume(Object.defineProperty({ ...view }, 'factsJson', { enumerable: true, get() { getters++; return view.factsJson; } })), options);
	} };
	try { await assert.rejects(exportPhotoFramescaperHandoffArchiveV1({ ...f.request, capture }, f.deps)); assert.equal(getters, 0); assert.deepEqual(f.events, []); }
	finally { await f.session.close(); }
});


test('Light archive refuses duplicate capture delivery before a second native acquisition', async () => {
	const f = await fixture(1), target = f.request.capture;
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => { const work = consume(view);
			assert.throws(() => consume(view), /exactly one/iu); return work; }, options);
	} };
	try { await exportPhotoFramescaperHandoffArchiveV1({ ...f.request, capture }, f.deps); assert.deepEqual(f.events, ['open', 'decode', 'close']); }
	finally { await f.session.close(); }
});

test('Light archive joins ignored native failure and preserves distinct opaque capture transport failure', async () => {
	const f = await fixture(1), entered = deferred<void>(), release = deferred<void>(), target = f.request.capture;
	const primary = new Proxy({}, { ownKeys() { throw new Error('Do not reflect transport.'); } });
	const nativeFailure = new Proxy({}, { ownKeys() { throw new Error('Do not reflect native failure.'); } });
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, async view => { void Promise.resolve(consume(view)).catch(() => undefined);
			await entered.promise; throw primary; }, options);
	} };
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => { const native = await f.openImage(request);
		return { ...native, decodeFrame: async () => { entered.resolve(); await release.promise; throw nativeFailure; } }; };
	const work = exportPhotoFramescaperHandoffArchiveV1({ ...f.request, capture }, { ...f.deps, openImage });
	const refusal = assert.rejects(work, error => error instanceof AggregateError && error.cause === primary
		&& error.errors.length === 2 && error.errors[0] === primary && error.errors[1] === nativeFailure);
	try { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); await refusal;
		assert.deepEqual(f.events, ['open', 'close']); }
	finally { release.resolve(); await f.session.close(); }
});

test('Light archive refuses an inactive saved version even when the actual Session admits its capture', async () => {
	const f = await fixture(1), version = f.photo.versions[0]!;
	f.change(normalizePhotoDocumentV1OrV2({ ...f.photo, versions: [...f.photo.versions, { ...version, id: 'saved-copy', kind: 'virtual-copy' }] }));
	try { await assert.rejects(exportPhotoFramescaperHandoffArchiveV1({ ...f.request, binding: { ...f.binding, versionId: 'saved-copy' } }, f.deps), /active/iu);
		assert.deepEqual(f.events, []); }
	finally { await f.session.close(); }
});

test('Light archive bounds the entire unique disabled LUT closure before decoder or archive copies', async () => {
	const f = await fixture(), target = f.request.capture;
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => { const facts = parsePhotoExportSidecarV1(view.factsJson);
			const effects = Array.from({ length: 9 }, (_, index) => { const sha256 = index.toString(16).padStart(64, '0');
				return { id: `lut-${String(index)}`, type: 'cube-lut-profile-v1', enabled: false,
					params: { lut: { ...LUT_REFERENCE, sha256, storageKey: `lut-sha256:${sha256}`, byteLength: 16_777_216 } } }; });
			const develop = { ...facts.version.develop, processVersion: 2, effects };
			const closure = createPhotoCubeLutClosureV1(); closure.addDevelop(develop);
			return consume({ ...view, factsJson: serializePhotoExportSidecarV1({ ...facts, version: { ...facts.version, develop } }), lutReferences: closure.finish() });
		}, options);
	} };
	try { await assert.rejects(exportPhotoFramescaperHandoffArchiveV1({ ...f.request, capture }, f.deps), /capacity/iu); assert.deepEqual(f.events, []); }
	finally { await f.session.close(); }
});

test('Light archive admits captured LUT identity without invoking nested reference getters', async () => {
	const f = await fixture(), target = f.request.capture; let getters = 0;
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => consume({ ...view, lutReferences: [Object.defineProperty({ ...LUT_REFERENCE }, 'byteLength',
			{ enumerable: true, get() { getters++; return LUT_REFERENCE.byteLength; } })] }), options);
	} };
	try { await assert.rejects(exportPhotoFramescaperHandoffArchiveV1({ ...f.request, capture }, f.deps)); assert.equal(getters, 0); assert.deepEqual(f.events, []); }
	finally { await f.session.close(); }
});


test('Light archive pins captured facts and forwards a private native lifetime before later transport shadows', async () => {
	const f = await fixture(1), target = f.request.capture; let getters = 0;
	const retained: { view?: PhotoLibraryImageHandoffViewV1 } = {};
	const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(binding, consume, options) {
		return target.withCapture(binding, view => { const mutable = { ...view }; retained.view = mutable; return consume(mutable); }, options);
	} };
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		assert.ok(retained.view);
		const signal = retained.view.signal;
		Object.defineProperty(signal, 'aborted', { configurable: true, get() { getters++; throw Symbol('late signal getter'); } });
		Object.defineProperty(retained.view, 'factsJson', { configurable: true, enumerable: true, get() { getters++; throw Symbol('late facts getter'); } });
		return await f.openImage(request);
	};
	try { const result = await exportPhotoFramescaperHandoffArchiveV1({ ...f.request, capture }, { ...f.deps, openImage });
		assert.ok(result.blob.size > 0); assert.equal(getters, 0); assert.deepEqual(f.events, ['open', 'decode', 'close']); }
	finally { await f.session.close(); }
});
