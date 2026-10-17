/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryBackupPortV1 } from '../src/common/editor/photo-library-backup-port-v1.ts';
import { createPhotoLibrarySessionV1 } from '../src/lightscaper/photo-library-session-runtime.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { importPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-import.ts';
import { stackArchiveDestination } from './helpers/lightscaper-stack-archive-fixture.ts';
import { importPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-import-v4.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });

async function fixture(count = 1, savedMode: 'defined' | 'deleted' | null = null) {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const previousDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
	Object.defineProperty(globalThis, 'navigator', { value: { locks: new MemoryLockManager() }, configurable: true });
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	const sources = Array.from({ length: count }, (_, index) => photoArchiveFixture(index + 1)), source = sources[0]!;
	for (const selected of sources) {
		await media.mediaRepository.writeAsset(selected.photo.original.storageKey, selected.original);
		await media.mediaRepository.catalogOriginals.retain('catalog-1', [{ photoId: selected.photo.id, sourceId: selected.photo.original.id,
			assetId: selected.photo.original.storageKey, sha256: selected.photo.original.contentSha256, size: selected.original.size }]);
	}
	await catalog.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Existing runtime library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }));
	const root = await catalog.publishPhotos('catalog-1', 0, sources.map(selected => selected.photo));
	const stack = count > 1 ? await catalog.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id,
		id: 'runtime-stack', revision: 0, photoIds: [...sources].reverse().map(selected => selected.photo.id), coverPhotoId: source.photo.id }), null,
	{ expectedCatalogRevision: root.revision, expectedStateRevision: 0 }) : null;
	const definition = normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id,
		id: 'runtime-saved', name: 'Metadata selection', revision: 0, query: { schemaVersion: 2, kind: 'photo-catalog-query',
			text: 'Photo', filter: null, sort: { field: 'capture-time', direction: 'descending' },
			predicate: { kind: 'not', term: { kind: 'text', column: 'lens', operator: 'equals', value: 'Excluded lens' } } } });
	async function writeOptions() {
		const { context } = await catalog.readSmartCollectionSnapshotV1(root.id, null);
		return { expectedCatalogRevision: context.catalogRevision, expectedIndexRevision: context.indexRevision,
			expectedStateRevision: context.collectionStateRevision };
	}
	if (savedMode !== null) await catalog.saveSmartCollection(definition, null, await writeOptions());
	if (savedMode === 'deleted') await catalog.deleteSmartCollection(root.id, definition.id, 0, await writeOptions());
	const savedState = (await catalog.readSmartCollectionArchiveContextV1(root.id)).state;
	await media.settingsRepository.putIfAbsent(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, { schemaVersion: 1, kind: 'photo-library', catalogId: 'catalog-1' });
	await Promise.all([catalog.close(), media.close()]);
	const session: ReturnType<typeof createPhotoLibrarySessionV1> & PhotoLibraryBackupPortV1 = createPhotoLibrarySessionV1({ name: 'Fallback library' });
	return { session, source, sources, stack, definition, savedState, restore: () => {
		if (previousDb) Object.defineProperty(globalThis, 'indexedDB', previousDb); else Reflect.deleteProperty(globalThis, 'indexedDB');
		if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
	} };
}

test('default runtime authenticates the immutable original before passing its exact size to the same-record media loader', async () => {
	const f = await fixture(), events: string[] = [];
	const metadata = MediaRepository.prototype.getAssetMetadata, load = MediaRepository.prototype.loadAsset;
	MediaRepository.prototype.getAssetMetadata = async function (key) { events.push(`verify:${key}`); return metadata.call(this, key); };
	MediaRepository.prototype.loadAsset = function (key, options = {}) {
		events.push(`load:${key}`); assert.equal(options.expectedSize, f.source.original.size);
		assert.ok(options.signal instanceof AbortSignal); return load.call(this, key, options);
	};
	try {
		const output = await f.session.backupCatalog(); assert.ok(output.blob);
		assert.equal(output.catalogName, 'Existing runtime library'); assert.equal(output.photoCount, 1);
		assert.deepEqual(events, ['verify:original-1', 'load:original-1']);
	} finally {
		MediaRepository.prototype.getAssetMetadata = metadata; MediaRepository.prototype.loadAsset = load;
		await f.session.close(); f.restore();
	}
});

