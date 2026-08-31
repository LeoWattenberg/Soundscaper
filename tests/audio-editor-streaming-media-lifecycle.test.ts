/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	MEDIA_ASSET_STAGING_STATE_KEY,
	MEDIA_ASSET_STAGING_STORE_NAME,
} from '../src/common/editor/storage/media-asset-staging-schema.ts';
import { MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../src/common/editor/storage/media-asset-write-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('temporary cleanup preserves a suspended chunk writer until it aborts', async () => {
	const store = memoryStore('stream-lifecycle-cleanup-chunks');
	const bytes = new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + 1).fill(0x34);
	const writer = await store.beginMediaAssetWrite('active-chunks', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes.subarray(0, MEDIA_ASSET_STREAM_CHUNK_BYTES));
	for (const [key, value] of store.memory.mediaAssetChunks) {
		store.memory.mediaAssetChunks.set(key, { ...(value as Record<string, unknown>), createdAt: 0 });
	}

	await store.cleanupTemporaryAssets({ maximumAgeMs: 0 });
	assert.equal(store.memory.mediaAssetChunks.size, 1);
	await writer.write(bytes.subarray(MEDIA_ASSET_STREAM_CHUNK_BYTES));
	await writer.commit();
	assert.deepEqual(
		new Uint8Array(await (await requiredMedia(store, 'active-chunks')).arrayBuffer()),
		bytes,
	);
});

test('temporary cleanup removes malformed chunk rows that cannot belong to a valid asset', async () => {
	const store = memoryStore('stream-lifecycle-malformed-orphans');
	store.memory.mediaAssetChunks.set('malformed', {
		key: 'malformed',
		payload: new Blob([Uint8Array.of(1)]),
		createdAt: Number.NaN,
	});

	await store.cleanupTemporaryAssets({ maximumAgeMs: 0 });
	assert.equal(store.memory.mediaAssetChunks.size, 0);
});

test('temporary cleanup preserves an active OPFS staging path', async () => {
	const opfs = fakeOpfs();
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		databaseName: uniqueDatabaseName('stream-lifecycle-cleanup-opfs'),
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	const writer = await store.beginMediaAssetWrite('active-opfs', {}, {
		expectedBytes: 1,
		expectedSha256: digest(Uint8Array.of(1)),
	});
	assert.equal(opfs.files.size, 1);

	await store.cleanupTemporaryAssets({ maximumAgeMs: 0 });
	assert.equal(opfs.files.size, 1);
	await writer.abort();
	assert.equal(opfs.files.size, 0);
});

test('clear aborts staged media, leaves no inventory, and reopens writer admission', async () => {
	const store = memoryStore('stream-lifecycle-clear');
	const bytes = new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + 1).fill(0x51);
	const writer = await store.beginMediaAssetWrite('cleared-active', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes.subarray(0, MEDIA_ASSET_STREAM_CHUNK_BYTES));
	await store.clear();

	assert.equal(store.memory.mediaAssetChunks.size, 0);
	assert.equal(store.memory.mediaAssets.size, 0);
	assert.deepEqual([...store.memory.mediaAssetStaging.keys()], [MEDIA_ASSET_STAGING_STATE_KEY]);
	await assert.rejects(writer.commit(), /writer is closed/iu);

	const replacement = Uint8Array.of(8);
	const next = await store.beginMediaAssetWrite('after-clear', {}, {
		expectedBytes: replacement.byteLength,
		expectedSha256: digest(replacement),
	});
	await next.write(replacement);
	await next.commit();
	assert.ok(await store.getMediaAssetMetadata('after-clear'));
});

test('close aborts staged media before closing the backing store', async () => {
	const store = memoryStore('stream-lifecycle-close');
	const bytes = new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + 1).fill(0x61);
	const writer = await store.beginMediaAssetWrite('closed-active', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes.subarray(0, MEDIA_ASSET_STREAM_CHUNK_BYTES));
	await store.close();

	assert.equal(store.memory.mediaAssetChunks.size, 0);
	assert.equal(store.memory.mediaAssets.size, 0);
	await assert.rejects(writer.commit(), /writer is closed/iu);
});

test('close rejects new storage work while an active writer is still aborting', async () => {
	const opfs = fakeOpfs({ stallAborts: true });
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		databaseName: uniqueDatabaseName('stream-lifecycle-close-admission'),
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	await store.beginMediaAssetWrite('closing-active', {}, {
		expectedBytes: 1,
		expectedSha256: digest(Uint8Array.of(1)),
	});

	const closing = store.close();
	await opfs.abortStarted;
	await assert.rejects(store.saveSetting('late-write', true), /closed/iu);
	assert.equal(store.memory.settings.has('late-write'), false);
	opfs.releaseAbort();
	await closing;
});

