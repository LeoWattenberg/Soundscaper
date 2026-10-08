/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PhotoCommandOwnerV1 } from '../src/lightscaper/controller/photo-command-owner.ts';
import { normalizePhotoLibraryDefinitionCommandV1, normalizePhotoLibraryDefinitionMutationV1,
	normalizePhotoLibraryDefinitionReadRequestV1, readPhotoLibraryDefinitionV1, applyPhotoLibraryDefinitionV1 } from '../src/lightscaper/controller/photo-library-organizer-v1.ts';
import { normalizePhotoLibraryMembershipReadV1, normalizePhotoLibraryMembershipMutationV1,
	readPhotoLibraryMembershipsV1, applyPhotoLibraryMembershipsV1 } from '../src/lightscaper/controller/photo-library-memberships-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'photo-organizer', verifyOriginal: async () => undefined });
	await repository.createCatalog(queryCatalogRootV1());
	await repository.publishPhotos('catalog', 0, [queryPhotoV1()]);
	return { repository, indexedDB };
}

const grammar = { kind: 'all', terms: [
	{ kind: 'any', terms: [{ kind: 'rating', minimum: 2, maximum: 5 }, { kind: 'flag', value: 'pick' }] },
	{ kind: 'not', term: { kind: 'label', value: 'red' } }, { kind: 'keyword', id: 'keyword' },
	{ kind: 'folder', id: 'folder' }, { kind: 'file-name', contains: 'Image-' },
	{ kind: 'capture-time', from: '2026-01-01T00:00:00', to: null },
] };

test('smart JSON authoring round trips every grammar variant without presets or invented offsets', async () => {
	const { repository } = await fixture();
	try {
		const ack = await applyPhotoLibraryDefinitionV1(repository, 'catalog', 1, {
			type: 'create-collection', collection: { id: 'full-smart', name: 'Full grammar', kind: 'smart', queryJson: JSON.stringify(grammar) },
		});
		assert.equal(ack.rootRevision, 2); assert.equal(ack.row?.kind, 'collection');
		const read = await readPhotoLibraryDefinitionV1(repository, 'catalog', { kind: 'collection', id: 'full-smart' });
		const parsed: unknown = JSON.parse(read.queryJson!);
		assert.deepEqual(parsed, { ...grammar, terms: [...grammar.terms.slice(0, -1),
			{ kind: 'capture-time', from: '2026-01-01T00:00:00.000', to: null }] });
		assert.equal(read.rootRevision, 2); assert.deepEqual(Object.keys(read).sort(), ['queryJson', 'rootRevision', 'row']);
	} finally { await repository.close(); }
});

test('create, rename, reparent and empty deletion publish one fresh-root revision each', async () => {
	const { repository } = await fixture();
	try {
		await applyPhotoLibraryDefinitionV1(repository, 'catalog', 1, { type: 'create-node', nodeKind: 'folder', id: 'child', name: 'Child', parentId: null });
		await applyPhotoLibraryDefinitionV1(repository, 'catalog', 2, { type: 'rename-node', nodeKind: 'folder', id: 'child', name: 'Renamed' });
		const moved = await applyPhotoLibraryDefinitionV1(repository, 'catalog', 3, { type: 'reparent-node', nodeKind: 'folder', id: 'child', parentId: 'folder' });
		assert.deepEqual(moved.row, { kind: 'folder', id: 'child', name: 'Renamed', parentId: 'folder' });
		await assert.rejects(applyPhotoLibraryDefinitionV1(repository, 'catalog', 4,
			{ type: 'reparent-node', nodeKind: 'folder', id: 'folder', parentId: 'child' }), /cycle/iu);
		const deleted = await applyPhotoLibraryDefinitionV1(repository, 'catalog', 4, { type: 'delete-empty-node', nodeKind: 'folder', id: 'child' });
		assert.deepEqual(deleted, { rootRevision: 5, row: null });
		await assert.rejects(applyPhotoLibraryDefinitionV1(repository, 'catalog', 5,
			{ type: 'delete-empty-node', nodeKind: 'folder', id: 'folder' }), /reference|membership/iu);
		assert.equal((await repository.loadCatalog('catalog'))?.revision, 5);
	} finally { await repository.close(); }
});

