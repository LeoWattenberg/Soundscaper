/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoLibraryMetadataSnapshotV2 } from '../src/lightscaper/controller/photo-library-metadata-v2.ts';
import { readPhotoLibraryMetadataSnapshotV1 } from '../src/lightscaper/controller/photo-library-metadata.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

test('mixed metadata presentation retains exact old bytes and carries no document recipes or original custody', () => {
	const legacy = queryPhotoV1(), develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'neutral', type: 'cube-lut-profile-v1', enabled: true, params: { lut: null } }] };
	const current = normalizePhotoDocumentV2({ ...legacy, schemaVersion: 2, versions: legacy.versions.map(version => ({ ...version, develop })) });
	const expected = readPhotoLibraryMetadataSnapshotV1(legacy);
	assert.equal(JSON.stringify(readPhotoLibraryMetadataSnapshotV2(legacy)), JSON.stringify(expected));
	assert.deepEqual(readPhotoLibraryMetadataSnapshotV2(current), expected);
	assert.deepEqual(Object.keys(expected).sort(), ['extracted', 'metadata', 'originalFileName', 'originalSha256', 'photoId', 'revision']);
	assert.throws(() => readPhotoLibraryMetadataSnapshotV1(current));
});

test('metadata presentation proves the whole mixed photo before projecting scalar fields', () => {
	const legacy = queryPhotoV1();
	for (const value of [{ ...legacy, schemaVersion: 3 }, { ...legacy, schemaVersion: 2, versions: [{ ...legacy.versions[0], develop: { processVersion: 99 } }] },
		Object.defineProperty({ ...legacy }, 'versions', { enumerable: true, get() { assert.fail('Recipe getter invoked'); } })]) {
		assert.throws(() => readPhotoLibraryMetadataSnapshotV2(value));
	}
});
