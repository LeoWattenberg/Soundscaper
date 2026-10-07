/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { PhotoCommandOwnerV1, type PhotoCommandRepositoryPortV1 } from '../src/lightscaper/controller/photo-command-owner.ts';
import { createPhotoDevelopClipboardV1, normalizePhotoDevelopClipboardV1, parsePhotoDevelopClipboardV1,
	serializePhotoDevelopClipboardV1 } from '../src/lightscaper/controller/photo-develop-clipboard.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { createPhotoHistoryV1, commitPhotoHistoryV1 } from '../src/lightscaper/catalog/photo-history.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'photo-command-tests', verifyOriginal: async () => undefined });
	await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Commands', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: 'Virtual', parentId: null }],
		keywords: [{ id: 'keyword', name: 'Keyword', parentId: null }],
		collections: [{ id: 'collection', name: 'Collection', kind: 'manual' }] });
	const photos = [photoArchiveFixture(1).photo, photoArchiveFixture(2).photo];
	await repository.publishPhotos('catalog-1', 0, photos);
	const owner = await PhotoCommandOwnerV1.open(repository, 'catalog-1', 'photo-1');
	return { indexedDB, repository, photos, owner };
}

function settings(brightness = 0.3) {
	return { ...defaultPhotoDevelopV1(), effects: [
		{ id: 'color', type: 'color-adjust', enabled: true, params: { brightness } },
	] };
}

test('edit, undo and redo acknowledge durable CAS exactly once before publishing each photo history', async () => {
	const { repository, owner, photos } = await fixture();
	await owner.execute({ type: 'set-attributes', changes: { rating: 5, flag: 'pick', folderId: 'folder',
		keywordIds: ['keyword'], collectionIds: ['collection'] } });
	await owner.execute({ type: 'set-metadata', changes: { title: 'Authored', caption: 'Description' } });
	assert.equal(owner.history.present.revision, 2);
	assert.equal(owner.history.past.length, 2);
	await owner.undo();
	assert.equal(owner.history.present.revision, 3);
	assert.equal(owner.history.present.metadata.title, '');
	await owner.undo();
	assert.equal(owner.history.present.revision, 4);
	assert.equal(owner.history.present.rating, 0);
	assert.equal((await repository.readSummaryPage('catalog-1', { filter: { kind: 'keyword', id: 'keyword' } })).items.length, 0);
	await owner.redo();
	assert.equal(owner.history.present.revision, 5);
	assert.equal(owner.history.present.rating, 5);
	assert.equal((await repository.readSummaryPage('catalog-1', { filter: { kind: 'keyword', id: 'keyword' } })).items[0]?.photoRevision, 5);
	assert.deepEqual(await repository.loadPhoto('catalog-1', 'photo-1'), owner.history.present);
	assert.deepEqual(await repository.loadPhoto('catalog-1', 'photo-2'), photos[1]);
	assert.deepEqual(owner.history.present.original, photos[0]!.original);
	assert.equal((await repository.loadCatalog('catalog-1'))?.revision, 1);
	await owner.close(); await repository.close();
});

test('all durable edit failure paths preserve exact history and clipboard identity, including redo state', async () => {
	for (const store of ['photos', 'summaries', 'memberships', 'catalogStates']) {
		const { repository, indexedDB, owner } = await fixture();
		await owner.execute({ type: 'set-develop', develop: settings() });
		owner.copyDevelop();
		await owner.undo();
		const before = owner.history, clipboard = owner.clipboard;
		indexedDB.failNextPutForStore(store, new DOMException('quota refused', 'QuotaExceededError'));
		await assert.rejects(owner.execute({ type: 'set-attributes', changes: { rating: 4 } }), { name: 'QuotaExceededError' });
		assert.equal(owner.history, before, store);
		assert.equal(owner.clipboard, clipboard, store);
		assert.deepEqual(await repository.loadPhoto('catalog-1', 'photo-1'), before.present);
		await owner.redo();
		assert.equal(owner.history.present.versions[0]?.develop.effects[0]?.params.brightness, 0.3);
		await owner.close(); await repository.close();
	}
});

