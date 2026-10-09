/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { currentDevelopFixture, currentRecipe, CURRENT_TIME } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { createPhotoLibraryDevelopSessionV2 } from '../src/lightscaper/controller/photo-library-develop-session-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('explicit current Develop port keeps legacy numeric edits and promotes full resource history without changing originals', async () => {
	const f = await currentDevelopFixture();
	try {
		assert.equal(f.develop.schemaVersion, 2);
		let view = await f.develop.read({ schemaVersion: 2, photoId: 'photo-1' });
		assert.equal(view.schemaVersion, 2); assert.equal(view.develop.processVersion, 1);
		let ack = await f.develop.apply({ schemaVersion: 2, photoId: view.photoId, expectedRevision: view.revision, command: {
			type: 'record-develop', versionId: view.versionId, develop: currentRecipe(), label: 'LUT', createdAt: CURRENT_TIME } });
		assert.equal(ack.snapshot.develop.processVersion, 2); assert.equal(ack.snapshot.history.cursor, 1);
		ack = await f.develop.apply({ schemaVersion: 2, photoId: view.photoId, expectedRevision: ack.snapshot.revision,
			command: { type: 'save-develop-snapshot', versionId: view.versionId, id: 'saved', name: 'Saved', createdAt: CURRENT_TIME } });
		view = (await f.develop.apply({ schemaVersion: 2, photoId: view.photoId, expectedRevision: ack.snapshot.revision,
			command: { type: 'select-develop-history', versionId: view.versionId, cursor: 0 } })).snapshot;
		assert.equal(view.develop.processVersion, 1); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.schemaVersion, 2);
		assert.equal(view.snapshots[0]?.id, 'saved'); assert.deepEqual((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.original, f.photos[0]?.original);
		const reopened = createPhotoLibraryDevelopSessionV2(f.host); assert.deepEqual(await reopened.read({ schemaVersion: 2, photoId: 'photo-1' }), view);
	} finally { await f.close(); }
});

test('current requests detach before held initialization, fence revisions and retain durable ACK through late Close/cleanup', async () => {
	const f = await currentDevelopFixture(), entered = deferred<void>(), release = deferred<void>();
	try {
		f.hooks.ready = async () => { entered.resolve(); await release.promise; return 'catalog-1'; };
		const command = { type: 'record-develop' as const, versionId: 'version-1', develop: structuredClone(currentRecipe(null)), label: 'Before', createdAt: CURRENT_TIME };
		const work = f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 0, command }); await entered.promise;
		command.label = 'After'; Reflect.set(command.develop.effects, 'length', 0); release.resolve();
		const ack = await work; assert.equal(ack.snapshot.history.entries[1]?.label, 'Before'); assert.equal(ack.snapshot.develop.effects.length, 1);
		await assert.rejects(f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 0, command }), { code: 'PHOTO_REVISION_CONFLICT' });
		f.hooks.afterWriter = async () => { throw Object.freeze({ cleanup: true }); };
		const saved = await f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 1, command: {
			type: 'record-develop', versionId: 'version-1', develop: defaultImageDevelopStateV1(), label: 'Legacy', createdAt: CURRENT_TIME } });
		assert.deepEqual(saved.notices, ['cleanup-failed']); assert.equal(saved.snapshot.revision, 2);
	} finally { release.resolve(); await f.close(); }
});

test('held read cancellation/Close joins the owning host and preserves exact opaque native reason', async () => {
	const f = await currentDevelopFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
	f.hooks.ready = async () => { entered.resolve(); await release.promise; return 'catalog-1'; };
	const work = f.develop.read({ schemaVersion: 2, photoId: 'photo-1' }, { signal: stop.signal });
	const refused = work.then(() => ({ error: undefined }), error => ({ error: error as unknown })); await entered.promise; stop.abort(reason);
	const closing = f.close(); assert.equal(await remainsPending(closing), true); release.resolve();
	assert.equal((await refused).error === reason, true); await closing; assert.equal(traps, 0);
});

test('current host pins exact callable receivers before initialization and rejects legacy/future/accessor requests without acquisition', async () => {
	const f = await currentDevelopFixture(); let traps = 0;
	const mutate = f.host.mutate;
	f.host.mutate = new Proxy(mutate, { get() { traps++; throw Error('Function metadata'); }, apply(target, receiver, args) {
		assert.equal(receiver, f.host); return Reflect.apply(target, receiver, args);
	} });
	const current = createPhotoLibraryDevelopSessionV2(f.host);
	try {
		for (const schemaVersion of [1, 3]) await assert.rejects(current.read({ schemaVersion, photoId: 'photo-1' } as Parameters<typeof current.read>[0]));
		let getters = 0; const request = Object.defineProperty({ schemaVersion: 2 as const, photoId: 'photo-1' }, 'photoId', { get() { getters++; return 'photo-1'; } });
		await assert.rejects(current.read(request)); assert.equal(getters, 0); assert.equal(f.calls.ready, 0);
		const packet = current.settings!.copy({ schemaVersion: 2, develop: defaultImageDevelopStateV1(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } });
		const preset = current.presets!.create({ schemaVersion: 2, id: 'pin', name: 'Pinned', settings: packet });
		f.host.mutate = async () => { throw Error('Replacement host used'); };
		assert.equal((await current.presets!.write({ schemaVersion: 2, catalogId: 'catalog-1', command: { type: 'save', expectedRevision: 0, preset } })).snapshot.revision, 1);
		assert.equal(traps, 0);
	} finally { await f.close(); }
});

