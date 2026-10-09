/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { exportPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-export-v4.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { savedArchiveFixtureV3, savedArchiveRootV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE, rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
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
	return { ...f, active, options: { name: 'Current library', indexedDB: f.factory, locks } };
}
async function archive() {
	const f = lutArchiveFixture(), result = await exportPhotoCatalogArchiveV5(f.root, [f.record], [], null, [], f.row,
		{ async withBytes(_reference, consume) { return consume(LUT_BODY); } });
	assert.ok(result.blob); return result.blob;
}
function holdFirstOpen(f: ReturnType<typeof fixture>) {
	const entered = deferred<void>(), release = deferred<void>(), open = f.factory.open; let held = false;
	f.factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		const request = Reflect.apply(open, f.factory, args) as IDBOpenDBRequest;
		if (!held) {
			held = true; let success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(request, 'onsuccess', { configurable: true, set(value: IDBOpenDBRequest['onsuccess']) { success = value; },
				get: () => (event: Event) => { entered.resolve(); void release.promise.then(() => { success?.call(request, event); }); } });
		} return request;
	}) as IDBFactory['open'];
	return { entered, release };
}

test('the current restore runtime stays inert, owns one cached Close and refuses later admission', async () => {
	const f = fixture(), runtime = createPhotoLibraryRestoreRuntimeV2(f.options);
	assert.deepEqual(f.opens, []); const closing = runtime.close(); assert.equal(runtime.close(), closing); await closing;
	await assert.rejects(runtime.restoreArchive(new Blob()), /closed/u); assert.deepEqual(f.opens, []);
});

test('the actual current runtime restores V5 resources and runtime3 reopens complete current settings and exact LUT bytes', async () => {
	const f = fixture(), runtime = createPhotoLibraryRestoreRuntimeV2(f.options), expected = lutArchiveFixture();
	try {
		const receipt = await runtime.restoreArchive(await archive()); assert.equal(receipt.photoCount, 1);
		const session = await createPhotoLibrarySessionV3(f.options);
		try {
			assert.equal((await session.readPage()).rows[0]?.id, expected.record.photo.id);
			const document = await session.develop.read({ schemaVersion: 2, photoId: expected.record.photo.id });
			assert.deepEqual(document.develop, expected.record.photo.versions[0]?.develop);
			const preset = await session.develop.presets!.read({ schemaVersion: 2, catalogId: expected.root.id,
				presetId: expected.row.presets[0]!.identity.id, expectedRevision: expected.row.revision });
			assert.deepEqual(preset.preset, expected.row.presets[0]);
			await session.cubeLuts.source.withBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); });
		} finally { await session.close(); }
	} finally { await runtime.close(); }
	assert.equal(f.active.size, 0);
});

test('current restore preserves V3 absence and V4/V5 positive-empty preset schema and revision', async () => {
	for (const version of [3, 4, 5] as const) {
		const f = fixture(), runtime = createPhotoLibraryRestoreRuntimeV2(f.options);
		const old = { schemaVersion: 1 as const, kind: 'photo-develop-presets' as const, catalogId: 'catalog-1', revision: 91, presets: [] };
		const current = { ...old, schemaVersion: 2 as const };
		const source = version === 3 ? await savedArchiveFixtureV3() : version === 4
			? (await exportPhotoCatalogArchiveV4(savedArchiveRootV3(0), [], [], null, [], old)).blob
			: (await exportPhotoCatalogArchiveV5(savedArchiveRootV3(0), [], [], null, [], current, undefined)).blob;
		assert.ok(source);
		try {
			assert.equal((await runtime.restoreArchive(source)).photoCount, version === 3 ? 2 : 0);
			const name = f.opens.find(open => open.name.startsWith('lightscaper-photo-media-restore-'))?.name; assert.ok(name);
			const row = f.raw(name).records(name, 'settings').find(value => value.key === 'photo-library:develop-presets:v1:catalog-1')?.value;
			assert.deepEqual(row, version === 3 ? undefined : version === 4 ? old : current);
		} finally { await runtime.close(); }
	}
});