test('conflicting photo owners preserve the loser history and reload establishes a fresh durable baseline', async () => {
	const { repository, owner } = await fixture();
	const second = await PhotoCommandOwnerV1.open(repository, 'catalog-1', 'photo-1');
	const before = second.history;
	await owner.execute({ type: 'set-attributes', changes: { rating: 5 } });
	await assert.rejects(second.execute({ type: 'set-attributes', changes: { rating: 2 } }), { code: 'PHOTO_REVISION_CONFLICT' });
	assert.equal(second.history, before);
	await second.reload();
	assert.equal(second.history.present.rating, 5);
	assert.equal(second.history.past.length, 0);
	await second.execute({ type: 'set-attributes', changes: { rating: 2 } });
	assert.equal(second.history.present.revision, 2);
	await owner.close(); await second.close(); await repository.close();
});

test('cancel before or during durable mutation leaves history unchanged and closes transactions', async () => {
	const { repository, indexedDB, owner } = await fixture();
	const before = owner.history;
	const canceled = new AbortController(); canceled.abort();
	await assert.rejects(owner.execute({ type: 'set-attributes', changes: { rating: 3 } }, { signal: canceled.signal }), { name: 'AbortError' });
	assert.equal(owner.history, before);
	const active = new AbortController();
	indexedDB.onNextGetForStore('catalogs', () => active.abort());
	await assert.rejects(owner.execute({ type: 'set-attributes', changes: { rating: 3 } }, { signal: active.signal }), { name: 'AbortError' });
	assert.equal(owner.history, before);
	assert.equal(indexedDB.stats.activeTransactions, 0);
	assert.deepEqual(await repository.loadPhoto('catalog-1', 'photo-1'), before.present);
	await owner.close(); await repository.close();
});

test('late cancellation after successful commit publishes the acknowledged revision', async () => {
	const { repository, owner } = await fixture();
	await owner.close();
	const cancel = new AbortController();
	const port: PhotoCommandRepositoryPortV1 = { loadPhoto: repository.loadPhoto.bind(repository),
		savePhoto: async (...args) => { const saved = await repository.savePhoto(...args); cancel.abort(); return saved; } };
	const next = await PhotoCommandOwnerV1.open(port, 'catalog-1', 'photo-1');
	await next.execute({ type: 'set-attributes', changes: { rating: 4 } }, { signal: cancel.signal });
	assert.equal(next.history.present.revision, 1);
	assert.deepEqual(await repository.loadPhoto('catalog-1', 'photo-1'), next.history.present);
	await next.close(); await repository.close();
});

test('close arriving after durable commit still installs the acknowledged history before settling', async () => {
	const { repository, owner } = await fixture();
	await owner.close();
	let closing = Promise.resolve();
	const port: PhotoCommandRepositoryPortV1 = { loadPhoto: repository.loadPhoto.bind(repository),
		savePhoto: async (...args) => { const saved = await repository.savePhoto(...args); closing = next.close(); return saved; } };
	const next = await PhotoCommandOwnerV1.open(port, 'catalog-1', 'photo-1');
	await next.execute({ type: 'set-attributes', changes: { rating: 4 } });
	await closing;
	assert.equal(next.history.present.revision, 1);
	assert.deepEqual(await repository.loadPhoto('catalog-1', 'photo-1'), next.history.present);
	await assert.rejects(next.undo(), { code: 'PHOTO_COMMAND_CLOSED' });
	await repository.close();
});

test('one pending operation rejects overlap, and idempotent close waits for cancellation without closing the repository', async () => {
	const { repository, owner } = await fixture();
	await owner.close();
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => { release = resolve; });
	const port: PhotoCommandRepositoryPortV1 = { loadPhoto: repository.loadPhoto.bind(repository),
		savePhoto: async (...args) => { await blocked; return repository.savePhoto(...args); } };
	const next = await PhotoCommandOwnerV1.open(port, 'catalog-1', 'photo-1');
	const before = next.history;
	const pending = next.execute({ type: 'set-attributes', changes: { rating: 1 } });
	await assert.rejects(next.undo(), { code: 'PHOTO_COMMAND_BUSY' });
	const closed = next.close();
	assert.equal(next.close(), closed);
	let settled = false; void closed.then(() => { settled = true; });
	await Promise.resolve(); assert.equal(settled, false);
	release();
	await assert.rejects(pending, { name: 'AbortError' });
	await closed;
	assert.equal(next.history, before);
	await assert.rejects(next.redo(), { code: 'PHOTO_COMMAND_CLOSED' });
	assert.ok(await repository.loadPhoto('catalog-1', 'photo-1'));
	await repository.close();
});

