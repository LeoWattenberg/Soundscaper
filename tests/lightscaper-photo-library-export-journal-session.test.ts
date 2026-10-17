/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { PhotoRasterExportJournalOwnerV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { createPhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
function journal(catalogId: string) {
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'real-session', format: 'png', filenameTemplate: '{index}-{name}',
		members: [{ photoId: 'current-photo', versionId: 'master', expectedRevision: 0, sourceFileName: 'Current.png' }] });
	return createPhotoRasterExportJournalV1(plan, { catalogId, filenameTemplate: '{index}-{name}',
		bindings: [{ originalSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64), lutSha256: [] }] });
}
test('actual selected runtime persists a separate export journal across Session close and reopen', async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const session = await seeded.createSession();
	try {
		const access = await session.exportJournal!.open(), owner = new PhotoRasterExportJournalOwnerV1(access.settings, access.catalogId);
		assert.equal(await owner.load(), null); await owner.create(journal(access.catalogId)); await owner.started('real-session:1'); await owner.closeAndJoin();
	} finally { await session.close(); }
	const reopened = await seeded.createSession();
	try {
		const access = await reopened.exportJournal!.open(), owner = new PhotoRasterExportJournalOwnerV1(access.settings, access.catalogId);
		assert.equal((await owner.load())?.members[0]!.state, 'started');
		await assert.rejects(access.settings.get('photo-library:managed-import'), /journal/u);
		await assert.rejects(access.settings.putIfAbsent(`photo-library:raster-export-journal:v1:other`, journal('other')), /journal/u);
		await owner.closeAndJoin();
	} finally { await reopened.close(); }
});
test('returned CAS facade cannot outlive the selected Session and never owns a renderer lease', async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks()), session = await seeded.createSession();
	const access = await session.exportJournal!.open();
	assert.equal((await session.develop.read({ schemaVersion: 2, photoId: 'current-photo' })).photoId, 'current-photo');
	await session.close(); await assert.rejects(access.settings.get(`photo-library:raster-export-journal:v1:${access.catalogId}`), /closed/u);
});

test('resource verification admits the same closed own-data saved binding without invoking request getters', async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks()), session = await seeded.createSession();
	try {
		const access = await session.exportJournal!.open(); let reads = 0;
		const request = { catalogId: seeded.photo.catalogId, photoId: seeded.photo.id, versionId: seeded.photo.activeVersionId, expectedRevision: seeded.photo.revision };
		const accessor = Object.defineProperty({ ...request }, 'photoId', { enumerable: true, get() { reads++; return request.photoId; } });
		for (const malformed of [accessor, { ...request, authority: new Blob() }, Object.create(request) as typeof request, { ...request, expectedRevision: -1 }]) {
			await assert.rejects(async () => access.verifyResources(malformed));
		}
		assert.equal(reads, 0); await access.verifyResources(request);
	} finally { await session.close(); }
});