test('clear preempts a stalled OPFS write instead of waiting for storage I/O', async () => {
	const opfs = fakeOpfs({ stallWrites: true });
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		databaseName: uniqueDatabaseName('stream-lifecycle-stalled-write'),
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	const writer = await store.beginMediaAssetWrite('stalled-write', {}, {
		expectedBytes: 1,
		expectedSha256: digest(Uint8Array.of(1)),
	});
	const writing = writer.write(Uint8Array.of(1));
	void writing.catch(() => undefined);
	await opfs.writeStarted;
	const clearing = store.clear();
	await opfs.abortStarted;
	await Promise.allSettled([writing, clearing]);

	assert.equal(opfs.files.size, 0);
	assert.equal(store.memory.mediaAssets.size, 0);
});

test('clear reports failed cleanup for a streamed writer cancelled before begin returns', async () => {
	const opfs = transientlyFailingPreReturnOpfs();
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		databaseName: uniqueDatabaseName('stream-lifecycle-pre-return-cleanup-failure'),
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	const beginning = store.beginMediaAssetWrite('pre-return-cleanup-failure', {}, {
		expectedBytes: 1,
		expectedSha256: digest(Uint8Array.of(1)),
	});
	await opfs.writerOpenStarted;

	const clearing = store.clear();
	const results = Promise.allSettled([beginning, clearing]);
	opfs.releaseWriterOpen();
	const [beginResult, clearResult] = await results;

	try {
		assert.equal(beginResult?.status, 'rejected', 'the interrupted writer begin must reject');
		if (beginResult?.status === 'rejected') {
			assert.equal(nestedErrorContains(beginResult.reason, opfs.removeError), true);
		}
		assert.equal(
			clearResult?.status,
			'rejected',
			'clear must surface failed pre-return staging cleanup instead of claiming quiescence',
		);
		if (clearResult?.status === 'rejected') {
			assert.equal(nestedErrorContains(clearResult.reason, opfs.removeError), true);
		}
		assert.equal(opfs.files.size, 1, 'the failed removal fixture must retain the staged path');
		assert.equal(opfs.removeCalls, 1, 'the writer rollback must make the failed removal attempt');
	} finally {
		if (beginResult?.status === 'fulfilled') await beginResult.value.abort();
		await store.close().catch(() => undefined);
	}
});

test('clear reports failed lease release during clean OPFS fallback', async () => {
	const databaseName = uniqueDatabaseName('stream-lifecycle-fallback-release-failure');
	const indexedDB = createInstrumentedIndexedDB();
	const opfs = cleanlyFallingBackOpfs();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	const beginning = store.beginMediaAssetWrite('fallback-release-failure', {}, {
		expectedBytes: 1,
		expectedSha256: digest(Uint8Array.of(1)),
	});
	void beginning.catch(() => undefined);
	await opfs.writerOpenStarted;

	const releaseError = new Error('Planned fallback lease release failure.');
	indexedDB.failNextDeleteForStore(MEDIA_ASSET_STAGING_STORE_NAME, releaseError);
	let clearing: Promise<void> | null = null;
	let markClearStarted: (() => void) | undefined;
	const clearStarted = new Promise<void>((resolve) => { markClearStarted = resolve; });
	indexedDB.onNextGetForStore(MEDIA_ASSET_STAGING_STORE_NAME, () => {
		clearing = store.clear();
		markClearStarted?.();
	});
	opfs.releaseWriterOpen();
	await clearStarted;
	assert.ok(clearing);
	const [beginResult, clearResult] = await Promise.allSettled([beginning, clearing]);

	assert.equal(beginResult?.status, 'rejected');
	if (beginResult?.status === 'rejected') {
		assert.equal(nestedErrorContains(beginResult.reason, releaseError), true);
	}
	assert.equal(clearResult?.status, 'rejected', 'maintenance must surface failed fallback lease cleanup');
	if (clearResult?.status === 'rejected') {
		assert.equal(nestedErrorContains(clearResult.reason, releaseError), true);
	}
	assert.equal(
		indexedDB.recordCount(databaseName, MEDIA_ASSET_STAGING_STORE_NAME) > 1,
		true,
		'the failed release must leave its durable lease visible',
	);

	await store.clear();
	assert.equal(indexedDB.recordCount(databaseName, MEDIA_ASSET_STAGING_STORE_NAME), 1);
	await store.close();
});

