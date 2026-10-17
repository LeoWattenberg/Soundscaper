/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { PhotoCubeLutRepositoryV1 } from '../src/lightscaper/storage/photo-cube-lut-repository-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';

const TEXT = 'TITLE "Größe"\r\nLUT_3D_SIZE 2\r\n0 0 0\r\n1 0 0\r\n0 1 0\r\n1 1 0\r\n0 0 1\r\n1 0 1\r\n0 1 1\r\n1 1 1';
function resource() {
	const parsed = parseCubeLutV1(TEXT), bytes = new TextEncoder().encode(TEXT);
	return { bytes, reference: { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax } };
}
function opaque() {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('opaque get'); }, getPrototypeOf() { traps++; throw new Error('opaque prototype'); } });
	return { reason, traps: () => traps };
}
async function exactFailure(work: Promise<unknown>, reason: unknown): Promise<void> {
	await work.then(() => assert.fail('Expected refusal'), error => { assert.equal(error, reason); });
}
async function fixture(native: boolean) {
	const name = `lightscaper-photo-lut-${crypto.randomUUID()}`, raw = createInstrumentedIndexedDB(), memory = getMemoryDatabase(name);
	const database = native ? await openDatabase(raw as unknown as IDBFactory, name) : null;
	return { name, raw, memory, database, create: () => new PhotoCubeLutRepositoryV1({ memory, database: async () => database }) };
}

for (const native of [false, true]) test(`${native ? 'native' : 'memory'} LUT body insertion/reuse/reopen preserves exact bytes and separate custody`, async () => {
	const f = await fixture(native), input = resource(), repository = f.create();
	try {
		assert.deepEqual(await repository.put(input.reference, input.bytes), { reference: input.reference, created: true });
		assert.deepEqual(await repository.put(input.reference, input.bytes), { reference: input.reference, created: false });
		await repository.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); bytes.fill(0); });
		await repository.close();
		const reopened = f.create();
		try { await reopened.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); }); } finally { await reopened.close(); }
		assert.equal(native ? f.raw.recordCount(f.name, 'analysis') : f.memory.analysis.size, 1);
		assert.equal(native ? f.raw.recordCount(f.name, 'mediaAssets') : f.memory.mediaAssets.size, 0);
		if (native) { assert.equal(f.raw.recordCount(f.name, 'catalogOriginalRoots'), 0); assert.equal(f.raw.stats.getAllRequests.length, 0); }
		await assert.rejects(repository.withBytes(input.reference, () => undefined), /closed/u);
	} finally { await repository.close(); f.database?.close(); }
});

for (const native of [false, true]) test(`${native ? 'native' : 'memory'} existing malformed or mismatched body never becomes absent or replaceable`, async () => {
	const f = await fixture(native), input = resource(), repository = f.create();
	try {
		await repository.put(input.reference, input.bytes);
		for (const change of [{ size: 3 }, { domainMin: [-1, 0, 0] }, { byteLength: input.bytes.length + 1 }]) {
			await assert.rejects(repository.put({ ...input.reference, ...change }, input.bytes));
		}
		await repository.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); });
		for (const row of [{ key: input.reference.storageKey }, { key: input.reference.storageKey, value: undefined },
			{ key: input.reference.storageKey, value: { schemaVersion: 1, kind: 'photo-cube-lut-body', reference: input.reference, bytes: new Uint8Array([0]) } }]) {
			if (native) f.raw.seedRecord(f.name, 'analysis', row); else f.memory.analysis.set(input.reference.storageKey, row);
			await assert.rejects(repository.put(input.reference, input.bytes));
			await assert.rejects(repository.withBytes(input.reference, () => assert.fail('Corrupt body delivered')));
		}
	} finally { await repository.close(); f.database?.close(); }
});

test('admitted body/reference and port receiver detach before held acquisition; no recipe queue', async () => {
	const input = resource(), expected = input.bytes.slice(), memory = getMemoryDatabase(`photo-lut-held-${crypto.randomUUID()}`), held = deferred<IDBDatabase | null>();
	const port = { memory, database() { assert.equal(this, port); return held.promise; } };
	const repository = new PhotoCubeLutRepositoryV1(port), inserting = repository.put(input.reference, input.bytes);
	input.bytes.fill(0); input.reference.size = 3;
	port.database = () => assert.fail('Late port replacement');
	await assert.rejects(repository.put(resource().reference, resource().bytes), /pending/u);
	const closing = repository.close(); assert.equal(await remainsPending(closing), true);
	held.resolve(null); const result = await inserting; await closing;
	assert.equal(result.reference.size, 2);
	const next = new PhotoCubeLutRepositoryV1({ memory, database: async () => null });
	try { await next.withBytes(resource().reference, bytes => { assert.deepEqual(bytes, expected); }); } finally { await next.close(); }
});

