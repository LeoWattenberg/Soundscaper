/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { promotePhotoFramescaperImageSourceV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-source-v1.ts';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';

const NEUTRAL = { processVersion: 1, effects: [], masks: [], maskBindings: [],
	geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false } };

/** Scalar fixtures carry no authenticated pack, original or pixel authority. */
function fixture(format = 'png', mimeType: string | null = 'image/png') {
	const source = normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind: 'image', id: 'frame-source', name: 'Stored display name',
		mimeType: 'application/vnd.framescaper.image-asset', storageKey: 'frame-source', contentSha256: 'a'.repeat(64), assetByteLength: 1000,
		original: { fileName: 'é.png', mimeType, recognizedFormat: format, byteLength: 23, sha256: 'b'.repeat(64) },
		canonical: { width: 4, height: 2, hasAlpha: true, frameCount: 1, durationTicks: '5000000', timingMode: 'fallback' },
		conversionReceiptSha256: 'c'.repeat(64) });
	const origin = { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'actual-project', revision: 7,
		sourceId: source.id, sequenceId: 'actual-sequence', clipId: 'actual-bin-clip' };
	return { source, origin };
}

test('Light ordinary still promotion preserves the unchanged pack and genuine supplied Frame context with a neutral recipe', () => {
	const request = fixture(), before = structuredClone(request), result = promotePhotoFramescaperImageSourceV1(request);
	assert.deepEqual(result, { ...request.source, schemaVersion: 2, develop: NEUTRAL, developed: { width: 4, height: 2 },
		provenance: createImageDevelopHandoffProvenanceV1({ origin: request.origin, original: { exactName: 'é.png', sha256: 'b'.repeat(64), byteLength: 23 }, develop: NEUTRAL }) });
	assert.deepEqual(result.provenance.origin, request.origin); assert.deepEqual(request, before);
	assert.deepEqual(normalizeFramescaperImageSourceV2(result), result);
	assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.develop.geometry)); assert.ok(Object.isFrozen(result.provenance.original));
	assert.equal(Object.hasOwn(result, 'originalBlob'), false); assert.equal(Object.hasOwn(result, 'canonicalFrameSha256'), false);
});

for (const format of ['png', 'jpeg', 'gif', 'webp', 'bmp']) test(`Light ordinary ${format} promotion derives a canonical MIME projection without changing the archived hint`, () => {
	for (const hint of [null, 'application/octet-stream', `image/${format}`]) {
		const request = fixture(format, hint), result = promotePhotoFramescaperImageSourceV1(request);
		assert.equal(result.original.mimeType, `image/${format}`); assert.equal(request.source.original.mimeType, hint);
		assert.deepEqual(result.original, { ...request.source.original, mimeType: `image/${format}` });
		assert.equal(result.contentSha256, request.source.contentSha256); assert.equal(result.conversionReceiptSha256, request.source.conversionReceiptSha256);
	}
});

test('Light ordinary promotion retains only the stored NFC filename, without inventing pre-ingest spelling', () => {
	const request = fixture(), result = promotePhotoFramescaperImageSourceV1(request);
	assert.equal(result.provenance.original.exactName, 'é.png'); assert.notEqual(result.provenance.original.exactName, 'e\u0301.png');
	assert.throws(() => promotePhotoFramescaperImageSourceV1({ ...request, source: { ...request.source,
		original: { ...request.source.original, fileName: 'e\u0301.png' } } }), /canonical safe text/iu);
});

test('Light ordinary promotion refuses animation, unsupported formats, authored stills and successor sources', () => {
	const request = fixture();
	for (const source of [{ ...request.source, canonical: { ...request.source.canonical, frameCount: 2 } },
		{ ...request.source, original: { ...request.source.original, recognizedFormat: 'tiff' } },
		{ ...request.source, kind: 'still' }, { ...request.source, schemaVersion: 2 }]) {
		assert.throws(() => promotePhotoFramescaperImageSourceV1({ ...request, source }));
	}
});

test('Light ordinary promotion requires complete Frame provenance bound to the selected source', () => {
	const request = fixture();
	for (const origin of [{ ...request.origin, sourceId: 'another-source' }, { ...request.origin, clipId: undefined },
		{ ...request.origin, sequenceId: undefined }, { ...request.origin, schemaVersion: 2 }, { ...request.origin, invented: true },
		{ schemaFamily: 'lightscaper', schemaVersion: 1, catalogId: 'catalog', photoId: 'photo', revision: 0,
			versionId: 'master', versionKind: 'master', versionName: 'Original', versionCreatedAt: '2026-10-10T12:00:00.000Z' }]) {
		assert.throws(() => promotePhotoFramescaperImageSourceV1({ ...request, origin }));
	}
});

test('Light ordinary promotion snapshots scalar facts and refuses getters, inherited requests and unknown fields', () => {
	const request = structuredClone(fixture()); let reads = 0;
	const result = promotePhotoFramescaperImageSourceV1(request);
	request.origin.clipId = 'late'; Object.defineProperty(request.source.original, 'fileName', { value: 'Late.png' });
	assert.equal(result.provenance.origin.schemaFamily, 'framescaper');
	assert.deepEqual(result.provenance.origin, { ...fixture().origin }); assert.equal(result.original.fileName, 'é.png');
	for (const invalid of [Object.create(request) as unknown, { ...request, native: {} },
		Object.defineProperty({ ...request }, 'source', { get() { reads++; return request.source; } }),
		{ ...request, origin: Object.defineProperty({ ...request.origin }, 'clipId', { get() { reads++; return 'fake'; } }) },
		{ ...request, source: Object.defineProperty({ ...request.source }, 'original', { get() { reads++; return request.source.original; } }) }]) {
		assert.throws(() => promotePhotoFramescaperImageSourceV1(invalid));
	}
	assert.equal(reads, 0);
});

test('Light ordinary promotion retains static alpha and dimensions without supplying decode or timeline composition facts', () => {
	const request = fixture();
	for (const hasAlpha of [false, true]) {
		const source = { ...request.source, canonical: { ...request.source.canonical, hasAlpha, width: 8192, height: 2048 } };
		const result = promotePhotoFramescaperImageSourceV1({ ...request, source });
		assert.deepEqual(result.canonical, source.canonical); assert.deepEqual(result.developed, { width: 8192, height: 2048 });
		assert.deepEqual(result.develop, NEUTRAL);
	}
});
