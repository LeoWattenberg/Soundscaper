/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoCatalogQueryV1, photoQueryDigestV1, readPhotoQueryContinuationV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { projectPhotoQueryRowV1, readPhotoQueryBuildStateV1, readPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-index-v1.ts';
import { matchesNormalizedPhotoQuerySubjectV1, matchesPhotoQueryV1, normalizePhotoSmartQueryV1 } from '../src/lightscaper/catalog/smart-query.ts';
import { queryPhotoV1, queryScaleFixtureRowV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

test('optimized scale seed is byte-for-byte identical to production projection at varied golden positions', () => {
	for (const index of [0, 1, 2, 3, 27, 28, 996, 997, 998, 65_536, 99_700, 99_999]) {
		assert.deepEqual(queryScaleFixtureRowV1(index), projectPhotoQueryRowV1(queryPhotoV1(index)));
		assert.deepEqual(readPhotoQueryRowV1(queryScaleFixtureRowV1(index)), queryScaleFixtureRowV1(index));
		assert.ok(new TextEncoder().encode(JSON.stringify(queryScaleFixtureRowV1(index))).byteLength <= 2_048);
	}
});

test('maximal legal authored text and memberships fit the derived row bound without truncation', () => {
	const words = 'ࠀ'.repeat(16_384);
	const ids = Array.from({ length: 1_024 }, (_, index) => `k-${String(index).padStart(4, '0')}-${'x'.repeat(121)}`);
	const photo = normalizePhotoDocumentV1({ ...queryPhotoV1(), keywordIds: ids, collectionIds: ids,
		metadata: { ...queryPhotoV1().metadata, title: words, caption: words, creator: words, location: words } });
	const row = projectPhotoQueryRowV1(photo);
	assert.equal(row.caption, words); assert.deepEqual(row.keywordIds, ids);
	assert.equal(row.collectionIds.length, 1_024);
	assert.ok(new TextEncoder().encode(JSON.stringify(row)).byteLength <= 524_288);
	assert.equal(Object.hasOwn(row, 'original'), false); assert.equal(Object.hasOwn(row, 'versions'), false);
});

test('persisted row readers refuse future fields, shadowed projections and accessors without invocation', () => {
	const row = projectPhotoQueryRowV1(queryPhotoV1()); let invoked = 0;
	assert.throws(() => readPhotoQueryRowV1({ ...row, schemaVersion: 2 }), /future/iu);
	assert.throws(() => readPhotoQueryRowV1({ ...row, develop: {} }), /unsupported/iu);
	assert.throws(() => readPhotoQueryRowV1({ ...row, fileNameSort: 'forged' }), /projection/iu);
	assert.throws(() => readPhotoQueryRowV1({ ...row, keywordIds: ['keyword', 'keyword'] }), /duplicate/iu);
	assert.throws(() => readPhotoQueryRowV1({ ...row, get title() { invoked++; return 'bad'; } }), /data property/iu);
	assert.equal(invoked, 0);
	assert.throws(() => readPhotoQueryBuildStateV1({ id: 'catalog', schemaVersion: 2, ready: true, afterKey: null, indexedCount: 0 }, 'catalog'), /future/iu);
	assert.throws(() => readPhotoQueryBuildStateV1({ id: 'catalog', schemaVersion: 1, ready: false, afterKey: 'other|photo', indexedCount: 0 }, 'catalog'), /catalog/iu);
});

test('canonical query identities and cursor contracts preserve sort, folding and unknown-time buckets', () => {
	const query = normalizePhotoCatalogQueryV1({ text: 'Café', sort: { field: 'capture-time', direction: 'descending' } });
	assert.deepEqual(normalizePhotoCatalogQueryV1(query), query);
	const token = { schemaVersion: 1, catalogId: 'catalog', indexRevision: 4, querySha256: photoQueryDigestV1(query), captureBucket: 1, afterKey: ['catalog', 1, '', 'photo-1'] };
	assert.deepEqual(readPhotoQueryContinuationV1(token, 'catalog', query), token);
	assert.throws(() => readPhotoQueryContinuationV1({ ...token, afterKey: ['catalog', 1, '2026-01-01T00:00:00.000', 'photo-1'] }, 'catalog', query), /invent/iu);
	assert.throws(() => readPhotoQueryContinuationV1({ ...token, afterKey: ['catalog', 0, '', 'photo-1'] }, 'catalog', query), /bucket/iu);
	assert.throws(() => normalizePhotoCatalogQueryV1({ sort: { field: 'random', direction: 'ascending' } }), /unsupported/iu);
});

test('shared smart predicate projection matches document evaluation across nested operators and missing captures', () => {
	const queries = [
		{ kind: 'all', terms: [{ kind: 'rating', minimum: 2, maximum: 5 }, { kind: 'keyword', id: 'keyword' }] },
		{ kind: 'any', terms: [{ kind: 'flag', value: 'reject' }, { kind: 'label', value: 'none' }] },
		{ kind: 'not', term: { kind: 'folder', id: 'folder' } },
		{ kind: 'file-name', contains: 'IMAGE' },
		{ kind: 'capture-time', from: '2026-01-05T00:00:00', to: '2026-01-20T00:00:00' },
	];
	for (let index = 0; index < 50; index++) {
		const photo = queryPhotoV1(index); const row = projectPhotoQueryRowV1(photo);
		for (const query of queries) assert.equal(matchesNormalizedPhotoQuerySubjectV1({ ...row.summary, keywordIds: row.keywordIds }, normalizePhotoSmartQueryV1(query)), matchesPhotoQueryV1(photo, query));
	}
});