test('virtual-copy creation, rename, activation and deletion remain undoable with a preserved master and original', async () => {
	const { repository, owner, photos } = await fixture();
	await owner.execute({ type: 'set-develop', develop: settings() });
	await owner.execute({ type: 'create-virtual-copy', id: 'copy', name: 'Warm', createdAt: '2026-10-07T01:00:00.000Z' });
	assert.equal(owner.history.present.activeVersionId, 'copy');
	await owner.execute({ type: 'set-develop', develop: settings(0.8) });
	await owner.execute({ type: 'rename-virtual-copy', versionId: 'copy', name: 'Warmer' });
	await owner.execute({ type: 'activate-version', versionId: 'version-1' });
	assert.equal(owner.history.present.versions[0]?.develop.effects[0]?.params.brightness, 0.3);
	await owner.execute({ type: 'activate-version', versionId: 'copy' });
	await owner.execute({ type: 'delete-virtual-copy', versionId: 'copy' });
	assert.equal(owner.history.present.activeVersionId, 'version-1');
	await owner.undo();
	assert.equal(owner.history.present.activeVersionId, 'copy');
	assert.equal(owner.history.present.versions[1]?.name, 'Warmer');
	assert.equal(owner.history.present.versions[1]?.develop.effects[0]?.params.brightness, 0.8);
	const before = owner.history;
	for (const command of [
		{ type: 'delete-virtual-copy', versionId: 'version-1' },
		{ type: 'rename-virtual-copy', versionId: 'version-1', name: 'Other' },
		{ type: 'activate-version', versionId: 'missing' },
		{ type: 'create-virtual-copy', id: 'copy', name: 'Duplicate', createdAt: '2026-10-07T01:00:00.000Z' },
	]) await assert.rejects(owner.execute(command));
	assert.equal(owner.history, before);
	assert.deepEqual(owner.history.present.original, photos[0]!.original);
	await owner.close(); await repository.close();
});

test('clipboard moves detached develop settings between photos without copying photo identities', async () => {
	const { repository, owner, photos } = await fixture();
	await owner.execute({ type: 'set-develop', develop: settings() });
	const clipboard = owner.copyDevelop();
	assert.equal(Object.hasOwn(clipboard, 'original'), false);
	assert.equal(Object.hasOwn(clipboard, 'photoId'), false);
	const second = await PhotoCommandOwnerV1.open(repository, 'catalog-1', 'photo-2');
	await second.pasteDevelop(clipboard);
	assert.deepEqual(second.history.present.original, photos[1]!.original);
	assert.equal(second.history.present.versions[0]?.develop.effects[0]?.params.brightness, 0.3);
	await second.undo();
	assert.equal(second.history.present.versions[0]?.develop.effects.length, 0);
	await second.redo();
	assert.equal(second.history.present.versions[0]?.develop.effects.length, 1);
	const mutable = { ...clipboard, develop: { ...clipboard.develop, geometry: { ...clipboard.develop.geometry } } };
	second.setClipboard(mutable);
	mutable.develop.geometry.rotationDegrees = 90;
	assert.equal(second.clipboard?.develop.geometry.rotationDegrees, 0);
	assert.equal(Object.isFrozen(second.clipboard?.develop.effects[0]?.params), true);
	await owner.close(); await second.close(); await repository.close();
});

