/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyPhotoCatalogDefinitionCommandV1 as apply,
	readPhotoCatalogDefinitionPageV1 as readPage,
} from '../src/lightscaper/controller/photo-catalog-definitions.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

function root(overrides: Partial<PhotoCatalogRootV1> = {}): PhotoCatalogRootV1 {
	return { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog',
		name: 'Library', revision: 9, photoCount: 12, folders: [], keywords: [], collections: [], ...overrides };
}

function hierarchy(count: number) {
	return Array.from({ length: count }, (_, index) => ({ id: `n${String(index).padStart(5, '0')}`, name: `Node ${String(index)}`, parentId: null }));
}

function fullRoot(): PhotoCatalogRootV1 {
	const maximum = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes;
	const base = root({ name: 'R' });
	const nodeBytes = JSON.stringify({ id: 'f000000', name: 'X'.repeat(256), parentId: null }).length;
	const baseBytes = serializeLightscaperDocumentV1(base).length;
	const count = Math.floor((maximum - baseBytes + 1) / (nodeBytes + 1));
	const folders = Array.from({ length: count }, (_, index) => ({ id: `f${String(index).padStart(6, '0')}`, name: 'X'.repeat(256), parentId: null }));
	const used = baseBytes + count * (nodeBytes + 1) - 1;
	const spare = maximum - used;
	// One more short node fits after shortening one existing name if needed.
	const extra = { id: 'z000000', name: 'Z', parentId: null };
	const extraCost = JSON.stringify(extra).length + 1;
	if (spare < extraCost) {
		folders[0] = { ...folders[0], name: 'X'.repeat(256 - (extraCost - spare)) };
	} else {
		extra.name = 'Z'.repeat(1 + spare - extraCost);
	}
	folders.push(extra);
	const result = root({ name: 'R', folders });
	assert.equal(serializeLightscaperDocumentV1(result).length, maximum);
	return result;
}

test('one hierarchy command returns an immutable draft and preserves catalog identity and counts', () => {
	const current = root(), before = structuredClone(current);
	const next = apply(current, 9, { type: 'create-node', nodeKind: 'folder', id: 'travel', name: 'Travel', parentId: null });
	assert.deepEqual(current, before);
	assert.deepEqual(next.folders, [{ id: 'travel', name: 'Travel', parentId: null }]);
	assert.equal(next.id, current.id); assert.equal(next.name, current.name);
	assert.equal(next.revision, 9); assert.equal(next.photoCount, 12);
	assert.ok(Object.isFrozen(next)); assert.ok(Object.isFrozen(next.folders)); assert.ok(Object.isFrozen(next.folders[0]));
});

test('folder and keyword names, parents and IDs are validated without crossing definition kinds', () => {
	const current = root({ folders: [{ id: 'same', name: 'Folder', parentId: null }], keywords: [{ id: 'same', name: 'Keyword', parentId: null }] });
	const renamed = apply(current, 9, { type: 'rename-node', nodeKind: 'keyword', id: 'same', name: 'New keyword' });
	assert.equal(renamed.folders[0].name, 'Folder'); assert.equal(renamed.keywords[0].name, 'New keyword');
	assert.throws(() => apply(current, 9, { type: 'create-node', nodeKind: 'folder', id: 'same', name: 'Duplicate', parentId: null }), /already|duplicate/iu);
	assert.throws(() => apply(current, 9, { type: 'rename-node', nodeKind: 'folder', id: 'missing', name: 'Missing' }), /missing/iu);
	assert.throws(() => apply(current, 9, { type: 'rename-node', nodeKind: 'folder', id: 'same', name: ' ' }), /nonempty/iu);
	assert.throws(() => apply(current, 9, { type: 'create-node', nodeKind: 'folder', id: '/path', name: 'Path', parentId: null }), /identifier/iu);
});

test('reparenting validates missing parents, self cycles and descendant cycles', () => {
	const current = root({ folders: [{ id: 'parent', name: 'Parent', parentId: null }, { id: 'child', name: 'Child', parentId: 'parent' }] });
	for (const parentId of ['missing', 'parent', 'child']) {
		assert.throws(() => apply(current, 9, { type: 'reparent-node', nodeKind: 'folder', id: 'parent', parentId }), /missing|cycle/iu);
	}
	const next = apply(current, 9, { type: 'reparent-node', nodeKind: 'folder', id: 'child', parentId: null });
	assert.equal(next.folders.find((node) => node.id === 'child')?.parentId, null);
});

