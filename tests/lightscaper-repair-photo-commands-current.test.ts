/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPhotoCommandCurrentV1 } from '../src/lightscaper/controller/photo-commands-current-v1.ts';
import { applyPhotoCommandV2 } from '../src/lightscaper/controller/photo-commands-v2.ts';
import { PhotoCommandOwnerCurrentV1 } from '../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { PhotoCommandOwnerV2 } from '../src/lightscaper/controller/photo-command-owner-v2.ts';
import { normalizePhotoDevelopWorkspaceCommandCurrentV1 } from '../src/lightscaper/controller/photo-develop-workspace-commands-current-v1.ts';
import { normalizePhotoDevelopWorkspaceCommandV2 } from '../src/lightscaper/controller/photo-develop-workspace-commands-v2.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { createPhotoDevelopClipboardV2 } from '../src/lightscaper/controller/photo-develop-clipboard-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const TIME = '2026-10-11T00:00:00.000Z';
function repaired(enabled = true) {
	return replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [{ id: 'repair', mode: 'heal', enabled,
		target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0.2, opacity: 0.75 }] });
}
const record = (develop = repaired()) => ({ type: 'record-develop', develop, label: 'Repair', createdAt: TIME });
async function fixture() {
	const raw = createInstrumentedIndexedDB(), databaseName = 'repair-command-current';
	const legacy = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory, databaseName, verifyOriginal: async () => undefined });
	await legacy.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current', revision: 0,
		photoCount: 0, folders: [], keywords: [], collections: [] });
	const seed = photoArchiveFixture().photo; await legacy.publishPhotos('catalog-1', 0, [seed]);
	// The actual V2 owner seeds a legacy row. Current storage is borrowed lazily
	// so baseline RED reaches command behavior rather than an unrelated fixture stub.
	const state: { repository?: PhotoCatalogRepositoryCurrentV1; owner?: PhotoCommandOwnerCurrentV1 } = {};
	const repository = () => state.repository ??= new PhotoCatalogRepositoryCurrentV1({ indexedDB: raw as unknown as IDBFactory,
		databaseName, verifyOriginal: async () => undefined });
	const port = { loadPhoto: (catalogId: string, photoId: string) => repository().loadPhoto(catalogId, photoId),
		savePhoto: (...args: Parameters<PhotoCatalogRepositoryCurrentV1['savePhoto']>) => repository().savePhoto(...args) };
	try { state.owner = new PhotoCommandOwnerCurrentV1(port, seed); }
	catch (error) { await state.repository?.close(); await legacy.close(); throw error; }
	return { raw, owner: state.owner, repository, legacy, async close() { await state.owner?.close(); await state.repository?.close(); await legacy.close(); } };
}

test('current commands explicitly set and record process3 while old command owners remain strict', () => {
	const seed = photoArchiveFixture().photo, recipe = repaired();
	const command = normalizePhotoDevelopWorkspaceCommandCurrentV1(record(recipe));
	assert.equal(command.type, 'record-develop');
	if (command.type !== 'record-develop') assert.fail('The authored record command changed kind');
	assert.deepEqual(command.develop, recipe); assert.equal(Object.isFrozen(command.develop), true);
	const set = applyPhotoCommandCurrentV1(seed, { type: 'set-develop', develop: recipe });
	assert.equal(set.schemaVersion, 3); assert.deepEqual(set.versions[0]?.develop, recipe);
	const next = applyPhotoCommandCurrentV1(seed, command);
	assert.equal(next.schemaVersion, 3); assert.equal(next.versions[0]?.workspace?.schemaVersion, 3);
	assert.deepEqual(next.versions[0]?.workspace?.entries.map(entry => entry.develop.processVersion), [1, 3]);
	assert.deepEqual(next.original, seed.original); assert.equal(next.revision, seed.revision);
	assert.throws(() => applyPhotoCommandV2(seed, record(recipe)));
	assert.throws(() => applyPhotoCommandV2(next, { type: 'set-attributes', changes: { rating: 1 } }));
	assert.throws(() => normalizePhotoDevelopWorkspaceCommandV2(record(recipe)));
	assert.throws(() => new PhotoCommandOwnerV2({ loadPhoto: async () => null, savePhoto: async () => seed }, next));
});

