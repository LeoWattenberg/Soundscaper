/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { photoCatalogRestoreRootRecordsV1, photoCatalogRestorePhotoRecordsV1,
	photoCatalogRestoreStackRecordsV1, photoCatalogRestoreSavedCollectionRecordsV1 } from '../src/lightscaper/catalog/photo-catalog-restore-records-v1.ts';
import { readValidatedPhotoCatalogRootV1, validateLightscaperDocumentV1, serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { photoSummary, photoMemberships, photoStorageKey, readStoredPhoto } from '../src/lightscaper/catalog/repository-records.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-index-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoStackRecordV1, readPhotoStackRecordV1 } from '../src/lightscaper/catalog/photo-stack-record-v1.ts';
import { photoSmartCollectionRecordV1, readPhotoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function root() {
	return readValidatedPhotoCatalogRootV1({ ...queryCatalogRootV1(), revision: 73, photoCount: 2 });
}
function state(revision = 39, collectionCount = 1) {
	return { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision, collectionCount };
}
function stack() {
	return { schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'stack', revision: 41,
		photoIds: ['photo-000001', 'photo-000000'], coverPhotoId: 'photo-000000' };
}
function saved() {
	return { schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog', id: 'saved', revision: 53, name: 'Saved 界',
		query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'live keyword names', filter: { kind: 'collection', id: 'smart' },
			sort: { field: 'capture-time', direction: 'descending' }, predicate: { kind: 'all', terms: [
				{ kind: 'any', terms: [{ kind: 'keyword', id: 'keyword' }, { kind: 'not', term: { kind: 'folder', id: 'folder' } }] },
				{ kind: 'text', column: 'camera-make', operator: 'contains', value: 'Canon' },
				{ kind: 'number', column: 'iso', minimum: 100, maximum: 800 }, { kind: 'presence', column: 'lens', value: 'unknown' },
			] } } };
}

test('restore initialization borrows branded root and preserves archive revisions with private pending derived states', () => {
	const catalog = root(), before = serializeLightscaperDocumentV1(catalog), physical = state();
	const rows = photoCatalogRestoreRootRecordsV1(catalog, physical);
	assert.equal(rows.root, catalog); assert.equal(rows.root.revision, 73); assert.equal(rows.root.photoCount, 2);
	assert.deepEqual(rows.index, { id: 'catalog', schemaFamily: 'lightscaper', schemaVersion: 1,
		rootRevision: 73, indexRevision: 0, photoCount: 2 });
	assert.deepEqual(rows.stackState, { schemaVersion: 1, kind: 'photo-stack-state', catalogId: 'catalog', revision: 0, stackCount: 0 });
	assert.deepEqual(rows.queryBuildV1, { id: 'catalog', schemaVersion: 1, ready: false, afterKey: null, indexedCount: 0 });
	assert.deepEqual(rows.queryBuildV2, { id: 'catalog', schemaVersion: 2, ready: false, afterKey: null, indexedCount: 0 });
	assert.deepEqual(rows.savedState, physical); assert.notEqual(rows.savedState, physical);
	assert.equal(serializeLightscaperDocumentV1(catalog), before); assert.ok(Object.isFrozen(rows));
	assert.ok(Object.isFrozen(rows.index)); assert.ok(Object.isFrozen(rows.savedState));
});

test('absent saved state remains absent and retained empty state preserves even an exhausted revision', () => {
	const catalog = root();
	assert.equal(photoCatalogRestoreRootRecordsV1(catalog, null).savedState, null);
	for (const revision of [0, Number.MAX_SAFE_INTEGER]) {
		const empty = state(revision, 0); assert.deepEqual(photoCatalogRestoreRootRecordsV1(catalog, empty).savedState, empty);
	}
	const exhausted = readValidatedPhotoCatalogRootV1({ ...catalog, revision: Number.MAX_SAFE_INTEGER });
	assert.equal(photoCatalogRestoreRootRecordsV1(exhausted, null).index.rootRevision, Number.MAX_SAFE_INTEGER);
	assert.throws(() => photoCatalogRestoreRootRecordsV1(catalog, undefined));
	assert.throws(() => photoCatalogRestoreRootRecordsV1(catalog, { ...state(), catalogId: 'foreign' }));
	assert.throws(() => photoCatalogRestoreRootRecordsV1(catalog, { ...state(), future: true }));
});

test('initialization enforces combined collection capacity without copying or widening the root family', () => {
	const collections = Array.from({ length: 9_999 }, (_, index) => ({ id: `collection-${index}`, name: 'Manual', kind: 'manual' }));
	const catalog = readValidatedPhotoCatalogRootV1({ ...root(), collections });
	assert.equal(photoCatalogRestoreRootRecordsV1(catalog, state()).savedState?.collectionCount, 1);
	assert.throws(() => photoCatalogRestoreRootRecordsV1(catalog, state(0, 2)), /10000|collection.*budget/iu);
	const oversized = normalizePhotoCatalogRootV1({ ...root(), collections: [], keywords: Array.from({ length: 10_000 }, (_, index) => ({
		id: `keyword-${index}`, name: 'x'.repeat(256), parentId: null,
	})) });
	assert.throws(() => photoCatalogRestoreRootRecordsV1(oversized, null), /byte budget/iu);
});

test('photo records retain exact original, extracted facts, develop state and revision while authenticating all derived rows', () => {
	const base = queryPhotoV1(1), source = normalizePhotoDocumentV1({ ...base, revision: Number.MAX_SAFE_INTEGER,
		original: { ...base.original, name: 'Cafe\u0301 original.jpg' }, metadata: { ...base.metadata, cameraMake: 'Authored camera', creator: '' },
		extractedMetadata: { schemaVersion: 1, container: 'jpeg', issues: [], iptc: null, exif: {
			orientation: 1, cameraMake: 'Source camera', cameraModel: 'Source model', lensModel: 'Source lens',
			artist: 'Source artist', copyright: 'Source copyright', description: 'Source caption', exposureSeconds: null,
			aperture: null, iso: 800, focalLengthMm: null, captureTime: null, captureTimeRaw: null,
		} } });
	const raw = JSON.parse(JSON.stringify(source)) as unknown, before = serializeLightscaperDocumentV1(source);
	const rows = photoCatalogRestorePhotoRecordsV1(root(), raw);
	assert.deepEqual(rows.photo, { key: photoStorageKey('catalog', source.id), document: source });
	assert.deepEqual(readStoredPhoto(rows.photo), source); assert.equal(rows.photo.document.revision, Number.MAX_SAFE_INTEGER);
	assert.deepEqual(rows.summary, photoSummary(source)); assert.deepEqual(rows.memberships, photoMemberships(source));
	assert.deepEqual(rows.queryV1, projectPhotoQueryRowV1(source)); assert.deepEqual(rows.queryV2, projectPhotoQueryRowV2(source));
	assert.equal(rows.queryV2.cameraMake, 'Authored camera'); assert.equal(rows.queryV2.creator, '');
	assert.equal(JSON.stringify(rows.queryV2).includes('Source camera'), false);
	assert.equal(serializeLightscaperDocumentV1(rows.photo.document), before);
	assert.ok(Object.isFrozen(rows)); assert.ok(Object.isFrozen(rows.photo)); assert.ok(Object.isFrozen(rows.memberships));
	assert.ok(Object.isFrozen(rows.photo.document.versions[0]!.develop));
	assert.equal(Object.hasOwn(rows, 'original'), false); assert.equal(Object.hasOwn(rows, 'body'), false);
});

test('raw photo admission rejects foreign identities, missing root references and non-document content', () => {
	const catalog = root(), photo = queryPhotoV1();
	for (const patch of [{ catalogId: 'foreign' }, { folderId: 'missing' }, { keywordIds: ['missing'] },
		{ collectionIds: ['smart'] }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { body: new Uint8Array([1]) }, { schemaVersion: 2 }]) {
		assert.throws(() => photoCatalogRestorePhotoRecordsV1(catalog, { ...photo, ...patch }));
	}
	assert.throws(() => photoCatalogRestorePhotoRecordsV1(catalog, catalog), /photo document/iu);
});

test('complete legal escaped metadata retires only the undersized legacy projection without truncating Row2', t => {
	const memberships = (prefix: string) => Array.from({ length: 1_024 }, (_, index) => `${prefix}${String(index).padStart(4, '0')}${'x'.repeat(123)}`);
	const keywords = memberships('k'), collections = memberships('c'), base = queryPhotoV1();
	const catalog = readValidatedPhotoCatalogRootV1({ ...root(), id: 'c'.repeat(128), folders: [],
		keywords: keywords.map(id => ({ id, name: 'Keyword', parentId: null })),
		collections: collections.map(id => ({ id, name: 'Manual', kind: 'manual' })) });
	const words = '\ud800'.repeat(16_384), camera = '\ud800'.repeat(1_024);
	const photo = normalizePhotoDocumentV1({ ...base, catalogId: catalog.id, id: 'p'.repeat(128), folderId: null,
		keywordIds: keywords, collectionIds: collections, metadata: { ...base.metadata, fileName: 'x'.repeat(256),
			cameraMake: camera, cameraModel: camera, lens: camera, title: words, caption: words, creator: words,
			copyright: words, location: words } });
	assert.throws(() => projectPhotoQueryRowV1(photo), /Photo query row exceeds its byte budget\./u);
	const rows = photoCatalogRestorePhotoRecordsV1(catalog, photo);
	assert.equal(rows.queryV1, null); assert.deepEqual(rows.photo.document, photo); assert.deepEqual(rows.queryV2, projectPhotoQueryRowV2(photo));
	assert.equal(rows.queryV2.title.length, 16_384); assert.equal(rows.queryV2.keywordIds.length, 1_024);
	assert.equal(rows.queryV2.collectionIds.length, 1_024); assert.equal(rows.memberships.length, 2_051);
	assert.ok(bytes(rows.queryV2) > 524_288); assert.ok(bytes(rows.queryV2) <= 1_048_576);
	// Source-equivalent accounting includes the borrowed root and caller photo, not only the normalized row packet.
	t.diagnostic(`Serial source-equivalent components: root=${bytes(catalog)}, callerPhoto=${bytes(photo)}, derivedPacket=${bytes(rows)} bytes; this is not an RSS or whole-scan heap claim.`);
});

test('a malformed large photo fails instead of being misclassified as legal legacy overflow', () => {
	const photo = queryPhotoV1(), title = '\ud800'.repeat(16_384);
	assert.throws(() => photoCatalogRestorePhotoRecordsV1(root(), { ...photo, metadata: { ...photo.metadata,
		title, caption: title, creator: title, copyright: title, location: title, cameraMake: 'x'.repeat(1_025) } }), /camera|bounded/iu);
});

test('stack records preserve order, cover and archived revision with exact forward and reverse projection', () => {
	const source = stack(), rows = photoCatalogRestoreStackRecordsV1(root(), source);
	assert.deepEqual(rows.stack, photoStackRecordV1(source)); assert.equal(rows.stack.document.revision, 41);
	assert.deepEqual(readPhotoStackRecordV1(rows.stack, 'catalog', 'catalog|stack'), rows.stack.document);
	assert.deepEqual(rows.memberships, source.photoIds.map(photoId => ({ key: `catalog|${photoId}`, catalogId: 'catalog',
		photoId, stackId: 'stack', scope: 'catalog|stack' })));
	assert.deepEqual(rows.stack.memberKeys, rows.memberships.map(row => row.key));
	assert.ok(Object.isFrozen(rows)); assert.ok(Object.isFrozen(rows.memberships)); assert.ok(Object.isFrozen(rows.memberships[0]));
	source.photoIds.reverse(); assert.deepEqual(rows.stack.document.photoIds, ['photo-000001', 'photo-000000']);
});

test('stack admission rejects duplicate/sparse/foreign members and cannot invent more photos than the root declares', () => {
	const catalog = root(), source = stack();
	for (const patch of [{ catalogId: 'foreign' }, { photoIds: ['photo-000000', 'photo-000000'] },
		{ photoIds: new Array(2) }, { photoIds: ['photo-000000', 'photo-000001', 'photo-000002'] },
		{ coverPhotoId: 'other' }, { schemaVersion: 2 }, { memberKeys: ['forged'] }]) {
		assert.throws(() => photoCatalogRestoreStackRecordsV1(catalog, { ...source, ...patch }));
	}
});

test('saved records preserve all fullQuery2 fields, reference projections and paired summary at the archived revision', () => {
	const source = saved(), rows = photoCatalogRestoreSavedCollectionRecordsV1(root(), source);
	assert.deepEqual(rows.definition, photoSmartCollectionRecordV1(source)); assert.equal(rows.definition.document.revision, 53);
	assert.deepEqual(rows.summary, photoSmartCollectionSummaryRecordV1(source));
	assert.deepEqual(readPhotoSmartCollectionRecordV1(rows.definition, 'catalog', '["catalog","saved"]'), rows.definition.document);
	assert.deepEqual(rows.definition.referenceKeys, ['["catalog","collection","smart"]', '["catalog","folder","folder"]', '["catalog","keyword","keyword"]']);
	assert.deepEqual(rows.definition.document.query, source.query); assert.ok(Object.isFrozen(rows));
	assert.ok(Object.isFrozen(rows.definition.document.query.predicate)); assert.ok(Object.isFrozen(rows.summary));
	source.query.text = 'Changed caller text'; assert.equal(rows.definition.document.query.text, 'live keyword names');
});

test('saved admission validates hidden references, root ID collision and root-only collection filters', () => {
	const catalog = root(), source = saved();
	for (const patch of [{ catalogId: 'foreign' }, { id: 'manual' }, { schemaVersion: 2 },
		{ query: { ...source.query, filter: { kind: 'collection', id: 'another-saved' } } },
		{ query: { ...source.query, predicate: { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 },
			{ kind: 'not', term: { kind: 'folder', id: 'missing' } }] } } }]) {
		assert.throws(() => photoCatalogRestoreSavedCollectionRecordsV1(catalog, { ...source, ...patch }));
	}
});

