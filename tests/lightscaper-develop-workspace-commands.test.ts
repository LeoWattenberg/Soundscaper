/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { parseLightscaperDocumentV1, serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PhotoCommandOwnerV1 } from '../src/lightscaper/controller/photo-command-owner.ts';
import { applyPhotoCommandV1 } from '../src/lightscaper/controller/photo-commands.ts';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { importPhotoCatalogArchiveV1, type PhotoCatalogArchiveStageV1 } from '../src/lightscaper/archive/catalog-archive-import.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const CREATED = '2026-10-09T00:00:00.000Z';
const settings = (exposure: number) => ({ ...defaultPhotoDevelopV1(), effects: [createVideoEffect('tone-ladder-v1', {
	id: 'tone', params: { exposure },
})] });
const edit = (exposure: number) => ({ type: 'record-develop', develop: settings(exposure), label: `Exposure ${exposure}`, createdAt: CREATED });
const snapshot = { type: 'save-develop-snapshot', id: 'snapshot', name: 'Bright', createdAt: CREATED };
const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
	kind: 'photo-catalog', id: 'catalog-1', name: 'Develop library', revision: 0, photoCount: 0,
	folders: [], keywords: [], collections: [] });

test('legacy photo bytes omit workspace until an explicit develop history or snapshot command opts in', () => {
	const { photo } = photoArchiveFixture();
	assert.equal(serializeLightscaperDocumentV1(photo).includes('workspace'), false);
	const legacy = applyPhotoCommandV1(photo, { type: 'set-develop', develop: settings(1) });
	assert.equal(Object.hasOwn(legacy.versions[0]!, 'workspace'), false);
	const edited = applyPhotoCommandV1(photo, edit(1));
	assert.equal(edited.versions.length, 1);
	assert.equal(edited.versions[0]!.workspace?.entries.length, 2);
	assert.deepEqual(edited.original, photo.original);
	assert.deepEqual(edited.extractedMetadata, photo.extractedMetadata);
	assert.deepEqual(parseLightscaperDocumentV1(serializeLightscaperDocumentV1(edited)), edited);
});

test('history and snapshots belong to one version and are never virtual copies or donor metadata', () => {
	let photo = applyPhotoCommandV1(photoArchiveFixture().photo, edit(1));
	photo = applyPhotoCommandV1(photo, snapshot);
	photo = applyPhotoCommandV1(photo, edit(2));
	photo = applyPhotoCommandV1(photo, { type: 'create-virtual-copy', id: 'copy', name: 'Alternate', createdAt: CREATED });
	assert.equal(photo.versions.length, 2);
	assert.equal(Object.hasOwn(photo.versions[1]!, 'workspace'), false);
	photo = applyPhotoCommandV1(photo, edit(-1));
	assert.equal(photo.versions[0]!.workspace?.snapshots.length, 1);
	assert.equal(photo.versions[1]!.workspace?.snapshots.length, 0);
	photo = applyPhotoCommandV1(photo, { type: 'restore-develop-snapshot', versionId: 'version-1', snapshotId: 'snapshot',
		label: 'Restore Bright', createdAt: CREATED });
	assert.equal(photo.activeVersionId, 'copy');
	assert.equal(photo.versions[0]!.develop.effects[0]!.params.exposure, 1);
	assert.equal(photo.versions[1]!.develop.effects[0]!.params.exposure, -1);
	photo = applyPhotoCommandV1(photo, { type: 'select-develop-history', versionId: 'version-1', cursor: 0 });
	assert.equal(photo.versions[0]!.develop.effects.length, 0);
	assert.equal(photo.versions[0]!.workspace?.snapshots[0]!.develop.effects[0]!.params.exposure, 1);
	photo = applyPhotoCommandV1(photo, { type: 'set-develop', versionId: 'version-1', develop: settings(3) });
	assert.equal(photo.versions[0]!.workspace?.entries.length, 2);
	assert.equal(photo.versions[0]!.workspace?.entries[1]!.develop.effects[0]!.params.exposure, 3);
	assert.equal(photo.versions[0]!.workspace?.entries[1]!.createdAt, null);
	assert.throws(() => normalizePhotoDocumentV1({ ...photo, versions: [{ ...photo.versions[0], develop: settings(-2) }, photo.versions[1]] }), /history|settings/iu);
});

test('per-version history survives durable reopen while a failed snapshot publication leaves no state', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'develop-workspace', verifyOriginal: async () => undefined });
	await repository.createCatalog(root());
	const initial = photoArchiveFixture().photo;
	await repository.publishPhotos('catalog-1', 0, [initial]);
	const owner = await PhotoCommandOwnerV1.open(repository, 'catalog-1', initial.id);
	try {
		await owner.execute(edit(1));
		await owner.execute(snapshot);
		await owner.execute(edit(2));
		await owner.execute({ type: 'select-develop-history', cursor: 1 });
		const before = owner.history;
		indexedDB.failNextPutForStore('photos', new DOMException('Full', 'QuotaExceededError'));
		await assert.rejects(owner.execute({ ...snapshot, id: 'failed' }), { name: 'QuotaExceededError' });
		assert.equal(owner.history, before);
		assert.deepEqual(await repository.loadPhoto('catalog-1', initial.id), before.present);
		await owner.close();
		const reopened = await PhotoCommandOwnerV1.open(repository, 'catalog-1', initial.id);
		try {
			assert.deepEqual(reopened.history.present, before.present);
			assert.equal(reopened.history.present.versions[0]!.workspace?.entries.length, 3);
			assert.equal(reopened.history.present.versions[0]!.workspace?.cursor, 1);
			assert.equal(reopened.history.present.versions[0]!.workspace?.snapshots.length, 1);
			assert.deepEqual(reopened.history.present.original, initial.original);
		} finally { await reopened.close(); }
	} finally { await owner.close(); await repository.close(); }
});

test('Scape catalog custody retains complete version history and immutable snapshots beside exact original bytes', async () => {
	const fixture = photoArchiveFixture();
	let photo = applyPhotoCommandV1(fixture.photo, edit(1));
	photo = applyPhotoCommandV1(photo, snapshot);
	photo = applyPhotoCommandV1(photo, edit(-1));
	const catalog = normalizePhotoCatalogRootV1({ ...root(), photoCount: 1 });
	const archive = await exportPhotoCatalogArchiveV1(catalog, [{ ...fixture, photo }]);
	assert.ok(archive.blob);
	const rows: unknown[] = [], originalParts: Uint8Array[] = [];
	let published = false;
	const stage: PhotoCatalogArchiveStageV1 = {
		async writePhoto(value, chunks) { rows.push(value); for await (const chunk of chunks) originalParts.push(chunk.slice()); },
		async publish() { published = true; }, async rollback() { assert.fail('Valid history archive must publish.'); },
	};
	await importPhotoCatalogArchiveV1(archive.blob, async () => stage);
	assert.equal(published, true);
	assert.deepEqual(rows, [photo]);
	assert.deepEqual(new Uint8Array(await new Blob(originalParts as BlobPart[]).arrayBuffer()), new Uint8Array(await fixture.original.arrayBuffer()));
});
