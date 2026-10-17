/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoMediaRestoreCandidateV1 } from '../src/lightscaper/storage/photo-media-restore-candidate-v1.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture, mediaRestoreAllocation, mediaRestoreRoot, mediaRestorePhoto, mediaRestoreChunks } from './helpers/lightscaper-media-restore-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const options = (f: ReturnType<typeof mediaRestoreFixture>, count: number, signal?: AbortSignal) => ({
	indexedDB: f.factory, allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(count), signal,
});

test('exact archived keys and logical originals survive repeated-key and same-digest distinct-key restoration', async () => {
	const f = mediaRestoreFixture(), bytes = new Uint8Array([1, 2, 3]);
	const photos = [mediaRestorePhoto(1, bytes, 'shared'), mediaRestorePhoto(2, bytes, 'shared'), mediaRestorePhoto(3, bytes, 'distinct')];
	const candidate = await createPhotoMediaRestoreCandidateV1(options(f, 3)), catalog = await f.catalog(photos);
	try {
		for (const [index, photo] of photos.entries()) {
			const receipt = await candidate.writeOriginal(photo, mediaRestoreChunks(bytes));
			assert.deepEqual(receipt, { photoId: photo.id, assetId: photo.original.storageKey, sha256: photo.original.contentSha256, size: 3, reused: index === 1 });
		}
		assert.deepEqual(await candidate.finish(), { databaseName: f.names.mediaDatabaseName, catalogId: 'catalog-1', photoCount: 3, originalCount: 2, originalByteLength: 6 });
		const rows = f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'mediaAssets');
		assert.deepEqual(rows.map(row => row.sourceId).sort(), ['distinct', 'shared']);
		assert.notEqual(rows[0]!.mediaContentToken, rows[1]!.mediaContentToken);
		assert.deepEqual(rows.map(row => row.catalogRootCount).sort(), [1, 2]);
		const roots = f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'catalogOriginalRoots');
		assert.deepEqual(roots.map(row => row.sourceId).sort(), ['original-1', 'original-2', 'original-3']);
		assert.ok(roots.every(row => row.importId === null));
	} finally { await candidate.rollback(); await catalog.rollback(); }
});

test('a corrupt second reused body is consumed and rejected rather than silently skipped', async () => {
	const f = mediaRestoreFixture(), bytes = new Uint8Array([1, 2, 3]), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 2));
	let drained = 0;
	try {
		await candidate.writeOriginal(mediaRestorePhoto(1, bytes, 'same'), mediaRestoreChunks(bytes));
		await assert.rejects(candidate.writeOriginal(mediaRestorePhoto(2, bytes, 'same'), (async function* () { drained++; yield new Uint8Array([3, 2, 1]); })()), /digest|SHA/u);
		assert.equal(drained, 1); await assert.rejects(candidate.finish(), /failed|retired/u);
	} finally { await candidate.rollback(); }
});

test('held body next owns exclusion, cancellation joins next and return before rollback', async () => {
	const f = mediaRestoreFixture(), stop = new AbortController(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1, stop.signal));
	const entered = deferred<void>(), release = deferred<void>(), returned = deferred<void>(), returnRelease = deferred<void>();
	const reason = Object.freeze({ cancelled: 'held' }); let failure: unknown;
	const source = { [Symbol.asyncIterator]() { return {
		async next() { entered.resolve(); await release.promise; return { done: false as const, value: new Uint8Array([1, 2, 3]) }; },
		async return() { returned.resolve(); await returnRelease.promise; return { done: true as const, value: undefined }; },
	}; } };
	const work = candidate.writeOriginal(mediaRestorePhoto(), source).catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; await assert.rejects(candidate.writeOriginal(new Proxy({}, { ownKeys() { throw new Error('overlap inspected'); } }), mediaRestoreChunks(new Uint8Array())), /pending/u);
		stop.abort(reason); const removal = candidate.rollback(); assert.equal(await remainsPending(removal), true);
		release.resolve(); await returned.promise; assert.equal(await remainsPending(removal), true);
		returnRelease.resolve(); await work; await removal; assert.equal(failure, reason);
		assert.deepEqual(f.deleted, [f.names.mediaDatabaseName]);
	} finally { release.resolve(); returnRelease.resolve(); await work; await candidate.rollback(); }
});

