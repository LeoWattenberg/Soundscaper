/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { crc32, PCM_ENCODING_RAW_F32LE } from '../src/common/editor/wavpack/index.js';
import {
	deleteByIndex,
	openDatabase,
	readCursorPage,
	request,
	transactionCompletion,
} from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { PcmMigrationRepository } from '../src/common/editor/storage/pcm-migration-repository.ts';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';

interface RequestHarness<Result> {
	result: Result;
	error: Error | null;
	onsuccess: (() => void) | null;
	onerror: (() => void) | null;
}

function requestHarness<Result>(result: Result, error: Error | null = null): RequestHarness<Result> {
	return { result, error, onsuccess: null, onerror: null };
}

test('IndexedDB promise adapters reject every asynchronous error callback', async () => {
	const failedRequest = requestHarness('', null);
	const requestPromise = request(failedRequest as unknown as IDBRequest<string>);
	failedRequest.onerror?.();
	await assert.rejects(requestPromise, /IndexedDB request failed/u);

	const failedCursor = requestHarness<IDBCursorWithValue | null>(null, null);
	const pagePromise = readCursorPage({
		openCursor: () => failedCursor,
	} as unknown as IDBObjectStore);
	failedCursor.onerror?.();
	await assert.rejects(pagePromise, /enumerate IndexedDB records/u);
	await assert.rejects(readCursorPage({
		openCursor() { throw new Error('cursor construction failed'); },
	} as unknown as IDBObjectStore), /cursor construction failed/u);

	const aborted = {
		error: null,
		oncomplete: null as (() => void) | null,
		onabort: null as (() => void) | null,
		onerror: null as (() => void) | null,
	};
	const abortPromise = transactionCompletion(aborted as unknown as IDBTransaction);
	aborted.onabort?.();
	await assert.rejects(abortPromise, /transaction was aborted/u);
	const errored = {
		error: null,
		oncomplete: null as (() => void) | null,
		onabort: null as (() => void) | null,
		onerror: null as (() => void) | null,
	};
	const transactionPromise = transactionCompletion(errored as unknown as IDBTransaction);
	errored.onerror?.();
	await assert.rejects(transactionPromise, /transaction failed/u);

	const deleteCursor = requestHarness<IDBCursor | null>(null, null);
	const deletePromise = deleteByIndex({
		openCursor: () => deleteCursor,
	} as unknown as IDBIndex, 'source');
	deleteCursor.onerror?.();
	await assert.rejects(deletePromise, /enumerate IndexedDB records/u);
});

test('deleteByIndex deletes and advances every matching value cursor', async () => {
	const cursorRequest = requestHarness<IDBCursorWithValue | null>(null, null);
	const deleted: IDBValidKey[] = [];
	const advanced: IDBValidKey[] = [];
	const cursors = ['first', 'second'].map((primaryKey) => ({
		primaryKey,
		value: { primaryKey },
		delete() { deleted.push(primaryKey); },
		continue() { advanced.push(primaryKey); },
	})) as unknown as IDBCursorWithValue[];
	const deletion = deleteByIndex({
		openCursor(key: IDBValidKey) {
			assert.equal(key, 'source');
			return cursorRequest;
		},
	} as unknown as IDBIndex, 'source');

	for (const cursor of cursors) {
		cursorRequest.result = cursor;
		cursorRequest.onsuccess?.();
	}
	cursorRequest.result = null;
	cursorRequest.onsuccess?.();

	await deletion;
	assert.deepEqual(deleted, ['first', 'second']);
	assert.deepEqual(advanced, ['first', 'second']);
});

test('database opening reports request failures and invokes its default version-change closer', async () => {
	const failed = {
		...requestHarness<IDBDatabase>(null as unknown as IDBDatabase),
		onupgradeneeded: null as (() => void) | null,
		onblocked: null as (() => void) | null,
	};
	const failedOpen = openDatabase({ open: () => failed } as unknown as IDBFactory, 'failed');
	failed.onerror?.();
	await assert.rejects(failedOpen, /open editor storage/u);

	let closed = 0;
	const database = {
		onversionchange: null as (() => void) | null,
		close() { closed += 1; },
	};
	const succeeded = {
		...requestHarness(database as unknown as IDBDatabase),
		onupgradeneeded: null as (() => void) | null,
		onblocked: null as (() => void) | null,
	};
	const opened = openDatabase({ open: () => succeeded } as unknown as IDBFactory, 'opened');
	succeeded.onsuccess?.();
	assert.strictEqual(await opened, database);
	database.onversionchange?.();
	assert.equal(closed, 1);
});

test('OPFS fallbacks cover unavailable, missing, and failed-write paths', async () => {
	const unavailable = new OpfsRepository({ preferOpfs: false });
	await assert.rejects(unavailable.loadBinaryRecord({}, 'missing binary'), /missing binary/u);
	await assert.rejects(
		unavailable.loadBinaryRecord({ storage: 'opfs' }, 'missing OPFS binary'),
		/missing OPFS binary/u,
	);
	await unavailable.deleteBinaryRecords(undefined as unknown as []);
	await unavailable.deletePath(null);

	const throwing = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: {
			getDirectoryHandle() { throw new Error('OPFS denied'); },
		} as unknown as FileSystemDirectoryHandle,
	});
	assert.equal(await throwing.directory(), null);
	assert.equal(await throwing.directory(), null);

	let abortedWrites = 0;
	let removedPaths = 0;
	const directory = {
		async getFileHandle() {
			return {
				async createWritable() {
					return {
						async write(_value: unknown) { throw new Error('disk full'); },
						async close() {},
						async abort() { abortedWrites += 1; },
					};
				},
			};
		},
		async removeEntry() { removedPaths += 1; },
	};
	const failedWriter = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: {
			async getDirectoryHandle() { return directory; },
		} as unknown as FileSystemDirectoryHandle,
	});
	assert.equal(await failedWriter.writeBlob('', new Blob(['audio'])), null);
	assert.equal(abortedWrites, 1);
	assert.equal(removedPaths, 1);
});