test('current snapshots, legacy cursor selection, virtual copies and metadata retain complete repair history', () => {
	const seed = photoArchiveFixture().photo, recipe = repaired();
	let next = applyPhotoCommandCurrentV1(seed, record(recipe));
	next = applyPhotoCommandCurrentV1(next, { type: 'save-develop-snapshot', id: 'snapshot', name: 'Repair', createdAt: TIME });
	next = applyPhotoCommandCurrentV1(next, { type: 'select-develop-history', cursor: 0 });
	assert.equal(next.schemaVersion, 3); assert.equal(next.versions[0]?.develop.processVersion, 1);
	assert.deepEqual(next.versions[0]?.workspace?.entries[1]?.develop, recipe);
	assert.deepEqual(next.versions[0]?.workspace?.snapshots[0]?.develop, recipe);
	next = applyPhotoCommandCurrentV1(next, { type: 'restore-develop-snapshot', snapshotId: 'snapshot', label: 'Restored', createdAt: TIME });
	next = applyPhotoCommandCurrentV1(next, { type: 'create-virtual-copy', id: 'copy', name: 'Copy', createdAt: TIME });
	assert.deepEqual(next.versions[1]?.develop, recipe); assert.equal(next.versions[1]?.workspace, undefined);
	next = applyPhotoCommandCurrentV1(next, { type: 'set-metadata', changes: { title: 'Repaired original',
		captureTime: { local: '2026-10-11T00:00:00.000', offsetMinutes: 0 } } });
	next = applyPhotoCommandCurrentV1(next, { type: 'rename-virtual-copy', versionId: 'copy', name: 'Renamed' });
	assert.equal(next.versions[1]?.name, 'Renamed'); assert.equal(next.metadata.title, 'Repaired original');
	assert.deepEqual(next.versions[0]?.workspace?.snapshots[0]?.develop, recipe);
	next = applyPhotoCommandCurrentV1(next, { type: 'activate-version', versionId: 'version-1' });
	next = applyPhotoCommandCurrentV1(next, { type: 'delete-virtual-copy', versionId: 'copy' });
	assert.equal(next.versions.length, 1); assert.equal(next.schemaVersion, 3); assert.deepEqual(next.original, seed.original);
	assert.throws(() => applyPhotoCommandCurrentV1(next, { type: 'delete-virtual-copy', versionId: 'version-1' }));
});

test('current safe legacy commands preserve exact old results and closed field/accessor refusal', () => {
	const seed = photoArchiveFixture().photo;
	for (const command of [{ type: 'set-attributes', changes: { rating: 3 } }, { type: 'set-metadata', changes: { title: 'Authored' } },
		{ type: 'set-develop', develop: defaultImageDevelopStateV2() }, { ...record(), develop: defaultImageDevelopStateV2() }]) {
		assert.deepEqual(applyPhotoCommandCurrentV1(seed, command), applyPhotoCommandV2(seed, command));
	}
	let getters = 0;
	const accessed = Object.defineProperty({ type: 'set-develop' }, 'develop', { enumerable: true, get() { getters++; return repaired(); } });
	assert.throws(() => applyPhotoCommandCurrentV1(seed, accessed));
	assert.throws(() => normalizePhotoDevelopWorkspaceCommandCurrentV1(Object.defineProperty(record(), 'develop',
		{ enumerable: true, get() { getters++; return repaired(); } })));
	for (const invalid of [{ ...record(), body: new Uint8Array([1]) }, { ...record(), versionId: 'missing' },
		{ type: 'set-develop', develop: { ...repaired(), processVersion: 4 } }, { type: 'activate-version', versionId: 'version-1', body: true }]) {
		assert.throws(() => applyPhotoCommandCurrentV1(seed, invalid));
	}
	assert.equal(getters, 0); assert.deepEqual(seed, photoArchiveFixture().photo);
});

