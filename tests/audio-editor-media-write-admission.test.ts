/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import {
	createStorageRepositories,
	type StorageRepositoryFactory,
} from '../src/common/editor/storage/repositories.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('clear drains a streamed writer registered before its first database await', async () => {
	const database = stallFirstRepositoryDatabaseAdmission();
	const store = createProjectStore({
		indexedDB: null,
		databaseName: uniqueDatabaseName('media-write-first-database-await'),
		preferOpfs: false,
		repositoryFactory: database.repositoryFactory,
	});
	const beginning = store.beginMediaAssetWrite('before-database-clear', {}, writerOptions());
	try {
		await requireDatabaseAdmission(database.started, beginning);
	} catch (error) {
		database.release();
		throw error;
	}

	const clearing = store.clear();
	const [settledBeforeRelease] = await settlementsBeforeRelease(database.release, [clearing]);
	const [beginResult, clearResult] = await Promise.allSettled([beginning, clearing]);
	if (beginResult.status === 'fulfilled') await beginResult.value.abort();
	await store.close();

	assert.equal(
		settledBeforeRelease,
		false,
		'clear must capture a writer begin before its first database await',
	);
	assertRejectedWith(
		beginResult,
		/maintenance/iu,
		'a writer admitted before its first database await must observe maintenance cancellation',
	);
	assert.equal(clearResult.status, 'fulfilled');
});

test('clear drains a streamed writer admitted before staging and then reopens admission', async () => {
	const databaseName = uniqueDatabaseName('media-write-admission-clear');
	const indexedDB = createInstrumentedIndexedDB();
	const opfs = stallFirstOpfsDirectoryAdmission();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		preferOpfs: true,
		opfsRoot: opfs.root,
	});
	const beginning = store.beginMediaAssetWrite('before-clear', {}, writerOptions());
	try {
		await requireDirectoryAdmission(opfs.started, beginning);
	} catch (error) {
		opfs.release();
		throw error;
	}

	const clearing = store.clear();
	const lateBeginning = store.beginMediaAssetWrite('during-clear', {}, writerOptions());
	const [settledBeforeRelease, lateSettledBeforeRelease] = await settlementsBeforeRelease(
		opfs.release,
		[clearing, lateBeginning],
	);
	const [beginResult, clearResult, lateResult] = await Promise.allSettled([
		beginning,
		clearing,
		lateBeginning,
	]);
	if (beginResult.status === 'fulfilled') await beginResult.value.abort();
	if (lateResult.status === 'fulfilled') await lateResult.value.abort();

	const replacementResult = await Promise.allSettled([
		store.beginMediaAssetWrite('after-clear', {}, writerOptions()),
	]);
	if (replacementResult[0]?.status === 'fulfilled') await replacementResult[0].value.abort();
	await store.close();

	assert.equal(
		beginResult.status,
		'rejected',
		'an admitted begin must not return a live writer after clear releases its fence',
	);
	assert.equal(
		settledBeforeRelease,
		false,
		'clear must wait for a begin operation admitted before the maintenance fence',
	);
	assert.equal(
		lateSettledBeforeRelease,
		true,
		'clear must reject later writer admission without waiting on the stalled backend',
	);
	assertRejectedWith(lateResult, /maintenance/iu, 'clear must fence new writer admission synchronously');
	assert.equal(clearResult.status, 'fulfilled');
	assert.equal(opfs.files.size, 0, 'clear must settle only after staged OPFS cleanup is drained');
	assert.equal(
		indexedDB.recordCount(databaseName, MEDIA_ASSET_STAGING_STORE_NAME),
		1,
		'clear must leave only the staging generation record',
	);
	assert.equal(replacementResult[0]?.status, 'fulfilled', 'clear must reopen writer admission');
});

