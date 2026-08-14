/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { transact } from '../src/common/editor/storage/indexeddb-backend.ts';
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
	normalizeVideoProxyCleanupTombstoneRecord,
} from '../src/common/editor/storage/video-proxy-cleanup-tombstone.ts';
import { videoProxyClaimKey } from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
} from '../src/framescaper/editor-project-v18-claim-cleanup-repository.ts';
import { collectFramescaperProjectStorageRootsV18 } from '../src/framescaper/editor-project-v18-retention.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import {
	attachedProject,
	bodyRow,
	chunkCount,
	claim,
	claimForRow,
	clearStaging,
	createClaimCleanupFixture,
	emptyScope,
	mediaRow,
	NOW,
	PROFILE,
	PROJECT_ID,
	PROXY_KEY,
	PROXY_SHA,
	seedBodiesAndClaims,
	seedProject,
	SOURCE_ID,
	stagingRecord,
	TIMING_KEY,
	TIMING_SHA,
	tombstones,
	uniqueName,
} from './helpers/framescaper-v18-claim-cleanup-fixture.ts';

test('cleanup authenticates the exact profile before dependencies and never falls back to memory', async () => {
	let dependencyTraps = 0;
	const dependencies = new Proxy({}, {
		get() { dependencyTraps += 1; throw new Error('dependency getter'); },
		ownKeys() { dependencyTraps += 1; throw new Error('dependency keys'); },
		getOwnPropertyDescriptor() { dependencyTraps += 1; throw new Error('dependency descriptor'); },
	});
	assert.throws(
		() => new FramescaperProjectV18ClaimCleanupRepository({}, dependencies),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.equal(dependencyTraps, 0);

	let memoryReads = 0;
	const memory = new Proxy(getMemoryDatabase(uniqueName('v18-cleanup-memory')), {
		get(target, property, receiver) {
			memoryReads += 1;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
	const port: StorageRepositoryPort = { memory, database: async () => null };
	const repository = new FramescaperProjectV18ClaimCleanupRepository(PROFILE, {
		port,
		opfs: new OpfsRepository({ preferOpfs: false }),
	});
	await assert.rejects(repository.reconcile(emptyScope()), /durable.*required|memory.*unsupported/iu);
	assert.equal(memoryReads, 0);
});

test('startup consumes exact committed claims and promotes both unchanged body rows', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const project = attachedProject();
	const proxy = claim('proxy', PROXY_KEY, PROXY_SHA);
	const timing = claim('timing', TIMING_KEY, TIMING_SHA);
	await seedProject(fixture.database, project);
	await seedBodiesAndClaims(fixture.database, [
		{ row: bodyRow('proxy'), claim: proxy },
		{ row: bodyRow('timing'), claim: timing },
	]);

	const result = await fixture.repository.reconcile(emptyScope());

	assert.equal(result.status, 'settled');
	assert.deepEqual(result.promotedClaimKeys, [proxy.key, timing.key].sort());
	assert.deepEqual(result.cleanedBodyKeys, []);
	assert.deepEqual(result.issues, []);
	for (const item of [proxy, timing]) {
		assert.equal(await stagingRecord(fixture.database, item.key), undefined);
		const row = await mediaRow(fixture.database, item.bodyKey) as Record<string, unknown>;
		assert.equal(Object.hasOwn(row, 'pendingProjectUntil'), false);
	}
});

test('an incomplete or unverified committed claim pair remains indeterminate and rooted', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const project = attachedProject();
	const proxy = { ...claim('proxy', PROXY_KEY, PROXY_SHA), status: 'unverified' as const };
	await seedProject(fixture.database, project);
	await seedBodiesAndClaims(fixture.database, [
		{ row: bodyRow('proxy'), claim: proxy },
		{ row: bodyRow('timing'), claim: claim('timing', TIMING_KEY, TIMING_SHA) },
	]);
	await transact(fixture.database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', ({ mediaAssetStaging }) => {
		mediaAssetStaging.delete(videoProxyClaimKey('cleanup-operation', 'timing', TIMING_KEY));
	});

	const result = await fixture.repository.reconcile(emptyScope());

	assert.equal(result.status, 'indeterminate');
	assert.equal(result.issues.some((issue) => issue.code === 'committed-claim-mismatch'), true);
	assert.deepEqual(await stagingRecord(fixture.database, proxy.key), proxy);
	const row = await mediaRow(fixture.database, PROXY_KEY) as Record<string, unknown>;
	assert.equal(Object.hasOwn(row, 'pendingProjectUntil'), true);
});

test('unrooted IndexedDB generations detach metadata and exact chunks through a restart-safe tombstone', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const item = claim('proxy', PROXY_KEY, PROXY_SHA, 'chunk-cleanup');
	const row = bodyRow('proxy', {
		storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE,
		mediaChunkToken: 'media-chunk-cleanup-000000000001',
		mediaChunkBytes: 4 * 1024 * 1024,
		mediaChunkCount: 1,
	});
	const chunk = {
		key: mediaAssetChunkKey(String(row.mediaChunkToken), 0),
		sourceId: PROXY_KEY,
		mediaChunkToken: row.mediaChunkToken,
		index: 0,
		payload: new Blob([Uint8Array.of(1, 2, 3, 4)]),
		byteLength: 4,
		createdAt: NOW,
	};
	await transact(
		fixture.database,
		['mediaAssets', MEDIA_ASSET_CHUNK_STORE_NAME, MEDIA_ASSET_STAGING_STORE_NAME],
		'readwrite',
		(stores) => {
			stores.mediaAssets.put(row);
			stores[MEDIA_ASSET_CHUNK_STORE_NAME].put(chunk);
			stores[MEDIA_ASSET_STAGING_STORE_NAME].put(claimForRow(item, row));
		},
	);

	const result = await fixture.repository.reconcile(emptyScope());

	assert.equal(result.status, 'settled');
	assert.deepEqual(result.cleanedBodyKeys, [PROXY_KEY]);
	assert.equal(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.equal(await chunkCount(fixture.database), 0);
	assert.deepEqual(await tombstones(fixture.database), []);
	assert.equal(await stagingRecord(fixture.database, item.key), undefined);
});

test('failed OPFS cleanup retains full identity and startup resumes it idempotently', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const item = claim('proxy', PROXY_KEY, PROXY_SHA, 'opfs-cleanup');
	fixture.files.set(String(item.rowIdentity.path), new Blob([Uint8Array.of(1, 2, 3, 4)]));
	fixture.opfsFailures.remaining = 1;
	await seedBodiesAndClaims(fixture.database, [{ row: bodyRow('proxy'), claim: item }]);

	const failed = await fixture.repository.reconcile(emptyScope());

	assert.equal(failed.status, 'indeterminate');
	assert.equal(failed.issues.some((issue) => issue.code === 'physical-cleanup-failed'), true);
	assert.equal(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.equal(await stagingRecord(fixture.database, item.key), undefined);
	const [stored] = await tombstones(fixture.database);
	const tombstone = normalizeVideoProxyCleanupTombstoneRecord(stored);
	assert.equal(tombstone.status, 'cleanup-failed');
	assert.equal(tombstone.failureCount, 1);
	assert.deepEqual(tombstone.claim, item);
	assert.equal(tombstone.path, item.rowIdentity.path);
	assert.equal(fixture.files.has(String(item.rowIdentity.path)), true);
	assert.equal(collectFramescaperProjectStorageRootsV18(PROFILE, {
		currentProject: createFramescaperProjectV18(PROFILE, {
			id: 'cleanup-retention-root', title: 'Cleanup retention root',
			now: '2026-08-13T10:00:00.000Z',
		}),
		retainedRevisions: [], histories: [], pendingSaveSnapshots: [], claims: [tombstone],
	}).includes(PROXY_KEY), true);
	await assert.rejects(fixture.staging.createVerifiedClaim({
		operationId: 'replacement-operation', projectId: PROJECT_ID, sourceId: SOURCE_ID,
		baseFingerprint: 'cd'.repeat(32), bodyKind: 'proxy', bodyKey: PROXY_KEY,
		byteLength: 4, mimeType: 'video/mp4',
	}), /generation.*exists|reserved.*cleanup/iu);

	const resumed = await fixture.repository.reconcile(emptyScope());

	assert.equal(resumed.status, 'settled');
	assert.deepEqual(resumed.cleanedBodyKeys, [PROXY_KEY]);
	assert.equal(fixture.files.has(String(item.rowIdentity.path)), false);
	assert.deepEqual(await tombstones(fixture.database), []);
});

test('restart cleanup rechecks absence and cannot delete a newer generation', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const item = claim('proxy', PROXY_KEY, PROXY_SHA, 'restart-race');
	fixture.files.set(String(item.rowIdentity.path), new Blob([Uint8Array.of(1, 2, 3, 4)]));
	fixture.opfsFailures.remaining = 1;
	await seedBodiesAndClaims(fixture.database, [{ row: bodyRow('proxy'), claim: item }]);
	await fixture.repository.reconcile(emptyScope());
	await transact(fixture.database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => {
		mediaAssets.put({
			...bodyRow('proxy'),
			mediaContentToken: 'media-content-newer-generation-00000001',
		});
	});

	const result = await fixture.repository.reconcile(emptyScope());

	assert.equal(result.status, 'indeterminate');
	assert.equal(result.issues.some((issue) => issue.code === 'tombstone-reservation-conflict'), true);
	assert.equal(fixture.files.has(String(item.rowIdentity.path)), true);
	assert.equal((await tombstones(fixture.database)).length, 1);
});

