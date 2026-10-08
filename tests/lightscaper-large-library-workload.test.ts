/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import {
	PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC,
	PHOTO_LARGE_LIBRARY_PNG_BASE64_V1,
	createLargeLibraryPhotoBatchV1,
	largeLibraryPhotoIdV1,
} from '../src/lightscaper/quality/large-library-workload-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

function template() {
	const bytes = new Uint8Array(Buffer.from(PHOTO_LARGE_LIBRARY_PNG_BASE64_V1, 'base64'));
	const source = photoArchiveFixture(1, bytes).photo;
	return normalizePhotoDocumentV1({ ...source, original: { ...source.original, width: 2, height: 2 } });
}

test('large-library media geometry and bytes are digest-pinned independently of synthetic row generation', () => {
	const bytes = Buffer.from(PHOTO_LARGE_LIBRARY_PNG_BASE64_V1, 'base64');
	assert.equal(bytes.byteLength, SPEC.sourceByteLength);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), SPEC.sourceSha256);
	assert.equal(bytes.readUInt32BE(16), SPEC.width); assert.equal(bytes.readUInt32BE(20), SPEC.height);
	assert.equal(SPEC.photoCount, 20_000); assert.equal(SPEC.publicationBatchSize, 16); assert.equal(SPEC.presentationPageSize, 64);
});

test('bounded batches keep one retained original and deterministic photo/master identities while covering distant search and memberships', () => {
	const source = template(), first = createLargeLibraryPhotoBatchV1(source, 0), last = createLargeLibraryPhotoBatchV1(source, 19_992);
	assert.equal(first.length, 16); assert.equal(last.length, 8);
	assert.deepEqual(first, createLargeLibraryPhotoBatchV1(source, 0));
	assert.equal(first[0]!.id, largeLibraryPhotoIdV1(0)); assert.equal(last.at(-1)!.id, largeLibraryPhotoIdV1(19_999));
	assert.equal(first[0]!.metadata.fileName, 'Photo-20000.png'); assert.equal(last.at(-1)!.metadata.fileName, 'Photo-00001.png');
	assert.equal(last.at(-1)!.metadata.title, SPEC.sparseSearchText);
	assert.equal(first[0]!.metadata.title.includes(SPEC.sparseSearchText), false);
	assert.deepEqual(first[0]!.keywordIds, ['landscape']); assert.deepEqual(first[1]!.keywordIds, []);
	assert.deepEqual(first[0]!.collectionIds, ['manual']); assert.deepEqual(first[1]!.collectionIds, []);
	assert.equal(first[0]!.metadata.captureTime, null); assert.deepEqual(first[1]!.metadata.captureTime, { local: '2026-09-02T12:00:00.000', offsetMinutes: null });
	for (const photo of [...first, ...last]) {
		assert.deepEqual(photo.original, source.original); assert.deepEqual(photo.extractedMetadata, source.extractedMetadata);
		assert.deepEqual(photo.versions[0]!.develop, source.versions[0]!.develop);
		assert.equal(photo.activeVersionId, photo.versions[0]!.id); assert.equal(photo.catalogId, source.catalogId);
		assert.equal(photo.revision, 0); assert.ok(Object.isFrozen(photo));
	}
	assert.deepEqual(template(), source);
});

test('full fixture visits every identity exactly once without retaining whole-catalog document arrays', () => {
	const source = template(), identities = new Set<string>(); let count = 0, sparse = 0, keyword = 0, manual = 0;
	for (let offset = 0; offset < SPEC.photoCount; offset += SPEC.publicationBatchSize) {
		const page = createLargeLibraryPhotoBatchV1(source, offset);
		assert.ok(page.length <= SPEC.publicationBatchSize);
		for (const photo of page) {
			assert.equal(identities.has(photo.id), false); identities.add(photo.id); count++;
			if (photo.metadata.title === SPEC.sparseSearchText) sparse++;
			keyword += photo.keywordIds.length; manual += photo.collectionIds.length;
		}
	}
	assert.equal(count, 20_000); assert.equal(sparse, 1); assert.equal(keyword, 10_000); assert.equal(manual, 6_667);
});

test('invalid offsets, source pins, versions and hostile document accessors refuse before producing any fixture page', () => {
	const source = template();
	for (const offset of [-1, 20_000, 0.5, NaN, Infinity, '0']) assert.throws(() => createLargeLibraryPhotoBatchV1(source, offset));
	assert.throws(() => createLargeLibraryPhotoBatchV1({ ...source, revision: 1 }, 0));
	assert.throws(() => createLargeLibraryPhotoBatchV1({ ...source, original: { ...source.original, contentSha256: '0'.repeat(64) } }, 0));
	assert.throws(() => createLargeLibraryPhotoBatchV1({ ...source, original: { ...source.original, width: 1 } }, 0));
	assert.throws(() => createLargeLibraryPhotoBatchV1({ ...source, metadata: { ...source.metadata, caption: 'x'.repeat(16_384) } }, 0), /byte bound/u);
	assert.throws(() => createLargeLibraryPhotoBatchV1({ ...source, versions: [...source.versions, { ...source.versions[0], id: 'copy', kind: 'virtual-copy' }] }, 0));
	let getters = 0;
	const hostile = Object.defineProperty({ ...source }, 'original', { enumerable: true, get: () => { getters++; return source.original; } });
	assert.throws(() => createLargeLibraryPhotoBatchV1(hostile, 0)); assert.equal(getters, 0);
});
