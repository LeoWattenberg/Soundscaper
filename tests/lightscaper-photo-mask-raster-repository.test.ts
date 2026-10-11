/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { PhotoMaskRasterRepositoryV1 } from '../src/lightscaper/storage/photo-mask-raster-repository-v1.ts';
import { createPhotoMediaMaskRasterResourcesV1 } from '../src/lightscaper/storage/photo-media-mask-raster-resources-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';

function resource() {
	// Independent canonical body: SCMASK01, little-endian 2x2, literal alpha.
	const bytes = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 2, 0, 0, 0, 0, 64, 128, 255]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: { storageKey: `brush-mask-v1:2:2:${sha256}`, sha256, width: 2, height: 2, byteLength: bytes.byteLength } };
}
function opaque() {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque reason reflected'); }, getPrototypeOf() { traps++; throw Error('Opaque reason inspected'); } });
	return { reason, traps: () => traps };
}
async function exactFailure(work: Promise<unknown>, reason: unknown) {
	await work.then(() => assert.fail('Expected exact refusal'), (error: unknown) => { assert.equal(Object.is(error, reason), true); });
}
async function fixture(durable: boolean) {
	const name = `lightscaper-brush-${crypto.randomUUID()}`, raw = createInstrumentedIndexedDB(), memory = getMemoryDatabase(name);
	const database = durable ? await openDatabase(raw as unknown as IDBFactory, name) : null;
	const port = { memory, database: async () => database };
	return { name, raw, memory, database, port, create: () => new PhotoMaskRasterRepositoryV1(port) };
}

for (const durable of [false, true]) test(`${durable ? 'instrumented IndexedDB' : 'degraded memory'} immutable brush install/reuse/reopen is separate from originals and previews`, async () => {
	const f = await fixture(durable), input = resource(), repository = f.create();
	try {
		assert.deepEqual(await repository.put(input.reference, input.bytes), { reference: input.reference, created: true });
		assert.deepEqual(await repository.put(input.reference.storageKey, input.bytes), { reference: input.reference, created: false });
		await repository.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); bytes.fill(0); });
		await repository.close(); const reopened = f.create();
		try { await reopened.withBytes(input.reference.storageKey, bytes => { assert.deepEqual(bytes, input.bytes); }); } finally { await reopened.close(); }
		assert.equal(durable ? f.raw.recordCount(f.name, 'analysis') : f.memory.analysis.size, 1);
		assert.equal(durable ? f.raw.recordCount(f.name, 'mediaAssets') : f.memory.mediaAssets.size, 0);
		if (durable) {
			assert.equal(f.raw.recordCount(f.name, 'catalogOriginalRoots'), 0); assert.equal(f.raw.recordCount(f.name, 'videoDerivativeCacheEntries'), 0);
			assert.equal(f.raw.stats.getAllRequests.length, 0); assert.equal(f.raw.stats.activeTransactions, 0);
		}
		await assert.rejects(repository.withBytes(input.reference, () => undefined), /closed/u);
	} finally { await repository.close(); f.database?.close(); }
});

for (const durable of [false, true]) test(`${durable ? 'instrumented IndexedDB' : 'degraded memory'} existing brush corruption refuses read/reuse without replacement`, async () => {
	const f = await fixture(durable), input = resource(), repository = f.create(); let deliveries = 0;
	try {
		await repository.put(input.reference, input.bytes);
		for (const change of [{ width: 3 }, { height: 3 }, { byteLength: 21 }, { sha256: 'ab'.repeat(32) }]) {
			await assert.rejects(repository.put({ ...input.reference, ...change }, input.bytes));
		}
		await repository.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); });
		const tampered = input.bytes.slice(); tampered[17] = 65;
		for (const row of [{ key: input.reference.storageKey }, { key: input.reference.storageKey, value: undefined },
			{ key: input.reference.storageKey, value: { schemaVersion: 1, kind: 'photo-mask-raster-body', reference: input.reference, bytes: tampered } }]) {
			if (durable) f.raw.seedRecord(f.name, 'analysis', row); else f.memory.analysis.set(input.reference.storageKey, row);
			await assert.rejects(repository.put(input.reference, input.bytes)); await assert.rejects(repository.withBytes(input.reference, () => { deliveries++; }));
			assert.equal(durable ? f.raw.recordCount(f.name, 'analysis') : f.memory.analysis.size, 1);
		}
		assert.equal(deliveries, 0); assert.deepEqual(input.bytes, resource().bytes);
	} finally { await repository.close(); f.database?.close(); }
});