test('current restore rejects a corrupt authenticated LUT then releases admission for a complete retry', async () => {
	const f = fixture(), runtime = createPhotoLibraryRestoreRuntimeV2(f.options), source = await archive();
	const corrupt = await rewriteLutArchiveFixture(source, files => { const bytes = files.get(`assets/luts/${LUT_REFERENCE.sha256}.cube`)!; bytes[bytes.length - 2] ^= 1; });
	try { await assert.rejects(runtime.restoreArchive(corrupt)); assert.equal((await runtime.restoreArchive(source)).photoCount, 1); }
	finally { await runtime.close(); }
	assert.equal(f.active.size, 0);
});

test('current runtime Close joins held anchor opening before rejecting restore or releasing its handle', async () => {
	const f = fixture(), held = holdFirstOpen(f), runtime = createPhotoLibraryRestoreRuntimeV2(f.options);
	const work = runtime.restoreArchive(await archive()), observed = work.then(() => ({ failure: null }), error => ({ failure: error as unknown }));
	try {
		await held.entered.promise; const closing = runtime.close(); assert.equal(runtime.close(), closing);
		assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
		await assert.rejects(runtime.restoreArchive(new Blob()), /closed/u); held.release.resolve();
		const { failure } = await observed; assert.ok(failure instanceof DOMException); assert.equal(failure.name, 'AbortError'); await closing;
		assert.equal(f.opens.some(open => open.name.includes('-restore-')), false); assert.equal(f.active.size, 0);
	} finally { held.release.resolve(); await observed; await runtime.close(); }
});

test('a pending current restore refuses reflected overlap and preserves opaque caller cancellation', async () => {
	const f = fixture(), held = holdFirstOpen(f), runtime = createPhotoLibraryRestoreRuntimeV2(f.options), stop = new AbortController(); let reflections = 0;
	const reason = new Proxy({}, { get() { reflections++; throw new Error('Opaque reason reflected'); } });
	const work = runtime.restoreArchive(await archive(), { signal: stop.signal }), observed = work.then(() => ({ failure: null }), error => ({ failure: error as unknown }));
	try {
		await held.entered.promise;
		await assert.rejects(runtime.restoreArchive(new Blob(), new Proxy({}, { ownKeys() { assert.fail('Overlapping options reflected'); } })), /pending/u);
		stop.abort(reason); assert.equal(await remainsPending(work), true); held.release.resolve();
		assert.equal((await observed).failure === reason, true); assert.equal(reflections, 0);
	} finally { held.release.resolve(); await observed; await runtime.close(); }
});

test('reentrant current runtime Close during admission owns the pending demand before anchor acquisition', async () => {
	const f = fixture(), runtime = createPhotoLibraryRestoreRuntimeV2(f.options), source = await archive();
	let closing: Promise<void> | null = null;
	const value = new Proxy({}, { getPrototypeOf() { closing = runtime.close(); return Object.prototype; } });
	await assert.rejects(runtime.restoreArchive(source, value), { name: 'AbortError' });
	assert.ok(closing); assert.equal(runtime.close(), closing); await closing; assert.deepEqual(f.opens, []);
});

test('current runtime captures original native factory and lock receivers without callable metadata', async () => {
	const f = fixture(), factory = f.factory, open = factory.open, remove = factory.deleteDatabase, request = f.options.locks.request; let reads = 0;
	const protect = <Method extends (...args: never[]) => unknown>(method: Method, receiver: unknown) => new Proxy(method, {
		apply(target, self, args) { assert.equal(self, receiver); return Reflect.apply(target, self, args); },
		get() { assert.fail('Callable metadata reflected'); },
	});
	Object.defineProperty(factory, 'open', { configurable: true, get() { reads++; if (reads > 1) assert.fail('Repeated factory capability'); return protect(open, factory); } });
	factory.deleteDatabase = protect(remove, factory); f.options.locks.request = protect(request, f.options.locks);
	const runtime = createPhotoLibraryRestoreRuntimeV2(f.options);
	Object.defineProperty(factory, 'open', { configurable: true, value() { assert.fail('Replaced native method used'); } });
	try { assert.equal((await runtime.restoreArchive(await archive())).photoCount, 1); assert.equal(reads, 1); }
	finally { await runtime.close(); }
});
