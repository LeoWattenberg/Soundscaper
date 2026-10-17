/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCommandOwnerCurrentV1, type PhotoCommandRepositoryPortCurrentV1 } from '../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1, type PhotoCatalogRepositoryOptionsCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { LUT_REFERENCE } from './helpers/lightscaper-masked-frame-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TIME = '2026-10-11T00:00:00.000Z';
function recipe(resource = false) {
	const develop = { ...defaultImageDevelopStateV2(), effects: resource ? [{ id: 'profile', type: 'cube-lut-profile-v1',
		enabled: false, params: { lut: LUT_REFERENCE } }] : [] };
	return replaceImageDevelopRepairSpotsV1(develop, { schemaVersion: 1, spots: [{ id: 'repair', mode: 'clone', enabled: true,
		target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0, opacity: 1 }] });
}
function command(resource = false) { return { type: 'record-develop', develop: recipe(resource), label: 'Repair', createdAt: TIME }; }
function opaque() { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy; }
function observe(work: Promise<unknown>) {
	return work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
}
async function fixture(verifyResources?: PhotoCatalogRepositoryOptionsCurrentV1['verifyResources']) {
	const raw = createInstrumentedIndexedDB(), databaseName = 'repair-command-lifetime';
	const legacy = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory, databaseName, verifyOriginal: async () => undefined });
	await legacy.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Current', revision: 0,
		photoCount: 0, folders: [], keywords: [], collections: [] });
	const seed = photoArchiveFixture().photo; await legacy.publishPhotos('catalog-1', 0, [seed]);
	const state: { repository?: PhotoCatalogRepositoryCurrentV1; owner?: PhotoCommandOwnerCurrentV1 } = {};
	const repository = () => state.repository ??= new PhotoCatalogRepositoryCurrentV1({ indexedDB: raw as unknown as IDBFactory,
		databaseName, verifyOriginal: async () => undefined, ...(verifyResources ? { verifyResources } : {}) });
	const port: PhotoCommandRepositoryPortCurrentV1 = { loadPhoto: (catalogId, photoId) => repository().loadPhoto(catalogId, photoId),
		savePhoto: (...args) => repository().savePhoto(...args) };
	try { state.owner = new PhotoCommandOwnerCurrentV1(port, seed); }
	catch (error) { await state.repository?.close(); await legacy.close(); throw error; }
	return { owner: state.owner, port, repository, seed,
		async close() { await state.owner?.close(); await state.repository?.close(); await legacy.close(); } };
}

test('current Close joins a held actual native resource verifier and opaque cancellation publishes no repaired history', async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = opaque();
	const f = await fixture(async (photo, signal) => {
		assert.equal(photo.schemaVersion, 3); assert.equal(photo.versions[0]?.develop.processVersion, 3);
		entered.resolve(); await release.promise; signal?.throwIfAborted();
	}), before = f.owner.history;
	const work = f.owner.execute(command(true), { signal: stop.signal }), outcome = observe(work);
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason);
		const closing = f.owner.close(); assert.equal(f.owner.close(), closing); assert.equal(await remainsPending(closing), true);
		await assert.rejects(f.owner.redo(), { code: 'PHOTO_COMMAND_CLOSED' });
		release.resolve(); const result = await outcome;
		assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true); await closing;
		assert.equal(f.owner.history, before); assert.deepEqual(await f.repository().loadPhoto('catalog-1', 'photo-1'), f.seed);
	} finally { release.resolve(); await outcome; await f.close(); }
});

test('actual current native save ACK wins later opaque caller cancellation or owner Close', async () => {
	for (const closeAtAck of [false, true]) {
		const f = await fixture(), stop = new AbortController(), reason = opaque(), joining: { work?: Promise<void> } = {};
		await f.owner.close();
		const port: PhotoCommandRepositoryPortCurrentV1 = { loadPhoto: (...args) => f.repository().loadPhoto(...args),
			async savePhoto(...args) {
				const result = await f.repository().savePhoto(...args);
				if (closeAtAck) joining.work = owner.close(); else stop.abort(reason); return result;
			} };
		const owner = new PhotoCommandOwnerCurrentV1(port, f.seed);
		try {
			const saved = await owner.execute(command(), { signal: stop.signal });
			assert.equal(saved.schemaVersion, 3); assert.equal(saved.revision, 1); assert.equal(owner.history.past.length, 1);
			assert.deepEqual(await f.repository().loadPhoto('catalog-1', 'photo-1'), saved);
			assert.deepEqual(saved.original, f.seed.original); await joining.work;
		} finally { await owner.close(); await f.close(); }
	}
});

