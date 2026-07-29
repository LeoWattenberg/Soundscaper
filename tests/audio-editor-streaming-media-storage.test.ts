/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES,
	MEDIA_ASSET_STREAM_CHUNK_BYTES,
} from '../src/common/editor/storage/media-asset-write-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('streaming media storage publishes documented non-raiseable byte boundaries', async () => {
	assert.equal(MEDIA_ASSET_STREAM_CHUNK_BYTES, 4 * 1024 * 1024);
	assert.equal(MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES, 64 * 1024 * 1024);
	const store = memoryStore('stream-media-memory-admission');
	const exact = await store.beginMediaAssetWrite('exact-memory-bound', {}, {
		expectedBytes: MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES,
		expectedSha256: '0'.repeat(64),
	});
	await exact.abort();
	await assert.rejects(
		store.beginMediaAssetWrite('over-memory-bound', {}, {
			expectedBytes: MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES + 1,
			expectedSha256: '0'.repeat(64),
		}),
		/64 MiB process-memory media limit/iu,
	);
	assert.equal(store.memory.mediaAssetChunks.size, 0);
	assert.equal(store.memory.mediaAssets.size, 0);
});

test('degraded memory streaming never creates uncoordinated OPFS staging', async () => {
	const files = new Map<string, Blob>();
	const store = createProjectStore({
		indexedDB: null,
		databaseName: uniqueDatabaseName('stream-media-degraded-opfs'),
		preferOpfs: true,
		opfsRoot: createOpfsDirectory(files),
	});
	const bytes = Uint8Array.of(6, 7, 8);
	const writer = await store.beginMediaAssetWrite('degraded-media', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});

	assert.equal(files.size, 0);
	await writer.write(bytes);
	await writer.commit();
	assert.equal(files.size, 0);
	assert.equal(store.memory.mediaAssetChunks.size, 1);
});

for (const backend of ['memory', 'indexeddb', 'opfs'] as const) {
	test(`${backend} streaming media writes coalesce tiny emissions and load exact bytes`, async () => {
		const files = new Map<string, Blob>();
		const indexedDB = backend === 'memory' ? null : createInstrumentedIndexedDB();
		const databaseName = uniqueDatabaseName(`stream-media-${backend}`);
		const store = createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: backend === 'opfs',
			databaseName,
			opfsRoot: backend === 'opfs' ? createOpfsDirectory(files) : null,
		});
		const bytes = Uint8Array.of(1, 2, 3, 4, 5);
		const writer = await store.beginMediaAssetWrite('streamed-video', {
			name: 'streamed.mp4',
			mimeType: 'video/mp4',
			sha256: 'caller-value-is-reserved',
			sourceToken: 'caller-pcm-token-is-reserved',
			mediaChunkToken: 'caller-token-is-reserved',
		}, {
			expectedBytes: bytes.byteLength,
			expectedSha256: digest(bytes),
		});
		for (const byte of bytes) await writer.write(Uint8Array.of(byte));
		const metadata = await writer.commit();

		assert.equal(metadata.sha256, digest(bytes));
		assert.equal(metadata.size, bytes.byteLength);
		assert.equal(metadata.mimeType, 'video/mp4');
		assert.equal('mediaChunkToken' in metadata, false);
		assert.equal('sourceToken' in metadata, false);
		assert.equal('mediaChunkBytes' in metadata, false);
		assert.equal('mediaChunkCount' in metadata, false);
		const loaded = await store.loadMediaAsset('streamed-video');
		assert.ok(loaded);
		assert.deepEqual(
			new Uint8Array(await loaded.arrayBuffer()),
			bytes,
		);
		const internal = store.memory.mediaAssets.get('streamed-video') as Record<string, unknown> | undefined;
		if (backend === 'memory') {
			assert.equal(typeof internal?.mediaChunkToken, 'string');
			assert.equal('sourceToken' in (internal || {}), false);
			assert.equal(store.memory.mediaAssetChunks.size, 1);
		} else if (backend === 'indexeddb') {
			assert.equal(indexedDB?.recordCount(databaseName, 'mediaAssetChunks'), 1);
		} else {
			assert.equal(store.memory.mediaAssetChunks.size, 0);
			assert.equal(files.size, 1);
		}

		await store.deleteMediaAsset('streamed-video');
		assert.equal(await store.loadMediaAsset('streamed-video'), null);
		assert.equal(store.memory.mediaAssetChunks.size, 0);
		if (indexedDB) assert.equal(indexedDB.recordCount(databaseName, 'mediaAssetChunks'), 0);
		assert.equal(files.size, 0);
	});
}

