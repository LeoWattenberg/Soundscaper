/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import { freshVerifiedMediaContentDigest } from '../src/common/editor/storage/media-content-provenance.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface InstrumentedIndexedDB {
	open(name: string, version?: number): IDBOpenDBRequest;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown, primaryKey?: IDBValidKey): void;
}

interface DerivativeStore {
	readonly memory: {
		readonly mediaAssets: Map<string, unknown>;
		readonly videoDerivatives: Map<string, unknown>;
	};
	ready(): Promise<unknown>;
	writeMediaAsset(sourceId: string, blob: Blob): Promise<Record<string, unknown>>;
	saveVideoDerivative(sourceId: string, input: Readonly<{
		readonly type: string;
		readonly blob: Blob;
	}>): Promise<Record<string, unknown>>;
	loadVideoDerivative(
		sourceId: string,
		selector: Readonly<{ type: string }>,
	): Promise<Blob | null>;
}

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} publication rejects an original generation changed after staging`, async () => {
		const indexedDB = backend === 'indexeddb'
			? createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB
			: null;
		const databaseName = `video-derivative-publication-fence-${backend}-${Date.now()}-${Math.random()}`;
		const opfs = createOpfsHarness();
		const store = createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: true,
			opfsRoot: opfs.directory,
			databaseName,
		}) as unknown as DerivativeStore;
		await store.ready();
		const original = await store.writeMediaAsset('video-source', new Blob(['original-video']));
		const originalPath = String(original.path);
		const rawOriginal = backend === 'indexeddb'
			? onlyRecord(indexedDB?.records(databaseName, 'mediaAssets') ?? [])
			: store.memory.mediaAssets.get('video-source') as Record<string, unknown>;
		opfs.arm(() => {
			if (backend === 'indexeddb') {
				indexedDB?.seedRecord(databaseName, 'mediaAssets', {
					...rawOriginal,
					...freshVerifiedMediaContentDigest(rawOriginal.sha256),
				});
			} else {
				store.memory.mediaAssets.delete('video-source');
			}
		});

		await assert.rejects(
			store.saveVideoDerivative('video-source', {
				type: 'poster', blob: new Blob(['staged-poster']),
			}),
			/verified original media.*changed during derivative publication/iu,
		);

		assert.equal(opfs.derivativePaths().length, 0, 'the staged derivative file is removed');
		assert.equal(opfs.files.has(originalPath), true, 'the unrelated retained-original file is preserved');
		if (backend === 'indexeddb') {
			assert.deepEqual(indexedDB?.records(databaseName, VIDEO_DERIVATIVE_STORE_NAME), []);
			assert.deepEqual(indexedDB?.records(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), []);
		} else {
			assert.equal(store.memory.videoDerivatives.size, 0);
		}
	});
}

test('equal-size OPFS derivative corruption fails the output digest check', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
	const databaseName = `video-derivative-opfs-integrity-${Date.now()}-${Math.random()}`;
	const opfs = createOpfsHarness();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot: opfs.directory,
		databaseName,
	}) as unknown as DerivativeStore;
	await store.ready();
	await store.writeMediaAsset('video-source', new Blob(['original-video']));
	const derivative = await store.saveVideoDerivative('video-source', {
		type: 'poster', blob: new Blob(['poster-body']),
	});
	const derivativePath = String(derivative.path);
	opfs.files.set(derivativePath, new Blob(['altered-bod']));

	await assert.rejects(
		store.loadVideoDerivative('video-source', { type: 'poster' }),
		/derivative.*digest integrity/iu,
	);
});

function createOpfsHarness(): Readonly<{
	readonly directory: FileSystemDirectoryHandle;
	readonly files: Map<string, Blob>;
	arm(callback: () => void): void;
	derivativePaths(): string[];
}> {
	const files = new Map<string, Blob>();
	let afterNextClose: (() => void) | null = null;
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
						async close() {
							files.set(path, new Blob(parts));
							const callback = afterNextClose;
							afterNextClose = null;
							callback?.();
						},
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return files.get(path) as Blob; },
			};
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new Error('missing');
		},
	};
	return {
		directory: directory as unknown as FileSystemDirectoryHandle,
		files,
		arm(callback) { afterNextClose = callback; },
		derivativePaths() { return [...files.keys()].filter((path) => path.startsWith('video-')); },
	};
}

function onlyRecord(records: readonly Record<string, unknown>[]): Record<string, unknown> {
	assert.equal(records.length, 1);
	return records[0];
}
