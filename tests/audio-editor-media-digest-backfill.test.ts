/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	MEDIA_ASSET_CHUNK_STORAGE_TYPE,
	MEDIA_ASSET_STREAM_CHUNK_BYTES,
} from '../src/common/editor/storage/media-asset-write-repository.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../src/common/editor/storage/media-content-digest.ts';
import { createMediaContentToken } from '../src/common/editor/storage/media-content-provenance.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const VERIFIED_DIGEST_VERSION = 1;

test('media content tokens require Web Crypto and always satisfy the reserved syntax', () => {
	assert.match(createMediaContentToken(), /^media-content-[a-z0-9][a-z0-9-]{15,127}$/u);
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
	try {
		assert.throws(createMediaContentToken, /secure random generation is required/iu);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
		else delete (globalThis as { crypto?: Crypto }).crypto;
	}
});

test('new direct and streaming media writes publish trusted internal digest provenance', async () => {
	const store = memoryStore('media-digest-new-writes');
	const directBytes = Uint8Array.of(1, 2, 3);
	const directMetadata = await store.writeMediaAsset(
		'direct',
		new Blob([directBytes]),
		{ mediaContentDigestVersion: 0, mediaContentToken: 'caller-controlled' },
	);
	assertTrustedPublicMetadata(directMetadata, digest(directBytes));
	assertTrustedInternalRecord(internalMemoryRecord(store, 'direct'), digest(directBytes));

	const streamedBytes = Uint8Array.of(4, 5, 6);
	const writer = await store.beginMediaAssetWrite('streamed', {
		mediaContentDigestVersion: 0,
		mediaContentToken: 'caller-controlled',
	}, {
		expectedBytes: streamedBytes.byteLength,
		expectedSha256: digest(streamedBytes),
	});
	await writer.write(streamedBytes);
	const streamedMetadata = await writer.commit();
	assertTrustedPublicMetadata(streamedMetadata, digest(streamedBytes));
	assertTrustedInternalRecord(internalMemoryRecord(store, 'streamed'), digest(streamedBytes));
});

test('markerless memory Blob metadata is untrusted until first load backfills its actual digest', async () => {
	const store = memoryStore('media-digest-memory-legacy');
	const sourceId = 'legacy-memory';
	const bytes = Uint8Array.of(0x61, 0x62, 0x63);
	store.memory.mediaAssets.set(sourceId, legacyBlobRecord(sourceId, new Blob([bytes])));

	assertUntrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId));
	const loaded = await store.loadMediaAsset(sourceId);
	assert.ok(loaded);
	assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);

	assertTrustedInternalRecord(internalMemoryRecord(store, sourceId), digest(bytes));
	assertTrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId), digest(bytes));
});

test('malformed internal digest provenance stays fail-closed, unexposed, and unmodified', async () => {
	const validToken = 'media-content-malformed-provenance-token-0001';
	const cases = [
		{ mediaContentToken: validToken },
		{ mediaContentDigestVersion: 0 },
		{ mediaContentDigestVersion: 0, mediaContentToken: 'invalid' },
		{ mediaContentDigestVersion: 2, mediaContentToken: validToken },
		{ mediaContentDigestVersion: 1, mediaContentToken: validToken, sha256: 'A'.repeat(64) },
	];
	for (const [index, provenance] of cases.entries()) {
		const sourceId = `malformed-provenance-${index}`;
		const store = memoryStore(sourceId);
		store.memory.mediaAssets.set(sourceId, legacyBlobRecord(
			sourceId,
			new Blob([Uint8Array.of(index)]),
			provenance,
		));
		const before = internalMemoryRecord(store, sourceId);
		await assert.rejects(store.loadMediaAsset(sourceId), /media asset is missing/iu);
		assert.equal(internalMemoryRecord(store, sourceId), before);
		assertUntrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId));
	}
});