test('streaming media accepts an exact 4 MiB emission and rejects an over-bound emission', async () => {
	const store = memoryStore('stream-media-emission-bound');
	const exactBytes = new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES);
	const exact = await store.beginMediaAssetWrite('exact-emission', {}, {
		expectedBytes: exactBytes.byteLength,
		expectedSha256: digest(exactBytes),
	});
	await exact.write(exactBytes);
	await exact.commit();

	const overBytes = new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + 1);
	const over = await store.beginMediaAssetWrite('over-emission', {}, {
		expectedBytes: overBytes.byteLength,
		expectedSha256: digest(overBytes),
	});
	await assert.rejects(over.write(overBytes), /4 MiB media chunk limit/iu);
	await over.abort();
	assert.equal(await store.getMediaAssetMetadata('over-emission'), null);
	assert.equal(store.memory.mediaAssetChunks.size, 1, 'only the committed exact-bound asset remains');
});

test('streaming media digest failure and cancellation remove staged chunks before publication', async () => {
	const store = memoryStore('stream-media-rollback');
	const bytes = new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES).fill(0x7f);
	const mismatched = await store.beginMediaAssetWrite('mismatched-media', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: '0'.repeat(64),
	});
	await mismatched.write(bytes);
	await assert.rejects(mismatched.commit(), /SHA-256/iu);
	assert.equal(await store.getMediaAssetMetadata('mismatched-media'), null);
	assert.equal(store.memory.mediaAssetChunks.size, 0);

	const controller = new AbortController();
	const reason = new DOMException('cancel staged stream', 'AbortError');
	const cancelled = await store.beginMediaAssetWrite('cancelled-media', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
		signal: controller.signal,
	});
	await cancelled.write(bytes);
	controller.abort(reason);
	await assert.rejects(cancelled.commit(), (error) => error === reason);
	assert.equal(await store.getMediaAssetMetadata('cancelled-media'), null);
	assert.equal(store.memory.mediaAssetChunks.size, 0);
});

test('streaming media snapshots mutable emissions and supports the exact zero-byte asset', async () => {
	const store = memoryStore('stream-media-snapshots');
	const original = Uint8Array.of(1, 2, 3);
	const mutableBuffer = typeof SharedArrayBuffer === 'function'
		? new SharedArrayBuffer(original.byteLength)
		: new ArrayBuffer(original.byteLength);
	const mutable = new Uint8Array(mutableBuffer);
	mutable.set(original);
	const writer = await store.beginMediaAssetWrite('snapshotted-media', {}, {
		expectedBytes: original.byteLength,
		expectedSha256: digest(original),
	});
	const write = writer.write(mutable);
	mutable.fill(0xff);
	await write;
	await writer.commit();
	const loaded = await store.loadMediaAsset('snapshotted-media');
	assert.ok(loaded);
	assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), original);

	const empty = new Uint8Array();
	const emptyWriter = await store.beginMediaAssetWrite('empty-media', {}, {
		expectedBytes: 0,
		expectedSha256: digest(empty),
	});
	await emptyWriter.write(empty);
	const emptyMetadata = await emptyWriter.commit();
	assert.equal(emptyMetadata.size, 0);
	assert.equal(store.memory.mediaAssetChunks.size, 1, 'zero-byte media creates no fallback row');
	assert.equal((await store.loadMediaAsset('empty-media'))?.size, 0);
});

test('streaming media rejects short and over-expected writes without inventory changes', async () => {
	const store = memoryStore('stream-media-exact-size');
	const short = await store.beginMediaAssetWrite('short-media', {}, {
		expectedBytes: 2,
		expectedSha256: digest(Uint8Array.of(1, 2)),
	});
	await short.write(Uint8Array.of(1));
	await assert.rejects(short.commit(), /declared asset size/iu);

	const over = await store.beginMediaAssetWrite('over-media', {}, {
		expectedBytes: 1,
		expectedSha256: digest(Uint8Array.of(1)),
	});
	await assert.rejects(over.write(Uint8Array.of(1, 2)), /declared asset size/iu);
	const firstAbort = over.abort();
	const secondAbort = over.abort();
	assert.equal(secondAbort, firstAbort);
	await firstAbort;
	assert.equal(store.memory.mediaAssetChunks.size, 0);
	assert.equal(store.memory.mediaAssets.size, 0);
});