test('actual 4MiB plus tail is durably chunked and independently hashed without whole-body loads', async () => {
	const f = mediaRestoreFixture(), bytes = new Uint8Array(4 * 1024 * 1024 + 37); bytes.fill(23); bytes[bytes.length - 1] = 99;
	const photo = mediaRestorePhoto(1, bytes), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), catalog = await f.catalog([photo]);
	try {
		await candidate.writeOriginal(photo, mediaRestoreChunks(bytes));
		const raw = f.raw(f.names.mediaDatabaseName), chunks = raw.records(f.names.mediaDatabaseName, 'mediaAssetChunks');
		assert.deepEqual(chunks.map(row => row.byteLength), [4 * 1024 * 1024, 37]);
		assert.ok(chunks.every(row => row.payloadEncoding === 'array-buffer-v1' && !Object.hasOwn(row, 'payload')));
		const before = raw.stats.getAllRequests.length;
		assert.equal((await candidate.finish()).originalByteLength, bytes.byteLength);
		assert.equal(raw.stats.getAllRequests.length, before);
		assert.ok((raw.stats.getRequests as unknown as readonly { store: string }[]).some(row => row.store === 'mediaAssetChunks'));
	} finally { await candidate.rollback(); await catalog.rollback(); }
});

test('conflicting repeated-key metadata refuses before borrowing any incoming body', async () => {
	const f = mediaRestoreFixture(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 2)); let calls = 0;
	try {
		await candidate.writeOriginal(mediaRestorePhoto(1, undefined, 'same'), mediaRestoreChunks(new Uint8Array([1, 2, 3])));
		await assert.rejects(candidate.writeOriginal(mediaRestorePhoto(2, new Uint8Array([3, 2, 1]), 'same'), {
			[Symbol.asyncIterator]() { calls++; throw new Error('must not borrow conflicting body'); },
		}), /conflicting/u);
		assert.equal(calls, 0);
	} finally { await candidate.rollback(); }
});

test('finish requires actual finished catalog bindings, rather than successful intake counters', async () => {
	for (const mode of ['absent', 'unfinished', 'different-original'] as const) {
		const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1));
		const catalog = mode === 'absent' ? null : await f.catalog([mode === 'different-original' ? mediaRestorePhoto(1, new Uint8Array([3, 2, 1])) : photo], mode !== 'unfinished');
		try {
			await candidate.writeOriginal(photo, mediaRestoreChunks(new Uint8Array([1, 2, 3])));
			await assert.rejects(candidate.finish(), /absent|finished|differs/u);
			assert.ok(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'catalogOriginalRoots').every(row => row.importId !== null));
		} finally { await candidate.rollback(); await catalog?.rollback(); }
	}
});

