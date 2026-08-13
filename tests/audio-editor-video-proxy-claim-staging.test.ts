/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import {
	MEDIA_ASSET_CHUNK_STORAGE_TYPE,
	MEDIA_ASSET_CHUNK_STORE_NAME,
} from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { mediaAssetChunkKey } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimStagingRepository,
} from '../src/common/editor/storage/video-proxy-claim-staging-repository.ts';
import { normalizeVideoProxyClaimRecord } from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const OPERATION_ID = 'proxy-stage-operation-0001';
const PROJECT_ID = 'framescaper-v18-project';
const SOURCE_ID = 'video-source';
const BASE_FINGERPRINT = 'a'.repeat(64);
const NOW = 1_786_550_400_000;

test('an exact IndexedDB chunk body becomes one verified generation-fenced claim', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(1, 2, 3, 4, 5);
	const row = await seedChunkBody(fixture, 'proxy', bytes);

	const claim = await fixture.staging.createVerifiedClaim(inputFor(row, 'proxy'));

	assert.deepEqual(claim, normalizeVideoProxyClaimRecord(claim));
	assert.equal(claim.status, 'verified');
	assert.equal(claim.rowIdentity.storage, MEDIA_ASSET_CHUNK_STORAGE_TYPE);
	assert.equal(claim.rowIdentity.mediaChunkToken, row.mediaChunkToken);
	assert.equal(claim.rowIdentity.path, null);
	assert.equal(claim.rowIdentity.sha256, row.sha256);
	assert.equal(Object.isFrozen(claim), true);
	assert.equal(Object.isFrozen(claim.rowIdentity), true);
	assert.deepEqual(await claims(fixture.database), [claim]);
	assert.equal(fixture.port.memory.mediaAssets.size, 0);
	assert.equal(fixture.port.memory.mediaAssetChunks.size, 0);
});

test('OPFS verification hashes bounded slices and retains the exact private path identity', async (context) => {
	const files = new Map<string, Blob>();
	const fixture = await createFixture(context, { files });
	const bytes = new Uint8Array(4 * 1024 * 1024 + 17).fill(0x4f);
	const row = await seedOpfsBody(fixture, 'proxy', bytes);

	const claim = await fixture.staging.createVerifiedClaim(inputFor(row, 'proxy'));

	assert.equal(claim.rowIdentity.storage, 'opfs');
	assert.equal(claim.rowIdentity.path, row.path);
	assert.equal(claim.rowIdentity.mediaChunkToken, null);
	assert.equal(claim.rowIdentity.byteLength, bytes.byteLength);
});

test('digest corruption releases only the operation claim and leaves the occupied body untouched', async (context) => {
	const fixture = await createFixture(context);
	const expected = Uint8Array.of(1, 2, 3);
	const actual = Uint8Array.of(1, 2, 4);
	const row = await seedChunkBody(fixture, 'proxy', actual, digest(expected));

	await assert.rejects(fixture.staging.createVerifiedClaim(inputFor(row, 'proxy')), /digest|verification/iu);
	assert.deepEqual(await claims(fixture.database), []);
	assert.deepEqual(await mediaRow(fixture.database, String(row.sourceId)), row);
	assert.equal(await chunkCount(fixture.database), 1);
});

test('a media-row race invalidates the generation claim after body hashing', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(8, 9, 10);
	const row = await seedChunkBody(fixture, 'proxy', bytes);
	fixture.indexedDB.onNextGetForStore(MEDIA_ASSET_CHUNK_STORE_NAME, () => {
		fixture.indexedDB.seedRecord(fixture.databaseName, 'mediaAssets', {
			...row,
			mediaContentToken: 'media-content-replacement-000000000001',
		});
	});

	await assert.rejects(fixture.staging.createVerifiedClaim(inputFor(row, 'proxy')), /changed|generation|current/iu);
	assert.deepEqual(await claims(fixture.database), []);
	assert.equal(
		(await mediaRow(fixture.database, String(row.sourceId)) as Record<string, unknown>).mediaContentToken,
		'media-content-replacement-000000000001',
	);
});

