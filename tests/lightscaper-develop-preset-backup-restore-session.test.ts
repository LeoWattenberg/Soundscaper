/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { importPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-import-v4.ts';
import { restorePhotoLibraryArchiveV1 } from '../src/lightscaper/controller/photo-library-archive-restore-v1.ts';
import { createPhotoLibrarySessionV2 } from '../src/lightscaper/photo-library-session-runtime-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { photoDevelopPresetsKeyV1, normalizePhotoDevelopPresetRowV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 as POINTER } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { developPresetArchiveFixture, developPresetArchiveRow, developPresetArchiveRichRow,
	developPresetArchiveDestination } from './helpers/lightscaper-develop-preset-archive-fixture.ts';
import { savedArchiveFixtureV3, savedArchiveStateV3, savedArchiveDefinitionV3, savedArchiveRootV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { stackArchiveRecord } from './helpers/lightscaper-stack-archive-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const key = photoDevelopPresetsKeyV1('catalog-1');

async function fixture() {
	const f = mediaRestoreFixture(), locks = new MemoryLockManager() as unknown as LockManager;
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.factory, locks, preferOpfs: false }); await anchor.ready();
	await anchor.settingsRepository.put(POINTER, { schemaVersion: 1, kind: 'photo-library', catalogId: 'catalog-1' });
	const stale = developPresetArchiveRow(7, 1, 'Stale anchor'); await anchor.settingsRepository.put(key, stale);
	let allocated = 9;
	return { ...f, anchor, stale, options: { indexedDB: f.factory, locks, settings: anchor.settingsRepository, name: 'Library',
		allocateToken: () => (++allocated).toString(16).repeat(32) },
		open: () => createPhotoLibrarySessionV2({ name: 'Library', indexedDB: f.factory, locks }) };
}

test('Actual Session preset saves survive production backup, private restore, reopen and a second backup with all catalog companions', async () => {
	const f = await fixture(), rich = developPresetArchiveRichRow();
	try {
		await restorePhotoLibraryArchiveV1(await developPresetArchiveFixture(null), f.options);
		const source = await f.open(); let backup: Blob;
		let archivedPhotos: ReturnType<typeof developPresetArchiveDestination>['photos'];
		const expected = normalizePhotoDevelopPresetRowV1({ ...rich, revision: 2 }, 'catalog-1');
		try {
			const presets = source.develop.presets!;
			assert.equal((await presets.list({ schemaVersion: 1, catalogId: 'catalog-1' })).revision, 0);
			for (const [index, preset] of rich.presets.entries()) {
				const ack = await presets.write({ schemaVersion: 1, catalogId: 'catalog-1', command: { type: 'save', expectedRevision: index, preset } });
				assert.equal(ack.snapshot.revision, index + 1); assert.deepEqual(ack.notices, []);
			}
			const output = await source.backupCatalog(); assert.ok(output.blob); backup = output.blob;
			assert.equal(output.photoCount, 2); assert.equal(output.byteLength, backup.size); assert.deepEqual(output.notices, []);
			const witness = developPresetArchiveDestination();
			assert.deepEqual(await importPhotoCatalogArchiveV4(backup, async (_root, state, header) => {
				assert.deepEqual(state, savedArchiveStateV3(1)); assert.ok(header); assert.equal(header.revision, 2); assert.equal(header.presetCount, 2);
				return witness.stage;
			}), savedArchiveRootV3());
			assert.deepEqual(witness.row, expected); assert.deepEqual([...witness.stacks.values()], [stackArchiveRecord()]);
			assert.deepEqual([...witness.saved.values()], [savedArchiveDefinitionV3()]);
			assert.deepEqual([...witness.photos.values()].map(value => value.photo.revision), [13, 14]);
			for (const value of witness.photos.values()) assert.deepEqual(value.bytes, new Uint8Array([1, 2, 3]));
			archivedPhotos = witness.photos;
			assert.deepEqual(await f.anchor.settingsRepository.get(key), f.stale);
		} finally { await source.close(); }
		const restored = await restorePhotoLibraryArchiveV1(backup, f.options);
		assert.equal(restored.originalByteLength, 6); assert.deepEqual(restored.notices, []);
		for (let reopening = 0; reopening < 2; reopening++) {
			const selected = await f.open();
			try {
				const menu = await selected.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog-1' });
				assert.equal(menu.revision, 2); assert.deepEqual(menu.presets.map(preset => preset.scope), ['full', 'partial']);
				for (const preset of expected.presets) assert.deepEqual((await selected.develop.presets!.read({ schemaVersion: 1,
					catalogId: 'catalog-1', expectedRevision: 2, presetId: preset.identity.id })).preset, preset);
				const again = await selected.backupCatalog(), witness = developPresetArchiveDestination(); assert.ok(again.blob);
				await importPhotoCatalogArchiveV4(again.blob, async () => witness.stage);
				assert.deepEqual(witness.row, expected); assert.deepEqual([...witness.stacks.values()], [stackArchiveRecord()]);
				assert.deepEqual([...witness.saved.values()], [savedArchiveDefinitionV3()]);
				// Compare complete authenticated photo documents, including every version,
				// workspace, source fact and original binding, across both durable reopens.
				assert.deepEqual(witness.photos, archivedPhotos);
			} finally { await selected.close(); }
		}
		assert.deepEqual(await f.anchor.settingsRepository.get(key), f.stale); assert.deepEqual(f.deleted, []);
	} finally { await f.anchor.close(); }
});

test('Selected Session backup preserves legacy absence, V4 absence and a positive empty preset revision without falling back to the anchor', async () => {
	for (const input of [await savedArchiveFixtureV3(), await developPresetArchiveFixture(null), await developPresetArchiveFixture(developPresetArchiveRow(29, 0))]) {
		const f = await fixture();
		try {
			await restorePhotoLibraryArchiveV1(input, f.options); const selected = await f.open();
			try {
				const revision = (await selected.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog-1' })).revision;
				const output = await selected.backupCatalog(), witness = developPresetArchiveDestination(); assert.ok(output.blob);
				await importPhotoCatalogArchiveV4(output.blob, async (_root, _state, header) => {
					assert.equal(header?.revision ?? 0, revision); return witness.stage;
				});
				assert.deepEqual(witness.row, revision === 0 ? null : developPresetArchiveRow(29, 0));
				assert.deepEqual(await f.anchor.settingsRepository.get(key), f.stale);
			} finally { await selected.close(); }
		} finally { await f.anchor.close(); }
	}
});
