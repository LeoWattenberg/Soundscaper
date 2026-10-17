/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createImageDevelopSelectedPresetV3 } from '../src/common/editor/imaging/image-develop-preset-selected-v3.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { createPhotoCatalogArchiveReachabilityCurrentV1 } from '../src/lightscaper/archive/catalog-archive-reachability-current-v1.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V4 } from '../src/lightscaper/archive/catalog-pack-v4.ts';
import { PHOTO_STACK_PACK_LIMITS_V1 } from '../src/lightscaper/archive/stack-pack.ts';
import { PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 } from '../src/lightscaper/archive/smart-collection-pack-v1.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { createPhotoLibraryBackupPackCounterCurrentV1, assertPhotoLibraryBackupCapacityCurrentV1 } from '../src/lightscaper/controller/internal/photo-library-backup-capacity-current-v1.ts';
import { repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { FULL_SETTINGS_SELECTION } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { repairBackupCurrentFixture, repairBackupDestination, readRepairBackupArchive } from './helpers/lightscaper-repair-backup-current-fixture.ts';

function resourceRow(catalogId: string, resourceCount: number) {
	const masks = Array.from({ length: Math.ceil(resourceCount / 256) }, (_, graphIndex) => ({ schemaVersion: 1, id: `mask-${graphIndex}`, kind: 'mask',
		inputs: Array.from({ length: Math.min(256, resourceCount - graphIndex * 256) }, (_, index) => {
			const ordinal = graphIndex * 256 + index + 1;
			return { name: `alpha-${index}`, kind: 'alpha', sourceRef: `brush-mask-v1:1:1:${ordinal.toString(16).padStart(64, '0')}` };
		}), nodes: [{ id: 'full', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'full' }));
	const develop = normalizeImageDevelopStateCurrentV1({ ...repairRecipe(), masks });
	const preset = createImageDevelopSelectedPresetV3({ schemaVersion: 3, id: 'capacity', name: 'Capacity',
		settings: { schemaVersion: 3, kind: 'photo-develop-settings', selection: FULL_SETTINGS_SELECTION, develop } });
	return normalizePhotoDevelopPresetRowCurrentV1({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId, revision: 1, presets: [preset] }, catalogId);
}

test('selected Current backup reserves real Photo and preset packs before any resource, Original or destination acquisition', async () => {
	const f = await repairBackupCurrentFixture('active', 1), target = repairBackupDestination(f.events);
	try {
		const row = resourceRow(f.root.id, 4_093), closure = createPhotoCatalogArchiveReachabilityCurrentV1();
		closure.addPhoto(f.records[0]!.photo); closure.addPresetRow(row, f.root.id);
		assert.equal(closure.finish().brushes.length, 4_093); await f.writeRow(row);
		await assert.rejects(f.session.backupCatalog({ createWritable: target.createWritable }), /archive.*(?:capacity|entry|slot|pack)|(?:capacity|entry|slot|pack).*archive/iu);
		assert.deepEqual(f.events, []); assert.deepEqual(await f.row(), row); assert.deepEqual(await f.inspect(), f.records.map(value => value.photo));
	} finally { await f.close(); }
});

test('selected Current capacity counts compact native Photos by actual pack partition rather than one asset per Photo', async () => {
	const f = await repairBackupCurrentFixture('active', 65);
	try {
		const result = await f.session.backupCatalog(); assert.ok(result.blob);
		const value = await readRepairBackupArchive(result.blob), packs = value.document.packs as { photoCount: number }[];
		assert.equal(value.document.schemaVersion, 7); assert.deepEqual(packs.map(pack => pack.photoCount), [65]);
		assert.equal(f.events.filter(event => event === 'original').length, 65); assert.deepEqual(await f.inspect(), f.records.map(value => value.photo));
	} finally { await f.close(); }
});

for (const [kind, limits] of [['photo', PHOTO_CATALOG_PACK_LIMITS_V4], ['stack', PHOTO_STACK_PACK_LIMITS_V1],
	['saved-collection', PHOTO_SMART_COLLECTION_PACK_LIMITS_V1]] as const) test(`${kind} capacity follows exact record and byte boundaries including each eight-byte magic`, () => {
	const empty = createPhotoLibraryBackupPackCounterCurrentV1(kind); assert.equal(empty.finish(), 0); assert.throws(() => { empty.add(128); }, /sealed/u);
	const exactBytes = createPhotoLibraryBackupPackCounterCurrentV1(kind); exactBytes.add(limits.maximumPackBytes - 8); assert.equal(exactBytes.finish(), 1);
	const nextBytePack = createPhotoLibraryBackupPackCounterCurrentV1(kind); nextBytePack.add(limits.maximumPackBytes - 8); nextBytePack.add(128); assert.equal(nextBytePack.finish(), 2);
	const exactRecords = createPhotoLibraryBackupPackCounterCurrentV1(kind), nextRecordPack = createPhotoLibraryBackupPackCounterCurrentV1(kind);
	for (let index = 0; index < limits.maximumRecords; index++) { exactRecords.add(128); nextRecordPack.add(128); }
	assert.equal(exactRecords.finish(), 1); nextRecordPack.add(128); assert.equal(nextRecordPack.finish(), 2);
});

test('complete capacity reserves stack, saved-definition and empty preset-row packs while accepting the exact shared slot boundary', async () => {
	const stack = normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog-1', id: 'stack', revision: 0,
		photoIds: ['photo-1', 'photo-2'], coverPhotoId: 'photo-1' });
	const definition = normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog-1', id: 'saved',
		name: 'Saved', revision: 0, query: { schemaVersion: 2, kind: 'photo-catalog-query' } });
	async function* records<Value>(value: Value) { yield value; }
	await assertPhotoLibraryBackupCapacityCurrentV1(1, 4_090, true, records(stack), records(definition));
	await assert.rejects(assertPhotoLibraryBackupCapacityCurrentV1(1, 4_091, true, records(stack), records(definition)), /archive.*capacity/iu);
});
