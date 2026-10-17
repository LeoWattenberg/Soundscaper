/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryBatchRenamePortV1 } from '../src/common/editor/photo-library-batch-rename-port-v1.ts';
import type { PhotoLibraryDevelopCommandV3 } from '../src/common/editor/photo-library-develop-port-v3.ts';
import type { PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { repairSettingsFixture, brushSettingsRecipe, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { repairPresetsFixture } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { repairBackupCurrentFixture } from './helpers/lightscaper-repair-backup-current-fixture.ts';
import { LUT_BODY, LUT_REFERENCE, profile } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const rename = Object.freeze({ template: '{stem}-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 2 });
type Fixture = Awaited<ReturnType<typeof repairPresetsFixture>>;
function child(session: { readonly batchRenameCurrent?: Readonly<PhotoLibraryBatchRenamePortV1> }) {
	assert.ok(session.batchRenameCurrent, 'The actual selected Current Session must expose batchRenameCurrent.'); return session.batchRenameCurrent;
}
function scalar(photo: PhotoDocumentCurrentV1) {
	return { photoId: photo.id, expectedRevision: photo.revision, fileName: photo.metadata.fileName };
}
function renamed(photo: PhotoDocumentCurrentV1, fileName: string, revision = photo.revision + 1) {
	return { ...photo, revision, metadata: { ...photo.metadata, fileName } };
}
async function command(f: Fixture, command: PhotoLibraryDevelopCommandV3) {
	const before = await f.read(); return f.session.develop.apply({ schemaVersion: 3, photoId: before.photoId,
		expectedRevision: before.revision, command });
}
async function retainedWork(f: Fixture) {
	const brush = await f.installBrush(), lut = await f.session.cubeLuts.importFile(new Blob([LUT_BODY]));
	assert.deepEqual(lut.reference, LUT_REFERENCE);
	const base = brushSettingsRecipe(brush.reference), develop = normalizeImageDevelopStateCurrentV1({ ...base, effects: [profile(false)] });
	await f.record(develop); const versionId = (await f.read()).versionId;
	await command(f, { type: 'save-develop-snapshot', versionId, id: 'retained-snapshot', name: 'Saved repairs', createdAt: SETTINGS_TIME });
	await command(f, { type: 'create-virtual-copy', sourceVersionId: versionId, id: 'retained-copy', name: 'Inactive repairs', createdAt: SETTINGS_TIME });
	await command(f, { type: 'activate-version', versionId });
	await command(f, { type: 'select-develop-history', versionId, cursor: 0 });
	assert.equal((await f.read()).develop.processVersion, 1);
	const bodies = (session = f.session) => Promise.all([
		session.cubeLuts.source.withBytes(lut.reference, bytes => Uint8Array.from(bytes)),
		session.maskRasterSource.withBytes(brush.reference, bytes => Uint8Array.from(bytes)),
	]);
	return { bodies };
}

test('selected repaired Photo3 enters the named Current session batch rename scalar selection', async () => {
	const f = await repairSettingsFixture(1);
	try {
		const before = await f.inspect(), photo = before[0]!.photo;
		assert.equal(photo.schemaVersion, 3);
		const snapshot = await child(f.session).readBatchRenameSelection([photo.id]);
		assert.deepEqual(snapshot, { schemaVersion: 1, catalogId: photo.catalogId,
			selection: [scalar(photo)] });
		assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('inherited batch rename read, apply and inverse remain permanently strict for genuine Photo3', async () => {
	const f = await repairSettingsFixture(1);
	try {
		const before = await f.inspect(), photo = before[0]!.photo, cap = child(f.session);
		await assert.rejects(f.session.readBatchRenameSelection([photo.id]), /Unsupported photo document version/u);
		const plan = cap.planBatchRename({ schemaVersion: 1, catalogId: photo.catalogId, selection: [scalar(photo)], rename });
		const refused = await f.session.renamePhotos(plan); assert.equal(refused.items[0]!.status, 'failed'); assert.equal(refused.undo, null);
		assert.equal(f.saved.length, 0); assert.deepEqual(await f.inspect(), before);
		const renamedAck = await cap.renamePhotos(plan); assert.equal(renamedAck.items[0]!.status, 'renamed'); assert.ok(renamedAck.undo);
		const changed = await f.inspect(), inverse = await f.session.undoBatchRename(renamedAck.undo);
		assert.equal(inverse.items[0]!.status, 'failed'); assert.deepEqual(inverse.undo, renamedAck.undo);
		assert.equal(f.saved.length, 1); assert.deepEqual(await f.inspect(), changed);
	} finally { await f.close(); }
});

test('native Current rename and guarded undo preserve inactive repairs, redo, snapshot, brush and disabled LUT through reopen', async () => {
	const f = await repairPresetsFixture(); let reopened: Awaited<ReturnType<Fixture['reopen']>> | undefined;
	try {
		const resources = await retainedWork(f), bodies = await resources.bodies(), before = await f.inspect(); f.saved.splice(0);
		const cap = child(f.session), order = [before[1]!.photo, before[0]!.photo], snapshot = await cap.readBatchRenameSelection(order.map(photo => photo.id));
		assert.deepEqual(snapshot, { schemaVersion: 1, catalogId: before[0]!.photo.catalogId, selection: order.map(scalar) });
		const plan = cap.planBatchRename({ ...snapshot, rename }); assert.equal(plan.schemaVersion, 1); assert.equal(plan.kind, 'photo-batch-rename');
		assert.deepEqual(plan.items.map(item => ({ index: item.index, photoId: item.photoId, fileName: item.fileName })), [
			{ index: 0, photoId: before[1]!.photo.id, fileName: 'Photo 2-07.png' }, { index: 1, photoId: before[0]!.photo.id, fileName: 'Photo 1-08.png' }]);
		assert.deepEqual(await f.inspect(), before); assert.equal(f.saved.length, 0);
		const receipt = await cap.renamePhotos(plan); assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.action, 'rename'); assert.equal(receipt.completion, 'finished');
		assert.deepEqual(receipt.items.map(item => item.status), ['renamed', 'renamed']); assert.ok(receipt.undo);
		assert.deepEqual(receipt.undo, { schemaVersion: 1, kind: 'photo-batch-rename-undo', catalogId: snapshot.catalogId,
			items: order.map((photo, index) => ({ index, photoId: photo.id, expectedRevision: photo.revision + 1,
				fileName: plan.items[index]!.fileName, previousDisplayName: photo.metadata.fileName })) });
		const after = await f.inspect(); assert.deepEqual(after[0]!.photo, renamed(before[0]!.photo, 'Photo 1-08.png'));
		assert.deepEqual(after[1]!.photo, renamed(before[1]!.photo, 'Photo 2-07.png')); assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
		assert.deepEqual(await resources.bodies(), bodies); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		reopened = await f.reopen(); const fresh = child(reopened), freshSelection = await fresh.readBatchRenameSelection(order.map(photo => photo.id));
		assert.deepEqual(freshSelection.selection.map(row => row.fileName), ['Photo 2-07.png', 'Photo 1-08.png']);
		assert.equal((await reopened.rebuildQueryStepV2()).ready, true);
		const indexed = await reopened.readQueryStepV2({ query: normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'Photo 1-08.png' }) });
		assert.deepEqual(indexed.rows.map(row => row.id), [before[0]!.photo.id]);
		const restored = await fresh.undoBatchRename(receipt.undo); assert.equal(restored.completion, 'finished'); assert.equal(restored.undo, null);
		assert.deepEqual(restored.items.map(row => row.status), ['restored', 'restored']);
		const final = await f.inspect(); assert.deepEqual(final[0]!.photo, renamed(before[0]!.photo, before[0]!.photo.metadata.fileName, before[0]!.photo.revision + 2));
		assert.deepEqual(final[1]!.photo, renamed(before[1]!.photo, before[1]!.photo.metadata.fileName, before[1]!.photo.revision + 2));
		assert.deepEqual(final.map(row => row.bytes), before.map(row => row.bytes));
		assert.deepEqual(await resources.bodies(reopened), bodies); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		assert.deepEqual((await reopened.readPage()).rows.map(row => row.fileName).sort(), before.map(row => row.photo.metadata.fileName).sort());
	} finally { await reopened?.close(); await f.close(); }
});

test('native mixed Photo1, Photo2 and repaired Photo3 rename and undo retain each schema and Original custody', async () => {
	const f = await repairBackupCurrentFixture('active', 3);
	try {
		await f.saveLegacyBrush(); const before = await f.inspect(); for (const photo of before) assert.ok(photo);
		assert.deepEqual(before.map(photo => photo!.schemaVersion), [2, 1, 3]);
		const roots = await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id }), cap = child(f.session);
		const snapshot = await cap.readBatchRenameSelection(f.records.map(row => row.photo.id)), plan = cap.planBatchRename({ ...snapshot, rename });
		const receipt = await cap.renamePhotos(plan); assert.deepEqual(receipt.items.map(row => row.status), ['renamed', 'renamed', 'renamed']); assert.ok(receipt.undo);
		const edited = await f.inspect(); for (let index = 0; index < before.length; index++) assert.deepEqual(edited[index], renamed(before[index]!, plan.items[index]!.fileName));
		const restored = await cap.undoBatchRename(receipt.undo); assert.equal(restored.undo, null);
		const final = await f.inspect(); for (let index = 0; index < before.length; index++) {
			assert.deepEqual(final[index], renamed(before[index]!, before[index]!.metadata.fileName, before[index]!.revision + 2));
			const body = await f.media.mediaRepository.loadAsset(before[index]!.original.storageKey); assert.ok(body);
			assert.deepEqual(new Uint8Array(await body.arrayBuffer()), new Uint8Array(await f.records[index]!.original.arrayBuffer()));
		}
		assert.deepEqual(await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id }), roots);
	} finally { await f.close(); }
});

