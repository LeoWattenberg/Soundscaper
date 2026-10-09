/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoLibraryMembershipsV2, applyPhotoLibraryMembershipsV2 } from '../src/lightscaper/controller/photo-library-memberships-v2.ts';
import { PhotoCommandOwnerV2 } from '../src/lightscaper/controller/photo-command-owner-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { CURRENT_TIME, currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('current membership edits retain actual inactive/history/disabled resources and immutable originals', async () => {
	const f = await currentDevelopFixture(1);
	try {
		const root = await f.repository.loadCatalog('catalog-1'); assert.ok(root);
		f.raw.seedRecord('current-develop-session', 'catalogs', { ...root, folders: [{ id: 'folder', name: 'Folder', parentId: null }] });
		await f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 0, command: {
			type: 'record-develop', versionId: 'version-1', develop: currentRecipe(), label: 'LUT', createdAt: CURRENT_TIME } });
		await f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 1, command: {
			type: 'save-develop-snapshot', versionId: 'version-1', id: 'saved', name: 'Saved LUT', createdAt: CURRENT_TIME } });
		await f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 2, command: {
			type: 'create-virtual-copy', id: 'copy', name: 'Copy', sourceVersionId: 'version-1', createdAt: CURRENT_TIME } });
		await f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 3, command: {
			type: 'select-develop-history', versionId: 'version-1', cursor: 0 } });
		const owner = await PhotoCommandOwnerV2.open(f.repository, 'catalog-1', 'photo-1');
		try {
			const before = owner.history.present; assert.throws(() => normalizePhotoDocumentV1(before));
			assert.equal(readPhotoLibraryMembershipsV2(owner, 'photo-1').revision, 4);
			const ack = await applyPhotoLibraryMembershipsV2(owner, 'photo-1', 4, { folderId: 'folder' });
			assert.equal(ack.snapshot.folderId, 'folder'); assert.equal(ack.snapshot.revision, 5);
			assert.equal(owner.history.present.schemaVersion, 2); assert.deepEqual(owner.history.present.versions, before.versions);
			assert.deepEqual(owner.history.present.original, before.original); assert.deepEqual(owner.history.present.extractedMetadata, before.extractedMetadata);
			await assert.rejects(applyPhotoLibraryMembershipsV2(owner, 'photo-1', 4, { folderId: null }), /revision/iu);
			const noOp = await applyPhotoLibraryMembershipsV2(owner, 'photo-1', 5, { folderId: 'folder' }); assert.equal(noOp.snapshot.revision, 5);
		} finally { await owner.close(); }
	} finally { await f.close(); }
});

test('current memberships normalize the complete photo before scalar reads and refuse native preabort without inspecting it', async () => {
	const f = await currentDevelopFixture(1), owner = await PhotoCommandOwnerV2.open(f.repository, 'catalog-1', 'photo-1');
	let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('opaque'); }, getPrototypeOf() { traps++; throw Error('opaque'); } });
	const stop = new AbortController(); stop.abort(reason);
	try {
		const result = await applyPhotoLibraryMembershipsV2(owner, 'photo-1', 0, {}, { signal: stop.signal }).then(() => ({ error: null }), error => ({ error: error as unknown }));
		assert.equal(result.error === reason, true); assert.equal(traps, 0); assert.equal(owner.history.present.revision, 0);
		assert.throws(() => readPhotoLibraryMembershipsV2({ history: { present: { ...owner.history.present, versions: [{ ...owner.history.present.versions[0], develop: { processVersion: 99 } }] } } } as never, 'photo-1'));
		assert.throws(() => readPhotoLibraryMembershipsV2(owner, 'foreign'));
	} finally { await owner.close(); await f.close(); }
});

test('current membership native save ACK remains owned while Close joins the held return', async () => {
	const f = await currentDevelopFixture(1), root = await f.repository.loadCatalog('catalog-1'); assert.ok(root);
	f.raw.seedRecord('current-develop-session', 'catalogs', { ...root, folders: [{ id: 'folder', name: 'Folder', parentId: null }] });
	const save = f.repository.savePhoto;
	const entered = deferred<void>(), release = deferred<void>();
	f.repository.savePhoto = async (...args) => { const ack = await Reflect.apply(save, f.repository, args); entered.resolve(); await release.promise; return ack; };
	const owner = await PhotoCommandOwnerV2.open(f.repository, 'catalog-1', 'photo-1');
	const work = applyPhotoLibraryMembershipsV2(owner, 'photo-1', 0, { folderId: 'folder' });
	try {
		await Promise.race([entered.promise, work.then(() => { throw Error('Save returned before the held ACK'); }, error => { throw error; })]);
		const closing = owner.close(); assert.equal(await remainsPending(closing), true);
		release.resolve(); assert.equal((await work).snapshot.revision, 1); await closing;
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.folderId, 'folder');
	} finally { release.resolve(); await owner.close(); await f.close(); }
});