test('a single commit promise serializes commit/abort races and leaves the writer terminal', async () => {
	const store = memoryStore('stream-media-terminal-race');
	const bytes = Uint8Array.of(4, 5, 6);
	const writer = await store.beginMediaAssetWrite('terminal-media', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	const firstCommit = writer.commit();
	const secondCommit = writer.commit();
	assert.equal(secondCommit, firstCommit);
	const abort = writer.abort();
	const [metadata] = await Promise.all([firstCommit, abort]);
	assert.equal(metadata.sha256, digest(bytes));
	assert.throws(() => writer.write(Uint8Array.of()), /writer is closed/iu);
	await assert.rejects(writer.commit(), /writer is closed/iu);
	await writer.abort();
	assert.ok(await store.getMediaAssetMetadata('terminal-media'));
});

test('publication failure before memory insertion rejects and removes its staged payload', async () => {
	const store = memoryStore('stream-media-fail-before-publish');
	const bytes = Uint8Array.of(1, 3, 5);
	const writer = await store.beginMediaAssetWrite('failed-publication', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	const planned = new Error('fail before insert');
	const assets = store.memory.mediaAssets;
	const originalSet = assets.set;
	assets.set = (() => { throw planned; }) as typeof assets.set;
	try {
		await assert.rejects(writer.commit(), (error) => error === planned);
	} finally {
		assets.set = originalSet;
	}
	assert.equal(await store.getMediaAssetMetadata('failed-publication'), null);
	assert.equal(store.memory.mediaAssetChunks.size, 0);
});

test('publication reconciles an after-insert exception as committed before abort can delete payload', async () => {
	const store = memoryStore('stream-media-after-insert');
	const bytes = Uint8Array.of(2, 4, 6);
	const writer = await store.beginMediaAssetWrite('reconciled-publication', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	const assets = store.memory.mediaAssets;
	const originalSet = assets.set;
	assets.set = ((key: string, value: unknown) => {
		originalSet.call(assets, key, value);
		throw new Error('throw after insert');
	}) as typeof assets.set;
	let metadata: Readonly<Record<string, unknown>>;
	try {
		metadata = await writer.commit();
	} finally {
		assets.set = originalSet;
	}
	await writer.abort();
	assert.equal(metadata.sha256, digest(bytes));
	assert.equal(store.memory.mediaAssetChunks.size, 1);
	assert.deepEqual(
		new Uint8Array(await (await store.loadMediaAsset('reconciled-publication'))?.arrayBuffer() as ArrayBuffer),
		bytes,
	);
});

test('indeterminate reconciliation preserves staged payload and surfaces both failures', async () => {
	const store = memoryStore('stream-media-reconcile-failure');
	const bytes = Uint8Array.of(7, 8, 9);
	const writer = await store.beginMediaAssetWrite('indeterminate-publication', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	const assets = store.memory.mediaAssets;
	const originalSet = assets.set;
	const originalGet = assets.get;
	const publicationError = new Error('throw after indeterminate insert');
	const reconciliationError = new Error('reconciliation unavailable');
	assets.set = ((key: string, value: unknown) => {
		originalSet.call(assets, key, value);
		throw publicationError;
	}) as typeof assets.set;
	assets.get = (() => { throw reconciliationError; }) as typeof assets.get;
	try {
		await assert.rejects(writer.commit(), (error: unknown) => (
			error instanceof AggregateError
			&& error.errors[0] === publicationError
			&& error.errors[1] === reconciliationError
		));
		await writer.abort();
	} finally {
		assets.set = originalSet;
		assets.get = originalGet;
	}
	assert.ok(await store.getMediaAssetMetadata('indeterminate-publication'));
	assert.equal(store.memory.mediaAssetChunks.size, 1);
});

test('a concurrent publication winner is preserved while the losing staged payload is removed', async () => {
	const store = memoryStore('stream-media-concurrent-winner');
	const bytes = Uint8Array.of(0xaa);
	const writer = await store.beginMediaAssetWrite('publication-winner', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	const assets = store.memory.mediaAssets;
	const originalSet = assets.set;
	const planned = new Error('lost publication race');
	assets.set = ((key: string) => {
		originalSet.call(assets, key, {
			sourceId: key,
			storage: 'indexeddb-blob',
			blob: new Blob(['winner']),
			size: 6,
			mimeType: 'video/mp4',
		});
		throw planned;
	}) as typeof assets.set;
	try {
		await assert.rejects(writer.commit(), (error) => error === planned);
	} finally {
		assets.set = originalSet;
	}
	assert.equal(store.memory.mediaAssetChunks.size, 0);
	const winner = await store.loadMediaAsset('publication-winner');
	assert.ok(winner);
	assert.equal(new TextDecoder().decode(await winner.arrayBuffer()), 'winner');
});

test('publication cancellation stops immediately before mutation but resolves after mutation begins', async () => {
	const beforeStore = memoryStore('stream-media-cancel-before-publish');
	const beforeController = new AbortController();
	const beforeReason = new DOMException('cancel before insert', 'AbortError');
	const beforeWriter = await beforeStore.beginMediaAssetWrite('cancel-before', {}, {
		expectedBytes: 1,
		expectedSha256: digest(Uint8Array.of(1)),
		signal: beforeController.signal,
	});
	await beforeWriter.write(Uint8Array.of(1));
	const beforeAssets = beforeStore.memory.mediaAssets;
	const originalHas = beforeAssets.has;
	beforeAssets.has = ((key: string) => {
		const result = originalHas.call(beforeAssets, key);
		beforeController.abort(beforeReason);
		return result;
	}) as typeof beforeAssets.has;
	try {
		await assert.rejects(beforeWriter.commit(), (error) => error === beforeReason);
	} finally {
		beforeAssets.has = originalHas;
	}
	assert.equal(beforeStore.memory.mediaAssetChunks.size, 0);
	assert.equal(await beforeStore.getMediaAssetMetadata('cancel-before'), null);

	const afterStore = memoryStore('stream-media-cancel-after-publish');
	const afterController = new AbortController();
	const afterWriter = await afterStore.beginMediaAssetWrite('cancel-after', {}, {
		expectedBytes: 1,
		expectedSha256: digest(Uint8Array.of(2)),
		signal: afterController.signal,
	});
	await afterWriter.write(Uint8Array.of(2));
	const afterAssets = afterStore.memory.mediaAssets;
	const originalSet = afterAssets.set;
	afterAssets.set = ((key: string, value: unknown) => {
		const result = originalSet.call(afterAssets, key, value);
		afterController.abort(new DOMException('late cancellation', 'AbortError'));
		return result;
	}) as typeof afterAssets.set;
	try {
		assert.equal((await afterWriter.commit()).sha256, digest(Uint8Array.of(2)));
	} finally {
		afterAssets.set = originalSet;
	}
	assert.ok(await afterStore.getMediaAssetMetadata('cancel-after'));
});

test('OPFS staged-file removal failures are surfaced with the primary write failure', async () => {
	const files = new Map<string, Blob>();
	const removeError = new DOMException('staged file is locked', 'NoModificationAllowedError');
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		databaseName: uniqueDatabaseName('stream-media-opfs-remove-failure'),
		opfsRoot: createOpfsDirectory(files, { removeError }),
	});
	const writer = await store.beginMediaAssetWrite('locked-opfs-stage', {}, {
		expectedBytes: 1,
		expectedSha256: '0'.repeat(64),
	});
	await writer.write(Uint8Array.of(1));
	await assert.rejects(writer.commit(), (error: unknown) => (
		error instanceof AggregateError && nestedAggregateContains(error, removeError)
	));
	assert.equal(await store.getMediaAssetMetadata('locked-opfs-stage'), null);
	assert.equal(files.size, 1, 'failed removal leaves the staged file discoverable for later cleanup');
});

test('retention preserves committed media chunks and prunes their rows with media inventory', async () => {
	const store = memoryStore('stream-media-retention');
	const bytes = Uint8Array.of(9, 8, 7);
	const writer = await store.beginMediaAssetWrite('retained-stream', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	await writer.commit();
	await store.cleanupTemporaryAssets({ maximumAgeMs: 0 });
	assert.equal(store.memory.mediaAssetChunks.size, 1);

	const result = await store.pruneUnreferencedSources({
		minimumAgeMs: 0,
		now: Date.now() + 2 * 24 * 60 * 60 * 1000,
	});
	assert.deepEqual(result.deletedSourceIds, ['retained-stream']);
	assert.equal(store.memory.mediaAssetChunks.size, 0);
	assert.equal(await store.getMediaAssetMetadata('retained-stream'), null);
});

function memoryStore(prefix: string) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName(prefix),
	});
}

function digest(bytes: Uint8Array): string {
	return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createOpfsDirectory(
	files: Map<string, Blob>,
	{ removeError }: Readonly<{ removeError?: unknown }> = {},
): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); },
						async close() { files.set(path, new Blob(parts)); },
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return files.get(path) as Blob; },
			};
		},
		async removeEntry(path: string) {
			if (removeError !== undefined) throw removeError;
			if (!files.delete(path)) throw new Error('missing');
		},
	};
	return directory as unknown as FileSystemDirectoryHandle;
}

function nestedAggregateContains(error: unknown, expected: unknown): boolean {
	if (error === expected) return true;
	return error instanceof AggregateError && error.errors.some((entry) => nestedAggregateContains(entry, expected));
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