test('current admitted demand blocks command reflection reentry and captures repair fields before a held native save', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), nested: { work?: Promise<unknown> } = {};
	await f.owner.close();
	const port: PhotoCommandRepositoryPortCurrentV1 = { loadPhoto: (...args) => f.repository().loadPhoto(...args), async savePhoto(...args) {
		entered.resolve(); await release.promise; return f.repository().savePhoto(...args);
	} };
	const owner = new PhotoCommandOwnerCurrentV1(port, f.seed), initial = command();
	const raw = { ...initial, develop: { ...initial.develop, repairs: { schemaVersion: 1,
		spots: initial.develop.repairs.spots.map(spot => ({ ...spot, target: { ...spot.target }, source: { ...spot.source } })) } } };
	const authored = new Proxy(raw, { ownKeys(target) {
		nested.work ??= owner.execute({ type: 'set-attributes', changes: { rating: 5 } }).then(() => ({ error: undefined }), (error: unknown) => ({ error }));
		return Reflect.ownKeys(target);
	} });
	const work = owner.execute(authored), outcome = observe(work);
	try {
		await Promise.race([entered.promise, work]); raw.develop.repairs.spots[0]!.source.x = 0.9; raw.develop.repairs.spots[0]!.opacity = 0;
		assert.equal(await remainsPending(work), true); release.resolve(); const saved = await work;
		assert.deepEqual(saved.versions[0]?.develop, recipe());
		const refusal = await nested.work; assert.ok(refusal && typeof refusal === 'object' && 'error' in refusal);
		assert.ok(refusal.error instanceof Error && 'code' in refusal.error); assert.equal(refusal.error.code, 'PHOTO_COMMAND_BUSY');
		assert.equal(saved.rating, 0); assert.equal(saved.revision, 1);
	} finally { release.resolve(); await outcome; await owner.close(); await f.close(); }
});

test('current open pins actual borrowed methods and receiver before a held real load without function metadata reads', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); await f.owner.close(); let traps = 0;
	const load = new Proxy(async function(this: unknown, ...args: Parameters<PhotoCatalogRepositoryCurrentV1['loadPhoto']>) {
		assert.equal(this, port); const photo = await f.repository().loadPhoto(...args); entered.resolve(); await release.promise; return photo;
	}, { get() { traps++; throw Error('Load callable metadata inspected'); } });
	const save = new Proxy(async function(this: unknown, ...args: Parameters<PhotoCatalogRepositoryCurrentV1['savePhoto']>) {
		assert.equal(this, port); return f.repository().savePhoto(...args);
	}, { get() { traps++; throw Error('Save callable metadata inspected'); } });
	const port = { loadPhoto: load, savePhoto: save }, opening = PhotoCommandOwnerCurrentV1.open(port, 'catalog-1', 'photo-1');
	const outcome = observe(opening), state: { owner?: PhotoCommandOwnerCurrentV1 } = {};
	try {
		await Promise.race([entered.promise, opening]); port.savePhoto = async () => { throw Error('Replaced save used'); };
		port.loadPhoto = async () => { throw Error('Replaced load used'); }; release.resolve(); state.owner = await opening;
		await state.owner.execute(command()); await state.owner.reload(); assert.equal(traps, 0);
		assert.equal(state.owner.history.present.schemaVersion, 3); assert.equal(state.owner.history.present.revision, 1);
	} finally { release.resolve(); await outcome; await state.owner?.close(); await f.close(); }
});

test('current preabort and native abort during inert command admission retain opaque reason with zero writes', async () => {
	const f = await fixture(), before = f.owner.history;
	try {
		for (const preabort of [false, true]) {
			const stop = new AbortController(), reason = opaque(); let reflected = 0;
			if (preabort) stop.abort(reason);
			const unread = new Proxy({}, { ownKeys() { reflected++; if (preabort) assert.fail('Pre-aborted command read'); stop.abort(reason); throw Error('Admission error'); } });
			const result = await observe(f.owner.execute(unread, { signal: stop.signal }));
			assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true); assert.equal(reflected, preabort ? 0 : 1);
			assert.equal(f.owner.history, before); assert.deepEqual(await f.repository().loadPhoto('catalog-1', 'photo-1'), f.seed);
		}
	} finally { await f.close(); }
});

test('current Close during options admission retains native cancellation and closes before later action reflection', async () => {
	const f = await fixture(), before = f.owner.history, reason = opaque(), joining: { work?: Promise<void> } = {};
	let commands = 0;
	const options = new Proxy({}, { ownKeys() { joining.work = f.owner.close(); throw reason; } });
	try {
		const result = await observe(f.owner.execute(new Proxy({}, { ownKeys() { commands++; throw Error('Closed command reflected'); } }), options));
		assert.equal(result.failed, true); assert.notEqual(result.error, reason); assert.ok(result.error instanceof DOMException);
		assert.equal(result.error.name, 'AbortError'); await joining.work; assert.equal(commands, 0); assert.equal(f.owner.history, before);
		await assert.rejects(f.owner.undo(), { code: 'PHOTO_COMMAND_CLOSED' });
		assert.deepEqual(await f.repository().loadPhoto('catalog-1', 'photo-1'), f.seed);
	} finally { await joining.work; await f.close(); }
});

test('current Close caches its join before native signal listeners reenter retirement', async () => {
	const entered = deferred<void>(), release = deferred<void>(), nested: { close?: Promise<void> } = {};
	const f = await fixture(async (_photo, signal) => {
		signal?.addEventListener('abort', () => { nested.close = owner.close(); }, { once: true });
		entered.resolve(); await release.promise; signal?.throwIfAborted();
	}); const owner = f.owner;
	const work = owner.execute(command(true)), outcome = observe(work);
	try {
		await Promise.race([entered.promise, work]); const closing = owner.close(); assert.equal(nested.close, closing);
		assert.equal(await remainsPending(closing), true); release.resolve(); await outcome; await closing;
		assert.equal(owner.history.present.revision, 0);
	} finally { release.resolve(); await outcome; await f.close(); }
});
