/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createPhotoDevelopWorkspaceCurrentV1, commitPhotoDevelopWorkspaceCurrentV1, selectPhotoDevelopHistoryCurrentV1,
	savePhotoDevelopSnapshotCurrentV1, restorePhotoDevelopSnapshotCurrentV1, deletePhotoDevelopSnapshotCurrentV1,
	parsePhotoDevelopWorkspaceCurrentV1, serializePhotoDevelopWorkspaceCurrentV1,
	upgradePhotoDevelopWorkspaceV3 } from '../src/lightscaper/catalog/photo-develop-workspace-current-v1.ts';
import { normalizePhotoDevelopWorkspaceV3 } from '../src/lightscaper/catalog/photo-develop-workspace-v3.ts';
import { createPhotoDevelopClipboardCurrentV1, parsePhotoDevelopClipboardCurrentV1, serializePhotoDevelopClipboardCurrentV1 } from '../src/lightscaper/controller/photo-develop-clipboard-current-v1.ts';
import { normalizePhotoDevelopClipboardV3 } from '../src/lightscaper/controller/photo-develop-clipboard-v3.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { applyPhotoCommandCurrentV1 } from '../src/lightscaper/controller/photo-commands-current-v1.ts';
import { applyPhotoCommandForProfileV1 } from '../src/lightscaper/controller/photo-commands-kernel.ts';
import { createPhotoHistoryForProfileV1 } from '../src/lightscaper/catalog/photo-history-kernel.ts';
import { PhotoCommandOwnerCurrentV1 } from '../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';

const TIME = '2026-10-15T00:00:00.000Z';
const step = (label: string) => ({ label, createdAt: TIME });
function recovery(mode: 'canonical' | 'headroom' | 'recovery' = 'recovery') {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4, repairs: { schemaVersion: 1, spots: [] }, rawDevelopment: { schemaVersion: 1, mode } });
}

test('Current history creates an explicit workspace4 retaining the recovery source recipe', () => {
	const develop = normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4,
		repairs: { schemaVersion: 1, spots: [] }, rawDevelopment: { schemaVersion: 1, mode: 'recovery' } });
	const workspace = createPhotoDevelopWorkspaceCurrentV1(develop, { label: 'Recover sensor highlights', createdAt: '2026-10-15T00:00:00.000Z' });
	assert.equal(workspace.schemaVersion, 4); assert.deepEqual(workspace.entries[0]!.develop, develop);
});

test('Current history promotes on explicit recovery, branches from old states, and restores exact saved RAW snapshots', () => {
	const old = defaultImageDevelopStateV1(), repair = normalizeImageDevelopStateV3({ ...old, processVersion: 3, repairs: { schemaVersion: 1, spots: [] } });
	let workspace = createPhotoDevelopWorkspaceCurrentV1(old, step('Original settings'));
	workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, repair, step('Repairs')); const before = workspace.entries;
	workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, recovery(), step('Recover'));
	assert.equal(workspace.schemaVersion, 4); assert.deepEqual(workspace.entries.map(entry => entry.develop), [old, repair, recovery()]);
	workspace = savePhotoDevelopSnapshotCurrentV1(workspace, { id: 'recover', name: 'Recovered é', createdAt: TIME });
	const complete = workspace; workspace = selectPhotoDevelopHistoryCurrentV1(workspace, 0);
	assert.equal(workspace.schemaVersion, 4); assert.deepEqual(workspace.entries, complete.entries); assert.deepEqual(workspace.entries[workspace.cursor]!.develop, old);
	workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, recovery('headroom'), step('Branch headroom'));
	assert.deepEqual(workspace.entries.map(entry => entry.develop), [old, recovery('headroom')]); assert.deepEqual(workspace.snapshots, complete.snapshots);
	workspace = restorePhotoDevelopSnapshotCurrentV1(workspace, { snapshotId: 'recover', label: 'Restore recovered', createdAt: TIME });
	assert.deepEqual(workspace.entries.at(-1)!.develop, recovery()); assert.equal(workspace.schemaVersion, 4);
	assert.deepEqual(parsePhotoDevelopWorkspaceCurrentV1(serializePhotoDevelopWorkspaceCurrentV1(workspace)), workspace);
	assert.deepEqual(complete.entries.slice(0, 2), before);
	workspace = deletePhotoDevelopSnapshotCurrentV1(workspace, 'recover'); assert.deepEqual(workspace.snapshots, []);
});

