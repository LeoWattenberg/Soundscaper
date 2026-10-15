/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { repairSettingsFixture, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';

test('the selected Current Session saves and reopens process4 without replacing its immutable PNG Original', async () => {
	const f = await repairSettingsFixture(1);
	let reopened: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try {
		const custody = await f.inspect(), before = await f.session.develop.read({ schemaVersion: 3, photoId: f.photos[0]!.id });
		const develop = normalizeImageDevelopStateV4({ ...before.develop, processVersion: 4,
			rawDevelopment: { schemaVersion: 1, mode: 'recovery' } });
		// This is native scalar persistence using a genuine PNG. It proves no
		// RAW decode or recovery authority for the Original's byte pixels.
		const ack = await f.session.develop.apply({ schemaVersion: 3, photoId: before.photoId, expectedRevision: before.revision,
			command: { type: 'record-develop', versionId: before.versionId, develop, label: 'Recovery selection', createdAt: SETTINGS_TIME } });
		assert.deepEqual(ack.notices, []); assert.deepEqual(ack.snapshot.develop, develop);
		assert.equal(ack.snapshot.revision, before.revision + 1); assert.equal(ack.snapshot.history.cursor, before.history.cursor + 1);
		await f.session.close(); reopened = await createPhotoLibrarySessionCurrentV1(f.options);
		const saved = await reopened.develop.read({ schemaVersion: 3, photoId: before.photoId });
		assert.deepEqual(saved.develop, develop); assert.equal(saved.revision, ack.snapshot.revision);
		assert.ok(reopened.develop.original && 'withDerivedFrame' in reopened.develop.original);
		assert.equal(typeof reopened.develop.original.withDerivedFrame, 'function');
		await assert.rejects(reopened.legacyDevelop!.read({ schemaVersion: 2, photoId: before.photoId }));
		const after = await f.inspect();
		assert.equal(after[0]!.photo.schemaVersion, 3); assert.deepEqual(after[0]!.photo.original, custody[0]!.photo.original);
		assert.deepEqual(after[0]!.bytes, custody[0]!.bytes);
	} finally { await reopened?.close(); await f.close(); }
});

test('the selected Current rename and guarded inverse retain the complete process4 workspace and Original', async () => {
	const f = await repairSettingsFixture(1);
	try {
		const before = await f.session.develop.read({ schemaVersion: 3, photoId: f.photos[0]!.id });
		const develop = normalizeImageDevelopStateV4({ ...before.develop, processVersion: 4,
			rawDevelopment: { schemaVersion: 1, mode: 'headroom' } });
		const saved = await f.session.develop.apply({ schemaVersion: 3, photoId: before.photoId, expectedRevision: before.revision,
			command: { type: 'record-develop', versionId: before.versionId, develop, label: 'Headroom selection', createdAt: SETTINGS_TIME } });
		const custody = (await f.inspect())[0]!, child = f.session.batchRenameCurrent; assert.ok(child);
		const selection = await child.readBatchRenameSelection([before.photoId]);
		assert.deepEqual(selection.selection, [{ photoId: before.photoId, expectedRevision: saved.snapshot.revision, fileName: custody.photo.metadata.fileName }]);
		const plan = child.planBatchRename({ ...selection, rename: { template: '{stem}-{sequence}.{extension}', sequenceStart: 1, sequencePadding: 2 } });
		const renamed = await child.renamePhotos(plan); assert.equal(renamed.items[0]?.status, 'renamed'); assert.ok(renamed.undo);
		const after = (await f.inspect())[0]!;
		assert.deepEqual(after.photo.versions, custody.photo.versions); assert.deepEqual(after.photo.original, custody.photo.original); assert.deepEqual(after.bytes, custody.bytes);
		const restored = await child.undoBatchRename(renamed.undo); assert.equal(restored.items[0]?.status, 'restored'); assert.equal(restored.undo, null);
		const final = (await f.inspect())[0]!;
		assert.deepEqual(final.photo.versions, custody.photo.versions); assert.equal(final.photo.metadata.fileName, custody.photo.metadata.fileName);
		assert.deepEqual(final.photo.original, custody.photo.original); assert.deepEqual(final.bytes, custody.bytes);
		assert.equal(final.photo.revision, custody.photo.revision + 2);
	} finally { await f.close(); }
});

test('selected derived Original capability obeys opaque preabort and the parent Close lifetime', async () => {
	const f = await repairSettingsFixture(1), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
	try {
		const child = f.session.develop.original; assert.ok(child?.withDerivedFrame);
		let delivered = 0, reflected = 0;
		const hostile = new Proxy({}, { ownKeys() { reflected++; throw new Error('Derived request reflected.'); } });
		let failure: unknown;
		try { await Reflect.apply(child.withDerivedFrame, child, [hostile, () => { delivered++; }, { signal: stop.signal }]); }
		catch (error) { failure = error; }
		assert.ok(Object.is(failure, opaque.proxy)); assert.equal(reflected, 0); assert.equal(delivered, 0);
		const snapshot = await f.session.develop.read({ schemaVersion: 3, photoId: f.photos[0]!.id });
		await f.session.close();
		await assert.rejects(child.withDerivedFrame({ schemaVersion: 1, photoId: snapshot.photoId,
			expectedRevision: snapshot.revision, profile: 'highlight-recovery-v1' }, () => { delivered++; }));
		assert.equal(delivered, 0);
	} finally { await f.close(); }
});