test('finished storage refuses token, root, chunk-byte and geometry corruption before any promotion', async () => {
	for (const kind of ['token', 'root-count', 'root-source', 'chunk-sha', 'chunk-geometry', 'extra-asset', 'extra-chunk'] as const) {
		const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), catalog = await f.catalog([photo]);
		await candidate.writeOriginal(photo, mediaRestoreChunks(new Uint8Array([1, 2, 3])));
		const raw = f.raw(f.names.mediaDatabaseName), asset = raw.records(f.names.mediaDatabaseName, 'mediaAssets')[0]!, root = raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots')[0]!, chunk = raw.records(f.names.mediaDatabaseName, 'mediaAssetChunks')[0]!;
		if (kind === 'token') raw.seedRecord(f.names.mediaDatabaseName, 'mediaAssets', { ...asset, mediaContentToken: `media-content-${'c'.repeat(32)}` });
		if (kind === 'root-count') raw.seedRecord(f.names.mediaDatabaseName, 'mediaAssets', { ...asset, catalogRootCount: 2 });
		if (kind === 'root-source') raw.seedRecord(f.names.mediaDatabaseName, 'catalogOriginalRoots', { ...root, sourceId: 'wrong-logical-original' });
		if (kind === 'chunk-sha') raw.seedRecord(f.names.mediaDatabaseName, 'mediaAssetChunks', { ...chunk, payloadBytes: new Uint8Array([3, 2, 1]).buffer });
		if (kind === 'chunk-geometry') raw.seedRecord(f.names.mediaDatabaseName, 'mediaAssetChunks', { ...chunk, index: 1 });
		if (kind === 'extra-asset') raw.seedRecord(f.names.mediaDatabaseName, 'mediaAssets', { ...asset, sourceId: 'orphan' });
		if (kind === 'extra-chunk') raw.seedRecord(f.names.mediaDatabaseName, 'mediaAssetChunks', { ...chunk, key: `${String(chunk.mediaChunkToken)}:0000000001`, index: 1 });
		try {
			await assert.rejects(candidate.finish(), /differs|differ|geometry|excess/u);
			assert.ok(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots').every(row => row.importId !== null));
		} finally { await candidate.rollback(); await catalog.rollback(); }
	}
});

test('rollback refuses changed owner and leaves the foreign namespace intact', async () => {
	const f = mediaRestoreFixture(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 0));
	const raw = f.raw(f.names.mediaDatabaseName), wrapper = raw.records(f.names.mediaDatabaseName, 'settings').find(row => row.key === PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1)!;
	raw.seedRecord(f.names.mediaDatabaseName, 'settings', { ...wrapper, value: { ...(wrapper.value as Record<string, unknown>), ownerToken: 'c'.repeat(32) } });
	await assert.rejects(candidate.rollback(), /ownership changed/u); assert.deepEqual(f.deleted, []);
	assert.equal(raw.recordCount(f.names.mediaDatabaseName, 'settings') > 0, true);
});

test('65 stored bindings retain one shared asset and cross bounded binding/root pages', async () => {
	const f = mediaRestoreFixture(), bytes = new Uint8Array([1, 2, 3]), photos = Array.from({ length: 65 }, (_, index) => mediaRestorePhoto(index + 1, bytes, 'shared'));
	const candidate = await createPhotoMediaRestoreCandidateV1(options(f, photos.length)), catalog = await f.catalog(photos);
	try {
		for (const photo of photos) await candidate.writeOriginal(photo, mediaRestoreChunks(bytes));
		const receipt = await candidate.finish(); assert.equal(receipt.photoCount, 65); assert.equal(receipt.originalCount, 1);
		assert.equal(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'mediaAssets')[0]!.catalogRootCount, 65);
		assert.equal(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'catalogOriginalRoots').filter(row => row.importId === null).length, 65);
	} finally { await candidate.rollback(); await catalog.rollback(); }
});

function onNativeCompletion(transaction: IDBTransaction, complete: () => void): void {
	let handler: IDBTransaction['oncomplete'] = null;
	Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
		get() { return (event: Event) => { handler?.call(transaction, event); complete(); }; } });
}

test('late body-custody native ACK survives cancellation, while unfinished candidate cannot publish', async () => {
	const f = mediaRestoreFixture(), stop = new AbortController(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1, stop.signal));
	const reason = new Proxy({}, { get() { throw new Error('opaque inspected'); }, getPrototypeOf() { throw new Error('opaque reflected'); } });
	f.observeTransactions((transaction, stores, mode) => {
		if (mode === 'readwrite' && [...(typeof stores === 'string' ? [stores] : stores)].sort().join(',') === 'catalogOriginalRoots,mediaAssets,settings') {
			onNativeCompletion(transaction, () => { stop.abort(reason); });
		}
	});
	try {
		assert.equal((await candidate.writeOriginal(mediaRestorePhoto(), mediaRestoreChunks(new Uint8Array([1, 2, 3])))).photoId, 'photo-1');
		let failure: unknown; try { await candidate.finish(); assert.fail('Expected cancellation.'); } catch (error) { failure = error; } assert.equal(failure, reason);
	} finally { await candidate.rollback(); }
});