for (const backend of ['indexeddb-blob', 'opfs'] as const) {
	test(`markerless ${backend} metadata backfills only after hashing stored bytes`, async () => {
		const indexedDB = createInstrumentedIndexedDB();
		const databaseName = uniqueDatabaseName(`media-digest-${backend}`);
		const sourceId = `legacy-${backend}`;
		const bytes = Uint8Array.of(0xde, 0xad, 0xbe, 0xef);
		const path = `${sourceId}.blob`;
		const files = new Map([[path, new Blob([bytes])]]);
		const store = createProjectStore({
			indexedDB,
			memoryFallback: false,
			preferOpfs: backend === 'opfs',
			opfsRoot: backend === 'opfs' ? createOpfsDirectory(files) : null,
			databaseName,
		});
		await store.ready();
		indexedDB.seedRecord(databaseName, 'mediaAssets', legacyBlobRecord(
			sourceId,
			new Blob([bytes]),
			backend === 'opfs' ? { storage: 'opfs', path, blob: undefined } : {},
		));

		assertUntrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId));
		const loaded = await store.loadMediaAsset(sourceId);
		assert.ok(loaded);
		assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);

		const [internal] = indexedDB.records(databaseName, 'mediaAssets') as Record<string, unknown>[];
		assertTrustedInternalRecord(internal, digest(bytes));
		assertTrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId), digest(bytes));
	});
}

test('markerless chunked media ignores a forged legacy digest and backfills the stored bytes', async () => {
	const store = memoryStore('media-digest-chunked-legacy');
	const sourceId = 'legacy-chunked';
	const bytes = Uint8Array.of(7, 8, 9);
	const token = `legacy-token-${sourceId}`;
	store.memory.mediaAssets.set(sourceId, legacyChunkedRecord(sourceId, token, bytes));
	store.memory.mediaAssetChunks.set(chunkKey(token, 0), mediaChunk(sourceId, token, bytes));

	assertUntrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId));
	const loaded = await store.loadMediaAsset(sourceId);
	assert.ok(loaded);
	assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
	assertTrustedInternalRecord(internalMemoryRecord(store, sourceId), digest(bytes));
	assertTrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId), digest(bytes));
});

test('markerless chunked media keeps malformed geometry fail-closed and unverified', async () => {
	const store = memoryStore('media-digest-chunked-malformed');
	const sourceId = 'malformed-chunked';
	const bytes = Uint8Array.of(1, 2);
	const token = `legacy-token-${sourceId}`;
	store.memory.mediaAssets.set(sourceId, legacyChunkedRecord(sourceId, token, bytes));
	store.memory.mediaAssetChunks.set(chunkKey(token, 0), {
		...mediaChunk(sourceId, token, bytes),
		byteLength: bytes.byteLength + 1,
	});

	await assert.rejects(store.loadMediaAsset(sourceId), /media asset is missing/iu);
	const internal = internalMemoryRecord(store, sourceId);
	assert.notEqual(internal.mediaContentDigestVersion, VERIFIED_DIGEST_VERSION);
	assertUntrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId));
});

