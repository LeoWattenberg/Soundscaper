/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoFramescaperHandoffPhotoV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-photo-v1.ts';
import { normalizeFramescaperImageSourceV2, framescaperImageSourceResourceReferencesV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageGeometryVideoEffectV1 } from '../src/common/editor/video-image-geometry-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { emptyPhotoMetadataV1 } from '../src/lightscaper/catalog/photo-metadata.ts';
import { parsePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';

const TIME = '2026-10-10T12:00:00.000Z', SAVED = '2026-10-07T00:00:00.000Z';
const LUT = { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };

/** Scalar admitted source fixtures grant no pack-body or native pixel authority. */
function fixture(processVersion: 1 | 2 = 1, kind: 'master' | 'virtual-copy' | 'frame' = 'master') {
	const effects = [normalizeImageGeometryVideoEffectV1({ id: 'stack-crop', type: 'develop-geometry-v1', enabled: true,
		params: { cropWidth: .5, cropHeight: 1 } }), normalizeImageGeometryVideoEffectV1({ id: 'disabled-rotation', type: 'develop-geometry-v1',
		enabled: false, params: { rotationDegrees: 90 } }), ...(processVersion === 2 ? [
		{ id: 'disabled-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT } }] : [])];
	const develop = normalizeImageDevelopStateV1OrV2({ ...defaultPhotoDevelopV1(), processVersion, effects,
		geometry: { crop: { x: .5, y: 0, width: .5, height: 1 }, rotationDegrees: 90, flipHorizontal: true, flipVertical: false } });
	const origin = kind === 'frame' ? { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'incoming-project', revision: 7,
		sourceId: 'incoming-image', sequenceId: 'incoming-sequence', clipId: 'incoming-clip' } : {
		schemaFamily: 'lightscaper', schemaVersion: processVersion, catalogId: 'incoming-catalog', photoId: 'incoming-photo', revision: 9,
		versionId: 'incoming-version', versionKind: kind, versionName: 'Saved selected recipe', versionCreatedAt: SAVED };
	const source = normalizeFramescaperImageSourceV2({ schemaVersion: 2, kind: 'image', id: 'incoming-image', name: 'Frame display label',
		mimeType: 'application/vnd.framescaper.image-asset', storageKey: 'incoming-image', contentSha256: 'a'.repeat(64), assetByteLength: 1000,
		original: { fileName: 'é.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: 23, sha256: 'b'.repeat(64) },
		canonical: { width: 4, height: 2, hasAlpha: true, frameCount: 1, durationTicks: '5000000', timingMode: 'fallback' },
		conversionReceiptSha256: 'c'.repeat(64), develop, developed: { width: 1, height: 2 },
		provenance: createImageDevelopHandoffProvenanceV1({ origin, original: { exactName: 'e\u0301.png', sha256: 'b'.repeat(64), byteLength: 23 }, develop }) });
	const catalog = { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'destination-catalog', name: 'Destination',
		revision: 3, photoCount: 12, folders: [{ id: 'folder', name: 'Existing', parentId: null }], keywords: [], collections: [] };
	const ownership = { photoId: 'new-photo', originalId: 'new-original', storageKey: 'new-original-body', masterVersionId: 'new-master',
		...(kind === 'virtual-copy' ? { selectedVersionId: 'new-selected-copy' } : {}) };
	return { source, request: { source, catalog, ownership, createdAt: TIME,
		metadata: { ...emptyPhotoMetadataV1('Metadata display.png'), title: 'Authored destination title' },
		extractedMetadata: { schemaVersion: 1, container: 'png', exif: null, iptc: null, issues: [] } } };
}

for (const process of [1, 2] as const) test(`Light Photo${process} master preserves complete saved recipe and original facts with fresh local identities`, () => {
	const f = fixture(process), before = structuredClone(f.request), photo = createPhotoFramescaperHandoffPhotoV1(f.request);
	assert.equal(photo.schemaVersion, process); assert.equal(photo.revision, 0); assert.equal(photo.id, 'new-photo');
	assert.equal(photo.catalogId, 'destination-catalog'); assert.equal(photo.activeVersionId, 'new-master');
	assert.deepEqual(photo.versions, [{ id: 'new-master', kind: 'master', name: 'Saved selected recipe', createdAt: SAVED, develop: f.source.develop }]);
	assert.deepEqual(photo.original, { schemaVersion: 1, kind: 'still', id: 'new-original', name: 'e\u0301.png', mimeType: 'image/png',
		storageKey: 'new-original-body', contentSha256: 'b'.repeat(64), width: 4, height: 2, hasAlpha: true, byteLength: 23, retention: 'managed' });
	assert.deepEqual([photo.folderId, photo.collectionIds, photo.keywordIds, photo.rating, photo.flag, photo.colorLabel], [null, [], [], 0, 'unflagged', 'none']);
	assert.deepEqual(photo.metadata, f.request.metadata); assert.deepEqual(photo.extractedMetadata, f.request.extractedMetadata);
	assert.deepEqual(parsePhotoDocumentV1OrV2(serializePhotoDocumentV1OrV2(photo)), photo); assert.deepEqual(f.request, before);
	assert.ok(Object.isFrozen(photo)); assert.ok(Object.isFrozen(photo.original)); assert.ok(Object.isFrozen(photo.versions[0]!.develop.effects));
	assert.equal(Object.hasOwn(photo, 'source'), false); assert.equal(Object.hasOwn(photo, 'provenance'), false);
});

for (const process of [1, 2] as const) test(`Light selected virtual copy process ${process} retains its role/name/time beside a fresh neutral master`, () => {
	const f = fixture(process, 'virtual-copy'), photo = createPhotoFramescaperHandoffPhotoV1(f.request);
	assert.equal(photo.schemaVersion, process); assert.equal(photo.activeVersionId, 'new-selected-copy');
	assert.deepEqual(photo.versions, [{ id: 'new-master', kind: 'master', name: 'Original', createdAt: TIME, develop: defaultPhotoDevelopV1() },
		{ id: 'new-selected-copy', kind: 'virtual-copy', name: 'Saved selected recipe', createdAt: SAVED, develop: f.source.develop }]);
	const sidecar = createPhotoExportSidecarV1(photo, { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: 0 });
	assert.deepEqual(sidecar.version.develop, f.source.develop); assert.equal(sidecar.version.kind, 'virtual-copy');
	if (process === 2) assert.deepEqual(framescaperImageSourceResourceReferencesV2(f.source), [LUT]);
});

for (const process of [1, 2] as const) test(`Light receive of Frame process ${process} creates one master without invented Photo history`, () => {
	const f = fixture(process, 'frame'), photo = createPhotoFramescaperHandoffPhotoV1(f.request);
	assert.deepEqual(photo.versions, [{ id: 'new-master', kind: 'master', name: 'Frame display label', createdAt: TIME, develop: f.source.develop }]);
	assert.equal(photo.schemaVersion, process); assert.equal(photo.activeVersionId, 'new-master');
});

test('Light process1 selected recipe stays Photo1 even when its origin was Photo2', () => {
	const f = fixture(), origin = f.source.provenance.origin;
	const source = { ...f.source, provenance: { ...f.source.provenance, origin: { ...origin, schemaVersion: 2 } } };
	assert.equal(createPhotoFramescaperHandoffPhotoV1({ ...f.request, source }).schemaVersion, 1);
});

test('Light exact 512-character decomposed original stays independent of bounded metadata and Frame master labels', () => {
	const f = fixture(2, 'frame'), exactName = `e\u0301${'x'.repeat(506)}.png`, source = { ...f.source, name: '😀'.repeat(256),
		original: { ...f.source.original, fileName: exactName.normalize('NFC') },
		provenance: { ...f.source.provenance, original: { ...f.source.provenance.original, exactName } } };
	const photo = createPhotoFramescaperHandoffPhotoV1({ ...f.request, source });
	assert.equal(photo.original.name, exactName); assert.equal(photo.original.name.length, 512);
	assert.equal(photo.metadata.fileName, 'Metadata display.png'); assert.equal(photo.versions[0]!.name, '😀'.repeat(128));
	assert.equal(parsePhotoDocumentV1OrV2(serializePhotoDocumentV1OrV2(photo)).original.name, exactName);
});

test('Light destination facts detach from mutable request data and never inherit collection membership', () => {
	const f = fixture(), result = createPhotoFramescaperHandoffPhotoV1(f.request), expected = serializePhotoDocumentV1OrV2(result);
	f.request.metadata.title = 'Changed'; f.request.catalog.id = 'changed-catalog'; f.request.ownership.photoId = 'changed-photo';
	f.request.source = { ...f.source, name: 'Changed source display' };
	assert.equal(serializePhotoDocumentV1OrV2(result), expected); assert.ok(Object.isFrozen(result.metadata));
	assert.ok(Object.isFrozen(result.extractedMetadata)); assert.deepEqual(result.collectionIds, []);
});

test('Light supplied authored and extracted facts remain separate, including null extracted metadata', () => {
	const f = fixture(), exif = { orientation: 8, cameraMake: 'Encoded camera', cameraModel: null, lensModel: null,
		artist: null, copyright: null, description: null, exposureSeconds: null, aperture: null, iso: 200, focalLengthMm: null,
		captureTime: null, captureTimeRaw: null };
	const metadata = { ...f.request.metadata, cameraMake: 'Authored camera', orientation: 1 };
	const extractedMetadata = { ...f.request.extractedMetadata, exif }, photo = createPhotoFramescaperHandoffPhotoV1({ ...f.request, metadata, extractedMetadata });
	assert.deepEqual(photo.metadata, metadata); assert.deepEqual(photo.extractedMetadata, extractedMetadata);
	assert.ok(Object.isFrozen(photo.extractedMetadata!.exif));
	assert.equal(createPhotoFramescaperHandoffPhotoV1({ ...f.request, extractedMetadata: null }).extractedMetadata, null);
});

test('Light ownership refuses pairwise and incoming Light/Frame identity or retained LUT storage collisions', () => {
	for (const kind of ['master', 'virtual-copy', 'frame'] as const) {
		const f = fixture(2, kind), origin = f.source.provenance.origin;
		const incoming = origin.schemaFamily === 'lightscaper' ? [origin.catalogId, origin.photoId, origin.versionId]
			: [origin.projectId, origin.sourceId, origin.sequenceId, origin.clipId];
		for (const collision of [...incoming, f.source.id, LUT.storageKey, f.request.catalog.id, 'new-original']) {
			assert.throws(() => createPhotoFramescaperHandoffPhotoV1({ ...f.request, ownership: { ...f.request.ownership, photoId: collision } }), /fresh|collision|distinct/iu);
		}
		assert.throws(() => createPhotoFramescaperHandoffPhotoV1({ ...f.request, ownership: { ...f.request.ownership, storageKey: 'new-master' } }), /fresh|collision|distinct/iu);
	}
});

test('Light virtual-copy allocation is required only for a selected virtual copy', () => {
	const copy = fixture(2, 'virtual-copy'), { selectedVersionId: _selected, ...ownership } = copy.request.ownership;
	assert.throws(() => createPhotoFramescaperHandoffPhotoV1({ ...copy.request, ownership }), /selected|field/iu);
	for (const kind of ['master', 'frame'] as const) {
		const f = fixture(2, kind);
		assert.throws(() => createPhotoFramescaperHandoffPhotoV1({ ...f.request, ownership: { ...f.request.ownership, selectedVersionId: 'unused' } }), /selected|field/iu);
	}
});

test('Light natural geometry must match base crop/rotation followed by enabled stack geometry', () => {
	const f = fixture();
	assert.throws(() => createPhotoFramescaperHandoffPhotoV1({ ...f.request, source: { ...f.source, developed: { width: 2, height: 2 } } }), /natural|geometry/iu);
	assert.deepEqual(createPhotoFramescaperHandoffPhotoV1(f.request).versions[0]!.develop, f.source.develop);
});

test('Light disabled conflicting LUT references refuse rather than disappear from the recipe', () => {
	const f = fixture(2), develop = { ...f.source.develop, effects: [...f.source.develop.effects,
		{ id: 'conflicting-disabled-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: { ...LUT, byteLength: 89 } } }] };
	const source = { ...f.source, develop, provenance: createImageDevelopHandoffProvenanceV1({ origin: f.source.provenance.origin,
		original: f.source.provenance.original, develop }) };
	assert.throws(() => createPhotoFramescaperHandoffPhotoV1({ ...f.request, source }), /resource.*conflict/iu);
});

test('Light bound masks explicitly refuse without flattening or discarding them', () => {
	const f = fixture(), develop = { ...f.source.develop, masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'node', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'node' }],
		maskBindings: [{ effectId: 'stack-crop', maskId: 'mask' }] };
	const source = { ...f.source, develop, provenance: createImageDevelopHandoffProvenanceV1({ origin: f.source.provenance.origin,
		original: f.source.provenance.original, develop }) };
	assert.throws(() => createPhotoFramescaperHandoffPhotoV1({ ...f.request, source }), /mask/iu);
});

test('Light legacy/future/nonstatic source and future process are refused', () => {
	const f = fixture();
	for (const source of [{ ...f.source, schemaVersion: 1 }, { ...f.source, schemaVersion: 3 },
		{ ...f.source, canonical: { ...f.source.canonical, frameCount: 2 } }, { ...f.source, develop: { ...f.source.develop, processVersion: 3 } },
		{ ...f.source, original: { ...f.source.original, recognizedFormat: 'svg' } }]) {
		assert.throws(() => createPhotoFramescaperHandoffPhotoV1({ ...f.request, source }));
	}
});

test('Light closed request/ownership and metadata refuse native authority and accessors without invoking them', () => {
	const f = fixture(); let calls = 0;
	const getter = { ...f.request }; Object.defineProperty(getter, 'source', { get() { calls++; return f.source; } });
	assert.throws(() => createPhotoFramescaperHandoffPhotoV1(getter)); assert.equal(calls, 0);
	for (const request of [{ ...f.request, originalBlob: new Blob() }, { ...f.request, provenance: f.source.provenance },
		{ ...f.request, ownership: { ...f.request.ownership, generation: 1 } }, { ...f.request, catalog: { ...f.request.catalog, schemaVersion: 2 } },
		{ ...f.request, metadata: { ...f.request.metadata, opaqueGPS: {} } }, { ...f.request, extractedMetadata: { ...f.request.extractedMetadata, schemaVersion: 2 } },
		{ ...f.request, source: { ...f.source, original: { ...f.source.original, mimeType: null } } }, { ...f.request, createdAt: 'not-a-time' }]) {
		assert.throws(() => createPhotoFramescaperHandoffPhotoV1(request));
	}
});