test('production backup preserves complete saved metadata criteria and a retained empty revision with photos and stacks', async () => {
	for (const mode of ['defined', 'deleted'] as const) {
		const f = await fixture(3, mode), target = stackArchiveDestination(), definitions: unknown[] = [];
		try {
			const output = await f.session.backupCatalog(); assert.ok(output.blob);
			await importPhotoCatalogArchiveV4(output.blob, async (_root, state) => {
				assert.deepEqual(state, f.savedState);
				return { ...target.stage, writeDevelopPresets: async () => { assert.fail('No Develop presets'); }, writeSavedCollection: async definition => { definitions.push(definition); } };
			});
			assert.deepEqual(definitions, mode === 'defined' ? [f.definition] : []);
			assert.deepEqual([...target.stacks.values()], [f.stack]); assert.equal(target.photos.size, 3);
			assert.deepEqual(output.notices, []); assert.equal(target.events.at(-1), 'publish');
		} finally { await f.session.close(); f.restore(); }
	}
});

test('default production session exports archive4 with absent saved state, the durable ordered stack and exact retained originals', async () => {
	const f = await fixture(3), target = stackArchiveDestination();
	try {
		const output = await f.session.backupCatalog(); assert.ok(output.blob); assert.ok(f.stack);
		assert.equal(output.photoCount, 3); assert.deepEqual(output.notices, []);
		const restored = await importPhotoCatalogArchiveV4(output.blob, async (_root, state) => {
			assert.equal(state, null);
			return { ...target.stage, writeDevelopPresets: async () => { assert.fail('No Develop presets'); }, writeSavedCollection: async () => { assert.fail('No saved filters'); } };
		});
		assert.equal(restored.id, 'catalog-1'); assert.equal(restored.revision, 2);
		assert.deepEqual([...target.stacks.values()], [f.stack]);
		assert.deepEqual(f.stack.photoIds, ['photo-3', 'photo-2', 'photo-1']); assert.equal(f.stack.coverPhotoId, 'photo-1');
		for (const source of f.sources) {
			const photo = target.photos.get(source.photo.id); assert.ok(photo); assert.deepEqual(photo.photo, source.photo);
			assert.deepEqual(photo.bytes, new Uint8Array(await source.original.arrayBuffer()));
		}
		await assert.rejects(importPhotoCatalogArchiveV1(output.blob, async () => target.stage));
		assert.deepEqual(target.events.slice(-1), ['publish']);
	} finally { await f.session.close(); f.restore(); }
});

test('default runtime refuses a changed custody digest before opening any original body', async () => {
	const f = await fixture(); let loads = 0;
	const metadata = MediaRepository.prototype.getAssetMetadata, load = MediaRepository.prototype.loadAsset;
	MediaRepository.prototype.getAssetMetadata = async function (key) {
		const value = await metadata.call(this, key); return value ? { ...value, sha256: 'f'.repeat(64) } : null;
	};
	MediaRepository.prototype.loadAsset = function (...args) { loads++; return load.apply(this, args); };
	try { await assert.rejects(f.session.backupCatalog(), error => contains(error, /media identity/iu)); assert.equal(loads, 0); }
	finally {
		MediaRepository.prototype.getAssetMetadata = metadata; MediaRepository.prototype.loadAsset = load;
		await f.session.close(); f.restore();
	}
});

function contains(value: unknown, pattern: RegExp): boolean {
	return value instanceof Error && (pattern.test(value.message) || (value instanceof AggregateError && value.errors.some(error => contains(error, pattern))));
}
