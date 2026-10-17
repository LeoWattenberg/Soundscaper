/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCommandOwnerV2 } from '../src/lightscaper/controller/photo-command-owner-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

async function fixture() {
	const raw = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory, databaseName: 'command-current', verifyOriginal: async () => undefined, verifyResources: async () => undefined });
	await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.publishPhotos('catalog-1', 0, [photoArchiveFixture().photo]);
	return { raw, repository, owner: await PhotoCommandOwnerV2.open(repository, 'catalog-1', 'photo-1') };
}

test('current command owner retains durable CAS/no-op/failure and monotonic undo/redo publication', async () => {
	const f = await fixture(), second = await PhotoCommandOwnerV2.open(f.repository, 'catalog-1', 'photo-1');
	await f.owner.execute({ type: 'set-attributes', changes: { rating: 3 } });
	assert.equal(f.owner.history.present.revision, 1); assert.deepEqual(await f.repository.loadPhoto('catalog-1', 'photo-1'), f.owner.history.present);
	const before = second.history; await assert.rejects(second.execute({ type: 'set-attributes', changes: { rating: 1 } }), { code: 'PHOTO_REVISION_CONFLICT' }); assert.equal(second.history, before);
	await f.owner.undo(); const undone = f.owner.history;
	await f.owner.execute({ type: 'set-attributes', changes: { rating: 0 } }); assert.equal(f.owner.history, undone);
	f.raw.failNextPutForStore('photos', new DOMException('Quota', 'QuotaExceededError'));
	await assert.rejects(f.owner.redo()); assert.equal(f.owner.history, undone);
	await f.owner.redo(); assert.equal(f.owner.history.present.revision, 3);
	await Promise.all([second.close(), f.owner.close()]); await f.repository.close();
});

const TIME = '2026-10-09T00:00:00.000Z';
function recipe(lut: unknown = { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }) {
	return { ...photoArchiveFixture().photo.versions[0]!.develop, processVersion: 2, effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut } }] };
}

test('durable process2 promotion, global undo/redo, copy/paste and snapshots keep original bytes and aggregate2 on reopen', async () => {
	const f = await fixture();
	await f.owner.execute({ type: 'record-develop', develop: recipe(), label: 'LUT', createdAt: TIME });
	await f.owner.execute({ type: 'save-develop-snapshot', id: 'snapshot', name: 'Snapshot', createdAt: TIME });
	const clipboard = f.owner.copyDevelop(); assert.equal(clipboard.schemaVersion, 2);
	await f.owner.execute({ type: 'create-virtual-copy', id: 'copy', name: 'Copy', createdAt: TIME });
	await f.owner.pasteDevelop(clipboard); assert.equal(f.owner.history.present.revision, 3);
	await f.owner.undo(); await f.owner.undo(); await f.owner.undo();
	assert.equal(f.owner.history.present.schemaVersion, 2); assert.equal(f.owner.history.present.versions[0]?.develop.processVersion, 1);
	await f.owner.redo(); assert.equal(f.owner.history.present.versions[0]?.develop.processVersion, 2);
	await f.owner.close();
	const reopened = await PhotoCommandOwnerV2.open(f.repository, 'catalog-1', 'photo-1');
	assert.deepEqual(reopened.history.present, f.owner.history.present); assert.equal(reopened.history.past.length, 0);
	assert.deepEqual(reopened.history.present.original, photoArchiveFixture().photo.original);
	await reopened.close(); await f.repository.close();
});

test('Close joins a held real resource verifier; opaque cancellation leaves history and physical photo unchanged', async () => {
	const raw = createInstrumentedIndexedDB(), entered = deferred<void>(), release = deferred<void>();
	const repository = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory, databaseName: 'command-held', verifyOriginal: async () => undefined,
		verifyResources: async (_photo, signal) => { entered.resolve(); await release.promise; signal?.throwIfAborted(); } });
	await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.publishPhotos('catalog-1', 0, [photoArchiveFixture().photo]);
	const owner = await PhotoCommandOwnerV2.open(repository, 'catalog-1', 'photo-1'), before = owner.history, stop = new AbortController();
	let traps = 0; const reason = new Proxy({}, { getPrototypeOf() { traps++; throw Error('Opaque reason inspected'); } });
	const pending = owner.execute({ type: 'set-develop', develop: recipe() }, { signal: stop.signal });
	const outcome = pending.then(() => undefined, error => error as unknown); await entered.promise; stop.abort(reason);
	const closing = owner.close(); assert.equal(owner.close(), closing); assert.equal(await remainsPending(closing), true);
	await assert.rejects(owner.undo(), { code: 'PHOTO_COMMAND_CLOSED' });
	release.resolve(); assert.equal((await outcome) === reason, true); await closing;
	assert.equal(owner.history, before); assert.deepEqual(await repository.loadPhoto('catalog-1', 'photo-1'), before.present); assert.equal(traps, 0);
	await repository.close();
});