for (const operation of ['delete', 'prune'] as const) {
	test(`${operation} cannot cross-delete chunks through a corrupted media token`, async () => {
		const store = memoryStore(`stream-lifecycle-token-${operation}`);
		const bytes = Uint8Array.of(2, 4, 6);
		const writer = await store.beginMediaAssetWrite('token-owner', {}, {
			expectedBytes: bytes.byteLength,
			expectedSha256: digest(bytes),
		});
		await writer.write(bytes);
		await writer.commit();
		const owner = structuredClone(store.memory.mediaAssets.get('token-owner')) as Record<string, unknown>;
		store.memory.mediaAssets.set('token-attacker', {
			...owner,
			sourceId: 'token-attacker',
			committedAt: new Date(0).toISOString(),
			pendingProjectUntil: undefined,
		});

		if (operation === 'delete') await store.deleteMediaAsset('token-attacker');
		else await store.pruneUnreferencedSources({
			protectedSourceIds: ['token-owner'],
			minimumAgeMs: 0,
			now: Date.now() + 1,
		});

		assert.deepEqual(
			new Uint8Array(await (await requiredMedia(store, 'token-owner')).arrayBuffer()),
			bytes,
		);
		assert.equal(store.memory.mediaAssetChunks.size, 1);
	});
}

test('delete cannot cross-delete an OPFS file through a corrupted media path', async () => {
	const opfs = fakeOpfs();
	const store = createProjectStore({
		indexedDB: null,
		databaseName: uniqueDatabaseName('stream-lifecycle-path-delete'),
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	const bytes = Uint8Array.of(3, 5, 7);
	await store.writeMediaAsset('path-owner', new Blob([bytes]));
	const owner = structuredClone(store.memory.mediaAssets.get('path-owner')) as Record<string, unknown>;
	store.memory.mediaAssets.set('path-attacker', { ...owner, sourceId: 'path-attacker' });

	await store.deleteMediaAsset('path-attacker');
	assert.deepEqual(
		new Uint8Array(await (await requiredMedia(store, 'path-owner')).arrayBuffer()),
		bytes,
	);
	assert.equal(opfs.files.size, 1);
});

test('delete cannot cross-delete an active OPFS staging path through corrupted metadata', async () => {
	const opfs = fakeOpfs();
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('stream-lifecycle-active-path-delete');
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	const bytes = Uint8Array.of(9, 7, 5);
	const writer = await store.beginMediaAssetWrite('active-path-owner', {}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	const [activePath] = opfs.files.keys();
	indexedDB.seedRecord(databaseName, 'mediaAssets', {
		sourceId: 'active-path-attacker',
		storage: 'opfs',
		path: activePath,
	});

	await store.deleteMediaAsset('active-path-attacker');
	assert.equal(opfs.files.size, 1);
	await writer.write(bytes);
	await writer.commit();
	assert.deepEqual(new Uint8Array(await (await requiredMedia(store, 'active-path-owner')).arrayBuffer()), bytes);
});

test('delete cannot cross-delete a derivative OPFS path through corrupted media metadata', async () => {
	const opfs = fakeOpfs();
	const store = createProjectStore({
		indexedDB: null,
		databaseName: uniqueDatabaseName('stream-lifecycle-derivative-path-delete'),
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	const bytes = Uint8Array.of(8, 6, 4);
	await store.writeMediaAsset('derivative-owner', new Blob(['trusted original']));
	await store.saveVideoDerivative('derivative-owner', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob([bytes]),
	} as never);
	const [derivative] = store.memory.videoDerivatives.values() as MapIterator<Record<string, unknown>>;
	store.memory.mediaAssets.set('derivative-path-attacker', {
		sourceId: 'derivative-path-attacker',
		storage: 'opfs',
		path: derivative?.path,
	});

	await store.deleteMediaAsset('derivative-path-attacker');
	const loaded = await store.loadVideoDerivative('derivative-owner', { timestamp: 0, type: 'poster' } as never);
	assert.ok(loaded);
	assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
});

function memoryStore(prefix: string) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName(prefix),
	});
}

async function requiredMedia(
	store: ReturnType<typeof createProjectStore>,
	sourceId: string,
): Promise<Blob> {
	const value = await store.loadMediaAsset(sourceId);
	assert.ok(value);
	return value as Blob;
}

function digest(bytes: Uint8Array): string {
	return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fakeOpfs({ stallAborts = false, stallWrites = false } = {}) {
	const files = new Map<string, { blob: Blob; lastModified: number }>();
	let markAbortStarted: (() => void) | undefined;
	let releaseAbort: (() => void) | undefined;
	let markWriteStarted: (() => void) | undefined;
	let releaseWrite: (() => void) | undefined;
	const abortStarted = new Promise<void>((resolve) => { markAbortStarted = resolve; });
	const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, { blob: new Blob(), lastModified: 0 });
			return fileHandle(path);
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
		async *entries() {
			for (const path of files.keys()) yield [path, fileHandle(path)];
		},
	};
	const fileHandle = (path: string) => ({
		kind: 'file',
		async createWritable() {
			const parts: BlobPart[] = [];
			return {
				async write(part: BlobPart) {
					if (stallWrites) {
						markWriteStarted?.();
						await new Promise<void>((resolve) => { releaseWrite = resolve; });
					}
					parts.push(part);
				},
				async close() { files.set(path, { blob: new Blob(parts), lastModified: Date.now() }); },
				async abort() {
					markAbortStarted?.();
					releaseWrite?.();
					if (stallAborts) {
						await new Promise<void>((resolve) => { releaseAbort = resolve; });
					}
				},
			};
		},
		async getFile() {
			const entry = files.get(path);
			if (!entry) throw new DOMException('missing', 'NotFoundError');
			Object.defineProperty(entry.blob, 'lastModified', { configurable: true, value: entry.lastModified });
			return entry.blob;
		},
	});
	return {
		directory: directory as unknown as FileSystemDirectoryHandle,
		files,
		abortStarted,
		writeStarted,
		releaseAbort: () => { releaseAbort?.(); },
	};
}