test('PCM repository rejects invalid geometry and keeps its circuit breaker deterministic', async () => {
	let encodeCalls = 0;
	const codec = {
		async encode(input: ArrayBuffer) {
			encodeCalls += 1;
			return {
				encoding: PCM_ENCODING_RAW_F32LE,
				payload: input,
				pcmCrc32: 0,
			};
		},
		async decode() { return { payload: new ArrayBuffer(0) }; },
	};
	const pcm = new PcmRepository({ codec });
	await assert.rejects(pcm.encode(new ArrayBuffer(4), {
		frames: 2,
		channelCount: 1,
		sampleRate: 48_000,
		priority: 'foreground',
		allowRawOnFailure: true,
	}), /declared geometry/u);

	const raw = new Float32Array(65_536);
	raw[0] = 0.5;
	const fallback = await pcm.encode(raw.buffer, {
		frames: raw.length,
		channelCount: 1,
		sampleRate: 48_000,
		priority: 'foreground',
		allowRawOnFailure: true,
	});
	assert.equal(fallback.encoding, PCM_ENCODING_RAW_F32LE);
	assert.equal(encodeCalls, 1);
	await assert.rejects(pcm.encode(raw.buffer, {
		frames: raw.length,
		channelCount: 1,
		sampleRate: 48_000,
		priority: 'foreground',
		allowRawOnFailure: false,
	}), /disabled for this session/u);

	await assert.rejects(pcm.decodeRecord({
		frames: 1,
		encoding: PCM_ENCODING_RAW_F32LE,
		payload: new ArrayBuffer(4),
		pcmCrc32: -1,
	}, { channelCount: 1 }), { code: 'PCM_RECORD_GEOMETRY' });
	const single = Float32Array.of(0.25);
	await assert.rejects(pcm.decodeRecord({
		frames: 1,
		encoding: 'unknown',
		payload: single.buffer,
		pcmCrc32: crc32(single.buffer),
	}, { channelCount: 1 }), { code: 'PCM_RECORD_ENCODING' });
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(pcm.decodeRecord({}, {}, controller.signal), { name: 'AbortError' });
	pcm.closeOwnedCodec();
});

test('PCM migration cancellation and failed copy-on-write migration clear pending work', async () => {
	const source = {
		id: 'copy-source',
		storage: 'copy-on-write',
		sourceToken: 'copy-token',
		baseSourceId: 'base',
		channelCount: 1,
		overrideChunkCount: 0,
		pcmEncodingVersion: 0,
	};
	let currentSource = source;
	const migration = new PcmMigrationRepository({
		records: {
			async getMetadata(_sourceId: string) { return currentSource; },
			async *chunks(_token: string) { /* Empty migration fixture. */ },
			async compareAndSwapMetadata() { return true; },
			async replaceChunkIfCurrent() { return true; },
		},
		pcm: {
			async encode() { throw new Error('encode should not run'); },
			async decodeRecord() { throw new Error('decode should not run'); },
			closeOwnedCodec() {},
		},
		opfs: {
			clearCache() {},
		},
		database: async () => null,
		estimateStorage: async () => ({ usage: null, quota: null }),
		isMemoryBackend: () => false,
		migrateOnAccess: true,
	} as unknown as ConstructorParameters<typeof PcmMigrationRepository>[0]);

	migration.queue(source);
	assert.deepEqual(migration.pendingSourceIds(), ['copy-source']);
	await migration.cancel('copy-source');
	assert.deepEqual(migration.pendingSourceIds(), []);

	currentSource = { ...source };
	migration.queue(source);
	for (let attempt = 0; attempt < 20 && migration.pendingSourceIds().length; attempt += 1) {
		await new Promise<void>((resolve) => { setTimeout(resolve, 5); });
	}
	assert.deepEqual(migration.pendingSourceIds(), []);
	migration.queue(source);
	assert.deepEqual(migration.pendingSourceIds(), [], 'a failed source remains suppressed');
	migration.forgetFailures(['copy-source']);
	await migration.stop({ closeCodec: true, clearFailures: false });
});

test('project repository rejects unstable IDs and prunes malformed memory revisions', async () => {
	const memory = getMemoryDatabase(`project-repository-coverage-${Date.now()}-${Math.random()}`);
	const repository = new ProjectRepository({
		memory,
		database: async () => null,
	}, 2);
	await assert.rejects(repository.save({ id: '' }), /stable string id/u);

	await repository.save({ id: 'project', revision: 0, updatedAt: '2026-01-01' });
	await repository.save({ id: 'project', revision: 1, updatedAt: '2026-01-02' });
	await repository.save({ id: 'project', revision: 2, updatedAt: '2026-01-03' });
	assert.deepEqual((await repository.listRevisions('project')).map(({ revision }) => revision), [2, 1]);

	memory.revisions.set('invalid-null', null);
	memory.revisions.set('invalid-key', { key: 4, projectId: 'project', revision: 4, project: {} });
	memory.revisions.set('invalid-revision', { key: 'bad', projectId: 'project', revision: '4', project: {} });
	memory.revisions.set('invalid-project', { key: 'bad-2', projectId: 'project', revision: 4, project: null });
	assert.deepEqual((await repository.listRevisions('project')).map(({ revision }) => revision), [2, 1]);
	assert.equal(await repository.load('missing'), null);
	await repository.delete('project');
	assert.deepEqual(await repository.list(), []);
});
