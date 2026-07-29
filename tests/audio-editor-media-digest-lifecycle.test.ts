/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../src/common/editor/storage/media-content-digest.ts';
import { MEDIA_CONTENT_DIGEST_VERIFIED_VERSION } from '../src/common/editor/storage/media-content-provenance.ts';

test('clear aborts and drains an admitted multi-chunk legacy digest before reopening admission', async (context) => {
	const sourceId = 'legacy-digest-clear';
	const bytes = new Uint8Array(MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 17).fill(0x43);
	const store = memoryStore('clear');
	store.memory.mediaAssets.set(sourceId, legacyRecord(sourceId, new Blob([bytes], { type: 'video/mp4' })));
	const stall = stallSecondDigestChunk(context, bytes.byteLength);

	const loading = store.loadMediaAsset(sourceId);
	await requireSecondChunk(stall.started, loading);
	const clearing = store.clear();
	const settledBeforeRelease = await settlesByNextTurn(clearing);
	const lateLoad = await Promise.allSettled([store.loadMediaAsset(sourceId)]);
	stall.release();
	const [loadResult, clearResult] = await Promise.allSettled([loading, clearing]);
	const inventorySizeAfterClear = store.memory.mediaAssets.size;

	const freshSourceId = 'legacy-digest-after-clear';
	const freshBytes = Uint8Array.of(7, 2, 8);
	store.memory.mediaAssets.set(
		freshSourceId,
		legacyRecord(freshSourceId, new Blob([freshBytes], { type: 'video/mp4' })),
	);
	const freshLoad = await store.loadMediaAsset(freshSourceId);
	const freshRecord = requiredRecord(store, freshSourceId);
	await store.close();

	assert.equal(settledBeforeRelease, false, 'clear must wait for the admitted digest to terminate');
	assertRejectedWith(lateLoad[0], /maintenance/iu, 'clear must fence new digest admission synchronously');
	assertAbortResult(loadResult);
	assert.equal(clearResult.status, 'fulfilled');
	assert.equal(inventorySizeAfterClear, 0);
	assert.ok(freshLoad, 'clear must reopen digest admission after maintenance');
	assert.equal(freshRecord.mediaContentDigestVersion, MEDIA_CONTENT_DIGEST_VERIFIED_VERSION);
});

test('close joins an active clear before terminal cleanup', async (context) => {
	const sourceId = 'legacy-digest-clear-close';
	const bytes = new Uint8Array(MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 19).fill(0x47);
	const store = memoryStore('clear-close');
	store.memory.mediaAssets.set(sourceId, legacyRecord(sourceId, new Blob([bytes], { type: 'video/mp4' })));
	const stall = stallSecondDigestChunk(context, bytes.byteLength);

	const loading = store.loadMediaAsset(sourceId);
	await requireSecondChunk(stall.started, loading);
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
		'close must not overtake an active clear while its admitted digest is draining',
	);
	assertAbortResult(loadResult);
	assert.equal(clearResult.status, 'fulfilled', 'an admitted clear must finish during close');
	assert.equal(closeResult.status, 'fulfilled');
	assert.deepEqual(settlementOrder, ['clear', 'close'], 'close must settle after the active clear');
	assert.equal(store.memory.mediaAssets.size, 0, 'the admitted clear must empty retained media');
	assert.equal(
		store.memory.mediaAssets.has(sourceId),
		false,
		'the interrupted digest must not republish verified provenance after clear',
	);
});