test('claim admission validates the complete bounded inventory before body reads', async (context) => {
	const fixture = await createFixture(context, { maximumClaims: 2 });
	const bytes = Uint8Array.of(3, 2, 1);
	const row = await seedChunkBody(fixture, 'proxy', bytes);
	await transact(fixture.database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', ({ mediaAssetStaging }) => {
		mediaAssetStaging.put({ key: 'malformed-claim', kind: 'video-proxy-claim' });
	});
	await assert.rejects(fixture.staging.createVerifiedClaim(inputFor(row, 'proxy')), /inventory|malformed|claim/iu);

	await transact(fixture.database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', ({ mediaAssetStaging }) => {
		mediaAssetStaging.delete('malformed-claim');
		for (const index of [0, 1]) {
			mediaAssetStaging.put(existingClaim(index));
		}
	});
	await assert.rejects(fixture.staging.createVerifiedClaim(inputFor(row, 'proxy')), /100,000|limit|inventory/iu);
	assert.deepEqual((await claims(fixture.database)).map((claim) => claim.key), [
		existingClaim(0).key,
		existingClaim(1).key,
	]);
});

test('timing claims require their canonical role, MIME, size, and content address', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(0x53, 0x43, 0x54, 0x49);
	const row = await seedChunkBody(fixture, 'timing', bytes);
	const claim = await fixture.staging.createVerifiedClaim(inputFor(row, 'timing'));
	assert.equal(claim.rowIdentity.kind, 'video-timing');
	assert.equal(claim.rowIdentity.encoding, 'soundscaper-video-timing-v1');
	assert.equal(claim.rowIdentity.mimeType, 'application/vnd.soundscaper.video-timing');

	const proxyRequest = inputFor(row, 'timing');
	await assert.rejects(fixture.staging.createVerifiedClaim({
		...proxyRequest,
		mimeType: 'video/mp4',
	}), /MIME|timing/iu);
});

test('production claim staging hard-stops before degraded memory or OPFS access', async () => {
	let memoryReads = 0;
	let opfsReads = 0;
	const memory = new Proxy(getMemoryDatabase(uniqueName('claim-staging-memory')), {
		get(target, property, receiver) {
			memoryReads += 1;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
	const opfs = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: {
			async getDirectoryHandle() { opfsReads += 1; throw new Error('OPFS accessed'); },
		} as unknown as FileSystemDirectoryHandle,
	});
	const staging = new VideoProxyClaimStagingRepository(
		{ memory, database: async () => null },
		opfs,
	);
	await assert.rejects(staging.createVerifiedClaim({
		operationId: OPERATION_ID,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: BASE_FINGERPRINT,
		bodyKind: 'proxy',
		bodyKey: `video-proxy-sha256:${'b'.repeat(64)}`,
		byteLength: 3,
		mimeType: 'video/mp4',
	}), /durable.*required|memory.*unsupported/iu);
	assert.equal(memoryReads, 0);
	assert.equal(opfsReads, 0);
});

interface InstrumentedIndexedDB extends IDBFactory {
	onNextGetForStore(storeName: string, observer: () => void): void;
	seedRecord(databaseName: string, storeName: string, value: unknown, primaryKey?: IDBValidKey): void;
}

interface Fixture {
	readonly databaseName: string;
	readonly database: IDBDatabase;
	readonly indexedDB: InstrumentedIndexedDB;
	readonly port: StorageRepositoryPort;
	readonly staging: VideoProxyClaimStagingRepository;
	readonly files: Map<string, Blob>;
}

async function createFixture(
	context: TestContext,
	options: Readonly<{ files?: Map<string, Blob>; maximumClaims?: number }> = {},
): Promise<Fixture> {
	const databaseName = uniqueName('proxy-claim-staging');
	const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
	const database = await openDatabase(indexedDB, databaseName);
	context.after(() => database.close());
	const port: StorageRepositoryPort = {
		memory: getMemoryDatabase(databaseName),
		database: async () => database,
	};
	const files = options.files ?? new Map<string, Blob>();
	const opfs = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: opfsRoot(files),
	});
	return {
		databaseName,
		database,
		indexedDB,
		port,
		files,
		staging: new VideoProxyClaimStagingRepository(port, opfs, {
			now: () => NOW,
			maximumClaims: options.maximumClaims,
			createGeneration: () => 'proxy-claim-generation-0001',
		}),
	};
}

async function seedChunkBody(
	fixture: Fixture,
	bodyKind: 'proxy' | 'timing',
	bytes: Uint8Array,
	expectedDigest = digest(bytes),
): Promise<Record<string, unknown>> {
	const bodyKey = `${bodyKind === 'proxy' ? 'video-proxy' : 'video-timing'}-sha256:${expectedDigest}`;
	const token = `media-chunk-${bodyKind}-0000000000000001`;
	const row = bodyRow(bodyKind, bodyKey, expectedDigest, bytes.byteLength, {
		storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE,
		mediaChunkToken: token,
		mediaChunkBytes: 4 * 1024 * 1024,
		mediaChunkCount: 1,
	});
	await transact(fixture.database, ['mediaAssets', MEDIA_ASSET_CHUNK_STORE_NAME], 'readwrite', (stores) => {
		stores.mediaAssets.put(row);
		stores[MEDIA_ASSET_CHUNK_STORE_NAME].put({
			key: mediaAssetChunkKey(token, 0),
			sourceId: bodyKey,
			mediaChunkToken: token,
			index: 0,
			payload: new Blob([bytes]),
			byteLength: bytes.byteLength,
			createdAt: NOW,
		});
	});
	return row;
}