test('current numeric-only legacy edit, no-op, virtual copy and snapshot restore retain durable aggregate semantics', async () => {
	const f = await currentDevelopFixture();
	const apply = async (expectedRevision: number, command: Parameters<typeof f.develop.apply>[0]['command']) =>
		f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision, command });
	try {
		let ack = await apply(0, { type: 'record-develop', versionId: 'version-1', develop: defaultImageDevelopStateV1(), label: 'Same', createdAt: CURRENT_TIME });
		// First authored history entry is meaningful, repeated complete settings are a no-op.
		const same = await apply(ack.snapshot.revision, { type: 'record-develop', versionId: 'version-1', develop: defaultImageDevelopStateV1(), label: 'Again', createdAt: CURRENT_TIME });
		assert.equal(same.snapshot.revision, ack.snapshot.revision); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.schemaVersion, 1);
		ack = await apply(same.snapshot.revision, { type: 'record-develop', versionId: 'version-1', develop: currentRecipe(null), label: 'Neutral profile', createdAt: CURRENT_TIME });
		ack = await apply(ack.snapshot.revision, { type: 'save-develop-snapshot', versionId: 'version-1', id: 'snapshot', name: 'Snapshot', createdAt: CURRENT_TIME });
		ack = await apply(ack.snapshot.revision, { type: 'create-virtual-copy', id: 'copy', name: 'Copy', sourceVersionId: 'version-1', createdAt: CURRENT_TIME });
		assert.equal(ack.snapshot.versionId, 'copy'); assert.equal(ack.snapshot.develop.processVersion, 2);
		ack = await apply(ack.snapshot.revision, { type: 'select-develop-history', versionId: 'version-1', cursor: 0 });
		assert.equal(ack.snapshot.develop.processVersion, 1);
		ack = await apply(ack.snapshot.revision, { type: 'restore-develop-snapshot', versionId: 'version-1', snapshotId: 'snapshot', label: 'Restore', createdAt: CURRENT_TIME });
		assert.equal(ack.snapshot.develop.processVersion, 2); assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.schemaVersion, 2);
	} finally { await f.close(); }
});

test('intrinsic preabort wins shadowed native properties and request reflection cancellation refuses before host acquisition', async () => {
	const f = await currentDevelopFixture(), stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
	stop.abort(reason); Object.defineProperty(stop.signal, 'aborted', { get() { traps++; throw Error('Shadowed aborted'); } });
	try {
		const work = f.develop.read({ schemaVersion: 2, photoId: 'photo-1' }, { signal: stop.signal });
		const result = await work.then(() => ({ error: undefined }), error => ({ error: error as unknown }));
		assert.equal(result.error === reason, true); assert.equal(traps, 0); assert.equal(f.calls.ready, 0);
		const fresh = new AbortController(), request = new Proxy({ schemaVersion: 2 as const, photoId: 'photo-1' }, { ownKeys(target) { fresh.abort(reason); return Reflect.ownKeys(target); } });
		const second = await f.develop.read(request, { signal: fresh.signal }).then(() => ({ error: undefined }), error => ({ error: error as unknown }));
		assert.equal(second.error === reason, true); assert.equal(f.calls.ready, 0);
	} finally { await f.close(); }
});

test('current Develop preserves the exact durable save snapshot when Close joins after native publication', async () => {
	const f = await currentDevelopFixture(), entered = deferred<void>(), release = deferred<void>(), save = f.repository.savePhoto;
	f.repository.savePhoto = async function (...args) { const ack = await Reflect.apply(save, f.repository, args); entered.resolve(); await release.promise; return ack; };
	const work = f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision: 0, command: {
		type: 'record-develop', versionId: 'version-1', develop: currentRecipe(null), label: 'Neutral profile', createdAt: CURRENT_TIME } });
	await entered.promise;
	try {
		const closing = f.close(); assert.equal(await remainsPending(closing), true); release.resolve();
		const ack = await work; await closing; assert.equal(ack.schemaVersion, 2); assert.equal(ack.snapshot.revision, 1);
		assert.equal(ack.snapshot.develop.processVersion, 2); assert.equal(f.raw.records('current-develop-session', 'photos')[0].document.revision, 1);
	} finally { release.resolve(); await f.close(); }
});

test('current composition snapshots repository and optional capability objects once before pinning receivers', async () => {
	const f = await currentDevelopFixture(); let reads = 0, originalReads = 0, presetReads = 0;
	const repository = { async loadPhoto(this: unknown, ...args: Parameters<typeof f.repository.loadPhoto>) {
		assert.equal(this, repository); return f.repository.loadPhoto(...args);
	} };
	const originalSource = { loadOriginal: async () => { throw Error('Original read is not requested'); } };
	const host = { ...f.host, get repository() { reads++; return reads === 1 ? repository : f.repository; },
		get originalSource() { originalReads++; if (originalReads > 1) throw Error('Original capability reread'); return originalSource; },
		get presetStorage() { presetReads++; if (presetReads > 1) throw Error('Preset capability reread'); return f.storage; } };
	try {
		const current = createPhotoLibraryDevelopSessionV2(host);
		assert.equal((await current.read({ schemaVersion: 2, photoId: 'photo-1' })).revision, 0);
		assert.equal(reads, 1); assert.equal(originalReads, 1); assert.equal(presetReads, 1);
	} finally { await f.close(); }
});
