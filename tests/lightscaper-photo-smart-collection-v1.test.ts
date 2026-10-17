/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PHOTO_QUERY_LIMITS_V2, normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { PHOTO_SMART_QUERY_LIMITS_V2 } from '../src/lightscaper/catalog/photo-smart-query-types-v2.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1, normalizePhotoSmartCollectionV1, photoSmartCollectionSummaryV1,
	readPhotoSmartCollectionSummaryV1, serializePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoSmartCollectionsStateV1, serializePhotoSmartCollectionsStateV1 } from '../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1, photoSmartCollectionKeyV1, photoSmartCollectionRecordV1,
	photoSmartCollectionReferenceKeyV1, readPhotoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';

function definition(query: unknown = { schemaVersion: 2, kind: 'photo-catalog-query' }) {
	return { schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog', id: 'collection', revision: 0,
		name: 'Camera selection', query };
}
function query(predicate: unknown, filter: unknown = null) {
	return { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Keyword Name', filter,
		sort: { field: 'capture-time', direction: 'descending' }, predicate };
}
function bytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function deepFrozen(value: unknown): boolean {
	if (value === null || typeof value !== 'object') return true;
	return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

test('saved collection retains the complete canonical catalog query, not a predicate-only conversion', () => {
	const predicate = { kind: 'all', terms: [{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' },
		{ kind: 'number', column: 'iso', minimum: 100, maximum: 400 }] };
	const input = definition(query(predicate, { kind: 'collection', id: 'legacy-root-collection' }));
	const normalized = normalizePhotoSmartCollectionV1(input);
	assert.deepEqual(normalized.query, normalizePhotoCatalogQueryV2(input.query));
	assert.equal(normalized.query.text, 'keyword name');
	assert.deepEqual(normalized.query.filter, { kind: 'collection', id: 'legacy-root-collection' });
	assert.deepEqual(normalized.query.sort, { field: 'capture-time', direction: 'descending' });
	assert.deepEqual(normalized.query.predicate, predicate);
	assert.equal(serializePhotoSmartCollectionV1(normalized), JSON.stringify(normalized));
	assert.deepEqual(normalizePhotoSmartCollectionV1(JSON.parse(serializePhotoSmartCollectionV1(normalized)) as unknown), normalized);
	assert.ok(deepFrozen(normalized));
	predicate.terms[0]!.value = 'mutated';
	assert.equal(JSON.stringify(normalized.query.predicate).includes('mutated'), false);
});

test('all branches and the root1 filter contribute sorted unique scoped reference keys', () => {
	const predicate = { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 },
		{ kind: 'not', term: { kind: 'all', terms: [{ kind: 'keyword', id: 'z-key' }, { kind: 'folder', id: 'same' }] } },
		{ kind: 'keyword', id: 'same' }, { kind: 'keyword', id: 'z-key' }] };
	const row = photoSmartCollectionRecordV1(definition(query(predicate, { kind: 'collection', id: 'same' })));
	const expected = ['["catalog","collection","same"]', '["catalog","folder","same"]',
		'["catalog","keyword","same"]', '["catalog","keyword","z-key"]'];
	assert.deepEqual(row.referenceKeys, expected);
	assert.ok(deepFrozen(row));
	assert.deepEqual(readPhotoSmartCollectionRecordV1(row, 'catalog', row.key), row.document);
	for (const kind of ['folder', 'keyword', 'collection'] as const) {
		const onlyFilter = photoSmartCollectionRecordV1(definition(query(null, { kind, id: 'constructor' })));
		assert.deepEqual(onlyFilter.referenceKeys, [photoSmartCollectionReferenceKeyV1('catalog', kind, 'constructor')]);
	}
	for (const filter of [null, { kind: 'rating', value: 4 }, { kind: 'flag', value: 'pick' }, { kind: 'label', value: 'blue' }]) {
		assert.deepEqual(photoSmartCollectionRecordV1(definition(query(null, filter))).referenceKeys, []);
	}
});

