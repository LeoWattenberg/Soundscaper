/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoLibraryBatchRenameSelectionV2, planPhotoLibraryBatchRenameV2, renamePhotoLibraryBatchV2, undoPhotoLibraryBatchRenameV2 } from '../src/lightscaper/controller/photo-library-batch-rename-v2.ts';
import { normalizePhotoBatchRenameUndoV1 } from '../src/lightscaper/controller/photo-batch-rename-inverse-v1.ts';
import { CURRENT_TIME, currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const rename = { template: '{stem}-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 2 };

test('current serial rename/undo keeps full mixed documents, authored order, history refs and old scalar inverse bytes', async () => {
	const f = await currentDevelopFixture();
	try {
		await f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 0, command: {
			type: 'record-develop', versionId: 'version-1', develop: currentRecipe(), label: 'LUT', createdAt: CURRENT_TIME } });
		const before = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(before);
		const snapshot = await readPhotoLibraryBatchRenameSelectionV2(f.host, ['photo-2', 'photo-1']);
		assert.equal(snapshot.schemaVersion, 1); assert.deepEqual(snapshot.selection.map(row => row.expectedRevision), [0, 1]);
		const plan = planPhotoLibraryBatchRenameV2({ ...snapshot, rename }), ack = await renamePhotoLibraryBatchV2(f.host, plan);
		assert.equal(ack.completion, 'finished'); assert.deepEqual(ack.items.map(row => row.status), ['renamed', 'renamed']); assert.ok(ack.undo);
		assert.equal(JSON.stringify(ack.undo), JSON.stringify(normalizePhotoBatchRenameUndoV1(ack.undo)));
		const edited = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(edited); assert.equal(edited.schemaVersion, 2);
		assert.deepEqual(edited.versions, before.versions); assert.deepEqual(edited.original, before.original); assert.deepEqual(edited.extractedMetadata, before.extractedMetadata);
		const restored = await undoPhotoLibraryBatchRenameV2(f.host, ack.undo); assert.equal(restored.undo, null);
		assert.deepEqual(restored.items.map(row => row.status), ['restored', 'restored']);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.metadata.fileName, before.metadata.fileName);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-2'))?.schemaVersion, 1);
	} finally { await f.close(); }
});

test('current batch pins borrowed functions and receivers before a held writer and keeps stale slots separate', async () => {
	const f = await currentDevelopFixture(), entered = deferred<void>(), release = deferred<void>();
	const repo = { loadPhoto: new Proxy(async (...args: Parameters<typeof f.repository.loadPhoto>) => f.repository.loadPhoto(...args), {
		get() { throw Error('Function metadata'); }, apply(target, receiver, args) { assert.equal(receiver, repo); return Reflect.apply(target, receiver, args); } }) };
	const ports = { repository: repo, withPhoto: f.host.withPhoto, async mutate<Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) {
		assert.equal(this, ports); entered.resolve(); await release.promise; return f.host.mutate(run, signal);
	} };
	const work = readPhotoLibraryBatchRenameSelectionV2(ports, ['photo-1']);
	try {
		await entered.promise; repo.loadPhoto = async () => { throw Error('Late replacement'); }; release.resolve();
		const snapshot = await work;
		const plan = planPhotoLibraryBatchRenameV2({ ...snapshot, rename });
		await f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 0, command: {
			type: 'record-develop', versionId: 'version-1', develop: currentRecipe(null), label: 'Edit', createdAt: CURRENT_TIME } });
		assert.equal((await renamePhotoLibraryBatchV2(f.host, plan)).items[0]?.status, 'failed');
		const calls = f.calls.writer; await assert.rejects(readPhotoLibraryBatchRenameSelectionV2(f.host, Array.from({ length: 65 }, (_, index) => `photo-${index}`)));
		assert.equal(f.calls.writer, calls);
	} finally { release.resolve(); await f.close(); }
});

test('current partial batch preserves a completed native ACK when opaque cancellation stops later slots and Close joins cleanup', async () => {
	const f = await currentDevelopFixture(), snapshot = await readPhotoLibraryBatchRenameSelectionV2(f.host, ['photo-1', 'photo-2']);
	const entered = deferred<void>(), release = deferred<void>(), save = f.repository.savePhoto, stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getOwnPropertyDescriptor() { traps++; throw Error('Opaque descriptor'); } });
	f.repository.savePhoto = async (...args) => { const ack = await Reflect.apply(save, f.repository, args); stop.abort(reason); entered.resolve(); await release.promise; return ack; };
	const work = renamePhotoLibraryBatchV2(f.host, planPhotoLibraryBatchRenameV2({ ...snapshot, rename }), { signal: stop.signal });
	try {
		await entered.promise; const closing = f.close(); assert.equal(await remainsPending(closing), true); release.resolve();
		const receipt = await work; await closing; assert.equal(receipt.completion, 'cancelled');
		assert.equal(receipt.items.length, 1); assert.equal(receipt.items[0]?.status, 'renamed'); assert.equal(receipt.undo?.items.length, 1); assert.equal(traps, 0);
	} finally { release.resolve(); await f.close(); }
});

test('current partial batch retains its native ACK and reports distinct post-abort lease cleanup as interruption', async () => {
	const f = await currentDevelopFixture(), snapshot = await readPhotoLibraryBatchRenameSelectionV2(f.host, ['photo-1', 'photo-2']);
	const stop = new AbortController(), cleanup = new Error('Selected lease cleanup failed.'); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getOwnPropertyDescriptor() { traps++; throw Error('Opaque descriptor'); } });
	const withPhoto: typeof f.host.withPhoto = async (catalogId, photoId, signal, run) => {
		await f.host.withPhoto(catalogId, photoId, signal, run); stop.abort(reason); throw cleanup;
	};
	try {
		const receipt = await renamePhotoLibraryBatchV2({ ...f.host, withPhoto }, planPhotoLibraryBatchRenameV2({ ...snapshot, rename }), { signal: stop.signal });
		assert.equal(receipt.completion, 'interrupted'); assert.equal(receipt.message, cleanup.message);
		assert.equal(receipt.items.length, 1); assert.equal(receipt.items[0]?.status, 'renamed'); assert.equal(receipt.undo?.items.length, 1);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.metadata.fileName, receipt.items[0]?.fileName);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-2'))?.metadata.fileName, snapshot.selection[1]?.fileName); assert.equal(traps, 0);
	} finally { await f.close(); }
});
