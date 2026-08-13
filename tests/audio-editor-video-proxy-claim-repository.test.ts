/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimRepository,
	type VideoProxyClaimRecord,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROJECT_ID = 'framescaper-v18-project';
const SOURCE_ID = 'video-source';
const OPERATION_ID = 'proxy-operation-0001';
const BASE_FINGERPRINT = 'a'.repeat(64);
const PROXY_DIGEST = 'b'.repeat(64);
const TIMING_DIGEST = 'c'.repeat(64);

test('durable repository authenticates and consumes one exact verified claim pair', async (context) => {
	const fixture = await createFixture(context);
	const proxy = claim('proxy', `video-proxy-sha256:${PROXY_DIGEST}`, PROXY_DIGEST);
	const timing = claim('timing', `video-timing-sha256:${TIMING_DIGEST}`, TIMING_DIGEST);
	await seedClaims(fixture.database, proxy, timing);

	const plan = await fixture.repository.preparePreservationPlan({
		operationId: OPERATION_ID,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: BASE_FINGERPRINT,
		proxyClaimKey: proxy.key,
		timingClaimKey: timing.key,
	});
	assert.deepEqual(Reflect.ownKeys(plan), []);
	assert.equal(Object.getPrototypeOf(plan), null);
	assert.equal(Object.isFrozen(plan), true);

	const consumed = await transact(
		fixture.database,
		MEDIA_ASSET_STAGING_STORE_NAME,
		'readwrite',
		({ mediaAssetStaging }) => fixture.repository.consumePreservationPlan(plan, mediaAssetStaging),
	);
	assert.deepEqual(consumed, { proxy, timing });
	assert.equal(Object.isFrozen(consumed), true);
	assert.equal(Object.isFrozen(consumed.proxy.rowIdentity), true);
	assert.deepEqual(await storedClaims(fixture.database, proxy.key, timing.key), [undefined, undefined]);
	await assert.rejects(
		transact(
			fixture.database,
			MEDIA_ASSET_STAGING_STORE_NAME,
			'readwrite',
			({ mediaAssetStaging }) => fixture.repository.consumePreservationPlan(plan, mediaAssetStaging),
		),
		/plan.*authentic|already.*consumed/iu,
	);
});

test('a plan is bound to its repository, database, exact rows, and transaction store', async (context) => {
	const fixture = await createFixture(context);
	const other = await createFixture(context);
	const proxy = claim('proxy', `video-proxy-sha256:${PROXY_DIGEST}`, PROXY_DIGEST);
	const timing = claim('timing', `video-timing-sha256:${TIMING_DIGEST}`, TIMING_DIGEST);
	await seedClaims(fixture.database, proxy, timing);
	const plan = await fixture.repository.preparePreservationPlan(planRequest(proxy, timing));

	await assert.rejects(
		transact(
			other.database,
			MEDIA_ASSET_STAGING_STORE_NAME,
			'readwrite',
			({ mediaAssetStaging }) => other.repository.consumePreservationPlan(plan, mediaAssetStaging),
		),
		/authentic/iu,
	);
	await transact(fixture.database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', async ({ mediaAssetStaging }) => {
		mediaAssetStaging.put({ ...proxy, expiresAt: proxy.expiresAt + 1 });
	});
	await assert.rejects(
		transact(
			fixture.database,
			MEDIA_ASSET_STAGING_STORE_NAME,
			'readwrite',
			({ mediaAssetStaging }) => fixture.repository.consumePreservationPlan(plan, mediaAssetStaging),
		),
		/changed|current/iu,
	);
	assert.deepEqual(await storedClaims(fixture.database, proxy.key, timing.key), [
		{ ...proxy, expiresAt: proxy.expiresAt + 1 },
		timing,
	]);
});