async function seedOpfsBody(
	fixture: Fixture,
	bodyKind: 'proxy' | 'timing',
	bytes: Uint8Array,
): Promise<Record<string, unknown>> {
	const sha256 = digest(bytes);
	const bodyKey = `${bodyKind === 'proxy' ? 'video-proxy' : 'video-timing'}-sha256:${sha256}`;
	const path = `${bodyKind}-${sha256}.bin`;
	fixture.files.set(path, new Blob([bytes]));
	const row = bodyRow(bodyKind, bodyKey, sha256, bytes.byteLength, { storage: 'opfs', path });
	await transact(fixture.database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => {
		mediaAssets.put(row);
	});
	return row;
}

function bodyRow(
	bodyKind: 'proxy' | 'timing',
	bodyKey: string,
	sha256: string,
	byteLength: number,
	physical: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return {
		sourceId: bodyKey,
		kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
		...(bodyKind === 'proxy' ? { encoding: 'video-proxy-v1' } : {}),
		...physical,
		mediaContentDigestVersion: 1,
		mediaContentToken: `media-content-${bodyKind}-0000000000000001`,
		sha256,
		size: byteLength,
		mimeType: bodyKind === 'proxy' ? 'video/mp4' : 'application/vnd.soundscaper.video-timing',
		committedAt: '2026-08-13T00:00:00.000Z',
		pendingProjectUntil: '2026-08-14T00:00:00.000Z',
	};
}

function inputFor(row: Readonly<Record<string, unknown>>, bodyKind: 'proxy' | 'timing') {
	return {
		operationId: OPERATION_ID,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: BASE_FINGERPRINT,
		bodyKind,
		bodyKey: String(row.sourceId),
		byteLength: Number(row.size),
		mimeType: String(row.mimeType),
	};
}

function existingClaim(index: number) {
	const digestValue = index.toString(16).padStart(64, '0');
	const bodyKey = `video-proxy-sha256:${digestValue}`;
	return {
		key: `video-proxy-claim:existing-operation-${String(index)}:proxy:${bodyKey}`,
		kind: 'video-proxy-claim', schemaVersion: 1, status: 'verified',
		operationId: `existing-operation-${String(index)}`, projectId: PROJECT_ID,
		sourceId: SOURCE_ID, baseFingerprint: BASE_FINGERPRINT, bodyKind: 'proxy', bodyKey,
		generation: `existing-generation-${String(index)}`, createdAt: NOW - 10,
		updatedAt: NOW - 5, expiresAt: NOW + 10_000,
		rowIdentity: {
			sourceId: bodyKey, kind: 'video-proxy', encoding: 'video-proxy-v1',
			storage: 'opfs', path: `proxy-${String(index)}.bin`, mediaChunkToken: null,
			mediaContentDigestVersion: 1,
			mediaContentToken: `media-content-existing-${String(index).padStart(16, '0')}`,
			sha256: digestValue, byteLength: 1, mimeType: 'video/mp4',
		},
	};
}

function claims(database: IDBDatabase): Promise<Record<string, unknown>[]> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', async ({ mediaAssetStaging }) => (
		(await request(mediaAssetStaging.index('kind').getAll('video-proxy-claim'))) as Record<string, unknown>[]
	));
}

function mediaRow(database: IDBDatabase, sourceId: string): Promise<unknown> {
	return transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.get(sourceId)));
}

function chunkCount(database: IDBDatabase): Promise<number> {
	return transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readonly', (stores) => (
		request(stores[MEDIA_ASSET_CHUNK_STORE_NAME].count())
	));
}

function opfsRoot(files: Map<string, Blob>): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string) {
			const file = files.get(path);
			if (!file) throw new Error('missing');
			return { async getFile() { return file; } };
		},
		async removeEntry(path: string) { files.delete(path); },
	};
	return directory as unknown as FileSystemDirectoryHandle;
}

function digest(bytes: Uint8Array): string {
	return bytesToHex(sha256(bytes));
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