test('actual current command CAS saves repair metadata and monotonically undo/redoes without downgrading on reopen', async () => {
	const f = await fixture();
	try {
		const recipe = repaired(), saved = await f.owner.execute(record(recipe));
		assert.equal(saved.schemaVersion, 3); assert.equal(saved.revision, 1);
		assert.deepEqual(await f.repository().loadPhoto('catalog-1', 'photo-1'), saved);
		await f.owner.execute({ type: 'save-develop-snapshot', id: 'snapshot', name: 'Repair', createdAt: TIME });
		await f.owner.undo(); assert.equal(f.owner.history.present.schemaVersion, 3);
		await f.owner.undo(); assert.equal(f.owner.history.present.schemaVersion, 3);
		assert.equal(f.owner.history.present.versions[0]?.develop.processVersion, 1); assert.equal(f.owner.history.present.revision, 4);
		await f.owner.redo(); await f.owner.redo(); assert.equal(f.owner.history.present.revision, 6);
		assert.deepEqual(f.owner.history.present.versions[0]?.workspace?.snapshots[0]?.develop, recipe);
		const unchanged = f.owner.history; await f.owner.execute({ type: 'set-attributes', changes: { rating: 0 } });
		assert.equal(f.owner.history, unchanged);
		await f.owner.close(); const reopened = await PhotoCommandOwnerCurrentV1.open(f.repository(), 'catalog-1', 'photo-1');
		try { assert.deepEqual(reopened.history.present, unchanged.present); assert.equal(reopened.history.past.length, 0); }
		finally { await reopened.close(); }
		assert.deepEqual(unchanged.present.original, photoArchiveFixture().photo.original);
	} finally { await f.close(); }
});

test('failed real native current saves and stale owners publish no repair history', async () => {
	const f = await fixture(), before = f.owner.history;
	const second = new PhotoCommandOwnerCurrentV1(f.repository(), before.present);
	try {
		f.raw.failNextPutForStore('photos', new DOMException('Quota', 'QuotaExceededError'));
		await assert.rejects(f.owner.execute(record())); assert.equal(f.owner.history, before);
		assert.deepEqual(await f.repository().loadPhoto('catalog-1', 'photo-1'), before.present);
		await f.owner.execute(record());
		await assert.rejects(second.execute({ type: 'set-attributes', changes: { rating: 1 } }), { code: 'PHOTO_REVISION_CONFLICT' });
		assert.deepEqual(second.history.present, before.present); assert.equal(second.canUndo, false);
	} finally { await second.close(); await f.close(); }
});

test('unsupported process3 clipboard and workspace paste refuse before writes while unrelated legacy versions remain usable', async () => {
	const f = await fixture();
	try {
		await f.owner.execute({ type: 'create-virtual-copy', id: 'legacy-copy', name: 'Legacy', createdAt: TIME });
		await f.owner.execute({ type: 'activate-version', versionId: 'version-1' }); await f.owner.execute(record());
		const before = f.owner.history, clipboard = createPhotoDevelopClipboardV2(defaultImageDevelopStateV2());
		assert.throws(() => f.owner.copyDevelop(), /process|repair|clipboard|current/iu);
		await assert.rejects(f.owner.pasteDevelop(clipboard), /process|repair|clipboard|workspace/iu);
		assert.equal(f.owner.history, before); assert.deepEqual(await f.repository().loadPhoto('catalog-1', 'photo-1'), before.present);
		await f.owner.execute({ type: 'select-develop-history', cursor: 0 });
		const selectedLegacy = f.owner.history; await assert.rejects(f.owner.pasteDevelop(clipboard), /process|repair|clipboard|workspace/iu);
		assert.equal(f.owner.history, selectedLegacy);
		await f.owner.execute({ type: 'activate-version', versionId: 'legacy-copy' });
		const retained = f.owner.history.present.versions[0]?.workspace;
		f.owner.setClipboard(clipboard); await f.owner.pasteDevelop(); assert.equal(f.owner.history.present.schemaVersion, 3);
		assert.deepEqual(f.owner.history.present.versions[0]?.workspace, retained);
		assert.equal(f.owner.copyDevelop().develop.processVersion, 2);
	} finally { await f.close(); }
});
