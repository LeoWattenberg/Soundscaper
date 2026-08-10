/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	MEDIA_ASSET_CHUNK_STORAGE_TYPE,
	MEDIA_ASSET_STREAM_CHUNK_BYTES,
} from '../src/common/editor/storage/media-asset-write-repository.ts';

test('a load registers before its first await, so a same-turn clear admits it instead of fencing it', async () => {
	const store = memoryStore('same-turn-clear');
	const sourceId = 'retained-load-same-turn';
	store.memory.mediaAssets.set(
		sourceId,
		blobRecord(sourceId, new Blob([Uint8Array.of(1)], { type: 'video/mp4' })),
	);

	const loading = store.loadMediaAsset(sourceId);
	const clearing = store.clear();
	const [loadResult, clearResult] = await Promise.allSettled([loading, clearing]);
	await store.close();

	// The admitted load either drains to completion or observes the maintenance
	// abort. A load that registered only after its first await would instead be
	// rejected by clear's synchronous admission fence with a maintenance error.
	if (loadResult.status === 'rejected') {
		assert.equal(
			(loadResult.reason as { readonly name?: unknown } | null)?.name,
			'AbortError',
			'a load started before a same-turn clear must abort, never see the admission fence',
		);
	} else {
		assert.ok(loadResult.value, 'a drained same-turn load must still return its payload');
	}
	assert.equal(clearResult.status, 'fulfilled');
	assert.equal(store.memory.mediaAssets.size, 0);
});

test('clear aborts and drains an admitted multi-chunk retained-media load before reopening admission', async (context) => {
	const sourceId = 'retained-load-clear';
	const bytes = multiChunkBytes(37, 0x43);
	const store = memoryStore('clear');
	seedTrustedChunkedMedia(store, sourceId, bytes);
	const stall = stallSecondChunkPayloadRead(context, bytes);

	const loading = store.loadMediaAsset(sourceId);
	await requirePayloadRead(stall.started, loading);
	const clearing = store.clear();
	const settledBeforeRelease = await settlesByNextTurn(clearing);
	const lateLoad = await Promise.allSettled([store.loadMediaAsset(sourceId)]);
	stall.release();
	const [loadResult, clearResult] = await Promise.allSettled([loading, clearing]);
	const inventorySizeAfterClear = store.memory.mediaAssets.size;

	const freshSourceId = 'retained-load-after-clear';
	const freshBytes = Uint8Array.of(7, 2, 8);
	store.memory.mediaAssets.set(
		freshSourceId,
		blobRecord(freshSourceId, new Blob([exactArrayBuffer(freshBytes)], { type: 'video/mp4' })),
	);
	const freshLoad = await store.loadMediaAsset(freshSourceId);
	await store.close();

	assert.equal(settledBeforeRelease, false, 'clear must wait for the admitted load to terminate');
	assertRejectedWith(lateLoad[0], /maintenance/iu, 'clear must fence new load admission synchronously');
	assertAbortResult(loadResult);
	assert.equal(clearResult.status, 'fulfilled');
	assert.equal(inventorySizeAfterClear, 0);
	assert.ok(freshLoad, 'clear must reopen load admission after maintenance');
	assert.deepEqual(new Uint8Array(await freshLoad.arrayBuffer()), freshBytes);
});

test('close joins an active clear before terminal cleanup', async (context) => {
	const sourceId = 'retained-load-clear-close';
	const bytes = multiChunkBytes(41, 0x47);
	const store = memoryStore('clear-close');
	seedTrustedChunkedMedia(store, sourceId, bytes);
	const stall = stallSecondChunkPayloadRead(context, bytes);

	const loading = store.loadMediaAsset(sourceId);
	await requirePayloadRead(stall.started, loading);
	const settlementOrder: string[] = [];
	const clearing = store.clear();
	const observedClear = clearing.then(
		() => { settlementOrder.push('clear'); },
		() => { settlementOrder.push('clear-rejected'); },
	);
	const closing = store.close();
	const observedClose = closing.then(
		() => { settlementOrder.push('close'); },
		() => { settlementOrder.push('close-rejected'); },
	);
	const closeSettledBeforeRelease = await settlesByNextTurn(closing);

	stall.release();
	const [loadResult, clearResult, closeResult] = await Promise.allSettled([
		loading,
		clearing,
		closing,
	]);
	await Promise.all([observedClear, observedClose]);

	assert.equal(
		closeSettledBeforeRelease,
		false,
		'close must not overtake an active clear while its admitted load is draining',
	);
	assertAbortResult(loadResult);
	assert.equal(clearResult.status, 'fulfilled', 'an admitted clear must finish during close');
	assert.equal(closeResult.status, 'fulfilled');
	assert.deepEqual(settlementOrder, ['clear', 'close'], 'close must settle after the active clear');
	assert.equal(store.memory.mediaAssets.size, 0, 'the admitted clear must empty retained media');
	assert.equal(
		store.memory.mediaAssets.has(sourceId),
		false,
		'the interrupted load must not repopulate retained media after clear',
	);
});