test('Current no-op rename reports unchanged without native revision, retained-work or inverse changes', async () => {
	const f = await repairSettingsFixture();
	try {
		const before = await f.inspect(), cap = child(f.session), snapshot = await cap.readBatchRenameSelection(f.photos.map(photo => photo.id));
		const plan = cap.planBatchRename({ ...snapshot, rename: { ...rename, template: '{stem}.{extension}' } }), receipt = await cap.renamePhotos(plan);
		assert.equal(receipt.completion, 'finished'); assert.deepEqual(receipt.items.map(row => row.status), ['unchanged', 'unchanged']); assert.equal(receipt.undo, null);
		assert.deepEqual(receipt.items.map(row => row.revision), before.map(row => row.photo.revision)); assert.equal(f.saved.length, 0); assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('stale planned slots and stale guarded inverses keep their actual selection indexes and retryable restoration work', async () => {
	const f = await repairSettingsFixture(3);
	try {
		const cap = child(f.session), before = await f.inspect(), snapshot = await cap.readBatchRenameSelection(f.photos.map(photo => photo.id)), plan = cap.planBatchRename({ ...snapshot, rename });
		await f.session.applyMetadata(before[0]!.photo.id, before[0]!.photo.revision, { title: 'Changed after preview' });
		const receipt = await cap.renamePhotos(plan); assert.equal(receipt.completion, 'finished'); assert.deepEqual(receipt.items.map(row => row.status), ['failed', 'renamed', 'renamed']);
		assert.deepEqual(receipt.items.map(row => row.index), [0, 1, 2]); assert.ok(receipt.undo); assert.deepEqual(receipt.undo.items.map(row => row.index), [1, 2]);
		const renamedRows = await f.inspect(); await f.session.applyMetadata(renamedRows[1]!.photo.id, renamedRows[1]!.photo.revision, { caption: 'Changed after rename' });
		const retained = await f.inspect(), inverse = await cap.undoBatchRename(receipt.undo);
		assert.deepEqual(inverse.items.map(row => ({ index: row.index, status: row.status })), [{ index: 1, status: 'failed' }, { index: 2, status: 'restored' }]);
		assert.deepEqual(inverse.undo, { ...receipt.undo, items: [receipt.undo.items[0]!] });
		const after = await f.inspect(); assert.deepEqual(after[0], retained[0]); assert.deepEqual(after[1], retained[1]);
		assert.deepEqual(after[2]!.photo, renamed(retained[2]!.photo, before[2]!.photo.metadata.fileName));
		assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
	} finally { await f.close(); }
});

test('a native ACK held across opaque cancellation remains in the partial receipt and inverse while Close joins it', async () => {
	const f = await repairPresetsFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let work: ReturnType<PhotoLibraryBatchRenamePortV1['renamePhotos']> | undefined, closing: Promise<void> | undefined, reopened: Awaited<ReturnType<Fixture['reopen']>> | undefined;
	try {
		const before = await f.inspect(), cap = child(f.session), snapshot = await cap.readBatchRenameSelection(f.photos.map(photo => photo.id));
		f.hooks.afterSave = async () => { entered.resolve(); await release.promise; };
		work = cap.renamePhotos(cap.planBatchRename({ ...snapshot, rename }), { signal: stop.signal });
		const observed = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(await Promise.race([entered.promise.then(() => true), observed.then(() => false)]), true);
		stop.abort(opaque.proxy); assert.equal(await remainsPending(work), true); closing = f.session.close(); assert.equal(f.session.close(), closing);
		assert.equal(await remainsPending(closing), true); release.resolve(); const outcome = await observed; assert.ok(outcome.ok); const receipt = outcome.value;
		await closing; assert.equal(receipt.completion, 'cancelled'); assert.equal(receipt.items.length, 1); assert.equal(receipt.items[0]!.status, 'renamed'); assert.ok(receipt.undo);
		assert.deepEqual(receipt.undo.items.map(row => row.index), [0]); assert.equal(f.saved.length, 1);
		const after = await f.inspect(); assert.deepEqual(after[0]!.photo, renamed(before[0]!.photo, 'Photo 1-07.png')); assert.deepEqual(after[1], before[1]);
		assert.deepEqual(after.map(row => row.bytes), before.map(row => row.bytes));
		f.hooks.afterSave = async () => undefined; reopened = await f.reopen(); const inverse = await child(reopened).undoBatchRename(receipt.undo);
		assert.equal(inverse.undo, null); assert.equal(inverse.items[0]!.status, 'restored');
		assert.deepEqual((await f.inspect())[0]!.photo, renamed(before[0]!.photo, before[0]!.photo.metadata.fileName, before[0]!.photo.revision + 2));
	} finally { release.resolve(); await work?.catch(() => undefined); await closing?.catch(() => undefined); await reopened?.close(); await f.close(); }
});

test('Current pre-aborted scalar operations preserve an opaque native reason and perform no native write', async () => {
	const f = await repairSettingsFixture(1);
	try {
		const cap = child(f.session), before = await f.inspect(), photo = before[0]!.photo, stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
		const snapshot = await cap.readBatchRenameSelection([photo.id]), plan = cap.planBatchRename({ ...snapshot, rename }); stop.abort(opaque.proxy);
		for (const run of [() => cap.readBatchRenameSelection([photo.id], { signal: stop.signal }), () => cap.renamePhotos(plan, { signal: stop.signal })]) {
			const outcome = await run().then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
			assert.equal(outcome.ok, false); assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy));
		}
		assert.equal(f.saved.length, 0); assert.deepEqual(await f.inspect(), before);
	} finally { await f.close(); }
});

test('Current native save refuses a corrupted disabled retained LUT without changing the Photo or Original', async () => {
	const f = await repairPresetsFixture(1);
	try {
		await retainedWork(f); const cap = child(f.session), snapshot = await cap.readBatchRenameSelection([f.photos[0]!.id]);
		await f.corruptResource(LUT_REFERENCE.storageKey); const before = await f.inspect(); f.saved.splice(0);
		const receipt = await cap.renamePhotos(cap.planBatchRename({ ...snapshot, rename })); assert.equal(receipt.items[0]!.status, 'failed'); assert.equal(receipt.undo, null);
		assert.equal(f.saved.length, 0); assert.deepEqual(await f.inspect(), before); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.close(); }
});