test('close drains a streamed writer admitted before staging and keeps admission terminal', async () => {
	const databaseName = uniqueDatabaseName('media-write-admission-close');
	const indexedDB = createInstrumentedIndexedDB();
	const opfs = stallFirstOpfsDirectoryAdmission();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		preferOpfs: true,
		opfsRoot: opfs.root,
	});
	const beginning = store.beginMediaAssetWrite('before-close', {}, writerOptions());
	try {
		await requireDirectoryAdmission(opfs.started, beginning);
	} catch (error) {
		opfs.release();
		throw error;
	}

	const closing = store.close();
	const lateBeginning = store.beginMediaAssetWrite('during-close', {}, writerOptions());
	const [settledBeforeRelease, lateSettledBeforeRelease] = await settlementsBeforeRelease(
		opfs.release,
		[closing, lateBeginning],
	);
	const [beginResult, closeResult, lateResult] = await Promise.allSettled([
		beginning,
		closing,
		lateBeginning,
	]);
	if (beginResult.status === 'fulfilled') await beginResult.value.abort();
	if (lateResult.status === 'fulfilled') await lateResult.value.abort();
	const afterCloseResult = await Promise.allSettled([
		store.beginMediaAssetWrite('after-close', {}, writerOptions()),
	]);

	assert.equal(
		settledBeforeRelease,
		false,
		'close must wait for a begin operation admitted before the terminal fence',
	);
	assert.equal(
		lateSettledBeforeRelease,
		true,
		'close must reject later writer admission without waiting on the stalled backend',
	);
	assertRejectedWith(lateResult, /closed/iu, 'close must fence new writer admission synchronously');
	assert.equal(
		beginResult.status,
		'rejected',
		'an admitted begin must not return a live writer after close starts',
	);
	assert.equal(closeResult.status, 'fulfilled');
	assert.equal(opfs.files.size, 0, 'close must settle only after staged OPFS cleanup is drained');
	assert.equal(
		indexedDB.recordCount(databaseName, MEDIA_ASSET_STAGING_STORE_NAME),
		1,
		'close must drain the pre-registration staging lease',
	);
	assertRejectedWith(afterCloseResult[0], /closed/iu, 'close must keep writer admission terminal');
});

function writerOptions(): Readonly<{ expectedBytes: number; expectedSha256: string }> {
	return { expectedBytes: 1, expectedSha256: '0'.repeat(64) };
}

function assertRejectedWith(
	result: PromiseSettledResult<unknown> | undefined,
	pattern: RegExp,
	message: string,
): void {
	assert.equal(result?.status, 'rejected', message);
	if (result?.status === 'rejected') assert.match(String(result.reason), pattern, message);
}

async function settlesWithinEventLoopTurns(promise: Promise<unknown>): Promise<boolean> {
	let settled = false;
	void promise.then(
		() => { settled = true; },
		() => { settled = true; },
	);
	for (let turn = 0; turn < 20 && !settled; turn += 1) {
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	return settled;
}

async function settlementsBeforeRelease(
	release: () => void,
	promises: readonly Promise<unknown>[],
): Promise<boolean[]> {
	try {
		return await Promise.all(promises.map((promise) => settlesWithinEventLoopTurns(promise)));
	} finally {
		release();
	}
}

async function requireDirectoryAdmission(started: Promise<void>, beginning: Promise<unknown>): Promise<void> {
	await Promise.race([
		started,
		beginning.then(
			() => { throw new Error('Streamed writer admission completed before the OPFS fixture stalled.'); },
			(error: unknown) => { throw error; },
		),
	]);
}

async function requireDatabaseAdmission(started: Promise<void>, beginning: Promise<unknown>): Promise<void> {
	await Promise.race([
		started,
		beginning.then(
			() => { throw new Error('Streamed writer admission completed before its first database await.'); },
			(error: unknown) => { throw error; },
		),
	]);
}

function stallFirstRepositoryDatabaseAdmission(): Readonly<{
	repositoryFactory: StorageRepositoryFactory;
	started: Promise<void>;
	release(): void;
}> {
	const started = deferred();
	const released = deferredValue<IDBDatabase | null>();
	let databaseCalls = 0;
	return {
		repositoryFactory: (port, options) => createStorageRepositories({
			memory: port.memory,
			database: () => {
				databaseCalls += 1;
				if (databaseCalls !== 1) return Promise.resolve(null);
				started.resolve();
				return released.promise;
			},
		}, options),
		started: started.promise,
		release: () => { released.resolve(null); },
	};
}

function stallFirstOpfsDirectoryAdmission() {
	const files = new Map<string, Blob>();
	const started = deferred();
	const released = deferred();
	let firstAdmission = true;
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
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
				async write(part: BlobPart) { parts.push(part); },
				async close() { files.set(path, new Blob(parts)); },
				async abort() { parts.length = 0; },
			};
		},
		async getFile() {
			const file = files.get(path);
			if (!file) throw new DOMException('missing', 'NotFoundError');
			return file;
		},
	});
	const root = {
		async getDirectoryHandle() {
			if (firstAdmission) {
				firstAdmission = false;
				started.resolve();
				await released.promise;
			}
			return directory;
		},
	};
	return {
		files,
		root: root as unknown as FileSystemDirectoryHandle,
		started: started.promise,
		release: released.resolve,
	};
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
	let resolve: (() => void) | undefined;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return {
		promise,
		resolve: () => { resolve?.(); },
	};
}

function deferredValue<Value>(): Readonly<{ promise: Promise<Value>; resolve(value: Value): void }> {
	let resolve: ((value: Value) => void) | undefined;
	const promise = new Promise<Value>((settle) => { resolve = settle; });
	return {
		promise,
		resolve: (value) => { resolve?.(value); },
	};
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