test('delete-empty refuses children and smart-query references and removes only the requested leaf', () => {
	const current = root({ keywords: [{ id: 'parent', name: 'Parent', parentId: null }, { id: 'leaf', name: 'Leaf', parentId: 'parent' }],
		collections: [{ id: 'smart', name: 'Smart', kind: 'smart', query: { kind: 'keyword', id: 'leaf' } }] });
	assert.throws(() => apply(current, 9, { type: 'delete-empty-node', nodeKind: 'keyword', id: 'parent' }), /children|missing/iu);
	assert.throws(() => apply(current, 9, { type: 'delete-empty-node', nodeKind: 'keyword', id: 'leaf' }), /reference|missing/iu);
	const next = apply({ ...current, collections: [] }, 9, { type: 'delete-empty-node', nodeKind: 'keyword', id: 'leaf' });
	assert.deepEqual(next.keywords, [{ id: 'parent', name: 'Parent', parentId: null }]);
});

test('manual and smart collections create and update closed names and normalized queries', () => {
	const current = root({ folders: [{ id: 'f', name: 'Folder', parentId: null }] });
	const manual = apply(current, 9, { type: 'create-collection', collection: { id: 'manual', kind: 'manual', name: 'Manual' } });
	const smart = apply(manual, 9, { type: 'create-collection', collection: { id: 'smart', kind: 'smart', name: 'Smart',
		query: { kind: 'all', terms: [{ kind: 'folder', id: 'f' }, { kind: 'rating', minimum: 4, maximum: 5 }] } } });
	const renamed = apply(smart, 9, { type: 'update-collection', collection: { id: 'manual', kind: 'manual', name: 'Renamed' } });
	assert.equal(renamed.collections[0].name, 'Renamed');
	const edited = apply(renamed, 9, { type: 'update-collection', collection: { id: 'smart', kind: 'smart', name: 'Picks', query: { kind: 'flag', value: 'pick' } } });
	assert.deepEqual(edited.collections[1], { id: 'smart', kind: 'smart', name: 'Picks', query: { kind: 'flag', value: 'pick' } });
	assert.ok(Object.isFrozen(edited.collections[1]));
	assert.equal(edited.photoCount, 12);
});

test('collection update cannot create missing IDs, duplicate IDs or change membership authority', () => {
	const current = root({ collections: [{ id: 'manual', kind: 'manual', name: 'Manual' }] });
	assert.throws(() => apply(current, 9, { type: 'update-collection', collection: { id: 'missing', kind: 'manual', name: 'Missing' } }), /missing/iu);
	assert.throws(() => apply(current, 9, { type: 'create-collection', collection: current.collections[0] }), /already|duplicate/iu);
	assert.throws(() => apply(current, 9, { type: 'update-collection', collection: { id: 'manual', kind: 'smart', name: 'Changed', query: { kind: 'flag', value: 'pick' } } }), /kind|manual|identity/iu);
	assert.throws(() => apply(current, 9, { type: 'create-collection', collection: { id: 'smart', kind: 'smart', name: 'Invalid', query: { kind: 'folder', id: 'missing' } } }), /missing/iu);
});

test('smart collection commands preserve query depth and node bounds', () => {
	let query: unknown = { kind: 'flag', value: 'pick' };
	for (let level = 0; level < 16; level += 1) query = { kind: 'not', term: query };
	for (const invalid of [query, { kind: 'all', terms: Array.from({ length: 256 }, () => ({ kind: 'flag', value: 'pick' })) }]) {
		assert.throws(() => apply(root(), 9, { type: 'create-collection', collection: { id: 'smart', name: 'Smart', kind: 'smart', query: invalid } }), /depth|node budget/iu);
	}
});

test('stale revision refuses the command before reading its properties', () => {
	let reads = 0;
	const command = Object.defineProperty({}, 'type', { enumerable: true, get() { reads += 1; throw new Error('Command getter executed'); } });
	assert.throws(() => apply(root(), 8, command), PhotoCatalogRevisionConflictError);
	assert.equal(reads, 0);
	for (const revision of [-1, NaN, 9.5, '9']) assert.throws(() => apply(root(), revision, {}));
});