test('brush reference/body and database receiver pin before acquisition; Close joins the admitted install without a queue', async () => {
	const input = resource(), expected = resource(), held = deferred<IDBDatabase | null>(), memory = getMemoryDatabase(`lightscaper-brush-held-${crypto.randomUUID()}`);
	const port = { memory, database() { assert.equal(this, port); return held.promise; } };
	const repository = new PhotoMaskRasterRepositoryV1(port), installing = repository.put(input.reference, input.bytes);
	input.reference.width = 1; input.bytes.fill(0); port.database = () => assert.fail('Late database receiver replacement');
	try {
		await assert.rejects(repository.put(expected.reference, expected.bytes), /pending/u);
		const closing = repository.close(); assert.equal(repository.close(), closing); assert.equal(await remainsPending(closing), true);
		held.resolve(null); assert.deepEqual(await installing, { reference: expected.reference, created: true }); await closing;
		const reopened = new PhotoMaskRasterRepositoryV1({ memory, database: async () => null });
		try { await reopened.withBytes(expected.reference, bytes => { assert.deepEqual(bytes, expected.bytes); }); } finally { await reopened.close(); }
	} finally { held.resolve(null); await installing.catch(() => undefined); await repository.close(); }
});

test('held authenticated brush borrow joins cancellation and Close, then wipes while preserving exact first reason and stored body', async () => {
	const f = await fixture(false), input = resource(), repository = f.create(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), failure = opaque();
	let borrowed: Uint8Array | undefined;
	try {
		await repository.put(input.reference, input.bytes);
		const reading = repository.withBytes(input.reference, async bytes => { borrowed = bytes; entered.resolve(); await release.promise; }, { signal: stop.signal });
		const joined = exactFailure(reading, failure.reason);
		await Promise.race([entered.promise, reading]); stop.abort(failure.reason); const closing = repository.close();
		assert.equal(await remainsPending(reading), true); assert.equal(await remainsPending(closing), true); assert.deepEqual(borrowed, input.bytes);
		release.resolve(); await joined; await closing; assert.ok(borrowed?.every(byte => byte === 0)); assert.equal(failure.traps(), 0);
		const reopened = f.create(); try { await reopened.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); }); } finally { await reopened.close(); }
	} finally { release.resolve(); await repository.close(); f.database?.close(); }
});

test('opaque consumer primary survives detached borrowed cleanup and Close still joins its active scope', async () => {
	const f = await fixture(false), input = resource(), repository = f.create(), entered = deferred<void>(), release = deferred<void>(), failure = opaque();
	let borrowed: Uint8Array | undefined;
	try {
		await repository.put(input.reference, input.bytes);
		const reading = repository.withBytes(input.reference, async bytes => {
			borrowed = bytes; entered.resolve(); await release.promise; structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); throw failure.reason;
		});
		const joined = exactFailure(reading, failure.reason); await Promise.race([entered.promise, reading]); const closing = repository.close();
		assert.equal(await remainsPending(closing), true); release.resolve(); await joined; await closing;
		assert.equal(borrowed?.byteLength, 0); assert.equal(failure.traps(), 0); assert.deepEqual(input.bytes, resource().bytes);
	} finally { release.resolve(); await repository.close(); f.database?.close(); }
});

test('actual instrumented transaction completion is the brush ACK and cannot be revoked by later caller cancellation', async () => {
	const f = await fixture(true), input = resource(), repository = f.create(), stop = new AbortController(), failure = opaque(), release = deferred<void>();
	const transaction = f.database!.transaction.bind(f.database!); let entered = false, packet: Uint8Array | undefined;
	f.database!.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const tx = transaction(names, mode);
		if (mode === 'readwrite') {
			const objectStore = tx.objectStore.bind(tx);
			tx.objectStore = name => { const store = objectStore(name), add = store.add.bind(store);
				store.add = value => { packet = (value as { value: { bytes: Uint8Array } }).value.bytes; return add(value); }; return store; };
			let complete: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(tx, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { complete = value; },
				get() { return (event: Event) => { entered = true; void release.promise.then(() => { complete?.call(tx, event); stop.abort(failure.reason); }); }; } });
		} return tx;
	}) as IDBDatabase['transaction'];
	try {
		const installing = repository.put(input.reference, input.bytes, { signal: stop.signal });
		const outcome = installing.then(value => ({ value }), (error: unknown) => ({ error }));
		await waitFor(() => entered, 'actual brush completion delivery'); const closing = repository.close();
		assert.equal(await remainsPending(installing), true); assert.equal(await remainsPending(closing), true); assert.deepEqual(packet, input.bytes);
		release.resolve(); assert.deepEqual(await outcome, { value: { reference: input.reference, created: true } }); await closing;
		assert.ok(packet?.every(byte => byte === 0)); assert.equal(f.raw.recordCount(f.name, 'analysis'), 1); assert.equal(f.raw.stats.activeTransactions, 0); assert.equal(failure.traps(), 0);
	} finally { release.resolve(); await repository.close(); f.database?.close(); }
});