test('tuple keys distinguish delimiter-like identities and root reference kinds', () => {
	assert.equal(photoSmartCollectionKeyV1('a:b', 'c'), '["a:b","c"]');
	assert.notEqual(photoSmartCollectionKeyV1('a:b', 'c'), photoSmartCollectionKeyV1('a', 'b:c'));
	assert.notEqual(photoSmartCollectionReferenceKeyV1('a:b', 'folder', 'c'),
		photoSmartCollectionReferenceKeyV1('a', 'folder', 'b:c'));
	assert.notEqual(photoSmartCollectionReferenceKeyV1('a', 'folder', 'c'), photoSmartCollectionReferenceKeyV1('a', 'keyword', 'c'));
	const row = photoSmartCollectionRecordV1({ ...definition(), catalogId: 'constructor', id: 'toString', name: '__proto__' });
	assert.equal(row.key, '["constructor","toString"]');
	assert.equal(Object.getPrototypeOf(row), Object.prototype);
	assert.equal(readPhotoSmartCollectionRecordV1(row, 'constructor', row.key).name, '__proto__');
});

test('private rows authenticate exact key, catalog and complete canonical ordered reference projection', () => {
	const row = photoSmartCollectionRecordV1(definition(query({ kind: 'all', terms: [{ kind: 'folder', id: 'f' },
		{ kind: 'keyword', id: 'k' }] })));
	const corruptions = [{ ...row, key: 'foreign' }, { ...row, catalogId: 'foreign' },
		{ ...row, referenceKeys: [] }, { ...row, referenceKeys: [row.referenceKeys[0]] },
		{ ...row, referenceKeys: [...row.referenceKeys].reverse() },
		{ ...row, referenceKeys: [...row.referenceKeys, row.referenceKeys[0]] },
		{ ...row, referenceKeys: [...row.referenceKeys, '["catalog","keyword","unused"]'] },
		{ ...row, referenceKeys: row.referenceKeys.map(key => key.replace('catalog', 'foreign')) },
		{ ...row, document: { ...row.document, id: 'other' } }, { ...row, extra: 'body' }];
	for (const corrupted of corruptions) assert.throws(() => readPhotoSmartCollectionRecordV1(corrupted, 'catalog', row.key));
	assert.throws(() => readPhotoSmartCollectionRecordV1(row, 'foreign', row.key));
	assert.throws(() => readPhotoSmartCollectionRecordV1(row, 'catalog', ['catalog', 'collection']));
	const input = { ...row, referenceKeys: [...row.referenceKeys] };
	const normalized = readPhotoSmartCollectionRecordV1(input, 'catalog', row.key);
	input.referenceKeys[0] = 'changed';
	assert.deepEqual(normalized, row.document);
});

test('definition/state/private row admission rejects hostile descriptors without executing getters', () => {
	let accesses = 0;
	const getter = () => { accesses += 1; throw new Error('must not evaluate'); };
	const hidden = Object.defineProperty(definition(), 'name', { value: 'hidden', enumerable: false });
	const accessor = Object.defineProperty(definition(), 'query', { get: getter, enumerable: true });
	const symbol = Object.assign(definition(), { [Symbol('body')]: 1 });
	const inherited = Object.assign(Object.create({ inherited: true }) as object, definition());
	for (const input of [hidden, accessor, symbol, inherited, { ...definition(), original: {} },
		{ ...definition(), schemaFamily: 'lightscaper' }, { ...definition(), kind: 'photo' },
		{ ...definition(), name: ' ' }, { ...definition(), name: 'x'.repeat(257) }, { ...definition(), id: 'bad|id' },
		{ ...definition(), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...definition(), revision: -1 }]) {
		assert.throws(() => normalizePhotoSmartCollectionV1(input));
	}
	const row = photoSmartCollectionRecordV1(definition());
	assert.throws(() => readPhotoSmartCollectionRecordV1(Object.defineProperty({ ...row }, 'referenceKeys',
		{ get: getter, enumerable: true }), 'catalog', row.key));
	const state = { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 7, collectionCount: 0 };
	assert.throws(() => normalizePhotoSmartCollectionsStateV1(Object.defineProperty(state, 'collectionCount', { get: getter, enumerable: true })));
	assert.equal(accesses, 0);
});