test('legacy backfill cancellation preserves the exact reason and leaves a retryable claim', async () => {
	const bytes = Uint8Array.of(3, 1, 4);
	const fixture = await legacyOpfsFixture('media-digest-cancel', bytes);
	const controller = new AbortController();
	const reason = new Error('cancel legacy digest');
	const loading = (fixture.store.loadMediaAsset as (
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<Blob | null>)(fixture.sourceId, { signal: controller.signal });
	await requirePayloadLoadStart(fixture.payloadLoadStarted, loading);
	controller.abort(reason);
	fixture.releasePayloadLoad();

	await assert.rejects(loading, (error: unknown) => error === reason);
	const claimed = fixture.internalRecord();
	assert.equal(claimed.mediaContentDigestVersion, 0);
	assert.equal(typeof claimed.mediaContentToken, 'string');
	assertUntrustedPublicMetadata(await fixture.store.getMediaAssetMetadata(fixture.sourceId));

	const retried = await fixture.store.loadMediaAsset(fixture.sourceId);
	assert.ok(retried);
	assertTrustedInternalRecord(fixture.internalRecord(), digest(bytes));
});

test('concurrent legacy loads converge on one verified digest claim across multiple hash chunks', async () => {
	const bytes = new Uint8Array(MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 17).fill(0x5a);
	const fixture = await legacyOpfsFixture('media-digest-concurrent', bytes);
	const first = fixture.store.loadMediaAsset(fixture.sourceId);
	await requirePayloadLoadStart(fixture.payloadLoadStarted, first);
	const claimedToken = String(fixture.internalRecord().mediaContentToken);
	assert.equal(fixture.internalRecord().mediaContentDigestVersion, 0);
	const second = fixture.store.loadMediaAsset(fixture.sourceId);
	fixture.releasePayloadLoad();

	const loaded = await Promise.all([first, second]);
	assert.ok(loaded.every(Boolean));
	const verified = fixture.internalRecord();
	assertTrustedInternalRecord(verified, digest(bytes));
	assert.equal(verified.mediaContentToken, claimedToken);
});

test('an aborted concurrent loser cannot report a winner digest as its own success', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('media-digest-concurrent-cancel');
	const sourceId = 'media-digest-concurrent-cancel-source';
	const path = `${sourceId}.blob`;
	const bytes = Uint8Array.of(0x0c, 0xa1);
	const gates = [opfsLoadGate(), opfsLoadGate()];
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot: createOpfsDirectory(new Map([[path, new Blob([bytes])]]), gates),
		databaseName,
	});
	await store.ready();
	indexedDB.seedRecord(databaseName, 'mediaAssets', legacyBlobRecord(sourceId, new Blob([bytes]), {
		storage: 'opfs',
		path,
		blob: undefined,
	}));

	const winner = store.loadMediaAsset(sourceId);
	await gates[0].started.promise;
	const controller = new AbortController();
	const loser = store.loadMediaAsset(sourceId, { signal: controller.signal });
	await gates[1].started.promise;
	gates[0].released.resolve();
	assert.ok(await winner);

	const reason = new Error('cancel concurrent digest loser');
	indexedDB.onNextGetForStore('mediaAssets', () => controller.abort(reason));
	gates[1].released.resolve();
	await assert.rejects(loser, (error: unknown) => error === reason);
	const [retained] = indexedDB.records(databaseName, 'mediaAssets') as Record<string, unknown>[];
	assertTrustedInternalRecord(retained, digest(bytes));
});

test('legacy digest publication preserves concurrent project-retention publication', async () => {
	const bytes = Uint8Array.of(0x20, 0x26);
	const fixture = await legacyOpfsFixture('media-digest-retention-publication', bytes);
	fixture.indexedDB.seedRecord(fixture.databaseName, 'mediaAssets', {
		...fixture.internalRecord(),
		pendingProjectUntil: '2026-07-29T00:00:00.000Z',
	});
	const loading = fixture.store.loadMediaAsset(fixture.sourceId);
	await requirePayloadLoadStart(fixture.payloadLoadStarted, loading);

	await fixture.store.saveProject({
		id: 'digest-retention-project',
		revision: 1,
		sources: [{ id: fixture.sourceId }],
		clips: [{ id: 'digest-retention-clip', sourceId: fixture.sourceId }],
	});
	assert.equal(fixture.internalRecord().pendingProjectUntil, undefined);
	fixture.releasePayloadLoad();

	assert.ok(await loading);
	assert.equal(fixture.internalRecord().pendingProjectUntil, undefined);
	assertTrustedInternalRecord(fixture.internalRecord(), digest(bytes));
});

test('a stalled legacy load cannot overwrite a same-shaped trusted replacement with a new token', async () => {
	const staleBytes = Uint8Array.of(0x01, 0x02);
	const fixture = await legacyOpfsFixture('media-digest-stale-cas', staleBytes);
	const staleLoad = fixture.store.loadMediaAsset(fixture.sourceId);
	await requirePayloadLoadStart(fixture.payloadLoadStarted, staleLoad);

	const replacementToken = 'media-content-trusted-replacement-token';
	fixture.indexedDB.seedRecord(fixture.databaseName, 'mediaAssets', {
		...legacyBlobRecord(fixture.sourceId, new Blob([staleBytes], { type: 'video/mp4' }), {
			storage: 'opfs',
			path: `${fixture.sourceId}.blob`,
			blob: undefined,
		}),
		sha256: digest(staleBytes),
		mediaContentDigestVersion: VERIFIED_DIGEST_VERSION,
		mediaContentToken: replacementToken,
	});
	fixture.releasePayloadLoad();
	await assert.rejects(staleLoad, /media asset changed while its digest was being verified/iu);

	const retained = fixture.internalRecord();
	assertTrustedInternalRecord(retained, digest(staleBytes));
	assert.equal(retained.mediaContentToken, replacementToken);
	const current = await fixture.store.loadMediaAsset(fixture.sourceId);
	assert.ok(current);
	assert.deepEqual(new Uint8Array(await current.arrayBuffer()), staleBytes);
});