test('commands reject unsafe objects, accessors and unknown fields without invoking getters', () => {
	let reads = 0;
	const getter = Object.defineProperty({ type: 'rename-node', nodeKind: 'folder', id: 'folder' }, 'name', { enumerable: true, get() { reads += 1; return 'Unsafe'; } });
	for (const command of [getter, { type: 'create-node', nodeKind: 'folder', id: 'folder', name: 'Folder', parentId: null, path: '/disk' },
		{ type: 'create-collection', collection: { id: 'manual', name: 'Manual', kind: 'manual', query: { kind: 'flag', value: 'pick' } } },
		Object.assign(Object.create({}) as object, { type: 'rename-node', nodeKind: 'folder', id: 'folder', name: 'Unsafe' }),
		{ type: 'delete-all' }, [{ type: 'delete-empty-node' }]]) assert.throws(() => apply(root(), 9, command));
	assert.equal(reads, 0);
});

test('commands enforce 10000 definitions and preflight the next durable revision byte growth', () => {
	const maximum = root({ folders: hierarchy(10_000) });
	assert.throws(() => apply(maximum, 9, { type: 'create-node', nodeKind: 'folder', id: 'extra', name: 'Extra', parentId: null }), /10000|10,000|entries/iu);
	const exact = fullRoot();
	assert.throws(() => apply(exact, 9, { type: 'rename-node', nodeKind: 'folder', id: exact.folders[1].id, name: exact.folders[1].name }), /byte budget/iu);
	assert.equal(exact.revision, 9);
	assert.throws(() => apply(root({ revision: Number.MAX_SAFE_INTEGER }), Number.MAX_SAFE_INTEGER,
		{ type: 'create-node', nodeKind: 'keyword', id: 'keyword', name: 'Keyword', parentId: null }), /revision|between/iu);
});

test('definition pages return 64 scalar rows in canonical ID order without exposing smart query trees', () => {
	const current = root({ collections: Array.from({ length: 65 }, (_, index) => ({ id: `c${String(index).padStart(2, '0')}`,
		name: 'Smart', kind: 'smart' as const, query: { kind: 'flag' as const, value: 'pick' as const } })).reverse() });
	const first = readPage(current, { kind: 'collection' });
	assert.equal(first.items.length, 64); assert.equal(first.catalogId, 'catalog'); assert.equal(first.rootRevision, 9);
	assert.deepEqual(Object.keys(first.items[0]).sort(), ['collectionKind', 'id', 'kind', 'name']);
	assert.equal(first.items[0].id, 'c00'); assert.equal(first.items[63].id, 'c63');
	assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.items)); assert.ok(Object.isFrozen(first.items[0]));
	assert.ok(first.continuation); assert.ok(new TextEncoder().encode(JSON.stringify(first.continuation)).byteLength <= 1_024);
	const last = readPage(current, { kind: 'collection', continuation: first.continuation });
	assert.deepEqual(last.items.map((item) => item.id), ['c64']); assert.equal(last.continuation, null);
});

test('hierarchy projection names the exact parent and does not include descendants', () => {
	const current = root({ folders: [{ id: 'parent', name: 'Parent', parentId: null }, { id: 'child', name: 'Child', parentId: 'parent' },
		{ id: 'leaf', name: 'Leaf', parentId: 'child' }] });
	assert.deepEqual(readPage(current, { kind: 'folder', parentId: null }).items, [{ kind: 'folder', id: 'parent', name: 'Parent', parentId: null }]);
	assert.deepEqual(readPage(current, { kind: 'folder', parentId: 'parent' }).items.map((node) => node.id), ['child']);
	assert.deepEqual(readPage(current, { kind: 'folder', parentId: 'leaf' }).items, []);
	assert.throws(() => readPage(current, { kind: 'folder', parentId: 'missing' }), /missing/iu);
	assert.throws(() => readPage(current, { kind: 'folder' }), /parentId|required/iu);
});

