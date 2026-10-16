/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { decodePhotoImageHandoffSourceCurrentV1 } from '../src/lightscaper/controller/photo-image-handoff-decode-current-v1.ts';
import { createPhotoFramescaperHandoffPhotoCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-photo-current-v1.ts';
import { exportPhotoFramescaperCollectionHandoffArchiveCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-archive-current-v1.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { preparePhotoFramescaperHandoffOriginalCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-original-current-v1.ts';
import { readImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { serializeImageHdrOriginalProvenanceV1 } from '../src/common/editor/imaging/image-hdr-original-contract-v1.ts';
import { createFramescaperImageFramePackWithWarningsV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperHdrImageSourceCurrentV1, prepareFramescaperHdrImageOriginalCurrentV1 } from '../src/common/editor/timeline-image-model-hdr-current-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV2 } from '../src/common/editor/photo-library-collection-handoff-port-v2.ts';
import { hdrFrameFixtureCurrentV1, HDR_FRAME_SAMPLES, HDR_FRAME_TIME, hdrFrameDigest } from './helpers/lightscaper-hdr-frame-current-fixture.ts';
import { queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

test('Current forward decode binds generated HDR Original to Source5 and reverse Photo composition without raster decoding', async () => {
	const f = await hdrFrameFixtureCurrentV1(); let rasterOpens = 0;
	const result = await decodePhotoImageHandoffSourceCurrentV1(f.capture, 'forward-hdr', { openImage: async () => { rasterOpens++; throw new Error('HDR must not use a browser raster decoder.'); } });
	assert.equal(rasterOpens, 0); assert.equal(result.source.schemaVersion, 5);
	if (result.source.schemaVersion !== 5) assert.fail('HDR handoff requires explicit Source5.');
	assert.deepEqual(result.source.hdr, f.hdr); assert.deepEqual(result.source.develop, f.source.develop);
	assert.equal(result.source.original.sha256, f.source.original.sha256);
	const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => result.body }, result.source);
	try { await reader.withCanonicalFrame(frame => { assert.deepEqual([...frame.pixels], [...Float32Array.from(HDR_FRAME_SAMPLES)]); }); }
	finally { await reader.closeAndJoin(); }
	const photo = createPhotoFramescaperHandoffPhotoCurrentV1({ source: result.source, catalog: queryCatalogRootV1(),
		ownership: { photoId: 'returned-hdr', originalId: 'returned-original', storageKey: 'returned-storage', masterVersionId: 'returned-master' },
		createdAt: HDR_FRAME_TIME, metadata: f.photo.metadata, extractedMetadata: f.photo.extractedMetadata });
	assert.equal(photo.schemaVersion, 3); assert.equal(photo.original.mimeType, 'image/x-lightscaper-hdr');
	assert.equal(photo.original.contentSha256, f.source.original.sha256); assert.deepEqual(photo.versions[0]!.develop, f.source.develop);
});

test('Current reverse proves a real HDR Original just above64MiB without widening the permanent raster metadata reader', { timeout: 30_000 }, async () => {
	const f = await hdrFrameFixtureCurrentV1(), width = 4096, height = 1366;
	const before = readImageHdrOriginalV1(f.original).provenance;
	const provenance = { ...before, inputs: before.inputs.map(input => ({ ...input, original: { ...input.original, width, height } })),
		output: { x: 0, y: 0, width, height } };
	const metadata = new TextEncoder().encode(serializeImageHdrOriginalProvenanceV1(provenance)), payloadOffset = Math.ceil((64 + metadata.length) / 4) * 4, payloadBytes = width * height * 12;
	const bytes = new Uint8Array(payloadOffset + payloadBytes), header = new DataView(bytes.buffer), cache = new Uint8Array(width * height * 4);
	bytes.set(new TextEncoder().encode('LSCHDRF1')); bytes.set(metadata, 64);
	for (const [offset, value] of [[8, 64], [12, 1], [16, width], [20, height], [24, metadata.length], [28, payloadBytes]]) header.setUint32(offset!, value!, true);
	bytes.set(Uint8Array.from(Buffer.from(hdrFrameDigest(metadata), 'hex')), 32);
	for (let at = 3; at < cache.length; at += 4) cache[at] = 255;
	const hdr = { ...f.hdr, descriptor: { ...f.descriptor, width, height }, pixelsSha256: hdrFrameDigest(bytes.subarray(payloadOffset)), metadataSha256: hdrFrameDigest(metadata) };
	const pack = await createFramescaperImageFramePackWithWarningsV1({ original: bytes, receipt: { schemaVersion: 1, kind: 'hdr-original', hdr }, width, height,
		timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: cache }] }, { maximumOriginalBytes: 196 * 1024 * 1024 });
	try {
		assert.ok(bytes.length > 64 * 1024 * 1024); assert.ok(bytes.length < 65 * 1024 * 1024);
		const source = normalizeFramescaperHdrImageSourceCurrentV1({ ...f.source, contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength,
			conversionReceiptSha256: pack.conversionReceiptSha256, original: { ...f.source.original, sha256: pack.originalSha256, byteLength: bytes.length },
			canonical: { ...f.source.canonical, width, height }, developed: { width, height }, hdr,
			provenance: { ...f.source.provenance, original: { ...f.source.provenance.original, sha256: pack.originalSha256, byteLength: bytes.length } } });
		const plan = prepareFramescaperHdrImageOriginalCurrentV1(source);
		assert.ok(BigInt(source.assetByteLength) * 3n + plan.decodeWorkingBytes < 1024n * 1024n * 1024n);
		const result = await preparePhotoFramescaperHandoffOriginalCurrentV1({ source, originalBlob: new Blob([bytes], { type: source.original.mimeType! }), canonicalFrameSha256: hdr.pixelsSha256 });
		assert.equal(result.originalBlob.size, bytes.length); assert.equal(result.originalBlob.type, 'image/x-lightscaper-hdr');
		assert.equal(result.metadata.orientation, 1); assert.equal(result.metadata.cameraModel, null); assert.equal(result.extractedMetadata.container, 'unsupported');
	} finally { bytes.fill(0); cache.fill(0); pack.bytes.fill(0); }
});

test('Current collection handoff preserves genuine HDR bodies, order and native Source5 frames through archive import', async t => {
	const f = await hdrFrameFixtureCurrentV1(), signal = new AbortController().signal, binding = { catalogId: f.photo.catalogId, collectionId: 'hdr-collection', scope: 'catalog' as const, expectedCatalogRevision: 7 };
	const reads: string[] = [], capture: PhotoLibraryCollectionHandoffPortV2 = { async withCapture(request, consume) {
		assert.deepEqual(request, binding);
		return consume({ schemaVersion: 2, signal, collection: { catalogId: binding.catalogId, id: binding.collectionId, scope: binding.scope,
			name: 'HDR order', catalogRevision: 7, indexRevision: 7, definitionRevision: null, definitionJson: '{}' },
			photos: [{ binding: f.binding, factsJson: f.factsJson, original: f.capture.original }], lutReferences: [], maskRasterReferences: [],
			async withOriginal(photoId, accept) { reads.push(photoId); return accept(f.capture.originalBlob); },
			withLutBytes: async () => assert.fail('No LUT declared.'), withMaskRasterBytes: async () => assert.fail('No brush declared.') });
	} };
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false }); t.after(() => store.close());
	let id = 0; const exported = await exportPhotoFramescaperCollectionHandoffArchiveCurrentV1({ capture, binding }, { createId: () => `hdr-collection-${++id}`, now: () => HDR_FRAME_TIME });
	assert.equal(exported.photoCount, 1); assert.deepEqual(reads, [f.photo.id]);
	const project = cloneFramescaperProject(PROFILE, (await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(exported.blob, store)).project);
	const source = project.sources.find(value => value.kind === 'image'); assert.ok(source?.kind === 'image' && source.schemaVersion === 5);
	assert.deepEqual(source.hdr, f.hdr); assert.equal(source.original.sha256, f.source.original.sha256);
	const reader = await openFramescaperCurrentImageFrameSource(store, source);
	try { await reader.withCanonicalFrame(frame => { assert.deepEqual([...frame.pixels], [...Float32Array.from(HDR_FRAME_SAMPLES)]); }); }
	finally { await reader.closeAndJoin(); }
});
