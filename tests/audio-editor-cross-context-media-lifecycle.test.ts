/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../src/common/editor/storage/media-asset-write-repository.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['indexeddb', 'opfs'] as const) {
	test(`${backend} temporary cleanup in another store preserves a live media writer`, async () => {
		const fixture = await sharedStores(`cross-context-cleanup-${backend}`, backend);
		const bytes = backend === 'indexeddb'
			? new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + 1).fill(0x43)
			: Uint8Array.of(4, 3, 2, 1);
		const writer = await fixture.first.beginMediaAssetWrite('live-media', {}, {
			expectedBytes: bytes.byteLength,
			expectedSha256: digest(bytes),
		});
		assert.equal(
			fixture.indexedDB.recordCount(fixture.databaseName, MEDIA_ASSET_STAGING_STORE_NAME),
			2,
		);
		if (backend === 'indexeddb') {
			await writer.write(bytes.subarray(0, MEDIA_ASSET_STREAM_CHUNK_BYTES));
			assert.equal(fixture.indexedDB.recordCount(fixture.databaseName, 'mediaAssetChunks'), 1);
		} else {
			assert.equal(fixture.files.size, 1);
		}

		try {
			await fixture.second.cleanupTemporaryAssets({ maximumAgeMs: 0 });
			if (backend === 'indexeddb') {
				assert.equal(fixture.indexedDB.recordCount(fixture.databaseName, 'mediaAssetChunks'), 1);
				await writer.write(bytes.subarray(MEDIA_ASSET_STREAM_CHUNK_BYTES));
			} else {
				assert.equal(fixture.files.size, 1);
				await writer.write(bytes);
			}
			await writer.commit();
			const loaded = await fixture.second.loadMediaAsset('live-media');
			assert.ok(loaded);
			assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
			assert.equal(
				fixture.indexedDB.recordCount(fixture.databaseName, MEDIA_ASSET_STAGING_STORE_NAME),
				1,
			);
		} finally {
			await writer.abort();
			await closeStores(fixture);
		}
	});

	test(`${backend} clear in another store fences a writer from late publication`, async () => {
		const fixture = await sharedStores(`cross-context-clear-${backend}`, backend);
		const bytes = Uint8Array.of(7, 8, 9);
		const writer = await fixture.first.beginMediaAssetWrite('fenced-media', {}, {
			expectedBytes: bytes.byteLength,
			expectedSha256: digest(bytes),
		});
		await writer.write(bytes);

		try {
			await fixture.second.clear();
			assert.equal(
				fixture.indexedDB.recordCount(fixture.databaseName, MEDIA_ASSET_STAGING_STORE_NAME),
				1,
			);
			assert.equal(fixture.indexedDB.recordCount(fixture.databaseName, 'mediaAssetChunks'), 0);
			assert.equal(fixture.files.size, 0);
			await assert.rejects(writer.commit(), /staging lease|storage maintenance|invalidated/iu);
			assert.equal(await fixture.first.getMediaAssetMetadata('fenced-media'), null);
			assert.equal(await fixture.second.getMediaAssetMetadata('fenced-media'), null);
		} finally {
			await writer.abort();
			await closeStores(fixture);
		}
	});

	test(`${backend} cleanup reclaims expired crashed media staging`, async () => {
		const fixture = await sharedStores(`cross-context-expired-${backend}`, backend);
		const bytes = backend === 'indexeddb'
			? new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + 1).fill(0x52)
			: Uint8Array.of(5, 4, 3);
		const writer = await fixture.first.beginMediaAssetWrite('expired-media', {}, {
			expectedBytes: bytes.byteLength,
			expectedSha256: digest(bytes),
		});
		await writer.write(backend === 'indexeddb'
			? bytes.subarray(0, MEDIA_ASSET_STREAM_CHUNK_BYTES)
			: bytes);
		if (backend === 'indexeddb') {
			for (const chunk of fixture.indexedDB.records(fixture.databaseName, 'mediaAssetChunks')) {
				fixture.indexedDB.seedRecord(fixture.databaseName, 'mediaAssetChunks', {
					...chunk,
					createdAt: 0,
				});
			}
		}
		const lease = fixture.indexedDB.records(fixture.databaseName, MEDIA_ASSET_STAGING_STORE_NAME)
			.find(({ kind }) => kind === 'lease');
		assert.ok(lease);
		fixture.indexedDB.seedRecord(fixture.databaseName, MEDIA_ASSET_STAGING_STORE_NAME, {
			...lease,
			expiresAt: 0,
		});

		try {
			await fixture.second.cleanupTemporaryAssets({ maximumAgeMs: 0 });
			assert.equal(
				fixture.indexedDB.recordCount(fixture.databaseName, MEDIA_ASSET_STAGING_STORE_NAME),
				1,
			);
			if (backend === 'indexeddb') {
				assert.equal(fixture.indexedDB.recordCount(fixture.databaseName, 'mediaAssetChunks'), 0);
			} else assert.equal(fixture.files.size, 0);
			await assert.rejects(writer.commit(), /staging lease|storage maintenance|invalidated/iu);
		} finally {
			await writer.abort();
			await closeStores(fixture);
		}
	});
}

interface InstrumentedIndexedDB extends IDBFactory {
	recordCount(databaseName: string, storeName: string): number;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown): void;
}

interface SharedStoreFixture {
	readonly databaseName: string;
	readonly indexedDB: InstrumentedIndexedDB;
	readonly files: Map<string, { blob: Blob; lastModified: number }>;
	readonly first: ReturnType<typeof createProjectStore>;
	readonly second: ReturnType<typeof createProjectStore>;
}

async function sharedStores(prefix: string, backend: 'indexeddb' | 'opfs'): Promise<SharedStoreFixture> {
	const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
	const databaseName = `${prefix}-${Date.now()}-${Math.random()}`;
	const files = new Map<string, { blob: Blob; lastModified: number }>();
	const opfsRoot = backend === 'opfs' ? createOpfsDirectory(files) : null;
	const options = {
		indexedDB,
		databaseName,
		memoryFallback: false,
		preferOpfs: backend === 'opfs',
		opfsRoot,
	};
	const first = createProjectStore(options);
	const second = createProjectStore(options);
	await first.ready();
	await second.ready();
	return { databaseName, indexedDB, files, first, second };
}

async function closeStores(fixture: SharedStoreFixture): Promise<void> {
	await Promise.allSettled([fixture.first.close(), fixture.second.close()]);
}

function digest(bytes: Uint8Array): string {
	return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createOpfsDirectory(
	files: Map<string, { blob: Blob; lastModified: number }>,
): FileSystemDirectoryHandle {
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
				async write(part: BlobPart) { parts.push(part); },
				async close() {
					files.set(path, { blob: new Blob(parts), lastModified: Date.now() });
				},
				async abort() { parts.length = 0; },
			};
		},
		async getFile() {
			const entry = files.get(path);
			if (!entry) throw new DOMException('missing', 'NotFoundError');
			Object.defineProperty(entry.blob, 'lastModified', {
				configurable: true,
				value: entry.lastModified,
			});
			return entry.blob;
		},
	});
	return directory as unknown as FileSystemDirectoryHandle;
}