test('preparation refuses incomplete, unverified, mixed, and malformed claim pairs', async (context) => {
	const fixture = await createFixture(context);
	const proxy = claim('proxy', `video-proxy-sha256:${PROXY_DIGEST}`, PROXY_DIGEST);
	const timing = claim('timing', `video-timing-sha256:${TIMING_DIGEST}`, TIMING_DIGEST);

	for (const changed of [
		{ ...timing, status: 'provisional' },
		{ ...timing, operationId: 'other-operation-0001' },
		{ ...timing, sourceId: 'other-source' },
		{ ...timing, rowIdentity: { ...timing.rowIdentity, extra: true } },
	]) {
		await seedClaims(fixture.database, proxy, changed);
		await assert.rejects(fixture.repository.preparePreservationPlan(planRequest(proxy, timing)));
	}
	await transact(fixture.database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', ({ mediaAssetStaging }) => {
		mediaAssetStaging.delete(timing.key);
	});
	await assert.rejects(fixture.repository.preparePreservationPlan(planRequest(proxy, timing)), /missing/iu);
});

test('production preservation hard-stops on degraded memory storage before claim access', async () => {
	let memoryReads = 0;
	const memory = new Proxy(getMemoryDatabase(uniqueName('proxy-claims-memory')), {
		get(target, property, receiver) {
			memoryReads += 1;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
	const repository = new VideoProxyClaimRepository({ memory, database: async () => null });
	await assert.rejects(repository.preparePreservationPlan({
		operationId: OPERATION_ID,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: BASE_FINGERPRINT,
		proxyClaimKey: 'video-proxy-claim:proxy',
		timingClaimKey: 'video-proxy-claim:timing',
	}), /durable.*required|memory.*unsupported/iu);
	assert.equal(memoryReads, 0);
});

interface Fixture {
	readonly database: IDBDatabase;
	readonly repository: VideoProxyClaimRepository;
}

async function createFixture(context: TestContext): Promise<Fixture> {
	const databaseName = uniqueName('proxy-claims');
	const database = await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, databaseName);
	context.after(() => database.close());
	const port: StorageRepositoryPort = {
		memory: getMemoryDatabase(databaseName),
		database: async () => database,
	};
	return { database, repository: new VideoProxyClaimRepository(port) };
}

function claim(
	bodyKind: 'proxy' | 'timing',
	bodyKey: string,
	sha256: string,
): VideoProxyClaimRecord {
	const encoding = bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1';
	const mimeType = bodyKind === 'proxy'
		? 'video/mp4'
		: 'application/vnd.soundscaper.video-timing';
	return {
		key: `video-proxy-claim:${OPERATION_ID}:${bodyKind}`,
		kind: 'video-proxy-claim',
		schemaVersion: 1,
		status: 'verified',
		operationId: OPERATION_ID,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: BASE_FINGERPRINT,
		bodyKind,
		bodyKey,
		generation: 'proxy-generation-0001',
		createdAt: 1_786_550_400_000,
		updatedAt: 1_786_550_400_100,
		expiresAt: 1_786_636_800_000,
		rowIdentity: {
			sourceId: bodyKey,
			kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
			encoding,
			storage: 'opfs',
			path: `proxy/${bodyKind}-${sha256}.bin`,
			mediaChunkToken: null,
			mediaContentDigestVersion: 1,
			mediaContentToken: `media-content-${bodyKind}-0000000000000001`,
			sha256,
			byteLength: bodyKind === 'proxy' ? 4096 : 64,
			mimeType,
		},
	};
}

function planRequest(proxy: VideoProxyClaimRecord, timing: VideoProxyClaimRecord) {
	return {
		operationId: OPERATION_ID,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: BASE_FINGERPRINT,
		proxyClaimKey: proxy.key,
		timingClaimKey: timing.key,
	};
}

function seedClaims(database: IDBDatabase, ...claims: readonly object[]): Promise<void> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', ({ mediaAssetStaging }) => {
		for (const claimRecord of claims) mediaAssetStaging.put(claimRecord);
	});
}

function storedClaims(database: IDBDatabase, ...keys: readonly string[]): Promise<unknown[]> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', ({ mediaAssetStaging }) => (
		Promise.all(keys.map((key) => request(mediaAssetStaging.get(key))))
	));
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
