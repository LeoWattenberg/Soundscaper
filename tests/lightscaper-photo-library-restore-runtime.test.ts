/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoLibraryRestoreRuntimeV1 } from '../src/lightscaper/photo-library-restore-runtime-v1.ts';
import { createPhotoLibrarySessionV2 } from '../src/lightscaper/photo-library-session-runtime-v2.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { savedArchiveFixtureV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
function fixture() {
	const f = mediaRestoreFixture(), active = new Set<string>();
	const locks = { async request(name: string, _options: unknown, run: (lock: Lock | null) => Promise<unknown>) {
		if (active.has(name)) return run(null); active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
	return { ...f, active, options: { name: 'Photo library', indexedDB: f.factory, locks } };
}

test('an inert runtime opens nothing and close is idempotent and prevents future admission', async () => {
	const f = fixture(), runtime = createPhotoLibraryRestoreRuntimeV1(f.options);
	assert.deepEqual(f.opens, []); const closing = runtime.close(); assert.equal(runtime.close(), closing); await closing;
	await assert.rejects(runtime.restoreArchive(new Blob()), /closed|retired/u); assert.deepEqual(f.opens, []);
});

test('actual runtime restores a complete backup then V2 Session reopens preserved selected records', async () => {
	const f = fixture(), runtime = createPhotoLibraryRestoreRuntimeV1(f.options);
	try {
		const receipt = await runtime.restoreArchive(await savedArchiveFixtureV3()); assert.equal(receipt.photoCount, 2);
		const session = await createPhotoLibrarySessionV2(f.options);
		try {
			const page = await session.readPage(); assert.equal(page.rows.length, 2); assert.equal(page.catalogName, receipt.catalogName);
			assert.deepEqual(page.rows.map(row => row.id).sort(), ['photo-1', 'photo-2']);
		} finally { await session.close(); }
	} finally { await runtime.close(); }
	assert.equal(f.active.size, 0);
});

test('close during a held native anchor opening joins the actual handle before rejecting restore', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), open = f.factory.open.bind(f.factory);
	let held = false;
	f.factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		const opening = open(...args);
		if (!held) {
			held = true; let success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(opening, 'onsuccess', { configurable: true, set(value: IDBOpenDBRequest['onsuccess']) { success = value; },
				get: () => (event: Event) => { entered.resolve(); void release.promise.then(() => { success?.call(opening, event); }); } });
		} return opening;
	}) as IDBFactory['open'];
	const runtime = createPhotoLibraryRestoreRuntimeV1(f.options); let failure: unknown;
	const work = runtime.restoreArchive(await savedArchiveFixtureV3()).catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; const closing = runtime.close(); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
		await assert.rejects(runtime.restoreArchive(new Blob()), /closed|retired/u);
		release.resolve(); await work; await closing; assert.ok(failure instanceof DOMException); assert.equal(failure.name, 'AbortError');
		assert.equal(f.opens.some(value => value.name.includes('-restore-')), false); assert.equal(f.active.size, 0);
	} finally { release.resolve(); await work; await runtime.close(); }
});

test('pending restore refuses overlapping options before reflection and retains opaque cancellation unchanged', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), open = f.factory.open.bind(f.factory), stop = new AbortController();
	let held = false, inspected = 0;
	f.factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		const opening = open(...args); if (!held) {
			held = true; let success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(opening, 'onsuccess', { configurable: true, set(value: IDBOpenDBRequest['onsuccess']) { success = value; },
				get: () => (event: Event) => { entered.resolve(); void release.promise.then(() => { success?.call(opening, event); }); } });
		} return opening;
	}) as IDBFactory['open'];
	const runtime = createPhotoLibraryRestoreRuntimeV1(f.options);
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Opaque reason.'); }, getPrototypeOf() { inspected++; throw new Error('Opaque prototype.'); } });
	let failure: unknown;
	const work = runtime.restoreArchive(await savedArchiveFixtureV3(), { signal: stop.signal }).catch((error: unknown) => { failure = error; });
	try {
		await entered.promise;
		await assert.rejects(runtime.restoreArchive(new Blob(), new Proxy({}, { ownKeys() { throw new Error('Overlapping options inspected.'); } })), /pending/u);
		stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve(); await work;
		assert.equal(failure, reason); assert.equal(inspected, 0); assert.equal(f.opens.some(value => value.name.includes('-restore-')), false);
	} finally { release.resolve(); await work; await runtime.close(); }
});

test('close reentered during option admission retires the registered demand before native resources exist', async () => {
	const f = fixture(), runtime = createPhotoLibraryRestoreRuntimeV1(f.options), source = await savedArchiveFixtureV3();
	let closing: Promise<void> | null = null, retired = 0;
	const options = new Proxy({}, { getPrototypeOf() { retired++; closing = runtime.close(); return Object.prototype; } });
	let failure: unknown;
	try { await runtime.restoreArchive(source, options); } catch (error) { failure = error; }
	await closing; await runtime.close();
	assert.equal(retired, 1); assert.ok(failure instanceof DOMException); assert.equal(failure.name, 'AbortError');
	assert.deepEqual(f.opens, []); assert.equal(f.active.size, 0);
});