test('same-mode edits do not grow history and canonical reset retains the process4 history envelope', () => {
	const original = recovery(), initial = createPhotoDevelopWorkspaceCurrentV1(original, step('Recovered'));
	const repeated = setImageDevelopRawDevelopmentCurrentV1(original, { schemaVersion: 1, mode: 'recovery' });
	assert.deepEqual(commitPhotoDevelopWorkspaceCurrentV1(initial, repeated, step('Same mode')), initial);
	const canonical = setImageDevelopRawDevelopmentCurrentV1(original, { schemaVersion: 1, mode: 'canonical' });
	const changed = commitPhotoDevelopWorkspaceCurrentV1(initial, canonical, step('Canonical'));
	assert.equal(changed.schemaVersion, 4); assert.equal(changed.entries.length, 2); assert.deepEqual(initial.entries[0]!.develop, original);
	assert.throws(() => normalizePhotoDevelopWorkspaceV3(changed)); assert.throws(() => upgradePhotoDevelopWorkspaceV3(changed));
	const oldOnly = { ...changed, entries: [{ ...changed.entries[0], develop: defaultImageDevelopStateV1() }], cursor: 0 };
	assert.equal(parsePhotoDevelopWorkspaceCurrentV1(JSON.stringify(oldOnly)).schemaVersion, 4);
	assert.throws(() => normalizePhotoDevelopWorkspaceV3(oldOnly));
});

test('whole clipboard4 roundtrips RAW processing and old fixed clipboard3 stays strict without migrating old JSON', () => {
	const develop = recovery(), packet = createPhotoDevelopClipboardCurrentV1(develop), text = serializePhotoDevelopClipboardCurrentV1(packet);
	assert.equal(packet.schemaVersion, 4); assert.deepEqual(packet.develop, develop); assert.deepEqual(parsePhotoDevelopClipboardCurrentV1(text), packet);
	assert.throws(() => normalizePhotoDevelopClipboardV3(packet));
	const old = createPhotoDevelopClipboardCurrentV1(defaultImageDevelopStateV1()), oldText = serializePhotoDevelopClipboardCurrentV1(old);
	assert.equal(serializePhotoDevelopClipboardCurrentV1(parsePhotoDevelopClipboardCurrentV1(oldText)), oldText);
	assert.equal(old.schemaVersion, 2); assert.equal(old.develop.processVersion, 1);
});

test('history and clipboard reject hostile nested source settings without invoking accessors or dropping inactive history', () => {
	let invoked = 0; const workspace = createPhotoDevelopWorkspaceCurrentV1(recovery(), step('Recovered'));
	const hostile = Object.defineProperty({ schemaVersion: 1, mode: 'recovery' }, 'mode', { enumerable: true, get() { invoked++; return 'canonical'; } });
	const badRecipe = { ...recovery(), rawDevelopment: hostile };
	assert.throws(() => commitPhotoDevelopWorkspaceCurrentV1(workspace, badRecipe, step('Hostile')));
	assert.throws(() => parsePhotoDevelopWorkspaceCurrentV1(JSON.stringify({ ...workspace, entries: [{ ...workspace.entries[0], develop: { ...recovery(), processVersion: 5 } }] })));
	assert.throws(() => createPhotoDevelopClipboardCurrentV1(badRecipe));
	assert.equal(invoked, 0); assert.deepEqual(workspace.entries[0]!.develop, recovery());
});