test('no-op edits preserve redo and malformed commands cannot mutate history or invoke accessors', async () => {
	const { repository, owner } = await fixture();
	await owner.execute({ type: 'set-attributes', changes: { rating: 2 } }); await owner.undo();
	const before = owner.history;
	await owner.execute({ type: 'set-attributes', changes: { rating: 0 } });
	assert.equal(owner.history, before);
	const hostile = { rating: 3 };
	Object.defineProperty(hostile, 'rating', { enumerable: true, get() { assert.fail('Commands must not invoke getters.'); } });
	for (const command of [
		{ type: 'invented' }, { type: 'set-attributes', changes: hostile },
		{ type: 'set-attributes', changes: { original: photosOriginal() } },
		{ type: 'set-metadata', changes: { extractedMetadata: {} } },
		{ type: 'set-attributes', changes: { rating: 6 } },
		{ type: 'set-develop', develop: { ...settings(), processVersion: 2 } },
	]) await assert.rejects(owner.execute(command));
	assert.equal(owner.history, before);
	await owner.execute({ type: 'set-attributes', changes: { rating: 3 } });
	assert.equal(owner.history.future.length, 0);
	await owner.close(); await repository.close();
});

function photosOriginal() { return photoArchiveFixture().photo.original; }

test('history capacity is per photo and reopening starts from durable state without session snapshots', async () => {
	const { repository, owner } = await fixture();
	await owner.close();
	const bounded = await PhotoCommandOwnerV1.open(repository, 'catalog-1', 'photo-1', 2);
	for (const rating of [1, 2, 3, 4]) await bounded.execute({ type: 'set-attributes', changes: { rating } });
	assert.equal(bounded.history.past.length, 2);
	await bounded.close();
	const reopened = await PhotoCommandOwnerV1.open(repository, 'catalog-1', 'photo-1');
	assert.equal(reopened.history.present.rating, 4);
	assert.equal(reopened.history.present.revision, 4);
	assert.equal(reopened.history.past.length, 0);
	assert.equal(reopened.history.future.length, 0);
	await reopened.close(); await repository.close();
});

test('clipboard golden, seeded round-trip and adversarial admission keep shared develop contracts intact', () => {
	const empty = createPhotoDevelopClipboardV1(defaultPhotoDevelopV1());
	assert.equal(serializePhotoDevelopClipboardV1(empty), '{"schemaFamily":"lightscaper","schemaVersion":1,"kind":"photo-develop-clipboard","develop":{"processVersion":1,"effects":[],"geometry":{"crop":null,"rotationDegrees":0,"flipHorizontal":false,"flipVertical":false},"masks":[],"maskBindings":[]}}');
	fc.assert(fc.property(fc.integer({ min: -100, max: 100 }), (value) => {
		const packet = createPhotoDevelopClipboardV1(settings(value / 100));
		assert.deepEqual(parsePhotoDevelopClipboardV1(serializePhotoDevelopClipboardV1(packet)), packet);
	}), { seed: 304_729, numRuns: 50 });
	assert.throws(() => normalizePhotoDevelopClipboardV1({ ...empty, schemaVersion: 2 }), /future/iu);
	assert.throws(() => normalizePhotoDevelopClipboardV1({ ...empty, original: photosOriginal() }), /unsupported/iu);
	assert.throws(() => parsePhotoDevelopClipboardV1(' '.repeat(2_097_153)), /byte/iu);
	const external = { ...defaultPhotoDevelopV1(), masks: [{ schemaVersion: 1, id: 'external', kind: 'mask',
		inputs: [{ name: 'raster', sourceRef: 'donor-source', kind: 'raster' }],
		nodes: [{ id: 'raster-node', kind: 'raster', inputName: 'raster', channel: 'luma' }], outputNodeId: 'raster-node' }] };
	assert.throws(() => createPhotoDevelopClipboardV1(external), /external|media/iu);
});

test('photo history never replaces read-only extracted import facts', () => {
	const photo = photoArchiveFixture().photo;
	const metadata = { schemaVersion: 1, container: 'unsupported', exif: null, iptc: null, issues: [] };
	const history = createPhotoHistoryV1({ ...photo, extractedMetadata: metadata });
	assert.throws(() => commitPhotoHistoryV1(history, { ...history.present, extractedMetadata: null }), /extracted|import/iu);
	const next = commitPhotoHistoryV1(history, { ...history.present, metadata: { ...history.present.metadata, title: 'Authored' } });
	assert.deepEqual(next.present.extractedMetadata, history.present.extractedMetadata);
});