test('native final-fence ACK wins late abort and its scalar receipt remains available after close', async () => {
	const f = mediaRestoreFixture(), stop = new AbortController(), photo = mediaRestorePhoto(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1, stop.signal)), catalog = await f.catalog([photo]);
	const reason = Object.freeze({ late: 'complete' }); let completions = 0;
	await candidate.writeOriginal(photo, mediaRestoreChunks(new Uint8Array([1, 2, 3])));
	f.observeTransactions((transaction, stores, mode) => {
		if (mode === 'readwrite' && [...(typeof stores === 'string' ? [stores] : stores)].sort().join(',') === 'catalogOriginalRoots,mediaAssetChunks,mediaAssets,settings') {
			onNativeCompletion(transaction, () => { completions++; stop.abort(reason); });
		}
	});
	try {
		const receipt = await candidate.finish(); assert.equal(completions, 1); assert.equal(receipt.originalCount, 1);
		assert.equal(await candidate.finish(), receipt); assert.deepEqual(Object.keys(receipt).sort(), ['catalogId', 'databaseName', 'originalByteLength', 'originalCount', 'photoCount']);
		await candidate.close(); assert.equal(await candidate.finish(), receipt);
	} finally { await candidate.rollback(); await catalog.rollback(); }
});

test('a read-handle close failure cannot silently disappear after candidate-ready acknowledgement', async () => {
	const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), catalog = await f.catalog([photo]);
	await candidate.writeOriginal(photo, mediaRestoreChunks(new Uint8Array([1, 2, 3])));
	const opening = f.factory.open(f.names.catalogDatabaseName), database = await new Promise<IDBDatabase>((resolve, reject) => {
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
	const close = database.close.bind(database), failure = new Error('read handle close failed'); let throws = true;
	database.close = () => { if (throws) throw failure; close(); };
	const receipt = await candidate.finish(); assert.equal(receipt.originalCount, 1); throws = false;
	await assert.rejects(candidate.close(), error => error === failure);
	await assert.rejects(candidate.rollback(), error => error === failure); await catalog.rollback();
	assert.deepEqual(f.deleted, [f.names.mediaDatabaseName, f.names.catalogDatabaseName]);
});

test('close requested at native completion retains a one-shot audit connection failure after joining finish', async () => {
	const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), catalog = await f.catalog([photo]);
	await candidate.writeOriginal(photo, mediaRestoreChunks(new Uint8Array([1, 2, 3])));
	const opening = f.factory.open(f.names.catalogDatabaseName), database = await new Promise<IDBDatabase>((resolve, reject) => {
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
	const close = database.close.bind(database), failure = new Error('one-shot read close failed'); let once = true, closing: Promise<void> | null = null;
	database.close = () => { if (once) { once = false; throw failure; } close(); };
	f.observeTransactions((transaction, stores, mode) => {
		if (mode === 'readwrite' && [...(typeof stores === 'string' ? [stores] : stores)].sort().join(',') === 'catalogOriginalRoots,mediaAssetChunks,mediaAssets,settings') {
			onNativeCompletion(transaction, () => { closing = candidate.close(); void closing.catch(() => undefined); });
		}
	});
	const receipt = await candidate.finish(); assert.equal(receipt.originalCount, 1); assert.ok(closing);
	await assert.rejects(closing, error => error === failure);
	await assert.rejects(candidate.rollback(), error => error === failure); await catalog.rollback();
});

test('missing chunk or custody row and wrong catalog owner all refuse actual final verification', async () => {
	for (const kind of ['chunk', 'root', 'catalog-owner'] as const) {
		const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), catalog = await f.catalog([photo]);
		try {
			await candidate.writeOriginal(photo, mediaRestoreChunks(new Uint8Array([1, 2, 3])));
			const raw = f.raw(f.names.mediaDatabaseName);
			if (kind === 'chunk') await f.remove(f.names.mediaDatabaseName, 'mediaAssetChunks', String(raw.records(f.names.mediaDatabaseName, 'mediaAssetChunks')[0]!.key));
			if (kind === 'root') await f.remove(f.names.mediaDatabaseName, 'catalogOriginalRoots', String(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots')[0]!.key));
			if (kind === 'catalog-owner') {
				const backing = f.raw(f.names.catalogDatabaseName), marker = backing.records(f.names.catalogDatabaseName, 'photoCatalogRestoreOwners')[0]!;
				backing.seedRecord(f.names.catalogDatabaseName, 'photoCatalogRestoreOwners', { ...marker, ownerToken: 'c'.repeat(32) });
			}
			await assert.rejects(candidate.finish(), /geometry|root|owner|identity|marker|reference/u);
		} finally { await candidate.rollback(); if (kind !== 'catalog-owner') await catalog.rollback(); else await catalog.close(); }
	}
});

test('stream truncation, overflow and overlarge emissions poison the candidate and join iterator cleanup', async () => {
	for (const bytes of [new Uint8Array([1, 2]), new Uint8Array([1, 2, 3, 4]), new Uint8Array(4 * 1024 * 1024 + 1)]) {
		const f = mediaRestoreFixture(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)); let returns = 0;
		const source = { [Symbol.asyncIterator]() { let first = true; return {
			async next() { if (first) { first = false; return { done: false as const, value: bytes }; } return { done: true as const, value: undefined }; },
			async return() { returns++; return { done: true as const, value: undefined }; },
		}; } };
		try { await assert.rejects(candidate.writeOriginal(mediaRestorePhoto(), source), /size|byte budget/u); assert.equal(returns, bytes.length < 3 ? 0 : 1); await assert.rejects(candidate.finish(), /failed/u); }
		finally { await candidate.rollback(); }
	}
});

test('cleanup failure remains distinct from exact opaque source cancellation and rollback waits for it', async () => {
	const f = mediaRestoreFixture(), stop = new AbortController(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1, stop.signal));
	const entered = deferred<void>(), release = deferred<void>(), returned = deferred<void>(), returnRelease = deferred<void>(), cleanup = new Error('return failed');
	const reason = new Proxy({}, { get() { throw new Error('reason inspected'); }, getPrototypeOf() { throw new Error('reason reflected'); } });
	let failure: unknown;
	const work = candidate.writeOriginal(mediaRestorePhoto(), { [Symbol.asyncIterator]() { return {
		async next() { entered.resolve(); await release.promise; return { done: false as const, value: new Uint8Array([1, 2, 3]) }; },
		async return() { returned.resolve(); await returnRelease.promise; throw cleanup; },
	}; } }).catch((error: unknown) => { failure = error; });
	await entered.promise; stop.abort(reason); const removal = candidate.rollback(); release.resolve(); await returned.promise;
	assert.equal(await remainsPending(removal), true); returnRelease.resolve(); await work; await removal;
	assert.ok(failure instanceof AggregateError); assert.equal(failure.errors[0], reason); assert.equal(failure.errors[1], cleanup);
});

test('native ports and iterator callbacks are captured before held body callbacks can replace them', async () => {
	const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), catalog = await f.catalog([photo]);
	const entered = deferred<void>(), release = deferred<void>(); let accesses = 0, first = true;
	const iterator = { async next() { if (!first) return { done: true as const, value: undefined }; first = false; entered.resolve(); await release.promise; return { done: false as const, value: new Uint8Array([1, 2, 3]) }; } };
	const source = Object.defineProperty({}, Symbol.asyncIterator, { get() { accesses++; return () => iterator; } }) as AsyncIterable<Uint8Array>;
	const work = candidate.writeOriginal(photo, source); await entered.promise;
	f.factory.open = () => { throw new Error('replaced native open'); }; f.factory.deleteDatabase = () => { throw new Error('replaced native delete'); };
	iterator.next = async () => { throw new Error('replaced next'); }; release.resolve(); await work;
	assert.equal(accesses, 1); assert.equal((await candidate.finish()).photoCount, 1); await candidate.rollback(); await catalog.rollback();
});