test('future definitions and queries refuse before traversing nested predicate authority', () => {
	let visits = 0;
	const nested = new Proxy({}, { getPrototypeOf() { visits += 1; throw new Error('future payload traversed'); } });
	assert.throws(() => normalizePhotoSmartCollectionV1({ ...definition(nested), schemaVersion: 2 }), /version/iu);
	assert.throws(() => normalizePhotoSmartCollectionV1(definition({ schemaVersion: 3, kind: 'photo-catalog-query', predicate: nested })), /version/iu);
	assert.equal(visits, 0);
	assert.throws(() => normalizePhotoSmartCollectionV1(definition({ schemaVersion: 2, kind: 'photo-smart-query', predicate: { kind: 'flag', value: 'pick' } })));
});

test('required saved query cannot default an explicit undefined authoring or persisted value', () => {
	const missing = { ...definition(), query: undefined };
	assert.throws(() => normalizePhotoSmartCollectionV1(missing));
	const row = photoSmartCollectionRecordV1(definition());
	assert.throws(() => readPhotoSmartCollectionRecordV1({ ...row, document: missing }, 'catalog', row.key));
	assert.throws(() => normalizePhotoSmartCollectionV1({ ...definition(), query: null }));
});

test('predicate and reference arrays use intrinsic dense descriptors and refuse sparse/cyclic/extra fields', () => {
	let getters = 0;
	const terms = new Proxy([{ kind: 'keyword', id: 'k' }], { get() { getters += 1; throw new Error('ordinary property read'); } });
	const row = photoSmartCollectionRecordV1(definition(query({ kind: 'all', terms })));
	const references = new Proxy([...row.referenceKeys], { get() { getters += 1; throw new Error('ordinary property read'); } });
	assert.deepEqual(readPhotoSmartCollectionRecordV1({ ...row, referenceKeys: references }, 'catalog', row.key), row.document);
	assert.equal(getters, 0);
	const sparse = Array<unknown>(2); sparse[1] = { kind: 'folder', id: 'f' };
	const cyclic: unknown[] = []; cyclic.push({ kind: 'all', terms: cyclic });
	const accessor = Object.defineProperty([{ kind: 'keyword', id: 'k' }], '0', { get() { getters += 1; throw new Error('accessor'); } });
	const symbol = Object.assign([{ kind: 'keyword', id: 'k' }], { [Symbol.iterator]: () => { getters += 1; return [][Symbol.iterator](); } });
	for (const bad of [sparse, cyclic, accessor, symbol]) assert.throws(() => normalizePhotoSmartCollectionV1(definition(query({ kind: 'all', terms: bad }))));
	const sparseReferences = Array<string>(1);
	assert.throws(() => readPhotoSmartCollectionRecordV1({ ...row, referenceKeys: sparseReferences }, 'catalog', row.key));
	assert.throws(() => readPhotoSmartCollectionRecordV1({ ...row, referenceKeys: Array<string>(258).fill('x') }, 'catalog', row.key));
	assert.equal(getters, 0);
});

test('maximal escaped, lone-surrogate and multibyte queries retain every legal field within explicit envelope', () => {
	assert.equal(PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes, PHOTO_QUERY_LIMITS_V2.maximumQueryBytes + 4096);
	assert.equal(PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes, 4096);
	assert.equal(PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections, 10_000);
	for (const sample of ['\ud800', '\udfff', '"', '\\', '界']) {
		const terms = Array.from({ length: 255 }, () => ({ kind: 'text', column: 'caption', operator: 'equals', value: sample.repeat(256) }));
		const predicate = { kind: 'all', terms };
		const input = { ...definition(query(predicate, { kind: 'collection', id: 'r'.repeat(128) })),
			catalogId: 'c'.repeat(128), id: 'i'.repeat(128), name: sample.repeat(256), revision: Number.MAX_SAFE_INTEGER };
		const result = normalizePhotoSmartCollectionV1(input);
		assert.equal(result.name, input.name);
		assert.deepEqual(result.query.predicate, predicate);
		assert.ok(bytes(result) <= PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes);
		assert.ok(bytes(photoSmartCollectionSummaryV1(result)) <= PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes);
		assert.deepEqual(normalizePhotoSmartCollectionV1(JSON.parse(serializePhotoSmartCollectionV1(result)) as unknown), result);
		assert.ok(bytes(photoSmartCollectionRecordV1(input)) <= PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes);
	}
});

