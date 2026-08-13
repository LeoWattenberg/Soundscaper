/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
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
import { VideoProxyClaimStagingRepository } from '../src/common/editor/storage/video-proxy-claim-staging-repository.ts';
import {
	normalizeVideoProxyCleanupTombstoneRecord,
	VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND,
} from '../src/common/editor/storage/video-proxy-cleanup-tombstone.ts';
import {
	type VideoProxyClaimRecord,
	videoProxyClaimKey,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import { FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18 } from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
} from '../src/framescaper/editor-project-v18-claim-cleanup-repository.ts';
import { collectFramescaperProjectStorageRootsV18 } from '../src/framescaper/editor-project-v18-retention.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const PROJECT_ID = 'framescaper-cleanup';
const SOURCE_ID = 'video-source';
const ORIGINAL_SHA = '12'.repeat(32);
const PROXY_SHA = '34'.repeat(32);
const TIMING_SHA = '56'.repeat(32);
const PROXY_KEY = `video-proxy-sha256:${PROXY_SHA}`;
const TIMING_KEY = `video-timing-sha256:${TIMING_SHA}`;
const NOW = 1_786_550_400_000;

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
	const fixture = await createFixture(context);
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
	const fixture = await createFixture(context);
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
	const fixture = await createFixture(context);
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
	const fixture = await createFixture(context);
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
	const fixture = await createFixture(context);
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
	const fixture = await createFixture(context);
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
	const fixture = await createFixture(context, { maximumInventory: 1 });
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
	const fixture = await createFixture(context);
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

interface Fixture {
	readonly database: IDBDatabase;
	readonly files: Map<string, Blob>;
	readonly opfsFailures: { remaining: number };
	readonly repository: FramescaperProjectV18ClaimCleanupRepository;
	readonly staging: VideoProxyClaimStagingRepository;
}

async function createFixture(
	context: TestContext,
	options: Readonly<{ maximumInventory?: number }> = {},
): Promise<Fixture> {
	const name = uniqueName('v18-claim-cleanup');
	const database = await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, name);
	context.after(() => database.close());
	const port: StorageRepositoryPort = {
		memory: getMemoryDatabase(name),
		database: async () => database,
	};
	const files = new Map<string, Blob>();
	const opfsFailures = { remaining: 0 };
	const opfs = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: opfsRoot(files, opfsFailures),
	});
	return {
		database,
		files,
		opfsFailures,
		staging: new VideoProxyClaimStagingRepository(port, opfs),
		repository: new FramescaperProjectV18ClaimCleanupRepository(PROFILE, {
			port,
			opfs,
			now: () => NOW,
			maximumInventory: options.maximumInventory,
		}),
	};
}

function emptyScope() {
	return {
		sessionProjects: [],
		histories: [],
		pendingSaveSnapshots: [],
	};
}