test('empty catalog is a valid bodyless candidate, and closed hostile admission has zero native opens', async () => {
	const f = mediaRestoreFixture(); let getters = 0;
	await assert.rejects(createPhotoMediaRestoreCandidateV1({ ...options(f, 0), root: Object.defineProperty({}, 'schemaFamily', { get() { getters++; return 'lightscaper'; }, enumerable: true }) }), /data|required/u);
	await assert.rejects(createPhotoMediaRestoreCandidateV1({ ...options(f, 0), future: true } as never), /unsupported/u);
	assert.equal(getters, 0); assert.equal(f.opens.length, 0);
	const candidate = await createPhotoMediaRestoreCandidateV1(options(f, 0)), catalog = await f.catalog([]);
	try { assert.deepEqual(await candidate.finish(), { databaseName: f.names.mediaDatabaseName, catalogId: 'catalog-1', photoCount: 0, originalCount: 0, originalByteLength: 0 }); }
	finally { await candidate.rollback(); await catalog.rollback(); }
});

test('closed owner wrapper corruption is rejected before a new source is borrowed', async () => {
	const f = mediaRestoreFixture(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), raw = f.raw(f.names.mediaDatabaseName);
	const wrapper = raw.records(f.names.mediaDatabaseName, 'settings').find(row => row.key === PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1)!;
	raw.seedRecord(f.names.mediaDatabaseName, 'settings', { ...wrapper, future: true }); let calls = 0;
	await assert.rejects(candidate.writeOriginal(mediaRestorePhoto(), { [Symbol.asyncIterator]() { calls++; throw new Error('borrowed despite corrupt owner'); } }), /unsupported|owner/u);
	assert.equal(calls, 0); await assert.rejects(candidate.rollback(), /ownership changed/u); assert.deepEqual(f.deleted, []);
});