test('raw root/photo/stack/saved descriptors never evaluate hostile getters during admission', () => {
	let reads = 0;
	const getter = { enumerable: true, get() { reads++; throw new Error('Getter evaluated.'); } };
	assert.throws(() => photoCatalogRestoreRootRecordsV1(Object.defineProperty({ ...root() }, 'name', getter), null));
	const photo = queryPhotoV1();
	assert.throws(() => photoCatalogRestorePhotoRecordsV1(root(), { ...photo, metadata: Object.defineProperty({ ...photo.metadata }, 'title', getter) }));
	assert.throws(() => photoCatalogRestoreStackRecordsV1(root(), { ...stack(), photoIds: Object.defineProperty(['photo-000000', 'photo-000001'], '0', getter) }));
	assert.throws(() => photoCatalogRestoreSavedCollectionRecordsV1(root(), { ...saved(), query: Object.defineProperty({ ...saved().query }, 'predicate', getter) }));
	assert.equal(reads, 0);
});

test('root photo kind refusal and owning canonical byte admission remain unchanged', () => {
	assert.throws(() => photoCatalogRestoreRootRecordsV1(queryPhotoV1(), null), /catalog root/iu);
	const raw = JSON.parse(JSON.stringify(root())) as unknown, admitted = photoCatalogRestoreRootRecordsV1(raw, null);
	assert.notEqual(admitted.root, raw); assert.deepEqual(admitted.root, root());
	assert.deepEqual(validateLightscaperDocumentV1(admitted.root), root());
});