test('continuations refuse changed revisions, catalogs, kinds and exact-parent scopes', () => {
	const current = root({ folders: hierarchy(65), keywords: hierarchy(65) });
	const page = readPage(current, { kind: 'folder', parentId: null }); assert.ok(page.continuation);
	assert.throws(() => readPage({ ...current, revision: 10 }, { kind: 'folder', parentId: null, continuation: page.continuation }), PhotoCatalogRevisionConflictError);
	assert.throws(() => readPage({ ...current, id: 'other' }, { kind: 'folder', parentId: null, continuation: page.continuation }), /catalog|scope/iu);
	assert.throws(() => readPage(current, { kind: 'keyword', parentId: null, continuation: page.continuation }), /scope/iu);
	assert.throws(() => readPage(current, { kind: 'folder', parentId: 'n00000', continuation: page.continuation }), /scope/iu);
});

test('projection refuses malformed, future and invented continuations and requests', () => {
	const current = root({ folders: hierarchy(65) });
	const page = readPage(current, { kind: 'folder', parentId: null }); assert.ok(page.continuation);
	let reads = 0;
	const getter = Object.defineProperty({ ...page.continuation }, 'afterId', { enumerable: true, get() { reads += 1; return 'n00063'; } });
	for (const continuation of [{ ...page.continuation, schemaVersion: 2 }, { ...page.continuation, afterId: 'missing' },
		{ ...page.continuation, afterId: 'x'.repeat(1_025) }, { ...page.continuation, rootRevision: NaN },
		{ ...page.continuation, extra: true }, getter]) assert.throws(() => readPage(current, { kind: 'folder', parentId: null, continuation }));
	for (const request of [{ kind: 'all' }, { kind: 'folder', parentId: null, descendants: true }, { kind: 'collection', parentId: null }]) assert.throws(() => readPage(current, request));
	assert.equal(reads, 0);
});

test('roots are validated before commands and projections without reading unsafe hierarchy accessors', () => {
	let reads = 0;
	const invalid = Object.defineProperty(root(), 'folders', { enumerable: true, get() { reads += 1; return []; } });
	assert.throws(() => apply(invalid, 9, { type: 'create-node', nodeKind: 'folder', id: 'folder', name: 'Folder', parentId: null }));
	assert.throws(() => readPage(invalid, { kind: 'collection' })); assert.equal(reads, 0);
	for (const value of [{ ...root(), schemaVersion: 2 }, { ...root(), schemaFamily: 'framescaper' }, { ...root(), kind: 'photo' }]) {
		assert.throws(() => apply(value, 9, {})); assert.throws(() => readPage(value, { kind: 'collection' }));
	}
});

test('a structurally empty-node draft still requires atomic repository membership refusal', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'definition-membership-test', verifyOriginal: async () => undefined });
	try {
		const initial = root({ id: 'catalog-1', revision: 0, photoCount: 0,
			folders: [{ id: 'folder', name: 'Folder', parentId: null }], keywords: [{ id: 'keyword', name: 'Keyword', parentId: null }] });
		await repository.createCatalog(initial);
		const photo = { ...photoArchiveFixture().photo, folderId: 'folder', keywordIds: ['keyword'] };
		const current = await repository.publishPhotos(initial.id, 0, [photo]);
		for (const nodeKind of ['folder', 'keyword'] as const) {
			const proposed = apply(current, current.revision, { type: 'delete-empty-node', nodeKind, id: nodeKind });
			await assert.rejects(repository.saveCatalog(proposed, current.revision), /referenced/iu);
			assert.deepEqual(await repository.loadCatalog(current.id), current);
		}
		assert.deepEqual(await repository.loadPhoto(current.id, photo.id), photo);
		const proposed = apply(current, current.revision, { type: 'rename-node', nodeKind: 'folder', id: 'folder', name: 'Renamed' });
		const acknowledged = await repository.saveCatalog(proposed, current.revision);
		assert.equal(acknowledged.revision, current.revision + 1);
		assert.equal(acknowledged.folders[0].name, 'Renamed');
		await assert.rejects(repository.saveCatalog(proposed, current.revision), PhotoCatalogRevisionConflictError);
		assert.deepEqual(await repository.loadPhoto(current.id, photo.id), photo);
	} finally { await repository.close(); }
});
