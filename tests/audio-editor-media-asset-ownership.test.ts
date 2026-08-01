/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('owned media rollback preserves a concurrent chunk-backed replacement', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('media-ownership-chunks'),
	});
	const bytes = Uint8Array.of(2, 4, 6, 8);
	const writer = await store.beginMediaAssetWrite('video-source', { mimeType: 'video/mp4' }, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	const publication = await writer.commitOwned();
	const acquired = structuredClone(store.memory.mediaAssets.get('video-source')) as Record<string, unknown>;
	const replacement = {
		...acquired,
		mediaChunkToken: 'replacement-media-token',
	};
	store.memory.mediaAssets.set('video-source', replacement);

	assert.equal(publication.metadata.sha256, digest(bytes));
	assert.equal('path' in publication.metadata, false);
	assert.equal('mediaChunkToken' in publication.metadata, false);
	assert.equal('mediaContentToken' in publication.metadata, false);
	assert.equal(await publication.discardIfCurrent(), false);
	assert.deepEqual(store.memory.mediaAssets.get('video-source'), replacement);

	store.memory.mediaAssets.set('video-source', acquired);
	assert.equal(await publication.discardIfCurrent(), true);
	assert.equal(store.memory.mediaAssets.has('video-source'), false);
	assert.equal(store.memory.mediaAssetChunks.size, 0);
});

test('owned media rollback deletes only its exact OPFS path', async () => {
	const databaseName = uniqueDatabaseName('media-ownership-opfs');
	const indexedDB = createInstrumentedIndexedDB();
	const opfs = fakeOpfs();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		preferOpfs: true,
		opfsRoot: opfs.directory,
	});
	const bytes = Uint8Array.of(1, 3, 5, 7);
	const writer = await store.beginMediaAssetWrite('video-source', { mimeType: 'video/mp4' }, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	const publication = await writer.commitOwned();
	const [acquired] = indexedDB.records(databaseName, 'mediaAssets') as Record<string, unknown>[];
	assert.equal(typeof acquired?.path, 'string');
	const acquiredPath = acquired?.path as string;
	const replacementPath = 'replacement-video.blob';
	opfs.files.set(replacementPath, new Blob(['replacement']));
	const replacement = { ...acquired, path: replacementPath };
	indexedDB.seedRecord(databaseName, 'mediaAssets', replacement);

	assert.equal(await publication.discardIfCurrent(), false);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [replacement]);
	assert.equal(opfs.files.has(acquiredPath), true);
	assert.equal(opfs.files.has(replacementPath), true);

	indexedDB.seedRecord(databaseName, 'mediaAssets', acquired);
	assert.equal(await publication.discardIfCurrent(), true);
	assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 0);
	assert.equal(opfs.files.has(acquiredPath), false);
	assert.equal(opfs.files.has(replacementPath), true);
	await store.close();
});

test('public and owned commit views share one media publication', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('media-ownership-shared-commit'),
	});
	const bytes = Uint8Array.of(9, 8, 7);
	const writer = await store.beginMediaAssetWrite('video-source', { mimeType: 'video/mp4' }, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);

	const [metadata, publication] = await Promise.all([
		writer.commit(),
		writer.commitOwned(),
	]);

	assert.equal(metadata.sha256, digest(bytes));
	const receiptMetadata = { ...metadata };
	delete receiptMetadata.path;
	assert.deepEqual(publication.metadata, receiptMetadata);
	assert.equal(store.memory.mediaAssets.size, 1);
	assert.equal(store.memory.mediaAssetChunks.size, 1);
	assert.equal(await publication.discardIfCurrent(), true);
	assert.equal(store.memory.mediaAssets.size, 0);
	assert.equal(store.memory.mediaAssetChunks.size, 0);
});

function digest(bytes: Uint8Array): string {
	return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}

function fakeOpfs() {
	const files = new Map<string, Blob>();
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
				async getFile() {
					const blob = files.get(path);
					if (!blob) throw new DOMException('missing', 'NotFoundError');
					return blob;
				},
			};
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
	};
	return { directory, files };
}