test('scoped read joins held consumer, cancellation and close, then wipes its delivered bytes', async () => {
	const f = await fixture(false), input = resource(), repository = f.create(), held = deferred<void>(), stop = new AbortController(), failure = opaque();
	let delivered: Uint8Array | undefined;
	try {
		await repository.put(input.reference, input.bytes);
		const reading = repository.withBytes(input.reference, async bytes => { delivered = bytes; await held.promise; return 'joined'; }, { signal: stop.signal });
		while (!delivered) await Promise.resolve();
		stop.abort(failure.reason); const closing = repository.close();
		assert.equal(await remainsPending(reading), true); assert.equal(await remainsPending(closing), true); assert.ok(delivered.some(value => value !== 0));
		held.resolve(); await exactFailure(reading, failure.reason); await closing;
		assert.ok(delivered.every(value => value === 0)); assert.equal(failure.traps(), 0); assert.deepEqual(input.bytes, resource().bytes);
	} finally { await repository.close(); }
});

test('borrowed Close drains held opaque consumer failure while the read promise owns its exact outcome', async () => {
	const f = await fixture(false), input = resource(), repository = f.create(), held = deferred<void>(), failure = opaque();
	let delivered: Uint8Array | undefined;
	try {
		await repository.put(input.reference, input.bytes);
		const reading = repository.withBytes(input.reference, async bytes => { delivered = bytes; await held.promise; throw failure.reason; });
		while (!delivered) await Promise.resolve();
		const refusal = exactFailure(reading, failure.reason), closing = repository.close();
		assert.equal(await remainsPending(closing), true); assert.ok(delivered.some(value => value !== 0));
		held.resolve(); await refusal; await closing;
		assert.ok(delivered.every(value => value === 0)); assert.equal(failure.traps(), 0);
	} finally { await repository.close(); }
});

test('native insertion completion joins close and preserves durable ACK over late opaque cancellation', async () => {
	const f = await fixture(true), input = resource(), repository = f.create(), stop = new AbortController(), failure = opaque();
	const release = deferred<void>(), transaction = f.database!.transaction.bind(f.database!); let entered = false;
	let delivered: Uint8Array | undefined;
	f.database!.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const tx = transaction(names, mode);
		if (mode === 'readwrite') {
			const objectStore = tx.objectStore.bind(tx);
			tx.objectStore = name => { const store = objectStore(name), add = store.add.bind(store);
				store.add = value => { delivered = (value as { value: { bytes: Uint8Array } }).value.bytes; return add(value); }; return store; };
			let complete: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(tx, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { complete = value; },
				get() { return (event: Event) => { entered = true; void release.promise.then(() => { complete?.call(tx, event); stop.abort(failure.reason); }); }; } });
		} return tx;
	}) as IDBDatabase['transaction'];
	try {
		const inserting = repository.put(input.reference, input.bytes, { signal: stop.signal });
		const outcome = inserting.then(value => ({ created: value.created, refused: false }), error => ({ refused: true, exact: error === failure.reason }));
		await waitFor(() => entered, 'native LUT insertion completion');
		const closing = repository.close(); assert.equal(await remainsPending(inserting), true); assert.equal(await remainsPending(closing), true);
		assert.ok(delivered?.some(value => value !== 0)); release.resolve();
		assert.deepEqual(await outcome, { created: true, refused: false }); await closing;
		assert.ok(delivered?.every(value => value === 0)); assert.equal(failure.traps(), 0);
		assert.equal(f.raw.recordCount(f.name, 'analysis'), 1); assert.equal(f.raw.stats.activeTransactions, 0);
	} finally { release.resolve(); await repository.close(); f.database?.close(); }
});

test('native add refusal joins rollback and wipes its captured packet without replacing source or creating a row', async () => {
	const f = await fixture(true), input = resource(), repository = f.create(), failure = new DOMException('LUT quota fault', 'QuotaExceededError');
	const transaction = f.database!.transaction.bind(f.database!); let delivered: Uint8Array | undefined, refuse = true;
	f.database!.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const tx = transaction(names, mode), objectStore = tx.objectStore.bind(tx);
		tx.objectStore = name => { const store = objectStore(name), add = store.add.bind(store);
			store.add = value => { delivered = (value as { value: { bytes: Uint8Array } }).value.bytes;
				if (refuse) { refuse = false; throw failure; } return add(value); }; return store; };
		return tx;
	}) as IDBDatabase['transaction'];
	try {
		await exactFailure(repository.put(input.reference, input.bytes), failure);
		assert.ok(delivered?.every(value => value === 0)); assert.deepEqual(input.bytes, resource().bytes);
		assert.equal(f.raw.recordCount(f.name, 'analysis'), 0); assert.equal(f.raw.stats.activeTransactions, 0);
		assert.equal((await repository.put(input.reference, input.bytes)).created, true);
	} finally { await repository.close(); f.database?.close(); }
});