test('Current commands retain RAW snapshots through legacy cursor selection and virtual copies while fixed current3 refuses them', () => {
	// Scalar command evidence; source authentication and decoding remain owned
	// by the actual Original/derived Session borrowers.
	const original = photoArchiveFixture().photo;
	let photo = applyPhotoCommandCurrentV1(original, { type: 'record-develop', develop: recovery(), label: 'Recovery', createdAt: TIME });
	assert.equal(photo.schemaVersion, 3); assert.equal(photo.versions[0]!.workspace!.schemaVersion, 4);
	photo = applyPhotoCommandCurrentV1(photo, { type: 'save-develop-snapshot', id: 'recovery', name: 'Saved recovery', createdAt: TIME });
	photo = applyPhotoCommandCurrentV1(photo, { type: 'select-develop-history', cursor: 0 });
	assert.equal(photo.versions[0]!.develop.processVersion, 1);
	assert.deepEqual(photo.versions[0]!.workspace!.snapshots[0]!.develop, recovery());
	assert.throws(() => applyPhotoCommandForProfileV1('current3', photo, { type: 'set-metadata', changes: { title: 'Fixed policy' } }));
	assert.throws(() => createPhotoHistoryForProfileV1('current3', photo));
	photo = applyPhotoCommandCurrentV1(photo, { type: 'restore-develop-snapshot', snapshotId: 'recovery', label: 'Restore', createdAt: TIME });
	photo = applyPhotoCommandCurrentV1(photo, { type: 'create-virtual-copy', id: 'copy', name: 'Recovery copy', createdAt: TIME });
	assert.deepEqual(photo.versions[1]!.develop, recovery()); assert.equal(photo.versions[1]!.workspace, undefined);
	assert.deepEqual(photo.original, original.original); assert.equal(photo.revision, original.revision);
});

test('actual Current command CAS history undo and redo preserve the RAW source setting without rewriting its retained Original identity', async () => {
	const native = createInstrumentedIndexedDB(), raw = rawRecoveryDngFixtureV1(), seed = photoArchiveFixture(1, raw.bytes);
	const photo = normalizePhotoDocumentV1({ ...seed.photo, original: { ...seed.photo.original,
		name: 'Recovery.dng', mimeType: 'image/x-adobe-dng', width: raw.width, height: raw.height } });
	const repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native as unknown as IDBFactory,
		databaseName: 'raw-current-command-history', verifyOriginal: async () => undefined });
	let owner: PhotoCommandOwnerCurrentV1 | undefined;
	try {
		await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: photo.catalogId,
			name: 'RAW history', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await repository.publishPhotos(photo.catalogId, 0, [photo]); owner = await PhotoCommandOwnerCurrentV1.open(repository, photo.catalogId, photo.id);
		await owner.execute({ type: 'record-develop', develop: recovery(), label: 'Recover', createdAt: TIME });
		await owner.execute({ type: 'save-develop-snapshot', id: 'recovery', name: 'Saved recovery', createdAt: TIME });
		assert.deepEqual(owner.history.present.versions[0]!.workspace!.snapshots[0]!.develop, recovery());
		await owner.undo(); await owner.undo();
		assert.equal(owner.history.present.schemaVersion, 3); assert.equal(owner.history.present.versions[0]!.develop.processVersion, 1);
		assert.equal(owner.history.present.revision, 4); assert.deepEqual(owner.history.present.original, photo.original);
		await owner.redo(); await owner.redo(); assert.equal(owner.history.present.revision, 6);
		assert.deepEqual(owner.history.present.versions[0]!.develop, recovery());
		const before = owner.history; native.failNextPutForStore('photos', new DOMException('Quota', 'QuotaExceededError'));
		await assert.rejects(owner.execute({ type: 'record-develop', develop: recovery('headroom'), label: 'Headroom', createdAt: TIME }));
		assert.equal(owner.history, before); assert.deepEqual(await repository.loadPhoto(photo.catalogId, photo.id), before.present);
		await owner.close(); owner = await PhotoCommandOwnerCurrentV1.open(repository, photo.catalogId, photo.id);
		assert.deepEqual(owner.history.present, before.present); assert.equal(owner.canUndo, false); assert.deepEqual(owner.history.present.original, photo.original);
	} finally { await owner?.close(); await repository.close(); }
});