test('late caller abort or owner Close after actual native save ACK still publishes the acknowledged whole history', async () => {
	for (const closeAtAck of [false, true]) {
		const f = await fixture(); await f.owner.close(); const stop = new AbortController(); let closing: Promise<void> | null = null;
		const port = { loadPhoto: f.repository.loadPhoto.bind(f.repository), savePhoto: async (...args: Parameters<PhotoCatalogRepositoryV2['savePhoto']>) => {
			const result = await f.repository.savePhoto(...args); if (closeAtAck) closing = owner.close(); else stop.abort(); return result;
		} };
		const owner = await PhotoCommandOwnerV2.open(port, 'catalog-1', 'photo-1');
		const saved = await owner.execute({ type: 'set-develop', develop: recipe(null) }, { signal: stop.signal });
		assert.equal(saved.schemaVersion, 2); assert.equal(saved.revision, 1); assert.deepEqual(await f.repository.loadPhoto('catalog-1', 'photo-1'), saved);
		if (closing) await closing; await owner.close(); await f.repository.close();
	}
});

test('admitted demand blocks reflection reentry and detaches mutable commands before the first borrowed await', async () => {
	const f = await fixture(); let nested: Promise<unknown> | undefined;
	const command = new Proxy({ type: 'set-attributes', changes: { rating: 2 } }, { ownKeys(target) {
		if (!nested) nested = f.owner.execute({ type: 'set-attributes', changes: { rating: 4 } }).then(() => 'unexpected', error => error as unknown);
		return Reflect.ownKeys(target);
	} });
	await f.owner.execute(command); const refusal = await nested; assert.equal((refusal as { code: string }).code, 'PHOTO_COMMAND_BUSY');
	assert.equal(f.owner.history.present.rating, 2); assert.equal(f.owner.history.present.revision, 1);
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const port = { loadPhoto: f.repository.loadPhoto.bind(f.repository), savePhoto: async (...args: Parameters<PhotoCatalogRepositoryV2['savePhoto']>) => {
		entered.resolve(); await release.promise; return f.repository.savePhoto(...args);
	} };
	const owner = new PhotoCommandOwnerV2(port, f.owner.history.present), mutable = { type: 'set-attributes', changes: { rating: 3 } };
	const work = owner.execute(mutable, { signal: stop.signal }); await entered.promise; mutable.changes.rating = 5; release.resolve();
	assert.equal((await work).rating, 3); await Promise.all([owner.close(), f.owner.close()]); await f.repository.close();
});

test('constructor/open pin borrowed function and receiver without bind/name reads across held load', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let traps = 0;
	const load = new Proxy(async function(this: unknown, ...args: Parameters<PhotoCatalogRepositoryV2['loadPhoto']>) {
		assert.equal(this, port); entered.resolve(); await release.promise; return f.repository.loadPhoto(...args);
	}, { get() { traps++; throw Error('Borrowed load metadata'); } });
	const save = new Proxy(async function(this: unknown, ...args: Parameters<PhotoCatalogRepositoryV2['savePhoto']>) {
		assert.equal(this, port); return f.repository.savePhoto(...args);
	}, { get() { traps++; throw Error('Borrowed save metadata'); } });
	const port = { loadPhoto: load, savePhoto: save }, opening = PhotoCommandOwnerV2.open(port, 'catalog-1', 'photo-1');
	await entered.promise; port.savePhoto = async () => { throw Error('Replacement save used'); }; release.resolve();
	const owner = await opening; await owner.execute({ type: 'set-attributes', changes: { rating: 1 } }); assert.equal(traps, 0);
	await Promise.all([owner.close(), f.owner.close()]); await f.repository.close();
});

test('preabort and synchronous abort during options/command admission preserve exact opaque reason with no writes', async () => {
	const f = await fixture(), before = f.owner.history;
	for (const preabort of [false, true]) {
		const stop = new AbortController(); let traps = 0; const reason = new Proxy({}, { getPrototypeOf() { traps++; throw Error('Reason inspected'); } });
		if (preabort) stop.abort(reason);
		const command = new Proxy({}, { ownKeys() { if (preabort) assert.fail('Already canceled command read'); stop.abort(reason); throw Error('Admission refusal'); } });
		const outcome = await f.owner.execute(command, { signal: stop.signal }).then(() => undefined, error => error as unknown);
		assert.equal(outcome === reason, true); assert.equal(traps, 0); assert.equal(f.owner.history, before);
	}
	await f.owner.close(); await f.repository.close();
});

test('Close during borrowed options reflection cannot replace native cancellation with an opaque admission failure', async () => {
	const f = await fixture(), before = f.owner.history;
	let closing: Promise<void> | undefined, traps = 0;
	const failure = new Proxy({}, { getPrototypeOf() { traps++; throw Error('Failure inspected'); } });
	const options = new Proxy({}, { ownKeys() { closing = f.owner.close(); throw failure; } });
	const outcome = await f.owner.execute({ type: 'set-attributes', changes: { rating: 1 } }, options).then(() => undefined, error => error as unknown);
	assert.notEqual(outcome, failure); assert.ok(outcome instanceof DOMException); assert.equal(outcome.name, 'AbortError');
	await closing; assert.equal(f.owner.history, before); assert.equal(traps, 0); await f.repository.close();
});
