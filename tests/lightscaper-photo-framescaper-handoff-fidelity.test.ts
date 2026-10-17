/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { exportPhotoFramescaperHandoffArchiveV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-archive-v1.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { metadataCrc32 } from '../src/common/editor/imaging/image-metadata-binary.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { OpenFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const WIDTH = 4, HEIGHT = 3;
const PIXELS = Uint8Array.from(Array.from({ length: WIDTH * HEIGHT }, (_, index) =>
	[32 + index * 11, 192 - index * 7, 64 + index * 9, index % WIDTH === 1 ? 127 : 255]).flat());
const PNG = encodedPng();
const ORIGINAL_NAME = 'Cafe\u0301 untouched.PNG';
const LUT_BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const LUT_SHA = createHash('sha256').update(LUT_BODY).digest('hex');
const LUT_REFERENCE = Object.freeze({ storageKey: `lut-sha256:${LUT_SHA}`, sha256: LUT_SHA, byteLength: LUT_BODY.byteLength, size: 2,
	domainMin: Object.freeze([0, 0, 0] as const), domainMax: Object.freeze([1, 1, 1] as const) });

for (const mode of ['legacy', 'disabled-lut', 'active-lut'] as const) test(`Light ${mode} archive opens as an editable still with the same natural developed pixels`, async context => {
	const processVersion = mode === 'legacy' ? 1 : 2, native = mediaRestoreFixture(), databaseName = `lightscaper-frame-fidelity-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `${databaseName}-media`, locks: null, preferOpfs: false });
	const resources = await media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: `${databaseName}-catalog`,
		verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	const base = photoArchiveFixture(1, PNG).photo, originalDevelop = defaultPhotoDevelopV1();
	const effects = [createVideoEffect('point-curves-v1', { id: 'saved-curve', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }),
		createVideoEffect('develop-geometry-v1', { id: 'saved-geometry', params: { cropHeight: .5, flipVertical: 1 } })];
	if (processVersion === 2) effects.unshift({ id: 'saved-profile', type: 'cube-lut-profile-v1', enabled: mode === 'active-lut', params: { lut: LUT_REFERENCE } });
	const develop = { ...originalDevelop, processVersion, effects,
		geometry: { crop: { x: .25, y: 0, width: .5, height: 1 }, rotationDegrees: 90, flipHorizontal: true, flipVertical: false } };
	const photo = normalizePhotoDocumentV1OrV2({ ...base, schemaVersion: processVersion,
		original: { ...base.original, name: ORIGINAL_NAME, width: WIDTH, height: HEIGHT, hasAlpha: true }, activeVersionId: 'saved-copy',
		versions: [{ ...base.versions[0]!, develop: { ...originalDevelop, processVersion } },
			{ id: 'saved-copy', kind: 'virtual-copy', name: 'Saved crop and curve', createdAt: '2026-10-10T00:00:00.000Z', develop }] });
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: photo.catalogId,
		name: 'Sender library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await catalog.createCatalog(root); await media.mediaRepository.writeAsset(photo.original.storageKey, new Blob([PNG], { type: 'image/png' }));
	if (processVersion === 2) await resources.put(LUT_REFERENCE, LUT_BODY);
	await catalog.publishPhotos(root.id, 0, [photo]);
	await media.mediaRepository.catalogOriginals.retain(root.id, [{ photoId: photo.id, assetId: photo.original.storageKey,
		sourceId: photo.original.id, sha256: photo.original.contentSha256, size: PNG.byteLength }]);
	const ports: PhotoLibrarySessionPortsV2 = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, cubeLutResources: async () => resources,
		backup: { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
			loadOriginal: (original, signal) => media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength }) },
		initialize: async () => (await catalog.loadCatalog(root.id))!, exclusive: async (_id, run, signal) => run(signal),
		closeResources: async () => { await Promise.all([catalog.close(), media.close()]); } };
	const session = new PhotoLibrarySessionV2(ports);
	context.after(() => session.close());
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false });
	context.after(() => recipient.close());
	const before = JSON.stringify(await catalog.loadPhoto(root.id, photo.id)), originalBefore = new Uint8Array(await (await media.mediaRepository.loadAsset(photo.original.storageKey))!.arrayBuffer());
	const savedDevelop = photo.versions.find(version => version.id === photo.activeVersionId)!.develop;
	const runtime = createPhotoDevelopRenderRuntimeV2(processVersion === 1 ? {} : { source: resources.source });
	assert.ok(runtime.withFullResolution);
	const signal = new AbortController().signal;
	const light = await runtime.withFullResolution({ signal, frame: { descriptor: { schemaVersion: 1, width: WIDTH, height: HEIGHT,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: PIXELS }, develop: savedDevelop },
		view => ({ width: view.frame.descriptor.width, height: view.frame.descriptor.height, pixels: view.frame.pixels.slice() }));
	assert.deepEqual([light.width, light.height], [3, 1]);
	const golden = mode === 'active-lut' ? [118, 255, 255, 127, 118, 255, 255, 127, 118, 255, 255, 127]
		: [212, 70, 182, 127, 168, 98, 146, 127, 124, 126, 110, 127];
	assert.deepEqual([...light.pixels], golden);
	let decodes = 0, closes = 0;
	// This injected native extraction matches the actual encoded fixture. The
	// admission, frame pack, archive, destination import and both renderers are real.
	const openImage: OpenFramescaperBrowserNativeImageV1 = async request => {
		assert.equal(request.format, 'png'); assert.deepEqual(request.bytes, PNG);
		return { metadata: { width: WIDTH, height: HEIGHT, frameCount: 1, topology: 'single', runtimeVersion: 'encoded-png-injection-fixture' },
			decodeFrame: async () => { decodes++; return { rgba: PIXELS, durationMicroseconds: null }; }, close: () => { closes++; } };
	};
	const archive = await exportPhotoFramescaperHandoffArchiveV1({ capture: session.imageHandoff,
		binding: { catalogId: root.id, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision } }, { openImage });
	assert.ok(archive.fileName.endsWith('.fscape')); assert.equal(decodes, 1); assert.equal(closes, 1);
	const imported = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(archive.blob, recipient);
	assert.equal(imported.readOnly, false); const project = cloneFramescaperProject(PROFILE, imported.project);
	const image = project.sources.find(source => source.kind === 'image'); assert.ok(image); assert.equal(image.schemaVersion, 2);
	if (image.schemaVersion !== 2) assert.fail('The selected saved recipe must remain editable.');
	assert.deepEqual(image.develop, photo.versions.find(version => version.id === photo.activeVersionId)!.develop);
	assert.deepEqual(image.developed, { width: light.width, height: light.height });
	assert.equal(image.provenance.original.exactName, ORIGINAL_NAME);
	if (image.provenance.origin.schemaFamily !== 'lightscaper') assert.fail('The original Lightscaper provenance must survive the editable copy.');
	assert.equal(image.provenance.origin.versionKind, 'virtual-copy');
	const reader = await openFramescaperCurrentImageFrameSource(recipient, image, signal);
	let frame: Uint8Array | null = null;
	try { frame = await reader.readFrame(0); assert.deepEqual(frame, light.pixels); }
	finally { frame?.fill(0); await reader.closeAndJoin(); }
	const packed = new Uint8Array(await (await recipient.loadMediaAsset(image.storageKey))!.arrayBuffer());
	const { develop: _develop, developed: _developed, provenance: _provenance, ...packSource } = image;
	const originalPack = await openFramescaperImageFramePackV1({ source: { ...packSource, schemaVersion: 1 }, read: (offset, length) => packed.slice(offset, offset + length) });
	assert.deepEqual(await originalPack.readOriginal(), PNG); assert.deepEqual(await originalPack.readFrame(0), PIXELS);
	if (processVersion === 2) assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(LUT_REFERENCE.storageKey))!.arrayBuffer()), LUT_BODY);
	assert.equal(JSON.stringify(await catalog.loadPhoto(root.id, photo.id)), before);
	assert.deepEqual(new Uint8Array(await (await media.mediaRepository.loadAsset(photo.original.storageKey))!.arrayBuffer()), originalBefore);
	assert.deepEqual(PIXELS, Uint8Array.from(Array.from({ length: WIDTH * HEIGHT }, (_, index) =>
		[32 + index * 11, 192 - index * 7, 64 + index * 9, index % WIDTH === 1 ? 127 : 255]).flat()));
});

function encodedPng(): Uint8Array<ArrayBuffer> {
	const header = Buffer.alloc(13); header.writeUInt32BE(WIDTH); header.writeUInt32BE(HEIGHT, 4); header.set([8, 6, 0, 0, 0], 8);
	const rows = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
	for (let y = 0; y < HEIGHT; y++) rows.set(PIXELS.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4), y * (WIDTH * 4 + 1) + 1);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}
function chunk(type: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), result = Buffer.alloc(body.byteLength + 8);
	result.writeUInt32BE(data.byteLength); result.set(body, 4); result.writeUInt32BE(metadataCrc32(body), body.byteLength + 4); return result;
}
