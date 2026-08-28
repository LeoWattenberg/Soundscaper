/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_CHUNK_STORE_NAME } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import type {
	VideoProxyClaimedMediaAssetWriter,
} from '../src/common/editor/storage/media-asset-write-contract.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import {
	VideoProxyClaimStagingRepository,
} from '../src/common/editor/storage/video-proxy-claim-staging-repository.ts';
import {
	createFramescaperEditorProjectEnvironment,
	type FramescaperEditorProjectEnvironment,
} from '../src/framescaper/editor-project-environment.ts';
import { framescaperProjectStoreAuthority } from '../src/framescaper/editor-project-store.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROFILE = FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE;
const OPERATION_ID = 'atomic-new-body-operation';
const PROJECT_ID = 'atomic-new-body-project';
const SOURCE_ID = 'original-video-source';
const BASE_FINGERPRINT = 'a'.repeat(64);

test('a new proxy row and its unverified claim publish in one durable transaction', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(1, 3, 5, 7, 9);
	const bodyKey = `video-proxy-sha256:${digest(bytes)}`;
	const writer = await newBodyWriter(fixture.environment, bodyKey, bytes);

	const publication = await writer.commitVideoProxyClaim(claimInput(bodyKey, bytes.byteLength));

	assert.equal(publication.claim.status, 'unverified');
	assert.equal(publication.claim.bodyKey, bodyKey);
	assert.equal(publication.metadata.sourceId, bodyKey);
	assert.equal('mediaContentToken' in publication.metadata, false);
	const database = await fixture.authority.port.database();
	assert.ok(database);
	assert.ok(await mediaRow(database, bodyKey));
	assert.deepEqual(await claims(database), [publication.claim]);

	const staging = new VideoProxyClaimStagingRepository(fixture.authority.port, fixture.authority.opfs!);
	const verified = await staging.verifyNewBodyClaim(publication.claim);
	assert.equal(verified.status, 'verified');
	await assert.rejects(
		staging.releaseVerifiedClaimIfCurrent(verified),
		/foreign or already released/iu,
	);
	assert.deepEqual(await claims(database), [verified]);
});

test('a failed claim put rolls back the new media row and its staged chunks', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(2, 4, 6, 8);
	const bodyKey = `video-proxy-sha256:${digest(bytes)}`;
	const writer = await newBodyWriter(fixture.environment, bodyKey, bytes);
	fixture.indexedDB.failNextPutForStore(
		MEDIA_ASSET_STAGING_STORE_NAME,
		new Error('planned atomic claim put failure'),
	);

	await assert.rejects(
		writer.commitVideoProxyClaim(claimInput(bodyKey, bytes.byteLength)),
		/planned atomic claim put failure/iu,
	);

	const database = await fixture.authority.port.database();
	assert.ok(database);
	assert.equal(await mediaRow(database, bodyKey), undefined);
	assert.deepEqual(await claims(database), []);
	assert.equal(await recordCount(database, MEDIA_ASSET_CHUNK_STORE_NAME), 0);
});

test('a stale claim root reserves its missing body key against a new generation', async (context) => {
	const fixture = await createFixture(context);
	const bytes = Uint8Array.of(3, 1, 4, 1, 5);
	const bodyKey = `video-proxy-sha256:${digest(bytes)}`;
	const first = await newBodyWriter(fixture.environment, bodyKey, bytes);
	const rooted = await first.commitVideoProxyClaim(claimInput(bodyKey, bytes.byteLength));
	const database = await fixture.authority.port.database();
	assert.ok(database);
	await transact(
		database,
		['mediaAssets', MEDIA_ASSET_CHUNK_STORE_NAME],
		'readwrite',
		async ({ mediaAssets, mediaAssetChunks }) => {
			await request(mediaAssets.delete(bodyKey));
			await request(mediaAssetChunks.clear());
		},
	);

	const replacement = await newBodyWriter(fixture.environment, bodyKey, bytes);
	await assert.rejects(
		replacement.commitVideoProxyClaim(claimInput(
			bodyKey,
			bytes.byteLength,
			'atomic-new-body-replacement-operation',
		)),
		/already has a durable claim root/iu,
	);

	assert.equal(await mediaRow(database, bodyKey), undefined);
	assert.deepEqual(await claims(database), [rooted.claim]);
	assert.equal(await recordCount(database, MEDIA_ASSET_CHUNK_STORE_NAME), 0);
});

interface InstrumentedIndexedDB extends IDBFactory {
	failNextPutForStore(storeName: string, error?: Error): void;
}

interface Fixture {
	readonly environment: Readonly<FramescaperEditorProjectEnvironment>;
	readonly indexedDB: InstrumentedIndexedDB;
	readonly authority: ReturnType<typeof framescaperProjectStoreAuthority>;
}

async function createFixture(context: TestContext): Promise<Fixture> {
	const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
	const environment = await createFramescaperEditorProjectEnvironment({
		storeOptions: {
			indexedDB,
			preferOpfs: false,
			storageManager: persistentStorage(),
		},
	});
	context.after(() => environment.close());
	return {
		environment,
		indexedDB,
		authority: framescaperProjectStoreAuthority(PROFILE, environment.store),
	};
}

async function newBodyWriter(
	environment: Readonly<FramescaperEditorProjectEnvironment>,
	bodyKey: string,
	bytes: Uint8Array,
): Promise<VideoProxyClaimedMediaAssetWriter> {
	const writer = await environment.store.beginMediaAssetWrite(bodyKey, {
		name: bodyKey,
		kind: 'video-proxy',
		encoding: 'video-proxy-v1',
		mimeType: 'video/mp4',
	}, {
		expectedBytes: bytes.byteLength,
		expectedSha256: digest(bytes),
	});
	await writer.write(bytes);
	return writer as VideoProxyClaimedMediaAssetWriter;
}

function claimInput(bodyKey: string, byteLength: number, operationId = OPERATION_ID) {
	return {
		operationId,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: BASE_FINGERPRINT,
		bodyKind: 'proxy' as const,
		bodyKey,
		byteLength,
		mimeType: 'video/mp4',
	};
}

function claims(database: IDBDatabase): Promise<unknown[]> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', ({ mediaAssetStaging }) => (
		request(mediaAssetStaging.index('kind').getAll('video-proxy-claim'))
	));
}

function mediaRow(database: IDBDatabase, bodyKey: string): Promise<unknown> {
	return transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.get(bodyKey)));
}

function recordCount(database: IDBDatabase, storeName: string): Promise<number> {
	return transact(database, storeName, 'readonly', (stores) => request(stores[storeName].count()));
}

function digest(bytes: Uint8Array): string {
	return bytesToHex(sha256(bytes));
}

function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true,
		persist: async () => true,
	} as unknown as StorageManager;
}