function attachedProject(): FramescaperProjectV18 {
	const project = structuredClone(createFramescaperProjectV18(PROFILE, {
		id: PROJECT_ID,
		title: 'Cleanup fixture',
		now: '2026-08-13T10:00:00.000Z',
		sources: [createVideoSourceV10({
			id: SOURCE_ID,
			name: 'Video',
			storageKey: 'owned/video-source',
			mimeType: 'video/mp4',
			contentSha256: ORIGINAL_SHA,
			frameCount: 48_000,
			sampleFrameCount: 48_000,
			sourceFrameCount: 10,
			frameRate: { num: 10, den: 1 },
			width: 1920,
			height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: SOURCE_ID, title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	})) as unknown as Record<string, unknown>;
	((project.sources as Record<string, unknown>[])[0]!).proxyAttachment = {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: PROXY_KEY, mimeType: 'video/mp4', byteLength: 4,
		sha256: PROXY_SHA, originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: TIMING_KEY,
			sha256: TIMING_SHA, sourceSha256: PROXY_SHA, byteLength: 112,
			frameCount: 10, timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	const manifest = project.featureRequirements as { schemaVersion: 2; requirements: unknown[] };
	project.featureRequirements = {
		schemaVersion: 2,
		requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return project as unknown as FramescaperProjectV18;
}

function bodyRow(
	bodyKind: 'proxy' | 'timing',
	physical: Readonly<Record<string, unknown>> = {
		storage: 'opfs',
		path: bodyKind === 'proxy' ? 'proxy/body.bin' : 'proxy/timing.bin',
	},
): Record<string, unknown> {
	const sha256 = bodyKind === 'proxy' ? PROXY_SHA : TIMING_SHA;
	const sourceId = bodyKind === 'proxy' ? PROXY_KEY : TIMING_KEY;
	return {
		sourceId,
		kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
		encoding: bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
		...physical,
		mediaContentDigestVersion: 1,
		mediaContentToken: `media-content-${bodyKind}-0000000000000001`,
		sha256,
		size: bodyKind === 'proxy' ? 4 : 112,
		mimeType: bodyKind === 'proxy' ? 'video/mp4' : 'application/vnd.soundscaper.video-timing',
		committedAt: '2026-08-13T00:00:00.000Z',
		pendingProjectUntil: '2026-08-14T00:00:00.000Z',
	};
}

function claim(
	bodyKind: 'proxy' | 'timing',
	bodyKey: string,
	sha256: string,
	operationId = 'cleanup-operation',
): VideoProxyClaimRecord {
	return claimForRow({
		key: '',
		kind: 'video-proxy-claim',
		schemaVersion: 1,
		status: 'verified',
		operationId,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: 'ab'.repeat(32),
		bodyKind,
		bodyKey,
		generation: `generation-${operationId}`,
		createdAt: NOW - 20,
		updatedAt: NOW - 10,
		expiresAt: NOW + 10_000,
		rowIdentity: {} as VideoProxyClaimRecord['rowIdentity'],
	}, bodyRow(bodyKind)) as VideoProxyClaimRecord;
}

function claimForRow(
	claimValue: VideoProxyClaimRecord,
	row: Readonly<Record<string, unknown>>,
): VideoProxyClaimRecord {
	const bodyKind = claimValue.bodyKind;
	const bodyKey = String(row.sourceId);
	return {
		...claimValue,
		key: videoProxyClaimKey(claimValue.operationId, bodyKind, bodyKey),
		bodyKey,
		rowIdentity: {
			sourceId: bodyKey,
			kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
			encoding: bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
			storage: row.storage as 'opfs' | typeof MEDIA_ASSET_CHUNK_STORAGE_TYPE,
			path: row.storage === 'opfs' ? String(row.path) : null,
			mediaChunkToken: row.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
				? String(row.mediaChunkToken) : null,
			mediaChunkBytes: row.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
				? Number(row.mediaChunkBytes) : null,
			mediaChunkCount: row.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
				? Number(row.mediaChunkCount) : null,
			mediaContentDigestVersion: 1,
			mediaContentToken: String(row.mediaContentToken),
			sha256: String(row.sha256),
			byteLength: Number(row.size),
			mimeType: String(row.mimeType),
		},
	};
}

function seedProject(database: IDBDatabase, project: FramescaperProjectV18): Promise<void> {
	return transact(database, ['projects', 'revisions'], 'readwrite', ({ projects, revisions }) => {
		projects.put(project);
		revisions.put({
			key: `${project.id}:${String(project.revision).padStart(12, '0')}`,
			projectId: project.id,
			revision: project.revision,
			project,
		});
	});
}

function seedBodiesAndClaims(
	database: IDBDatabase,
	items: readonly { readonly row?: Record<string, unknown>; readonly claim: VideoProxyClaimRecord }[],
): Promise<void> {
	return transact(
		database,
		['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
		'readwrite',
		({ mediaAssets, mediaAssetStaging }) => {
			for (const item of items) {
				if (item.row) mediaAssets.put(item.row);
				mediaAssetStaging.put(item.claim);
			}
		},
	);
}

function clearStaging(database: IDBDatabase): Promise<void> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', async ({ mediaAssetStaging }) => {
		for (const item of await request(mediaAssetStaging.index('kind').getAll('video-proxy-claim'))) {
			await request(mediaAssetStaging.delete((item as { key: string }).key));
		}
	});
}

function mediaRow(database: IDBDatabase, bodyKey: string): Promise<unknown> {
	return transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.get(bodyKey)));
}

function stagingRecord(database: IDBDatabase, key: string): Promise<unknown> {
	return transact(
		database,
		MEDIA_ASSET_STAGING_STORE_NAME,
		'readonly',
		({ mediaAssetStaging }) => request(mediaAssetStaging.get(key)),
	);
}

function tombstones(database: IDBDatabase): Promise<unknown[]> {
	return transact(
		database,
		MEDIA_ASSET_STAGING_STORE_NAME,
		'readonly',
		({ mediaAssetStaging }) => request(
			mediaAssetStaging.index('kind').getAll(VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND),
		),
	);
}

function chunkCount(database: IDBDatabase): Promise<number> {
	return transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readonly', (stores) => (
		request(stores[MEDIA_ASSET_CHUNK_STORE_NAME].count())
	));
}

function opfsRoot(
	files: Map<string, Blob>,
	failures: { remaining: number },
): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async removeEntry(path: string) {
			if (failures.remaining > 0) {
				failures.remaining -= 1;
				throw new Error('injected OPFS cleanup failure');
			}
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
	};
	return directory as unknown as FileSystemDirectoryHandle;
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