test('a memory backfill rejects a same-Blob trusted replacement with a new token', async () => {
	const sourceId = 'media-digest-memory-token-cas';
	const bytes = new Uint8Array(MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 1).fill(0x7b);
	const expectedSha256 = digest(bytes);
	const blob = new Blob([bytes], { type: 'video/mp4' });
	const store = memoryStore(sourceId);
	store.memory.mediaAssets.set(sourceId, legacyBlobRecord(sourceId, blob));
	const staleLoad = store.loadMediaAsset(sourceId);
	const claimed = await waitForMemoryDigestClaim(store, sourceId);
	const replacementToken = 'media-content-memory-replacement-token-0001';
	store.memory.mediaAssets.set(sourceId, {
		...claimed,
		sha256: expectedSha256,
		mediaContentDigestVersion: VERIFIED_DIGEST_VERSION,
		mediaContentToken: replacementToken,
	});

	await assert.rejects(staleLoad, /media asset changed while its digest was being verified/iu);
	const retained = internalMemoryRecord(store, sourceId);
	assert.equal(retained.blob, blob);
	assert.equal(retained.mediaContentToken, replacementToken);
	assertTrustedInternalRecord(retained, expectedSha256);
});

test('legacy backfill rejects declared-size drift without publishing trust', async () => {
	const store = memoryStore('media-digest-size-drift');
	const sourceId = 'legacy-size-drift';
	const bytes = Uint8Array.of(1, 2, 3);
	store.memory.mediaAssets.set(sourceId, legacyBlobRecord(sourceId, new Blob([bytes]), {
		size: bytes.byteLength + 1,
	}));

	await assert.rejects(store.loadMediaAsset(sourceId), /media asset is missing|size/iu);
	assert.notEqual(internalMemoryRecord(store, sourceId).mediaContentDigestVersion, VERIFIED_DIGEST_VERSION);
	assertUntrustedPublicMetadata(await store.getMediaAssetMetadata(sourceId));
});

test('a failed final digest publication leaves a retryable unverified claim', async () => {
	const bytes = Uint8Array.of(9, 2, 6);
	const fixture = await legacyOpfsFixture('media-digest-final-put', bytes);
	const publicationError = new Error('planned digest publication failure');
	const loading = fixture.store.loadMediaAsset(fixture.sourceId);
	await requirePayloadLoadStart(fixture.payloadLoadStarted, loading);
	fixture.indexedDB.failNextPutForStore('mediaAssets', publicationError);
	fixture.releasePayloadLoad();

	await assert.rejects(loading, (error: unknown) => error === publicationError);
	assert.equal(fixture.internalRecord().mediaContentDigestVersion, 0);
	assertUntrustedPublicMetadata(await fixture.store.getMediaAssetMetadata(fixture.sourceId));

	const retry = await fixture.store.loadMediaAsset(fixture.sourceId);
	assert.ok(retry);
	assertTrustedInternalRecord(fixture.internalRecord(), digest(bytes));
});

function assertTrustedInternalRecord(record: Record<string, unknown>, expectedSha256: string): void {
	assert.equal(record.sha256, expectedSha256);
	assert.equal(record.mediaContentDigestVersion, VERIFIED_DIGEST_VERSION);
	assert.equal(typeof record.mediaContentToken, 'string');
	assert.match(String(record.mediaContentToken), /^media-content-[a-z0-9][a-z0-9-]{15,127}$/u);
}

function assertTrustedPublicMetadata(metadata: Record<string, unknown> | null, expectedSha256: string): void {
	assert.ok(metadata);
	assert.equal(metadata.sha256, expectedSha256);
	assert.equal('mediaContentDigestVersion' in metadata, false);
	assert.equal('mediaContentToken' in metadata, false);
}

function assertUntrustedPublicMetadata(metadata: Record<string, unknown> | null): void {
	assert.ok(metadata);
	assert.equal('sha256' in metadata, false);
	assert.equal('mediaContentDigestVersion' in metadata, false);
	assert.equal('mediaContentToken' in metadata, false);
}

