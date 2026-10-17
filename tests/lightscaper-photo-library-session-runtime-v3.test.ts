/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { applyPhotoDevelopPresetV2 } from '../src/lightscaper/storage/photo-develop-presets-v2.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { LUT_BODY, LUT_REFERENCE, lutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });

function lockManager(): LockManager {
	const active = new Set<string>();
	return { async request(name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) {
		if (active.has(name)) return run(null);
		active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
}

test('actual runtime3 opens current Session2 and installs exact LUT bytes in its selected durable media namespace', async () => {
	const f = mediaRestoreFixture(), options = { name: 'Current', indexedDB: f.factory, locks: lockManager() };
	const session = await createPhotoLibrarySessionV3(options);
	try {
		assert.ok(session instanceof PhotoLibrarySessionV2); assert.equal(session.develop.schemaVersion, 2);
		assert.equal((await session.readPage()).totalCount, 0);
		const receipt = await session.cubeLuts.importFile(new File([LUT_BODY], 'profile.cube'));
		assert.deepEqual(receipt.reference, LUT_REFERENCE); assert.equal(receipt.created, true);
		await session.cubeLuts.source.withBytes(receipt.reference, bytes => { assert.deepEqual(bytes, LUT_BODY); });
	} finally { await session.close(); }
	const reopened = await createPhotoLibrarySessionV3(options);
	try {
		assert.equal((await reopened.cubeLuts.importFile(new File([LUT_BODY], 'profile.cube'))).created, false);
		await reopened.cubeLuts.source.withBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); });
	} finally { await reopened.close(); }
});

test('actual runtime3 Close joins a selected LUT consumer, retires once and wipes the borrowed bytes', async () => {
	const f = mediaRestoreFixture(), session = await createPhotoLibrarySessionV3({ name: 'Current', indexedDB: f.factory, locks: lockManager() });
	const entered = deferred<void>(), release = deferred<void>(), borrowed: { bytes: Uint8Array<ArrayBuffer> | null } = { bytes: null };
	await session.cubeLuts.importFile(new File([LUT_BODY], 'profile.cube'));
	const work = session.cubeLuts.source.withBytes(LUT_REFERENCE, async bytes => { borrowed.bytes = bytes; entered.resolve(); await release.promise; });
	const result = work.then(() => null, error => error as unknown);
	try {
		await entered.promise; const closing = session.close(); assert.equal(session.close(), closing);
		await remainsPending(closing);
		await assert.rejects(session.cubeLuts.importFile(new File([LUT_BODY], 'profile.cube')), /closed/u);
		release.resolve(); await result; await closing;
		assert.ok(borrowed.bytes); assert.equal(borrowed.bytes.some(value => value !== 0), false);
	} finally { release.resolve(); await session.close(); }
});

test('actual current Session imports a saved resource recipe through native custody and refuses a later missing body before saving', async () => {
	const f = mediaRestoreFixture(), media = new PhotoMediaStoreV1({ indexedDB: f.factory, locks: null, preferOpfs: false });
	const resources = await media.getCubeLutResources(), input = photoArchiveFixture(), recipe = lutArchiveFixture().row.presets[0]!;
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: f.factory, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Current', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await resources.put(LUT_REFERENCE, LUT_BODY);
	const root = await catalog.loadCatalog('catalog-1'); assert.ok(root);
	const presets = await applyPhotoDevelopPresetV2(media.settingsRepository, root,
		{ type: 'save', expectedRevision: 0, preset: recipe }, { verifyResources: (preset, signal) => resources.verifyPreset(preset, signal) });
	const session = new PhotoLibrarySessionV2({ catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, settings: media.settingsRepository, developPresetSettings: media.settingsRepository,
		cubeLutResources: async () => resources, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal),
		initialize: async () => { const root = await catalog.loadCatalog('catalog-1'); if (!root) throw new Error('Missing root'); return root; },
		prepare: async function* () { yield { ...input, outcome: 'prepared' as const, index: 0,
			fileName: input.photo.original.name, keywordNames: ['Travel'], notices: [] }; },
		closeResources: async () => { await catalog.close(); await media.close(); },
	});
	try {
		const result = await session.developImport.importFiles([new File([new Uint8Array([1, 2, 3])], input.photo.original.name)], {
			schemaVersion: 2, developPreset: { schemaVersion: 2, catalogId: root.id, presetId: recipe.identity.id, expectedRevision: presets.revision },
			settings: { rename: null, metadata: { title: 'Authored on import' }, keywordIds: [] },
		});
		assert.equal(result[0]?.status, 'imported');
		const photo = await catalog.loadPhoto(root.id, input.photo.id); assert.ok(photo);
		assert.equal(photo.schemaVersion, 2); assert.equal(photo.metadata.title, 'Authored on import');
		assert.equal(photo.versions[0]?.workspace?.schemaVersion, 2); assert.equal(photo.versions[0]?.workspace?.entries.length, 2);
		assert.equal(photo.keywordIds.length, 1); assert.deepEqual(photo.extractedMetadata, input.photo.extractedMetadata);
		await media.verifyOriginal(photo.original);
		const mediaName = f.opens.find(open => open.name.includes('media'))?.name; assert.ok(mediaName);
		await f.remove(mediaName, 'analysis', LUT_REFERENCE.storageKey);
		await assert.rejects(session.setRating(photo.id, 5), /missing/u);
		const unchanged = await catalog.loadPhoto(root.id, photo.id); assert.deepEqual(unchanged, photo);
	} finally { await session.close(); }
});