test('close aborts and drains an admitted multi-chunk retained-media load without mutating its record', async (context) => {
	const sourceId = 'retained-load-close';
	const bytes = multiChunkBytes(43, 0x53);
	const store = memoryStore('close');
	const record = seedTrustedChunkedMedia(store, sourceId, bytes);
	const stall = stallSecondChunkPayloadRead(context, bytes);

	const loading = store.loadMediaAsset(sourceId);
	await requirePayloadRead(stall.started, loading);
	const closing = store.close();
	const settledBeforeRelease = await settlesByNextTurn(closing);
	const lateLoad = await Promise.allSettled([store.loadMediaAsset(sourceId)]);
	stall.release();
	const [loadResult, closeResult] = await Promise.allSettled([loading, closing]);
	const retained = requiredRecord(store, sourceId);

	const freshSourceId = 'retained-load-after-close';
	store.memory.mediaAssets.set(
		freshSourceId,
		blobRecord(freshSourceId, new Blob([Uint8Array.of(1)], { type: 'video/mp4' })),
	);
	const freshResult = await Promise.allSettled([store.loadMediaAsset(freshSourceId)]);

	assert.equal(settledBeforeRelease, false, 'close must wait for the admitted load to terminate');
	assertRejectedWith(lateLoad[0], /closed/iu, 'close must fence new load admission synchronously');
	assertAbortResult(loadResult);
	assert.equal(closeResult.status, 'fulfilled');
	assert.equal(retained, record, 'an interrupted load must not replace or mutate its stored record');
	assert.equal(freshResult[0]?.status, 'rejected');
	assert.match(String(freshResult[0]?.reason), /closed/iu);
});

test('concurrent close callers join the same terminal media drain', async (context) => {
	const sourceId = 'retained-load-concurrent-close';
	const bytes = multiChunkBytes(47, 0x59);
	const store = memoryStore('concurrent-close');
	const record = seedTrustedChunkedMedia(store, sourceId, bytes);
	const stall = stallSecondChunkPayloadRead(context, bytes);

	const loading = store.loadMediaAsset(sourceId);
	await requirePayloadRead(stall.started, loading);
	const firstClosing = store.close();
	const secondClosing = store.close();
	const [firstSettledBeforeRelease, secondSettledBeforeRelease] = await Promise.all([
		settlesByNextTurn(firstClosing),
		settlesByNextTurn(secondClosing),
	]);

	stall.release();
	const [loadResult, firstCloseResult, secondCloseResult] = await Promise.allSettled([
		loading,
		firstClosing,
		secondClosing,
	]);
	const retained = requiredRecord(store, sourceId);

	assert.equal(
		secondClosing,
		firstClosing,
		'concurrent close callers must receive the exact same terminal cleanup promise',
	);
	assert.equal(firstSettledBeforeRelease, false, 'the first close must wait for the admitted load');
	assert.equal(
		secondSettledBeforeRelease,
		false,
		'a concurrent close caller must join terminal cleanup instead of resolving early',
	);
	assertAbortResult(loadResult);
	assert.equal(firstCloseResult.status, 'fulfilled');
	assert.equal(secondCloseResult.status, 'fulfilled');
	assert.equal(retained, record, 'an interrupted load must not replace or mutate its stored record');
});

function memoryStore(suffix: string) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `media-load-lifecycle-${suffix}-${Date.now()}-${Math.random()}`,
	});
}

function blobRecord(sourceId: string, blob: Blob): Record<string, unknown> {
	return {
		sourceId,
		storage: 'indexeddb-blob',
		blob,
		size: blob.size,
		mimeType: blob.type,
		name: `${sourceId}.mp4`,
	};
}

/** Bytes spanning one full stream chunk plus a distinctive short tail chunk. */
function multiChunkBytes(tailBytes: number, fill: number): Uint8Array {
	return new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + tailBytes).fill(fill);
}