test('closed options and intrinsic cancellation refuse before lazy work without invoking shadowed native methods', async () => {
	const input = resource(), stop = new AbortController(), failure = opaque(); let opened = 0, methods = 0, getters = 0;
	const repository = new PhotoCubeLutRepositoryV1({ memory: getMemoryDatabase(`lut-cold-${crypto.randomUUID()}`), database: async () => { opened++; return null; } });
	Object.defineProperty(stop.signal, 'throwIfAborted', { value: () => { methods++; } }); stop.abort(failure.reason);
	try {
		await exactFailure(repository.put(input.reference, input.bytes, { signal: stop.signal }), failure.reason);
		await exactFailure(repository.withBytes(input.reference, () => undefined, { signal: stop.signal }), failure.reason);
		const accessor = Object.defineProperty({}, 'signal', { enumerable: true, get() { getters++; return undefined; } });
		await assert.rejects(repository.put(input.reference, input.bytes, accessor), TypeError);
		await assert.rejects(repository.put(input.reference, input.bytes, { extra: true } as unknown as { signal?: AbortSignal }), TypeError);
		assert.equal(opened, 0); assert.equal(methods, 0); assert.equal(getters, 0); assert.equal(failure.traps(), 0);
	} finally { await repository.close(); }
});

test('actual source prune and Photo preview eviction preserve immutable LUT rows; whole clear intentionally removes them', async () => {
	const f = await fixture(true), input = resource(), repository = f.create();
	const store = createProjectStore({ indexedDB: f.raw as unknown as IDBFactory, databaseName: f.name, preferOpfs: false, memoryFallback: false });
	const photoMedia = new PhotoMediaStoreV1({ indexedDB: f.raw as unknown as IDBFactory, databaseName: f.name, preferOpfs: false, locks: null });
	try {
		await repository.put(input.reference, input.bytes);
		await store.ready(); f.raw.seedRecord(f.name, 'mediaAssets', { sourceId: 'unretained-source', storage: 'indexeddb-blob', blob: new Blob(['orphan']), size: 6, committedAt: '2000-01-01T00:00:00.000Z' });
		await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: Date.now() + 1000 });
		assert.equal(f.raw.recordCount(f.name, 'mediaAssets'), 0);
		const source = photoArchiveFixture(), original = source.photo.original;
		await photoMedia.mediaRepository.writeAsset(original.storageKey, source.original);
		const roots = [{ photoId: source.photo.id, assetId: original.storageKey, sourceId: original.id, sha256: original.contentSha256, size: original.byteLength }];
		await photoMedia.mediaRepository.catalogOriginals.retain(source.photo.catalogId, roots);
		const binding = { catalogId: source.photo.catalogId, photoId: source.photo.id, originalId: original.id, storageKey: original.storageKey,
			contentSha256: original.contentSha256, byteLength: original.byteLength, width: 1, height: 1 };
		const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array([12, 34, 56, 255]) };
		const plan = planPhotoPreviewV1({ binding, source: frame.descriptor, tier: 'thumbnail' });
		await photoMedia.getPreviewCache().store(await preparePhotoPreviewV1({ plan, binding, frame }));
		assert.equal(f.raw.recordCount(f.name, 'videoDerivativeCacheEntries'), 1);
		// The actual shared eviction owner uses a zero-entry test profile to
		// evict the genuinely published body without constructing 128MiB input.
		const media = new MediaRepository({ memory: f.memory, database: async () => f.database }, new OpfsRepository({ preferOpfs: false }));
		const evicting = new PhotoPreviewCacheV1(media.createBinaryDerivativeCache({ ...PHOTO_PREVIEW_CACHE_PROFILE_V1, maximumEntries: 0 }));
		assert.equal((await evicting.trim()).removedEntries, 1);
		assert.equal(f.raw.recordCount(f.name, 'videoDerivativeCacheEntries'), 0);
		await photoMedia.mediaRepository.catalogOriginals.release(source.photo.catalogId, [source.photo.id]); await photoMedia.close();
		await repository.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); });
		await store.clear(); assert.equal(f.raw.recordCount(f.name, 'analysis'), 0);
		await assert.rejects(repository.withBytes(input.reference, () => assert.fail('Cleared body delivered')), /missing/u);
	} finally { await repository.close(); await photoMedia.close(); await store.close(); f.database?.close(); }
});
