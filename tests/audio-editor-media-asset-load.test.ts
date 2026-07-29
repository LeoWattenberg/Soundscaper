/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	MEDIA_ASSET_CHUNK_STORAGE_TYPE,
	MEDIA_ASSET_STREAM_CHUNK_BYTES,
} from '../src/common/editor/storage/media-asset-write-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('fallback media persists canonical source-owned native Blob chunks', async () => {
	const store = memoryStore('media-blob-chunks');
	const sourceId = 'blob-backed-media';
	const bytes = new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + 3).fill(0x5a);
	const writer = await store.beginMediaAssetWrite(sourceId, { mimeType: 'video/mp4' }, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) {
		await writer.write(bytes.subarray(offset, Math.min(bytes.byteLength, offset + 1024 * 1024)));
	}
	await writer.commit();

	const chunks = [...store.memory.mediaAssetChunks.values()] as Array<Record<string, unknown>>;
	chunks.sort((left, right) => Number(left.index) - Number(right.index));
	assert.deepEqual(chunks.map(({ sourceId: owner }) => owner), [sourceId, sourceId]);
	assert.ok(chunks.every(({ payload }) => payload instanceof Blob));
	assert.ok(chunks.every(({ payload }) => !(payload instanceof ArrayBuffer)));
	assert.deepEqual(chunks.map(({ payload }) => (payload as Blob).size), [
		MEDIA_ASSET_STREAM_CHUNK_BYTES,
		3,
	]);

	const loaded = await store.loadMediaAsset(sourceId);
	assert.ok(loaded);
	assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
});

test('chunked media loading fails closed for malformed fallback inventories', async () => {
	const cases = [
		['missing', []],
		['extra', [validChunk('extra'), { ...validChunk('extra'), ...chunkIdentity('extra', 1) }]],
		['duplicate index', [validChunk('duplicate'), {
			...validChunk('duplicate'),
			key: chunkIdentity('duplicate', 1).key,
		}]],
		['spoofed value key', [{
			...validChunk('spoofed-key'),
			key: 'attacker-controlled',
			primaryKey: chunkIdentity('spoofed-key', 0).key,
		}]],
		['spoofed value token', [{
			...validChunk('spoofed-token'),
			mediaChunkToken: 'attacker-controlled',
		}]],
		['out of order', [{ ...validChunk('out-of-order'), index: 1 }]],
		['truncated', [{ ...validChunk('truncated'), payload: new Blob(), byteLength: 0 }]],
		['legacy ArrayBuffer payload', [{
			...validChunk('array-buffer'),
			payload: Uint8Array.of(1).buffer,
		}]],
	] as const;
	for (const [label, chunks] of cases) {
		const store = memoryStore(`media-corrupt-${label}`);
		seedChunkedMedia(store, label, chunks);
		await assert.rejects(store.loadMediaAsset(label), /media asset is missing/iu, label);
	}
});

test('chunked media loading rejects equal-length byte corruption', async () => {
	const store = memoryStore('media-equal-length-corruption');
	const sourceId = 'equal-length-corruption';
	seedChunkedMedia(store, sourceId, [validChunk(sourceId, Uint8Array.of(2))]);

	await assert.rejects(store.loadMediaAsset(sourceId), /media asset is missing/iu);
});

test('chunked media loading requires exact digest, size, and chunk-count scalars', async () => {
	const sourceId = 'strict-metadata';
	const canonical = chunkedMediaRecord(sourceId);
	const cases: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
		['missing SHA', { sha256: undefined }],
		['uppercase SHA', { sha256: String(canonical.sha256).toUpperCase() }],
		['short SHA', { sha256: '0'.repeat(63) }],
		['string size', { size: '1' }],
		['fractional size', { size: 1.5 }],
		['string count', { mediaChunkCount: '1' }],
		['drifted count', { mediaChunkCount: 2 }],
		['string chunk size', { mediaChunkBytes: String(MEDIA_ASSET_STREAM_CHUNK_BYTES) }],
	];
	for (const [label, override] of cases) {
		const store = memoryStore(`media-metadata-${label}`);
		seedChunkedMedia(store, sourceId, [validChunk(sourceId)], { ...canonical, ...override });
		await assert.rejects(store.loadMediaAsset(sourceId), /media asset is missing/iu, label);
	}
});

test('source ownership rejects redirecting one media record to another asset token', async () => {
	const store = memoryStore('media-token-redirect');
	const sourceA = 'redirected-a';
	const sourceB = 'redirect-target-b';
	const bytesB = Uint8Array.of(0xb2);
	seedChunkedMedia(store, sourceB, [validChunk(sourceB, bytesB)], chunkedMediaRecord(sourceB, bytesB));
	store.memory.mediaAssets.set(sourceA, chunkedMediaRecord(sourceA, bytesB, {
		mediaChunkToken: tokenFor(sourceB),
	}));

	await assert.rejects(store.loadMediaAsset(sourceA), /media asset is missing/iu);
	assert.deepEqual(
		new Uint8Array(await (await store.loadMediaAsset(sourceB))?.arrayBuffer() as ArrayBuffer),
		bytesB,
	);
});