test('maximum unique reference projection is complete and fits its separately charged private budget', () => {
	const terms = Array.from({ length: 255 }, (_, index) => ({ kind: index % 2 ? 'folder' : 'keyword',
		id: `${String(index).padStart(3, '0')}${'x'.repeat(125)}` }));
	const input = { ...definition(query({ kind: 'all', terms }, { kind: 'collection', id: 'r'.repeat(128) })),
		catalogId: 'c'.repeat(128), id: 'i'.repeat(128), revision: Number.MAX_SAFE_INTEGER, name: '\ud800'.repeat(256) };
	const row = photoSmartCollectionRecordV1(input);
	assert.equal(row.referenceKeys.length, 256);
	assert.equal(PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumReferenceKeys, PHOTO_SMART_QUERY_LIMITS_V2.maximumNodes + 1);
	assert.equal(PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes,
		PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes + PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumReferenceKeys * 288 + 1024);
	assert.ok(row.referenceKeys.every(key => bytes(key) + 1 <= 288));
	assert.ok(bytes(row) <= PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes);
	assert.deepEqual(readPhotoSmartCollectionRecordV1(row, input.catalogId, row.key), row.document);
});

test('scalar summaries authenticate only closed identities/names and contain no predicate or body', () => {
	const summary = photoSmartCollectionSummaryV1(definition(query({ kind: 'keyword', id: 'k' })));
	assert.deepEqual(summary, { schemaVersion: 1, kind: 'photo-smart-collection-summary', catalogId: 'catalog',
		id: 'collection', revision: 0, name: 'Camera selection' });
	assert.ok(deepFrozen(summary));
	assert.deepEqual(readPhotoSmartCollectionSummaryV1(summary), summary);
	for (const input of [{ ...summary, query: {} }, { ...summary, schemaVersion: 2 }, { ...summary, revision: 0.5 },
		{ ...summary, name: 'x'.repeat(257) }, { ...summary, catalogId: '' }]) assert.throws(() => readPhotoSmartCollectionSummaryV1(input));
});

test('empty retained state preserves monotonic revision and bounded collection count without ABA reset', () => {
	for (const revision of [0, 1, 37, Number.MAX_SAFE_INTEGER]) {
		for (const collectionCount of [0, 1, 10_000]) {
			const state = { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision, collectionCount };
			const normalized = normalizePhotoSmartCollectionsStateV1(state);
			assert.deepEqual(normalized, state);
			assert.ok(Object.isFrozen(normalized));
			assert.deepEqual(normalizePhotoSmartCollectionsStateV1(JSON.parse(serializePhotoSmartCollectionsStateV1(state)) as unknown), state);
		}
	}
	const state = { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 37, collectionCount: 0 };
	for (const input of [{ ...state, schemaVersion: 2 }, { ...state, kind: 'photo-smart-collection' }, { ...state, extra: 1 },
		{ ...state, collectionCount: 10_001 }, { ...state, collectionCount: -1 }, { ...state, collectionCount: 0.5 },
		{ ...state, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...state, revision: NaN }]) assert.throws(() => normalizePhotoSmartCollectionsStateV1(input));
	assert.equal(Object.is(normalizePhotoSmartCollectionsStateV1({ ...state, revision: -0 }).revision, -0), false);
});

test('seeded round trips preserve complete query identity and deterministic reference projection', () => {
	for (let seed = 0; seed < 64; seed += 1) {
		const terms = Array.from({ length: 1 + seed % 16 }, (_, index) => ({ kind: index % 2 ? 'folder' : 'keyword', id: `node-${String((seed + index) % 7)}` }));
		const input = { ...definition(query({ kind: seed % 2 ? 'all' : 'any', terms }, { kind: 'folder', id: `node-${String(seed % 7)}` })),
			id: `collection-${String(seed)}`, name: `Selection ${String(seed)} 界`, revision: seed };
		const row = photoSmartCollectionRecordV1(input);
		const roundTrip: unknown = JSON.parse(JSON.stringify(row));
		assert.deepEqual(readPhotoSmartCollectionRecordV1(roundTrip, 'catalog', row.key), row.document);
		assert.deepEqual(photoSmartCollectionRecordV1(row.document), row);
		assert.equal(serializePhotoSmartCollectionV1(input), serializePhotoSmartCollectionV1(row.document));
		assert.equal(row.referenceKeys.length, new Set(row.referenceKeys).size);
		assert.deepEqual([...row.referenceKeys].sort(), row.referenceKeys);
	}
});
