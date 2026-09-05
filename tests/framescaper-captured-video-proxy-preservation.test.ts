/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimRepository,
	videoProxyClaimKey,
	type VideoProxyClaimRecord,
	type VideoProxyPreservationPlan,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import { videoProxyCleanupTombstoneKey } from '../src/common/editor/storage/video-proxy-cleanup-tombstone-schema.ts';
import {
	FramescaperCapturedVideoProxyPreservationRepository as Repository,
	framescaperCapturedVideoProxyProjectFingerprint as fingerprintOf,
} from '../src/framescaper/editor-captured-video-proxy-preservation.ts';
import {
	nextCapturedVideoProxyAttachmentProject,
} from '../src/framescaper/editor-captured-video-proxy-transition.ts';
import {
	reconcileFramescaperProjectFeatureRequirements,
} from '../src/framescaper/editor-project-feature-requirements.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;
type BodyKind = 'proxy' | 'timing';

const SCHEMA_VERSION = 1;
const PROJECT_ID = 'framescaper-v20';
const SOURCE_ID = 'video-source';
const OPERATION_ID = 'captured-proxy-operation';
const FRAME_COUNT = 10;
const PROXY_SHA256 = '34'.repeat(32);
const TIMING_SHA256 = '56'.repeat(32);
const PROXY_BODY_KEY = `video-proxy-sha256:${PROXY_SHA256}`;
const TIMING_BODY_KEY = `video-timing-sha256:${TIMING_SHA256}`;
const PROXY_BYTES = 1_024;
const TIMING_BYTES = 112;
const PROXY_MIME_TYPE = 'video/mp4';
const TIMING_MIME_TYPE = 'application/vnd.soundscaper.video-timing';
const TIMING_ENCODING = 'soundscaper-video-timing-v1';
const NOW = 1_786_550_400_200;
const STORES = ['projects', 'revisions', 'mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME];

test('publishing an exact next revision commits the project, its revision row, and both bodies', async (context) => {
	const scenario = await createScenario(context);

	const published = await scenario.publish();

	assert.deepEqual(published, scenario.published);
	assert.deepEqual(await read(scenario.database, 'projects', PROJECT_ID), scenario.published);
	assert.deepEqual(await read(scenario.database, 'revisions', scenario.nextKey), {
		key: scenario.nextKey,
		projectId: PROJECT_ID,
		revision: Number(scenario.expected.revision) + 1,
		project: scenario.published,
	});
	// Publication strips the staging lease from each body row and drops both claims.
	for (const bodyKey of [PROXY_BODY_KEY, TIMING_BODY_KEY]) {
		const row = await read(scenario.database, 'mediaAssets', bodyKey) as Data;
		assert.equal(Object.hasOwn(row, 'pendingProjectUntil'), false);
		assert.equal(row.sourceId, bodyKey);
	}
	assert.deepEqual(await stagedClaims(scenario), [undefined, undefined]);
});

test('publication returns null and leaves both claims staged when the stored project moved on', async (context) => {
	const scenario = await createScenario(context);
	const plan = await scenario.plan();
	await write(scenario.database, 'projects', (projects) => {
		projects.put({ ...scenario.expected, title: 'Renamed elsewhere' });
	});

	const published = await scenario.publish(plan);

	assert.equal(published, null);
	assert.equal(await read(scenario.database, 'revisions', scenario.nextKey), undefined);
	assert.deepEqual(await stagedClaims(scenario), [scenario.proxyClaim, scenario.timingClaim]);
});

test('publication refuses a base revision row that is missing, misfiled, or stale', async (context) => {
	const cases: readonly (readonly [string, (row: Data) => Data | null])[] = [
		['missing', () => null],
		['misfiled key', (row) => ({ ...row, key: `${PROJECT_ID}:zzz` })],
		['foreign project', (row) => ({ ...row, projectId: 'other-project' })],
		['mismatched revision number', (row) => ({ ...row, revision: 7 })],
		['a different project body', (row) => ({ ...row, project: { ...row.project as Data, title: 'Other' } })],
	];
	for (const [name, mutate] of cases) {
		const scenario = await createScenario(context);
		const plan = await scenario.plan();
		const replacement = mutate(await read(scenario.database, 'revisions', scenario.baseKey) as Data);
		await write(scenario.database, 'revisions', (revisions) => {
			revisions.delete(scenario.baseKey);
			if (replacement) revisions.put(replacement);
		});

		await assert.rejects(scenario.publish(plan), /base revision is missing or inconsistent/u, name);
		assert.deepEqual(await stagedClaims(scenario), [scenario.proxyClaim, scenario.timingClaim], name);
	}
});

test('publication refuses a next revision slot that is already occupied', async (context) => {
	const scenario = await createScenario(context);
	const plan = await scenario.plan();
	await write(scenario.database, 'revisions', (revisions) => {
		revisions.put({ key: scenario.nextKey, projectId: PROJECT_ID, revision: 1, project: scenario.published });
	});

	await assert.rejects(scenario.publish(plan), /next revision is already occupied/u);
	assert.deepEqual(await read(scenario.database, 'projects', PROJECT_ID), scenario.expected);
});

test('a consumed claim that does not match the publication or its attachment aborts the transaction', async (context) => {
	const foreign = { projectId: 'other-project' };
	const cases: readonly (readonly [string, RegExp, ScenarioOptions])[] = [
		['a claim generation from another project', /does not match its exact source generation/u,
			{ proxyClaim: foreign, timingClaim: foreign }],
		['a proxy body sized against another body', /proxy body claim does not match its attachment/u,
			{ proxyRow: { byteLength: PROXY_BYTES * 2 } }],
		['a proxy body carrying another container type', /proxy body claim does not match its attachment/u,
			{ proxyRow: { mimeType: 'video/webm' } }],
		['a timing body addressed to another digest', /timing body claim does not match its attachment/u,
			{ timingDigest: '78'.repeat(32) }],
	];
	for (const [name, message, options] of cases) {
		const scenario = await createScenario(context, options);

		await assert.rejects(scenario.publish(), message, name);
		assert.deepEqual(await read(scenario.database, 'projects', PROJECT_ID), scenario.expected, name);
		assert.deepEqual(await stagedClaims(scenario), [scenario.proxyClaim, scenario.timingClaim], name);
	}
});

test('a body row that vanished, drifted, or lost its timing summary refuses publication', async (context) => {
	const cases: readonly (readonly [string, RegExp, BodyKind, Data | null])[] = [
		['the proxy row is gone', /captured proxy row changed/u, 'proxy', null],
		['the proxy digest changed', /captured proxy row changed/u, 'proxy', { sha256: '99'.repeat(32) }],
		['the proxy byte size changed', /captured proxy row changed/u, 'proxy', { size: PROXY_BYTES + 1 }],
		['the timing row is gone', /captured timing row changed/u, 'timing', null],
		['the timing storage moved', /captured timing row changed/u, 'timing', { storage: 'mediaAssetChunk' }],
		['the timing summary drifted', /timing row summary changed/u, 'timing', { finalFrameDurationTicks: '101' }],
	];
	for (const [name, message, bodyKind, replacement] of cases) {
		const scenario = await createScenario(context);
		const plan = await scenario.plan();
		await write(scenario.database, 'mediaAssets', (mediaAssets) => {
			mediaAssets.delete(bodyKind === 'proxy' ? PROXY_BODY_KEY : TIMING_BODY_KEY);
			if (replacement) mediaAssets.put({ ...bodyRow(bodyKind), ...replacement });
		});

		await assert.rejects(scenario.publish(plan), message, name);
		assert.deepEqual(await read(scenario.database, 'projects', PROJECT_ID), scenario.expected, name);
		assert.deepEqual(await stagedClaims(scenario), [scenario.proxyClaim, scenario.timingClaim], name);
	}
});

test('a publication must describe the exact next revision of one attached video source', async (context) => {
	const scenario = await createScenario(context);
	const { expected, published } = scenario;
	const base = Number(expected.revision);
	const earlier = new Date(new Date(String(expected.updatedAt)).getTime() - 1_000).toISOString();
	const publication = (project: unknown, sourceId: string = SOURCE_ID) => ({ expected, project, sourceId });
	// The base project's own source is still detached, so it doubles as the null-attachment case.
	const detached = { ...expected, revision: base + 1, updatedAt: published.updatedAt };
	const cases: readonly (readonly [string, unknown, RegExp])[] = [
		['no publication at all', null, /captured proxy publication is required/u],
		['a revision two steps ahead', publication({ ...published, revision: base + 2 }), /exact next project revision/u],
		['a source that does not exist', publication(published, 'no-such-source'), /source is missing or ambiguous/u],
		['an audio source', publication(published, 'audio-source'), /one video attachment target/u],
		['an unbounded source id', publication(published, ''), /bounded printable captured proxy source id/u],
		['a still-detached target', publication(detached), /one video attachment target/u],
		['a reused base timestamp', publication({ ...published, updatedAt: expected.updatedAt }), /fresh canonical timestamp/u],
		['a timestamp older than the base', publication({ ...published, updatedAt: earlier }), /fresh canonical timestamp/u],
		['an unrelated edit riding along', publication({ ...published, title: 'Renamed' }),
			/may change only its target attachment and owned revision fields/u],
	];
	for (const [name, value, message] of cases) {
		await assert.rejects(() => scenario.repository.publishIfCurrent(value as never), message, name);
	}
	assert.deepEqual(await read(scenario.database, 'projects', PROJECT_ID), expected);
});

test('preservation and rollback both refuse a port without durable storage', async (context) => {
	const scenario = await createScenario(context);
	const detached = new Repository(SCHEMA_VERSION, PROFILE, {
		port: { memory: getMemoryDatabase('captured-proxy-memory'), database: async () => null },
		claims: scenario.claims,
	} as never);
	const { expected, published, proxyClaim, timingClaim } = scenario;

	await assert.rejects(
		detached.publishIfCurrent({ expected, project: published, sourceId: SOURCE_ID, plan: {} } as never),
		/Durable storage is required for captured proxy preservation/u,
	);
	await assert.rejects(
		detached.rollbackIfCurrent(expected, published, SOURCE_ID, [proxyClaim, timingClaim]),
		/Durable storage is required for captured proxy rollback/u,
	);
});

test('rollback rewinds the published revision and restages both cleanup claims', async (context) => {
	const scenario = await createScenario(context);
	await scenario.publish();

	const rolledBack = await scenario.rollback();

	assert.equal(rolledBack, true);
	assert.deepEqual(await read(scenario.database, 'projects', PROJECT_ID), scenario.expected);
	assert.equal(await read(scenario.database, 'revisions', scenario.nextKey), undefined);
	assert.deepEqual(await stagedClaims(scenario), [scenario.proxyClaim, scenario.timingClaim]);
	// The published bodies stay published; only the staging leases come back.
	assert.notEqual(await read(scenario.database, 'mediaAssets', PROXY_BODY_KEY), undefined);
});

test('rollback declines quietly when the stored project is no longer the published one', async (context) => {
	const scenario = await createScenario(context);
	await scenario.publish();
	await write(scenario.database, 'projects', (projects) => {
		projects.put({ ...scenario.published, title: 'Moved on' });
	});

	assert.equal(await scenario.rollback(), false);
	assert.deepEqual(await stagedClaims(scenario), [undefined, undefined]);
});

test('rollback refuses when the revision evidence for either end of the transition changed', async (context) => {
	for (const key of ['baseKey', 'nextKey'] as const) {
		const scenario = await createScenario(context);
		await scenario.publish();
		await write(scenario.database, 'revisions', (revisions) => { revisions.delete(scenario[key]); });

		await assert.rejects(scenario.rollback(), /rollback revision evidence changed/u, key);
		assert.deepEqual(await read(scenario.database, 'projects', PROJECT_ID), scenario.published, key);
	}
});

test('rollback refuses when a cleanup body was restaged, tombstoned, or rewritten', async (context) => {
	const staging = MEDIA_ASSET_STAGING_STORE_NAME;
	const cases: readonly (readonly [string, string, (scenario: Scenario, store: IDBObjectStore) => void])[] = [
		['the claim is already staged again', staging, (scenario, store) => { store.put(scenario.proxyClaim); }],
		['a cleanup tombstone reserved the body', staging, (_scenario, store) => {
			store.put({ key: videoProxyCleanupTombstoneKey(TIMING_BODY_KEY), kind: 'tombstone' });
		}],
		['the body row is gone', 'mediaAssets', (_scenario, store) => { store.delete(PROXY_BODY_KEY); }],
		['the body row changed identity', 'mediaAssets', (_scenario, store) => {
			store.put({ ...bodyRow('proxy'), path: 'captured/elsewhere.bin' });
		}],
	];
	for (const [name, store, damage] of cases) {
		const scenario = await createScenario(context);
		await scenario.publish();
		await write(scenario.database, store, (objectStore) => damage(scenario, objectStore));

		await assert.rejects(scenario.rollback(), /rollback cleanup evidence changed/u, name);
		assert.deepEqual(await read(scenario.database, 'projects', PROJECT_ID), scenario.published, name);
	}
});

test('rollback authenticates its cleanup claim list before touching durable storage', async (context) => {
	const scenario = await createScenario(context);
	await scenario.publish();
	const { baseFingerprint, proxyClaim, timingClaim } = scenario;
	const cases: readonly (readonly [string, unknown, RegExp])[] = [
		['three claims for a two-body transition', [proxyClaim, timingClaim, proxyClaim], /cleanup claims are invalid/u],
		['a value that is not a list', 'claims', /cleanup claims are invalid/u],
		['two claims for the same role', [proxyClaim, { ...proxyClaim }], /unique roles/u],
		['an unverified claim', [{ ...proxyClaim, status: 'unverified' }], /changed identity/u],
		['a claim from another project', [{ ...proxyClaim, projectId: 'other-project' }], /changed identity/u],
		['a claim from another source', [{ ...proxyClaim, sourceId: 'other-source' }], /changed identity/u],
		['a claim against another generation', [{ ...proxyClaim, baseFingerprint: '99'.repeat(32) }], /changed identity/u],
		['a claim for an unattached body', [claimRecord('proxy', baseFingerprint, {}, { sha256: '78'.repeat(32) })],
			/changed identity/u],
	];
	for (const [name, claims, message] of cases) {
		await assert.rejects(scenario.rollback(claims as readonly unknown[]), message, name);
	}
	// An empty list is legal: the transition is rewound with no bodies to restage.
	assert.equal(await scenario.rollback([]), true);
	assert.deepEqual(await stagedClaims(scenario), [undefined, undefined]);
});

test('rollback requires one published attachment on the exact next revision', async (context) => {
	const { expected, published, repository } = await createScenario(context);

	await assert.rejects(
		repository.rollbackIfCurrent(published, expected, SOURCE_ID, []),
		/requires one published attachment/u,
	);
	await assert.rejects(
		repository.rollbackIfCurrent(expected, { ...published, revision: 5 }, SOURCE_ID, []),
		/rollback requires its exact next revision/u,
	);
	await assert.rejects(
		repository.rollbackIfCurrent(expected, published, '', []),
		/bounded printable captured proxy source id/u,
	);
});

interface ScenarioOptions {
	readonly proxyClaim?: Data;
	readonly timingClaim?: Data;
	readonly proxyRow?: Data;
	readonly timingDigest?: string;
}

interface Scenario {
	readonly database: IDBDatabase;
	readonly claims: VideoProxyClaimRepository;
	readonly repository: Repository;
	readonly expected: Data;
	readonly published: Data;
	readonly baseFingerprint: string;
	readonly baseKey: string;
	readonly nextKey: string;
	readonly proxyClaim: VideoProxyClaimRecord;
	readonly timingClaim: VideoProxyClaimRecord;
	plan(): Promise<VideoProxyPreservationPlan>;
	publish(plan?: VideoProxyPreservationPlan): Promise<Data | null>;
	rollback(claims?: readonly unknown[]): Promise<boolean>;
}

async function createScenario(context: TestContext, options: ScenarioOptions = {}): Promise<Scenario> {
	const name = `captured-proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	const database = await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, name);
	context.after(() => database.close());
	const port: StorageRepositoryPort = { memory: getMemoryDatabase(name), database: async () => database };
	const claims = new VideoProxyClaimRepository(port, { now: () => NOW });
	const repository = new Repository(SCHEMA_VERSION, PROFILE, { port, claims } as never);
	const expected = createFramescaperProject(PROFILE, framescaperV20Options() as never) as unknown as Data;
	const published = nextCapturedVideoProxyAttachmentProject(
		{
			profile: PROFILE,
			schemaVersion: SCHEMA_VERSION,
			reconcileProjectRequirements: (project: unknown) => (
				reconcileFramescaperProjectFeatureRequirements(PROFILE, project)
			),
		} as never,
		expected as never,
		SOURCE_ID,
		attachmentFor(expected) as never,
	) as unknown as Data;
	const baseFingerprint = fingerprintOf(SCHEMA_VERSION, PROFILE, expected as never);
	const proxyClaim = claimRecord('proxy', baseFingerprint, options.proxyClaim, options.proxyRow);
	const timingClaim = claimRecord('timing', baseFingerprint, options.timingClaim, {
		...(options.timingDigest === undefined ? {} : { sha256: options.timingDigest }),
	});
	const baseKey = revisionKey(Number(expected.revision));
	const nextKey = revisionKey(Number(expected.revision) + 1);
	await transact(database, STORES, 'readwrite', (stores) => {
		stores.projects.put(expected);
		stores.revisions.put({ key: baseKey, projectId: PROJECT_ID, revision: expected.revision, project: expected });
		stores.mediaAssets.put(bodyRow('proxy'));
		stores.mediaAssets.put(bodyRow('timing'));
		stores.mediaAssetStaging.put(proxyClaim);
		stores.mediaAssetStaging.put(timingClaim);
	});
	const plan = (): Promise<VideoProxyPreservationPlan> => claims.preparePreservationPlan({
		operationId: String(proxyClaim.operationId),
		projectId: String(proxyClaim.projectId),
		sourceId: String(proxyClaim.sourceId),
		baseFingerprint: String(proxyClaim.baseFingerprint),
		proxyClaimKey: proxyClaim.key,
		timingClaimKey: timingClaim.key,
	});
	return {
		database, claims, repository, expected, published, baseFingerprint, baseKey, nextKey,
		proxyClaim, timingClaim, plan,
		publish: async (prepared) => await repository.publishIfCurrent({
			expected, project: published, sourceId: SOURCE_ID, plan: prepared ?? await plan(),
		} as never) as unknown as Data | null,
		rollback: (cleanup = [proxyClaim, timingClaim]) => (
			repository.rollbackIfCurrent(expected, published, SOURCE_ID, cleanup)
		),
	};
}

function attachmentFor(project: Data): Data {
	const source = (project.sources as readonly Data[]).find(({ id }) => id === SOURCE_ID);
	return {
		kind: 'video-proxy-attachment',
		version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: PROXY_BODY_KEY,
		mimeType: PROXY_MIME_TYPE,
		byteLength: PROXY_BYTES,
		sha256: PROXY_SHA256,
		originalSha256: String(source?.contentSha256),
		originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg',
		generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1',
		recipeVersion: 1,
		timingBackendId: 'ffprobe',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: FRAME_COUNT,
		boundaryCount: FRAME_COUNT + 1,
		timingAsset: {
			encoding: TIMING_ENCODING,
			storageKey: TIMING_BODY_KEY,
			sha256: TIMING_SHA256,
			sourceSha256: PROXY_SHA256,
			byteLength: TIMING_BYTES,
			frameCount: FRAME_COUNT,
			timescale: 1_000,
			finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function claimRecord(
	bodyKind: BodyKind,
	baseFingerprint: string,
	overrides: Data = {},
	rowOverrides: Data = {},
): VideoProxyClaimRecord {
	const proxy = bodyKind === 'proxy';
	const sha256 = String(rowOverrides.sha256 ?? (proxy ? PROXY_SHA256 : TIMING_SHA256));
	const bodyKey = `video-${proxy ? 'proxy' : 'timing'}-sha256:${sha256}`;
	const operationId = String(overrides.operationId ?? OPERATION_ID);
	return {
		key: videoProxyClaimKey(operationId, bodyKind, bodyKey),
		kind: 'video-proxy-claim',
		schemaVersion: 1,
		status: 'verified',
		operationId,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint,
		bodyKind,
		bodyKey,
		generation: 'captured-proxy-generation',
		createdAt: NOW - 200,
		updatedAt: NOW - 100,
		expiresAt: NOW + 86_400_000,
		...overrides,
		rowIdentity: {
			sourceId: bodyKey,
			kind: proxy ? 'video-proxy' : 'video-timing',
			encoding: proxy ? 'video-proxy-v1' : TIMING_ENCODING,
			storage: 'opfs',
			path: `captured/${bodyKind}.bin`,
			mediaChunkToken: null,
			mediaChunkBytes: null,
			mediaChunkCount: null,
			mediaContentDigestVersion: 1,
			mediaContentToken: `media-content-${bodyKind}-0000000000001`,
			sha256,
			byteLength: proxy ? PROXY_BYTES : TIMING_BYTES,
			mimeType: proxy ? PROXY_MIME_TYPE : TIMING_MIME_TYPE,
			...rowOverrides,
		},
	} as unknown as VideoProxyClaimRecord;
}

function bodyRow(bodyKind: BodyKind): Data {
	const proxy = bodyKind === 'proxy';
	return {
		sourceId: proxy ? PROXY_BODY_KEY : TIMING_BODY_KEY,
		kind: proxy ? 'video-proxy' : 'video-timing',
		encoding: proxy ? 'video-proxy-v1' : TIMING_ENCODING,
		storage: 'opfs',
		path: `captured/${bodyKind}.bin`,
		mediaChunkToken: null,
		mediaChunkBytes: null,
		mediaChunkCount: null,
		mediaContentDigestVersion: 1,
		mediaContentToken: `media-content-${bodyKind}-0000000000001`,
		sha256: proxy ? PROXY_SHA256 : TIMING_SHA256,
		size: proxy ? PROXY_BYTES : TIMING_BYTES,
		mimeType: proxy ? PROXY_MIME_TYPE : TIMING_MIME_TYPE,
		pendingProjectUntil: '2026-08-13T13:00:00.000Z',
		...(proxy ? {} : { frameCount: FRAME_COUNT, timescale: 1_000, finalFrameDurationTicks: '100' }),
	};
}

function revisionKey(revision: number): string {
	return `${PROJECT_ID}:${String(revision).padStart(12, '0')}`;
}

function stagedClaims(scenario: Scenario): Promise<readonly unknown[]> {
	return transact(scenario.database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', (stores) => (
		Promise.all([scenario.proxyClaim.key, scenario.timingClaim.key]
			.map((key) => request(stores.mediaAssetStaging.get(key))))
	));
}

function read(database: IDBDatabase, store: string, key: string): Promise<unknown> {
	return transact(database, store, 'readonly', (stores) => request(stores[store].get(key)));
}

function write(database: IDBDatabase, store: string, mutate: (objectStore: IDBObjectStore) => void): Promise<void> {
	return transact(database, store, 'readwrite', (stores) => { mutate(stores[store]); });
}