test('other claims, runtime snapshots, shared payload identities, and changed rows remain rooted', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const primary = claim('proxy', PROXY_KEY, PROXY_SHA, 'primary');
	const second = claim('proxy', PROXY_KEY, PROXY_SHA, 'secondary');
	await seedBodiesAndClaims(fixture.database, [
		{ row: bodyRow('proxy'), claim: primary },
		{ claim: second },
	]);
	let result = await fixture.repository.reconcile(emptyScope());
	assert.equal(result.status, 'indeterminate');
	assert.equal(result.issues.some((issue) => issue.code === 'other-root'), true);
	assert.notEqual(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.notEqual(await stagingRecord(fixture.database, primary.key), undefined);
	assert.notEqual(await stagingRecord(fixture.database, second.key), undefined);

	await clearStaging(fixture.database);
	const timing = claim('timing', TIMING_KEY, TIMING_SHA, 'runtime-root');
	await seedBodiesAndClaims(fixture.database, [{ row: bodyRow('timing'), claim: timing }]);
	result = await fixture.repository.reconcile({
		...emptyScope(),
		pendingSaveSnapshots: [attachedProject()],
	});
	assert.equal(result.status, 'indeterminate');
	assert.equal(result.issues.some((issue) => issue.bodyKey === TIMING_KEY && issue.code === 'other-root'), true);
	assert.notEqual(await stagingRecord(fixture.database, timing.key), undefined);

	await clearStaging(fixture.database);
	const shared = claim('proxy', PROXY_KEY, PROXY_SHA, 'shared-path');
	await seedBodiesAndClaims(fixture.database, [{ row: bodyRow('proxy'), claim: shared }]);
	await transact(fixture.database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => {
		mediaAssets.put({
			...bodyRow('proxy'),
			sourceId: 'unrelated-media-row',
			path: shared.rowIdentity.path,
			mediaContentToken: 'media-content-shared-reference-000001',
		});
	});
	result = await fixture.repository.reconcile(emptyScope());
	assert.equal(result.issues.some((issue) => issue.code === 'shared-physical-identity'), true);
	assert.notEqual(await mediaRow(fixture.database, PROXY_KEY), undefined);

	await transact(fixture.database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => {
		mediaAssets.delete('unrelated-media-row');
		mediaAssets.put({
			...bodyRow('proxy'),
			mediaContentToken: 'media-content-changed-generation-00001',
		});
	});
	result = await fixture.repository.reconcile(emptyScope());
	assert.equal(result.issues.some((issue) => issue.code === 'body-generation-changed'), true);
	assert.notEqual(await stagingRecord(fixture.database, shared.key), undefined);
	assert.deepEqual(await tombstones(fixture.database), []);
});