test('stale root writers and collection-kind changes leave the saved definition intact', async () => {
	const { repository } = await fixture();
	try {
		await applyPhotoLibraryDefinitionV1(repository, 'catalog', 1, { type: 'update-collection', collection: { id: 'manual', name: 'Updated', kind: 'manual' } });
		await assert.rejects(applyPhotoLibraryDefinitionV1(repository, 'catalog', 1,
			{ type: 'rename-node', nodeKind: 'keyword', id: 'keyword', name: 'Stale' }), { code: 'CATALOG_REVISION_CONFLICT' });
		await assert.rejects(applyPhotoLibraryDefinitionV1(repository, 'catalog', 2,
			{ type: 'update-collection', collection: { id: 'manual', name: 'Changed kind', kind: 'smart', queryJson: JSON.stringify(grammar) } }), /preserve/iu);
		assert.equal((await readPhotoLibraryDefinitionV1(repository, 'catalog', { kind: 'collection', id: 'manual' })).row.name, 'Updated');
	} finally { await repository.close(); }
});

test('future, oversized, malformed and accessor commands refuse before any port or owner traversal', async () => {
	let invoked = 0;
	const hostile = Object.defineProperty({}, 'type', { enumerable: true, get: () => { invoked++; return 'create-node'; } });
	assert.throws(() => normalizePhotoLibraryDefinitionCommandV1(hostile));
	for (const queryJson of ['{', ' '.repeat(2_097_153), JSON.stringify({ kind: 'future' }),
		JSON.stringify({ kind: 'all', terms: Array.from({ length: 256 }, () => ({ kind: 'flag', value: 'pick' })) })]) {
		assert.throws(() => normalizePhotoLibraryDefinitionCommandV1({ type: 'create-collection', collection: { id: 'x', name: 'X', kind: 'smart', queryJson } }));
	}
	assert.throws(() => normalizePhotoLibraryDefinitionMutationV1(-1, {}));
	assert.throws(() => normalizePhotoLibraryDefinitionReadRequestV1({ kind: 'future', id: 'x' }));
	assert.throws(() => normalizePhotoLibraryMembershipMutationV1('photo', 0, { keywordIds: ['same', 'same'] }));
	assert.throws(() => normalizePhotoLibraryMembershipMutationV1('photo', 0, { original: {} }));
	assert.throws(() => normalizePhotoLibraryMembershipMutationV1('photo', 0, { folderId: undefined }));
	for (const normalize of [() => normalizePhotoLibraryDefinitionReadRequestV1({ kind: 'folder', id: 'x', signal: AbortSignal.abort() }),
		() => normalizePhotoLibraryDefinitionMutationV1(0, hostile, { signal: AbortSignal.abort() }),
		() => normalizePhotoLibraryMembershipReadV1('photo', { signal: AbortSignal.abort() })]) assert.throws(normalize);
	assert.equal(invoked, 0);
});

test('the existing exact JSON, query depth and node ceilings remain usable', () => {
	const query = JSON.stringify({ kind: 'all', terms: Array.from({ length: 255 }, () => ({ kind: 'flag', value: 'pick' })) });
	const command = (queryJson: string) => ({ type: 'create-collection', collection: { id: 'full', name: 'Full', kind: 'smart', queryJson } });
	const admitted = normalizePhotoLibraryDefinitionCommandV1(command(' '.repeat(2_097_152 - query.length) + query));
	assert.ok('collection' in admitted && admitted.collection.kind === 'smart');
	assert.equal(JSON.parse(admitted.collection.queryJson).terms.length as unknown, 255);
	let tree: unknown = { kind: 'flag', value: 'pick' };
	for (let index = 0; index < 15; index++) tree = { kind: 'not', term: tree };
	assert.doesNotThrow(() => normalizePhotoLibraryDefinitionCommandV1(command(JSON.stringify(tree))));
	assert.throws(() => normalizePhotoLibraryDefinitionCommandV1(command(JSON.stringify({ kind: 'not', term: tree }))));
});

test('membership normalization preserves arbitrary unseen ID sets and exact folder clearing', () => {
	fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 9_999 }), { maxLength: 128 }), values => {
		const ids = values.map(value => `keyword-${value}`), input = { folderId: null, keywordIds: ids };
		const admitted = normalizePhotoLibraryMembershipMutationV1('photo', 7, input);
		assert.deepEqual(new Set(admitted.changes.keywordIds), new Set(ids));
		assert.equal(admitted.changes.folderId, null); assert.equal(admitted.expectedRevision, 7);
		assert.deepEqual(input.keywordIds, ids); assert.ok(Object.isFrozen(admitted.changes.keywordIds));
	}), { numRuns: 100, seed: 47 });
});