test('opaque native add refusal joins rollback, wipes captured brush bytes and permits a genuine retry', async () => {
	const f = await fixture(true), input = resource(), repository = f.create(), failure = opaque(), transaction = f.database!.transaction.bind(f.database!);
	let packet: Uint8Array | undefined, refuse = true;
	f.database!.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const tx = transaction(names, mode), objectStore = tx.objectStore.bind(tx);
		tx.objectStore = name => { const store = objectStore(name), add = store.add.bind(store);
			store.add = value => { packet = (value as { value: { bytes: Uint8Array } }).value.bytes; if (refuse) { refuse = false; throw failure.reason; } return add(value); }; return store; };
		return tx;
	}) as IDBDatabase['transaction'];
	try {
		await exactFailure(repository.put(input.reference, input.bytes), failure.reason);
		assert.ok(packet?.every(byte => byte === 0)); assert.equal(f.raw.recordCount(f.name, 'analysis'), 0); assert.equal(f.raw.stats.activeTransactions, 0);
		assert.deepEqual(input.bytes, resource().bytes); assert.equal(failure.traps(), 0); assert.equal((await repository.put(input.reference, input.bytes)).created, true);
	} finally { await repository.close(); f.database?.close(); }
});

test('closed brush reference/options and native pre-abort refuse before database or getter acquisition', async () => {
	const input = resource(), stop = new AbortController(), failure = opaque(); let opened = 0, getters = 0;
	const repository = new PhotoMaskRasterRepositoryV1({ memory: getMemoryDatabase(`lightscaper-brush-cold-${crypto.randomUUID()}`), database: async () => { opened++; return null; } });
	stop.abort(failure.reason);
	try {
		await exactFailure(repository.put(input.reference, input.bytes, { signal: stop.signal }), failure.reason);
		await exactFailure(repository.withBytes(input.reference, () => undefined, { signal: stop.signal }), failure.reason);
		const reference = Object.defineProperty({ ...input.reference }, 'storageKey', { enumerable: true, get() { getters++; return input.reference.storageKey; } });
		const options = Object.defineProperty({}, 'signal', { enumerable: true, get() { getters++; return undefined; } });
		await assert.rejects(repository.put(reference, input.bytes)); await assert.rejects(repository.put(input.reference, input.bytes, options));
		await assert.rejects(repository.put({ ...input.reference, future: true }, input.bytes));
		await assert.rejects(repository.put(input.reference, new Uint8Array(new SharedArrayBuffer(input.bytes.length))));
		assert.equal(opened, 0); assert.equal(getters, 0); assert.equal(failure.traps(), 0);
	} finally { await repository.close(); }
});

test('selected-port resource facade permits installation alongside a held render and Close joins every borrower', async () => {
	const f = await fixture(true), input = resource(), entered = deferred<void>(), release = deferred<void>(); let accepting = true, starts = 0;
	const pending = new Set<Promise<unknown>>();
	const own = <Result,>(operation: () => Promise<Result>): Promise<Result> => {
		starts++; let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); pending.add(work);
		void work.then(() => { pending.delete(work); }, () => { pending.delete(work); });
		try { resolve(operation()); } catch (error) { reject(error); } return work;
	};
	const owner = createPhotoMediaMaskRasterResourcesV1(f.port, own, () => { if (!accepting) throw Error('Selected media owner retired'); });
	let borrowed: Uint8Array | undefined;
	try {
		assert.equal((await owner.resources.put(input.reference, input.bytes)).created, true);
		const reading = owner.resources.source.withBytes(input.reference, async bytes => { borrowed = bytes; entered.resolve(); await release.promise; return 7; });
		await Promise.race([entered.promise, reading]); assert.equal((await owner.resources.put(input.reference, input.bytes)).created, false);
		const closing = owner.close(); assert.equal(owner.close(), closing); assert.equal(await remainsPending(closing), true); assert.deepEqual(borrowed, input.bytes);
		await assert.rejects(owner.resources.put(input.reference, input.bytes), /closed/u);
		release.resolve(); assert.equal(await reading, 7); await closing; assert.ok(borrowed?.every(byte => byte === 0));
		assert.equal(pending.size, 0); assert.ok(starts >= 4); accepting = false;
		await assert.rejects(owner.resources.source.withBytes(input.reference, () => undefined), /retired/u);
		assert.equal(f.raw.stats.activeTransactions, 0); assert.equal(f.raw.recordCount(f.name, 'analysis'), 1);
	} finally { release.resolve(); await owner.close(); await Promise.allSettled([...pending]); f.database?.close(); }
});
