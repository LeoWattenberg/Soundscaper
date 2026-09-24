/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('ordinary media write reconciles a committed row after completion acknowledgement fails', async () => {
	const fixture = await mediaFixture('committed');
	try {
		injectPublicationCompletionFailure(fixture.database, fixture.publicationError);
		const metadata = await fixture.store.writeMediaAsset('video-source', new Blob(['original']));
		assert.equal(metadata.storage, 'opfs');
		assert.equal(fixture.files.size, 1);
		assert.equal(await readMedia(fixture.store), 'original');
	} finally {
		await fixture.store.close();
		fixture.database.close();
	}
});

test('ordinary Blob-backed media write reconciles a committed row after completion acknowledgement fails', async () => {
	const fixture = await mediaFixture('blob-committed', false);
	try {
		injectPublicationCompletionFailure(fixture.database, fixture.publicationError);
		const metadata = await fixture.store.writeMediaAsset('video-source', new Blob(['original']));
		assert.equal(metadata.storage, 'indexeddb-blob');
		assert.equal(await readMedia(fixture.store), 'original');
	} finally {
		await fixture.store.close();
		fixture.database.close();
	}
});

test('ordinary media write retains OPFS when publication reconciliation cannot read the row', async () => {
	const fixture = await mediaFixture('indeterminate');
	const reconciliationError = new Error('media reconciliation unavailable');
	try {
		injectPublicationCompletionFailure(fixture.database, fixture.publicationError, reconciliationError);
		await assert.rejects(
			fixture.store.writeMediaAsset('video-source', new Blob(['original'])),
			(error: unknown) => error instanceof AggregateError
				&& error.errors[0] === fixture.publicationError
				&& error.errors[1] === reconciliationError,
		);
		assert.equal(fixture.files.size, 1);
		assert.equal(await readMedia(fixture.store), 'original');
	} finally {
		await fixture.store.close();
		fixture.database.close();
	}
});

async function mediaFixture(label: string, preferOpfs = true) {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `ordinary-media-reconcile-${label}-${crypto.randomUUID()}`;
	const files = new Map<string, Blob>();
	const store = createProjectStore({
		indexedDB, databaseName, memoryFallback: false, preferOpfs,
		opfsRoot: fakeOpfs(files),
	});
	await store.ready();
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(databaseName) as unknown as IDBOpenDBRequest;
		opening.onsuccess = () => { resolve(opening.result); };
		opening.onerror = () => { reject(opening.error); };
	});
	return { store, database, files, publicationError: new Error('media completion acknowledgement lost') };
}

async function readMedia(store: ReturnType<typeof createProjectStore>): Promise<string | null> {
	const loaded = await store.loadMediaAsset('video-source');
	return loaded ? new TextDecoder().decode(await loaded.arrayBuffer()) : null;
}

function injectPublicationCompletionFailure(
	database: IDBDatabase,
	publicationError: Error,
	reconciliationError?: Error,
): void {
	const originalTransaction = database.transaction.bind(database);
	let injected = false;
	let failedRead = false;
	Object.defineProperty(database, 'transaction', {
		configurable: true,
		value(storeNames: string | string[], mode?: IDBTransactionMode) {
			const names = Array.isArray(storeNames) ? storeNames : [storeNames];
			if (injected && !failedRead && reconciliationError && mode === 'readonly'
				&& names.length === 1 && names[0] === 'mediaAssets') {
				failedRead = true;
				throw reconciliationError;
			}
			const transaction = originalTransaction(storeNames, mode);
			if (!injected && mode === 'readwrite'
				&& names.length === 1 && names[0] === 'mediaAssets') {
				injected = true;
				Object.defineProperty(transaction, 'oncomplete', {
					configurable: true,
					set() {},
					get() {
						return () => {
							Object.defineProperty(transaction, 'error', { configurable: true, value: publicationError });
							transaction.onerror?.(new Event('error'));
						};
					},
				});
			}
			return transaction;
		},
	});
}

function fakeOpfs(files: Map<string, Blob>): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				kind: 'file',
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); },
						async close() { files.set(path, new Blob(parts)); },
						async abort() {},
					};
				},
				async getFile() { return files.get(path) as Blob; },
			};
		},
		async removeEntry(path: string) { files.delete(path); },
	};
	return directory as unknown as FileSystemDirectoryHandle;
}