test('malformed or over-bound staging inventory fails closed without detaching media', async (context) => {
	const fixture = await createClaimCleanupFixture(context, { maximumInventory: 1 });
	const item = claim('proxy', PROXY_KEY, PROXY_SHA, 'bounded');
	await seedBodiesAndClaims(fixture.database, [{ row: bodyRow('proxy'), claim: item }]);
	await transact(fixture.database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', ({ mediaAssetStaging }) => {
		mediaAssetStaging.put({ key: 'malformed-video-proxy-claim', kind: 'video-proxy-claim' });
	});

	const result = await fixture.repository.reconcile(emptyScope());

	assert.equal(result.status, 'indeterminate');
	assert.equal(result.issues[0]?.code, 'inventory-invalid');
	assert.notEqual(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.notEqual(await stagingRecord(fixture.database, item.key), undefined);
	assert.deepEqual(await tombstones(fixture.database), []);
});

test('prepublication cleanup releases only the exact authenticated operation inventory', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const selected = claim('proxy', PROXY_KEY, PROXY_SHA, 'selected-operation');
	const unrelated = claim('timing', TIMING_KEY, TIMING_SHA, 'unrelated-operation');
	await seedBodiesAndClaims(fixture.database, [
		{ row: bodyRow('proxy'), claim: selected },
		{ row: bodyRow('timing'), claim: unrelated },
	]);

	const result = await fixture.repository.cleanupOperation({
		operationId: selected.operationId,
		projectId: selected.projectId,
		sourceId: selected.sourceId,
		baseFingerprint: selected.baseFingerprint,
	}, emptyScope());

	assert.equal(result.status, 'settled');
	assert.deepEqual(result.cleanedBodyKeys, [PROXY_KEY]);
	assert.equal(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.equal(await stagingRecord(fixture.database, selected.key), undefined);
	assert.notEqual(await mediaRow(fixture.database, TIMING_KEY), undefined);
	assert.deepEqual(await stagingRecord(fixture.database, unrelated.key), unrelated);
});