function nestedErrorContains(error: unknown, expected: unknown): boolean {
	if (error === expected) return true;
	return error instanceof AggregateError
		&& error.errors.some((entry) => nestedErrorContains(entry, expected));
}

function transientlyFailingPreReturnOpfs() {
	const files = new Map<string, Blob>();
	const removeError = new Error('Transient staged path removal failure.');
	let markWriterOpenStarted: (() => void) | undefined;
	let releaseWriterOpen: (() => void) | undefined;
	const writerOpenStarted = new Promise<void>((resolve) => { markWriterOpenStarted = resolve; });
	const writerOpenRelease = new Promise<void>((resolve) => { releaseWriterOpen = resolve; });
	let removeCalls = 0;
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable() {
					markWriterOpenStarted?.();
					await writerOpenRelease;
					return {
						async write() { /* The regression cancels before the first write. */ },
						async close() { /* The regression cancels before close. */ },
						async abort() { /* Path removal is owned by the OPFS repository. */ },
					};
				},
				async getFile() {
					const file = files.get(path);
					if (!file) throw new DOMException('missing', 'NotFoundError');
					return file;
				},
			};
		},
		async removeEntry(path: string) {
			removeCalls += 1;
			if (removeCalls === 1) throw removeError;
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
		async *entries() {
			for (const path of files.keys()) yield [path, await directory.getFileHandle(path)];
		},
	};
	return {
		directory: directory as unknown as FileSystemDirectoryHandle,
		files,
		removeError,
		writerOpenStarted,
		releaseWriterOpen: () => { releaseWriterOpen?.(); },
		get removeCalls() { return removeCalls; },
	};
}

function cleanlyFallingBackOpfs() {
	const files = new Map<string, Blob>();
	let markWriterOpenStarted: (() => void) | undefined;
	let releaseWriterOpen: (() => void) | undefined;
	const writerOpenStarted = new Promise<void>((resolve) => { markWriterOpenStarted = resolve; });
	const writerOpenRelease = new Promise<void>((resolve) => { releaseWriterOpen = resolve; });
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable(): Promise<never> {
					markWriterOpenStarted?.();
					await writerOpenRelease;
					throw new Error('OPFS writer creation fell back cleanly.');
				},
				async getFile() {
					const file = files.get(path);
					if (!file) throw new DOMException('missing', 'NotFoundError');
					return file;
				},
			};
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
		async *entries() {
			for (const path of files.keys()) yield [path, await directory.getFileHandle(path)];
		},
	};
	return {
		directory: directory as unknown as FileSystemDirectoryHandle,
		writerOpenStarted,
		releaseWriterOpen: () => { releaseWriterOpen?.(); },
	};
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