test('failed final audit also retains a one-shot read cleanup failure for explicit close', async () => {
	const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), catalog = await f.catalog([photo], false);
	await candidate.writeOriginal(photo, mediaRestoreChunks(new Uint8Array([1, 2, 3])));
	const opening = f.factory.open(f.names.catalogDatabaseName), database = await new Promise<IDBDatabase>((resolve, reject) => {
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
	const close = database.close.bind(database), cleanup = new Error('failed audit close'); let once = true;
	database.close = () => { if (once) { once = false; throw cleanup; } close(); };
	let failure: unknown; try { await candidate.finish(); } catch (error) { failure = error; }
	assert.ok(failure instanceof AggregateError); assert.match(String(failure.errors[0]), /finished/u); assert.equal(failure.errors[1], cleanup);
	await assert.rejects(candidate.close(), error => error === cleanup); await assert.rejects(candidate.rollback(), error => error === cleanup); await catalog.rollback();
});

test('one mutable archived photo is detached synchronously before its first borrowed native await', async () => {
	const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), mutable = structuredClone(photo), candidate = await createPhotoMediaRestoreCandidateV1(options(f, 1)), catalog = await f.catalog([photo]);
	const work = candidate.writeOriginal(mutable, mediaRestoreChunks(new Uint8Array([1, 2, 3])));
	(mutable.original as unknown as { storageKey: string }).storageKey = 'replaced-before-native-await';
	try { assert.equal((await work).assetId, photo.original.storageKey); assert.equal((await candidate.finish()).photoCount, 1); }
	finally { await candidate.rollback(); await catalog.rollback(); }
});