/**
 * Seeds a verified chunked media row. Loading it verifies the stored digest,
 * so the load reads chunk payload bytes and can be stalled mid-flight.
 */
function seedTrustedChunkedMedia(
	store: ReturnType<typeof memoryStore>,
	sourceId: string,
	bytes: Uint8Array,
): Readonly<Record<string, unknown>> {
	const token = `token-${sourceId}`;
	const record = Object.freeze({
		sourceId,
		storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE,
		mediaContentDigestVersion: 1,
		mediaContentToken: `media-content-trusted-lifecycle-fixture-${sourceId}`,
		mediaChunkToken: token,
		mediaChunkBytes: MEDIA_ASSET_STREAM_CHUNK_BYTES,
		mediaChunkCount: Math.ceil(bytes.byteLength / MEDIA_ASSET_STREAM_CHUNK_BYTES),
		size: bytes.byteLength,
		sha256: digest(bytes),
		mimeType: 'video/mp4',
	});
	store.memory.mediaAssets.set(sourceId, record);
	for (let index = 0, offset = 0; offset < bytes.byteLength; index += 1, offset += MEDIA_ASSET_STREAM_CHUNK_BYTES) {
		const part = bytes.subarray(offset, Math.min(bytes.byteLength, offset + MEDIA_ASSET_STREAM_CHUNK_BYTES));
		const key = `${token}:${String(index).padStart(10, '0')}`;
		store.memory.mediaAssetChunks.set(key, Object.freeze({
			key,
			mediaChunkToken: token,
			index,
			sourceId,
			payload: new Blob([exactArrayBuffer(part)]),
			byteLength: part.byteLength,
			createdAt: Date.now(),
		}));
	}
	return record;
}

function requiredRecord(
	store: ReturnType<typeof memoryStore>,
	sourceId: string,
): Record<string, unknown> {
	const record = store.memory.mediaAssets.get(sourceId);
	assert.ok(record);
	return record as Record<string, unknown>;
}

function assertAbortResult(result: PromiseSettledResult<unknown>): void {
	assert.equal(result.status, 'rejected', 'maintenance must reject the interrupted media load');
	if (result.status !== 'rejected') return;
	assert.equal(
		(result.reason as { readonly name?: unknown } | null)?.name,
		'AbortError',
		'maintenance interruption must be reported as an abort',
	);
}

function assertRejectedWith(
	result: PromiseSettledResult<unknown> | undefined,
	pattern: RegExp,
	message: string,
): void {
	assert.equal(result?.status, 'rejected', message);
	if (result?.status === 'rejected') assert.match(String(result.reason), pattern, message);
}

async function settlesByNextTurn(promise: Promise<unknown>): Promise<boolean> {
	return Promise.race([
		promise.then(() => true, () => true),
		new Promise<false>((resolve) => { setImmediate(() => resolve(false)); }),
	]);
}

async function requirePayloadRead(started: Promise<void>, loading: Promise<unknown>): Promise<void> {
	await Promise.race([
		started,
		loading.then(
			() => { throw new Error('The retained-media load settled without reading its second stored chunk.'); },
			(error: unknown) => { throw error; },
		),
	]);
}

interface PayloadReadStall {
	readonly started: Promise<void>;
	release(): void;
}

/**
 * Stalls the admitted load at its second chunk payload read. The tail chunk is
 * the only Blob whose size matches, so the first chunk read passes through and
 * the load is provably mid multi-chunk flight when the stall engages.
 */
function stallSecondChunkPayloadRead(context: TestContext, bytes: Uint8Array): PayloadReadStall {
	const tailSize = bytes.byteLength - MEDIA_ASSET_STREAM_CHUNK_BYTES;
	const originalArrayBuffer = Blob.prototype.arrayBuffer;
	const started = deferred();
	const released = deferred();
	let intercepted = false;
	Blob.prototype.arrayBuffer = async function patchedArrayBuffer(this: Blob): Promise<ArrayBuffer> {
		if (!intercepted && this.size === tailSize) {
			intercepted = true;
			started.resolve();
			await released.promise;
		}
		return Reflect.apply(originalArrayBuffer, this, []) as Promise<ArrayBuffer>;
	};
	context.after(() => {
		released.resolve();
		Blob.prototype.arrayBuffer = originalArrayBuffer;
	});
	return { started: started.promise, release: released.resolve };
}

interface Deferred {
	readonly promise: Promise<void>;
	readonly resolve: () => void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function digest(bytes: Uint8Array): string {
	return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}