function internalMemoryRecord(
	store: ReturnType<typeof memoryStore>,
	sourceId: string,
): Record<string, unknown> {
	const record = store.memory.mediaAssets.get(sourceId);
	assert.ok(record);
	return record as Record<string, unknown>;
}

function legacyBlobRecord(
	sourceId: string,
	blob: Blob,
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		sourceId,
		storage: 'indexeddb-blob',
		blob,
		size: blob.size,
		mimeType: 'video/mp4',
		name: `${sourceId}.mp4`,
		sha256: '0'.repeat(64),
		...overrides,
	};
}

function legacyChunkedRecord(sourceId: string, token: string, bytes: Uint8Array): Record<string, unknown> {
	return {
		sourceId,
		storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE,
		mediaChunkToken: token,
		mediaChunkBytes: MEDIA_ASSET_STREAM_CHUNK_BYTES,
		mediaChunkCount: 1,
		size: bytes.byteLength,
		mimeType: 'video/mp4',
		sha256: '0'.repeat(64),
	};
}

function mediaChunk(sourceId: string, token: string, bytes: Uint8Array): Record<string, unknown> {
	return {
		key: chunkKey(token, 0),
		sourceId,
		mediaChunkToken: token,
		index: 0,
		payload: new Blob([exactArrayBuffer(bytes)]),
		byteLength: bytes.byteLength,
		createdAt: Date.now(),
	};
}

function chunkKey(token: string, index: number): string {
	return `${token}:${String(index).padStart(10, '0')}`;
}

function memoryStore(prefix: string) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName(prefix),
	});
}

async function legacyOpfsFixture(prefix: string, bytes: Uint8Array) {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueDatabaseName(prefix);
	const sourceId = `${prefix}-source`;
	const path = `${sourceId}.blob`;
	const blob = new Blob([exactArrayBuffer(bytes)], { type: 'video/mp4' });
	const files = new Map<string, Blob>([[path, blob]]);
	const payloadLoadStarted = deferred();
	const payloadLoadReleased = deferred();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot: createOpfsDirectory(files, [{
			started: payloadLoadStarted,
			released: payloadLoadReleased,
		}]),
		databaseName,
	});
	await store.ready();
	indexedDB.seedRecord(databaseName, 'mediaAssets', legacyBlobRecord(sourceId, blob, {
		storage: 'opfs',
		path,
		blob: undefined,
	}));
	return {
		store,
		indexedDB,
		databaseName,
		sourceId,
		payloadLoadStarted: payloadLoadStarted.promise,
		releasePayloadLoad(): void { payloadLoadReleased.resolve(); },
		internalRecord(): Record<string, unknown> {
			const [record] = indexedDB.records(databaseName, 'mediaAssets') as Record<string, unknown>[];
			assert.ok(record);
			return record;
		},
	};
}

function createOpfsDirectory(
	files: Map<string, Blob>,
	gates: readonly OpfsLoadGate[] = [],
): FileSystemDirectoryHandle {
	let loadIndex = 0;
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string) {
			const blob = files.get(path);
			if (!blob) throw new Error('missing');
			return {
				async getFile() {
					const gate = gates[loadIndex];
					loadIndex += 1;
					gate?.started.resolve();
					await gate?.released.promise;
					return blob;
				},
			};
		},
		async removeEntry(path: string) { files.delete(path); },
	};
	return directory as unknown as FileSystemDirectoryHandle;
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}

interface OpfsLoadGate {
	readonly started: Deferred<void>;
	readonly released: Deferred<void>;
}

function opfsLoadGate(): OpfsLoadGate {
	return { started: deferred(), released: deferred() };
}

function deferred(): Deferred<void> {
	let resolve!: Deferred<void>['resolve'];
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}

async function requirePayloadLoadStart(started: Promise<void>, loading: Promise<unknown>): Promise<void> {
	await Promise.race([
		started,
		loading.then(() => { throw new Error('Legacy load settled without reading stored media.'); }),
	]);
}

async function waitForMemoryDigestClaim(
	store: ReturnType<typeof memoryStore>,
	sourceId: string,
): Promise<Record<string, unknown>> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const record = internalMemoryRecord(store, sourceId);
		if (record.mediaContentDigestVersion === 0) return record;
		await Promise.resolve();
	}
	throw new Error('Memory media digest claim was not installed.');
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