test('IndexedDB loading rejects a row whose authoritative primary key diverges from its value', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('media-primary-key');
	const store = createProjectStore({ indexedDB, memoryFallback: false, preferOpfs: false, databaseName });
	await store.ready();
	const sourceId = 'divergent-primary-key';
	indexedDB.seedRecord(databaseName, 'mediaAssets', chunkedMediaRecord(sourceId));
	indexedDB.seedRecord(
		databaseName,
		'mediaAssetChunks',
		validChunk(sourceId),
		`${tokenFor(sourceId)}:divergent`,
	);

	await assert.rejects(store.loadMediaAsset(sourceId), /media asset is missing/iu);
});

test('IndexedDB chunk loading materializes at most one native Blob per page', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('media-one-blob-pages');
	const store = createProjectStore({ indexedDB, memoryFallback: false, preferOpfs: false, databaseName });
	await store.ready();
	const sourceId = 'paged-media';
	const bytes = new Uint8Array(MEDIA_ASSET_STREAM_CHUNK_BYTES + 3).fill(0x39);
	indexedDB.seedRecord(databaseName, 'mediaAssets', chunkedMediaRecord(sourceId, bytes));
	indexedDB.seedRecord(
		databaseName,
		'mediaAssetChunks',
		validChunk(sourceId, bytes.subarray(0, MEDIA_ASSET_STREAM_CHUNK_BYTES), 0),
	);
	indexedDB.seedRecord(
		databaseName,
		'mediaAssetChunks',
		validChunk(sourceId, bytes.subarray(MEDIA_ASSET_STREAM_CHUNK_BYTES), 1),
	);

	const loaded = await store.loadMediaAsset(sourceId);
	assert.ok(loaded);
	assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);

	const cursorPages = indexedDB.stats.cursorRequests
		.filter(({ store, index }: Record<string, unknown>) => (
			store === 'mediaAssetChunks' && index === 'mediaChunkToken'
		))
		.map(({ blobValuesDelivered, blobBytesDelivered }: Record<string, number>) => ({
			blobCount: blobValuesDelivered,
			blobBytes: blobBytesDelivered,
		}));
	const keyedPages = indexedDB.stats.getRequests
		.filter(({ store }: Record<string, unknown>) => store === 'mediaAssetChunks')
		.map(({ blobValuesReturned, blobBytesReturned }: Record<string, number>) => ({
			blobCount: blobValuesReturned,
			blobBytes: blobBytesReturned,
		}));
	const pages = [...cursorPages, ...keyedPages];
	assert.equal(pages.length, 2);
	assert.ok(pages.every(({ blobCount }) => blobCount === 1));
	assert.ok(pages.every(({ blobBytes }) => blobBytes <= MEDIA_ASSET_STREAM_CHUNK_BYTES));
});

function memoryStore(prefix: string) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName(prefix),
	});
}

function seedChunkedMedia(
	store: ReturnType<typeof memoryStore>,
	sourceId: string,
	chunks: readonly Readonly<Record<string, unknown>>[],
	record: Readonly<Record<string, unknown>> = chunkedMediaRecord(sourceId),
): void {
	store.memory.mediaAssets.set(sourceId, structuredClone(record));
	for (const chunk of chunks) {
		const primaryKey = String(chunk.primaryKey ?? chunk.key);
		store.memory.mediaAssetChunks.set(primaryKey, structuredClone(chunk));
	}
}

function chunkedMediaRecord(
	sourceId: string,
	bytes: Uint8Array = Uint8Array.of(1),
	overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		sourceId,
		storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE,
		mediaContentDigestVersion: 1,
		mediaContentToken: 'media-content-trusted-chunk-fixture-0001',
		mediaChunkToken: tokenFor(sourceId),
		mediaChunkBytes: MEDIA_ASSET_STREAM_CHUNK_BYTES,
		mediaChunkCount: bytes.byteLength === 0
			? 0
			: Math.ceil(bytes.byteLength / MEDIA_ASSET_STREAM_CHUNK_BYTES),
		size: bytes.byteLength,
		sha256: digest(bytes),
		mimeType: 'video/mp4',
		...overrides,
	});
}

function validChunk(
	sourceId: string,
	bytes: Uint8Array = Uint8Array.of(1),
	index = 0,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		...chunkIdentity(sourceId, index),
		sourceId,
		payload: new Blob([exactArrayBuffer(bytes)]),
		byteLength: bytes.byteLength,
		createdAt: Date.now(),
	});
}

function chunkIdentity(sourceId: string, index: number): Readonly<Record<string, unknown>> {
	const token = tokenFor(sourceId);
	return Object.freeze({
		key: `${token}:${String(index).padStart(10, '0')}`,
		mediaChunkToken: token,
		index,
	});
}

function tokenFor(sourceId: string): string {
	return `token-${sourceId}`;
}

function digest(bytes: Uint8Array): string {
	return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