test('close aborts and drains an admitted multi-chunk legacy digest without late verification', async (context) => {
	const sourceId = 'legacy-digest-close';
	const bytes = new Uint8Array(MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 23).fill(0x53);
	const store = memoryStore('close');
	store.memory.mediaAssets.set(sourceId, legacyRecord(sourceId, new Blob([bytes], { type: 'video/mp4' })));
	const stall = stallSecondDigestChunk(context, bytes.byteLength);

	const loading = store.loadMediaAsset(sourceId);
	await requireSecondChunk(stall.started, loading);
	const closing = store.close();
	const settledBeforeRelease = await settlesByNextTurn(closing);
	const lateLoad = await Promise.allSettled([store.loadMediaAsset(sourceId)]);
	stall.release();
	const [loadResult, closeResult] = await Promise.allSettled([loading, closing]);
	const retained = requiredRecord(store, sourceId);

	const freshSourceId = 'legacy-digest-after-close';
	store.memory.mediaAssets.set(
		freshSourceId,
		legacyRecord(freshSourceId, new Blob([Uint8Array.of(1)], { type: 'video/mp4' })),
	);
	const freshResult = await Promise.allSettled([store.loadMediaAsset(freshSourceId)]);

	assert.equal(settledBeforeRelease, false, 'close must wait for the admitted digest to terminate');
	assertRejectedWith(lateLoad[0], /closed/iu, 'close must fence new digest admission synchronously');
	assertAbortResult(loadResult);
	assert.equal(closeResult.status, 'fulfilled');
	assert.notEqual(
		retained.mediaContentDigestVersion,
		MEDIA_CONTENT_DIGEST_VERIFIED_VERSION,
		'a digest captured before close must not publish verified provenance afterward',
	);
	assert.equal(freshResult[0]?.status, 'rejected');
	assert.match(String(freshResult[0]?.reason), /closed/iu);
});

test('concurrent close callers join the same terminal media drain', async (context) => {
	const sourceId = 'legacy-digest-concurrent-close';
	const bytes = new Uint8Array(MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 29).fill(0x59);
	const store = memoryStore('concurrent-close');
	store.memory.mediaAssets.set(sourceId, legacyRecord(sourceId, new Blob([bytes], { type: 'video/mp4' })));
	const stall = stallSecondDigestChunk(context, bytes.byteLength);

	const loading = store.loadMediaAsset(sourceId);
	await requireSecondChunk(stall.started, loading);
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
	assert.equal(firstSettledBeforeRelease, false, 'the first close must wait for the admitted digest');
	assert.equal(
		secondSettledBeforeRelease,
		false,
		'a concurrent close caller must join terminal cleanup instead of resolving early',
	);
	assertAbortResult(loadResult);
	assert.equal(firstCloseResult.status, 'fulfilled');
	assert.equal(secondCloseResult.status, 'fulfilled');
	assert.notEqual(
		retained.mediaContentDigestVersion,
		MEDIA_CONTENT_DIGEST_VERIFIED_VERSION,
		'the interrupted digest must not publish verified provenance after either close settles',
	);
});

function memoryStore(suffix: string) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `media-digest-lifecycle-${suffix}-${Date.now()}-${Math.random()}`,
	});
}

function legacyRecord(sourceId: string, blob: Blob): Record<string, unknown> {
	return {
		sourceId,
		storage: 'indexeddb-blob',
		blob,
		size: blob.size,
		mimeType: blob.type,
		name: `${sourceId}.mp4`,
		sha256: '0'.repeat(64),
	};
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

async function requireSecondChunk(started: Promise<void>, loading: Promise<unknown>): Promise<void> {
	await Promise.race([
		started,
		loading.then(
			() => { throw new Error('Legacy digest completed without reaching its second chunk.'); },
			(error: unknown) => { throw error; },
		),
	]);
}

interface DigestChunkStall {
	readonly started: Promise<void>;
	release(): void;
}

function stallSecondDigestChunk(context: TestContext, expectedSize: number): DigestChunkStall {
	const descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'slice');
	const originalSlice = descriptor?.value as unknown;
	const originalArrayBuffer = Blob.prototype.arrayBuffer;
	if (!descriptor || typeof originalSlice !== 'function') {
		throw new Error('Blob.prototype.slice is unavailable for the digest lifecycle fixture.');
	}
	const started = deferred();
	const released = deferred();
	let intercepted = false;
	const patchedSlice = function patchedSlice(
		this: Blob,
		start?: number,
		end?: number,
		contentType?: string,
	): Blob {
		const part = Reflect.apply(originalSlice, this, [start, end, contentType]) as Blob;
		if (!intercepted
			&& this.size === expectedSize
			&& start === MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
			intercepted = true;
			started.resolve();
			return {
				async arrayBuffer(): Promise<ArrayBuffer> {
					await released.promise;
					return Reflect.apply(originalArrayBuffer, part, []) as Promise<ArrayBuffer>;
				},
			} as Blob;
		}
		return part;
	};
	Object.defineProperty(Blob.prototype, 'slice', { ...descriptor, value: patchedSlice });
	context.after(() => {
		released.resolve();
		Object.defineProperty(Blob.prototype, 'slice', descriptor);
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
