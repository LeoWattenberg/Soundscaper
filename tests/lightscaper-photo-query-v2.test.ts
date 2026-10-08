/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePhotoCatalogQueryV1, readPhotoQueryContinuationV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { migratePhotoCatalogQueryV1ToV2, normalizePhotoCatalogQueryV2, photoQueryDigestV2,
	PHOTO_QUERY_LIMITS_V2, readPhotoQueryContinuationV2, serializePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';

const predicate = { kind: 'all', terms: [
	{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' },
	{ kind: 'number', column: 'iso', minimum: 400, maximum: 1600 },
	{ kind: 'text', column: 'copyright', operator: 'contains', value: 'Photographer' },
] };

test('V2 catalog queries admit conjunctive metadata filters without changing legacy text and sort', () => {
	const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'CAFÉ',
		filter: { kind: 'rating', value: 3 }, sort: { field: 'capture-time', direction: 'descending' }, predicate });
	assert.equal(query.text, 'café'); assert.deepEqual(query.predicate, predicate);
	assert.deepEqual(query.filter, { kind: 'rating', value: 3 });
	assert.deepEqual(query.sort, { field: 'capture-time', direction: 'descending' });
	assert.deepEqual(normalizePhotoCatalogQueryV2(query), query);
	assert.ok(Object.isFrozen(query)); assert.ok(Object.isFrozen(query.predicate));
	assert.deepEqual(JSON.parse(serializePhotoCatalogQueryV2(query)) as unknown, query);
});

test('the explicit V1 adapter preserves old defaults and refuses successor input in the old reader', () => {
	const original = normalizePhotoCatalogQueryV1({ text: 'Café', filter: { kind: 'rating', value: 3 },
		sort: { field: 'capture-time', direction: 'descending' } });
	assert.equal(JSON.stringify(original), '{"text":"café","filter":{"kind":"rating","value":3},"sort":{"field":"capture-time","direction":"descending"}}');
	const migrated = migratePhotoCatalogQueryV1ToV2(original);
	assert.deepEqual(migrated, { schemaVersion: 2, kind: 'photo-catalog-query', ...original, predicate: null });
	assert.deepEqual(migratePhotoCatalogQueryV1ToV2(), normalizePhotoCatalogQueryV2());
	assert.throws(() => normalizePhotoCatalogQueryV1(migrated), /unsupported/iu);
	assert.throws(() => migratePhotoCatalogQueryV1ToV2(migrated), /unsupported/iu);
	assert.throws(() => normalizePhotoCatalogQueryV2(original), /required/iu);
});

test('query digests and continuations bind every metadata rule and both revision fences', () => {
	const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', predicate });
	const next = { schemaVersion: 2, kind: 'photo-query', catalogId: 'catalog', catalogRevision: 4,
		indexRevision: 7, querySha256: photoQueryDigestV2(query), captureBucket: 0, afterKey: ['catalog', 'photo-64'] };
	assert.deepEqual(readPhotoQueryContinuationV2(next, 'catalog', query), next);
	const changed = normalizePhotoCatalogQueryV2({ ...query, predicate: { kind: 'number', column: 'iso', minimum: 401, maximum: 1600 } });
	assert.notEqual(photoQueryDigestV2(query), photoQueryDigestV2(changed));
	assert.throws(() => readPhotoQueryContinuationV2(next, 'catalog', changed), /another.*query/iu);
	assert.throws(() => readPhotoQueryContinuationV2(next, 'other', query), /another.*catalog/iu);
	assert.throws(() => readPhotoQueryContinuationV2({ ...next, catalogRevision: -1 }, 'catalog', query), /revision/iu);
	assert.throws(() => readPhotoQueryContinuationV2({ ...next, indexRevision: -1 }, 'catalog', query), /revision/iu);
	assert.throws(() => readPhotoQueryContinuationV1(next, 'catalog', migratePhotoCatalogQueryV1ToV2()), /unsupported/iu);
});

test('unknown captures stay in their final bucket in both directions without invented dates', () => {
	for (const direction of ['ascending', 'descending'] as const) {
		const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query',
			sort: { field: 'capture-time', direction } });
		const next = { schemaVersion: 2, kind: 'photo-query', catalogId: 'catalog', catalogRevision: 4,
			indexRevision: 7, querySha256: photoQueryDigestV2(query), captureBucket: 1, afterKey: ['catalog', 1, '', 'photo-64'] };
		assert.deepEqual(readPhotoQueryContinuationV2(next, 'catalog', query), next);
		assert.throws(() => readPhotoQueryContinuationV2({ ...next, afterKey: ['catalog', 1, '2026-10-08T00:00:00.000', 'photo-64'] }, 'catalog', query), /invent/iu);
		assert.throws(() => readPhotoQueryContinuationV2({ ...next, afterKey: ['catalog', 0, '', 'photo-64'] }, 'catalog', query), /bucket/iu);
	}
});

test('closed V2 query and cursor admission rejects foreign fields, versions and accessors without invoking them', () => {
	const query = normalizePhotoCatalogQueryV2(); let invoked = 0;
	assert.throws(() => normalizePhotoCatalogQueryV2({ ...query, schemaVersion: 3 }), /future/iu);
	assert.throws(() => normalizePhotoCatalogQueryV2({ ...query, kind: 'script' }), /kind/iu);
	assert.throws(() => normalizePhotoCatalogQueryV2({ ...query, rawExif: true }), /unsupported/iu);
	assert.throws(() => normalizePhotoCatalogQueryV2({ ...query, get predicate() { invoked++; return predicate; } }), /data property/iu);
	const next = { schemaVersion: 2, kind: 'photo-query', catalogId: 'catalog', catalogRevision: 0,
		indexRevision: 0, querySha256: photoQueryDigestV2(query), captureBucket: 0, afterKey: null };
	assert.throws(() => readPhotoQueryContinuationV2({ ...next, schemaVersion: 3 }, 'catalog', query), /future/iu);
	assert.throws(() => readPhotoQueryContinuationV2({ ...next, kind: 'collapsed-photo-query' }, 'catalog', query), /foreign/iu);
	assert.throws(() => readPhotoQueryContinuationV2({ ...next, pending: null }, 'catalog', query), /unsupported/iu);
	assert.throws(() => readPhotoQueryContinuationV2({ ...next, get afterKey() { invoked++; return null; } }, 'catalog', query), /data property/iu);
	assert.equal(invoked, 0);
	assert.equal(PHOTO_QUERY_LIMITS_V2.candidates, 64); assert.equal(PHOTO_QUERY_LIMITS_V2.rebuildPhotos, 16);
	assert.equal(PHOTO_QUERY_LIMITS_V2.rebuildBytes, 8 * 1024 * 1024);
	assert.equal(PHOTO_QUERY_LIMITS_V2.maximumContinuationBytes, 4096);
});