test('a durable root acknowledgment survives cancellation arriving before its continuation', async () => {
	const { repository } = await fixture(), controller = new AbortController();
	try {
		const port = { loadCatalog: async (id: string) => repository.loadCatalog(id),
			saveCatalog: async (...args: Parameters<PhotoCatalogRepositoryV1['saveCatalog']>) => { const saved = await repository.saveCatalog(...args); controller.abort(); return saved; } };
		const ack = await applyPhotoLibraryDefinitionV1(port, 'catalog', 1,
			{ type: 'create-node', nodeKind: 'keyword', id: 'new-keyword', name: 'New', parentId: null }, { signal: controller.signal });
		assert.equal(controller.signal.aborted, true); assert.equal(ack.rootRevision, 2); assert.equal(ack.row?.id, 'new-keyword');
	} finally { await repository.close(); }
});

test('native signal shadows stay inert and cancellation fences a late definition read', async () => {
	let invoked = 0;
	const signal = Object.defineProperty(AbortSignal.abort(), 'throwIfAborted', { get: () => { invoked++; return () => undefined; } });
	assert.throws(() => normalizePhotoLibraryDefinitionReadRequestV1({ kind: 'folder', id: 'folder', signal }), { name: 'AbortError' });
	assert.equal(invoked, 0);
	const result = deferred<ReturnType<typeof queryCatalogRootV1>>(), controller = new AbortController();
	const reading = readPhotoLibraryDefinitionV1({ loadCatalog: async () => result.promise }, 'catalog', { kind: 'folder', id: 'folder', signal: controller.signal });
	controller.abort(); result.resolve(queryCatalogRootV1());
	await assert.rejects(reading, { name: 'AbortError' });
});

test('membership commands use the injected owner, preserve immutable state and maintain live indexes', async () => {
	const { repository } = await fixture(), owner = await PhotoCommandOwnerV1.open(repository, 'catalog', queryPhotoV1().id);
	try {
		const before = owner.history.present;
		assert.deepEqual(readPhotoLibraryMembershipsV1(owner, before.id), { photoId: before.id, revision: 0,
			folderId: 'folder', keywordIds: ['keyword'], collectionIds: ['manual'] });
		const ack = await applyPhotoLibraryMembershipsV1(owner, before.id, 0, { folderId: null, keywordIds: [], collectionIds: [] });
		assert.equal(ack.snapshot.revision, 1); assert.equal(ack.row.id, before.id);
		assert.deepEqual(ack.snapshot.keywordIds, []); assert.deepEqual(owner.history.present.original, before.original);
		assert.deepEqual(owner.history.present.extractedMetadata, before.extractedMetadata);
		assert.deepEqual(owner.history.present.versions, before.versions);
		assert.equal((await repository.readSummaryPage('catalog', { filter: { kind: 'keyword', id: 'keyword' } })).items.length, 0);
		await assert.rejects(applyPhotoLibraryMembershipsV1(owner, before.id, 0, { keywordIds: ['keyword'] }), { code: 'PHOTO_REVISION_CONFLICT' });
		await assert.rejects(applyPhotoLibraryMembershipsV1(owner, before.id, 1, { collectionIds: ['smart'] }), /manual/iu);
		assert.equal(owner.history.present.revision, 1);
	} finally { await owner.close(); await repository.close(); }
});

test('a durable membership acknowledgment survives cancellation arriving before continuation', async () => {
	const { repository } = await fixture(), owner = await PhotoCommandOwnerV1.open(repository, 'catalog', queryPhotoV1().id), controller = new AbortController();
	try {
		const port = { get history() { return owner.history; }, execute: async (...args: Parameters<PhotoCommandOwnerV1['execute']>) => {
			const ack = await owner.execute(...args); controller.abort(); return ack;
		} };
		const ack = await applyPhotoLibraryMembershipsV1(port, queryPhotoV1().id, 0, { keywordIds: [] }, { signal: controller.signal });
		assert.equal(controller.signal.aborted, true); assert.equal(ack.snapshot.revision, 1); assert.deepEqual(ack.snapshot.keywordIds, []);
	} finally { await owner.close(); await repository.close(); }
});
