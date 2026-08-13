/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimRepository,
	type VideoProxyClaimRecord,
	type VideoProxyPreservationPlan,
	videoProxyClaimKey,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import { FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18 } from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	FramescaperProjectV18PreservationRepository,
	framescaperProjectFingerprintV18,
} from '../src/framescaper/editor-project-v18-preservation-repository.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const PROJECT_ID = 'framescaper-preservation';
const SOURCE_ID = 'video-source';
const ORIGINAL_SHA = '12'.repeat(32);
const PROXY_SHA = '34'.repeat(32);
const TIMING_SHA = '56'.repeat(32);
const NOW = 1_786_550_400_000;

test('repository construction authenticates the exact profile before dependency observation', () => {
	let traps = 0;
	const dependencies = new Proxy({}, {
		get() { traps += 1; throw new Error('dependency get'); },
		ownKeys() { traps += 1; throw new Error('dependency keys'); },
		getOwnPropertyDescriptor() { traps += 1; throw new Error('dependency descriptor'); },
	});
	assert.throws(
		() => new FramescaperProjectV18PreservationRepository({}, dependencies),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.throws(
		() => framescaperProjectFingerprintV18({}, dependencies),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.equal(traps, 0);
});

test('one durable transaction publishes exact V18 and consumes every body claim', async (context) => {
	const fixture = await createFixture(context);
	const expected = baseProject();
	const next = attachedProject(expected);
	await seedBase(fixture.database, expected);
	const { plans, claims } = await seedPreservation(fixture, expected);

	const published = await fixture.repository.publishIfCurrent({ expected, project: next, plans });

	assert.deepEqual(published, next);
	assert.notStrictEqual(published, next);
	assert.deepEqual(await storedProject(fixture.database, PROJECT_ID), next);
	assert.deepEqual(await storedRevision(fixture.database, PROJECT_ID, 1), {
		key: revisionKey(PROJECT_ID, 1), projectId: PROJECT_ID, revision: 1, project: next,
	});
	assert.deepEqual(await storedClaims(fixture.database, claims), [undefined, undefined]);
	for (const bodyKey of [`video-proxy-sha256:${PROXY_SHA}`, `video-timing-sha256:${TIMING_SHA}`]) {
		const row = await storedMediaRow(fixture.database, bodyKey) as Record<string, unknown>;
		assert.equal(Object.hasOwn(row, 'pendingProjectUntil'), false);
		assert.equal(row.sourceId, bodyKey);
	}
});

test('stale base and occupied next revision refuse before claim consumption or mutation', async (context) => {
	const fixture = await createFixture(context);
	const expected = baseProject();
	const current = structuredClone(expected) as unknown as Record<string, unknown>;
	current.title = 'Changed elsewhere';
	await seedBase(fixture.database, current);
	let seeded = await seedPreservation(fixture, expected);
	assert.equal(await fixture.repository.publishIfCurrent({
		expected, project: attachedProject(expected), plans: seeded.plans,
	}), null);
	assert.deepEqual(await storedClaims(fixture.database, seeded.claims), seeded.claims);
	assert.deepEqual(await storedProject(fixture.database, PROJECT_ID), current);

	await replaceBase(fixture.database, expected);
	seeded = await seedPreservation(fixture, expected, 'occupied');
	await transact(fixture.database, 'revisions', 'readwrite', ({ revisions }) => {
		revisions.put({
			key: revisionKey(PROJECT_ID, 1), projectId: PROJECT_ID, revision: 1,
			project: { ...expected, revision: 1, title: 'Occupied' },
		});
	});
	await assert.rejects(fixture.repository.publishIfCurrent({
		expected, project: attachedProject(expected), plans: seeded.plans,
	}), /next revision.*occupied/iu);
	assert.deepEqual(await storedClaims(fixture.database, seeded.claims), seeded.claims);
});

test('claim/source/body mismatches abort the complete pointer transaction', async (context) => {
	const fixture = await createFixture(context);
	const expected = baseProject();
	const next = attachedProject(expected);
	await seedBase(fixture.database, expected);
	const seeded = await seedPreservation(fixture, expected, 'mismatch', 'other-source');

	await assert.rejects(fixture.repository.publishIfCurrent({
		expected,
		project: next,
		plans: [{ sourceId: SOURCE_ID, plan: seeded.plans[0]!.plan }],
	}), /source|attachment|claim/iu);
	assert.deepEqual(await storedProject(fixture.database, PROJECT_ID), expected);
	assert.equal(await storedRevision(fixture.database, PROJECT_ID, 1), undefined);
	assert.deepEqual(await storedClaims(fixture.database, seeded.claims), seeded.claims);

	const valid = await seedPreservation(fixture, expected, 'row-race');
	await transact(fixture.database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => {
		mediaAssets.put({ ...bodyRow('proxy'), mediaContentToken: 'media-content-replaced-000000000001' });
	});
	await assert.rejects(fixture.repository.publishIfCurrent({
		expected, project: next, plans: valid.plans,
	}), /body row.*changed|generation/iu);
	assert.deepEqual(await storedClaims(fixture.database, valid.claims), valid.claims);
});

test('publication requires durable storage and a complete one-use plan set', async () => {
	let memoryReads = 0;
	const memory = new Proxy(getMemoryDatabase(uniqueName('v18-preservation-memory')), {
		get(target, property, receiver) {
			memoryReads += 1;
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
	const port: StorageRepositoryPort = { memory, database: async () => null };
	const claims = new VideoProxyClaimRepository(port);
	const repository = new FramescaperProjectV18PreservationRepository(PROFILE, { port, claims });
	const expected = baseProject();
	await assert.rejects(repository.publishIfCurrent({
		expected, project: attachedProject(expected), plans: [],
	}), /durable.*required|memory.*unsupported/iu);
	assert.equal(memoryReads, 0);
});

interface Fixture {
	readonly database: IDBDatabase;
	readonly port: StorageRepositoryPort;
	readonly claims: VideoProxyClaimRepository;
	readonly repository: FramescaperProjectV18PreservationRepository;
}

async function createFixture(context: TestContext): Promise<Fixture> {
	const name = uniqueName('v18-preservation');
	const database = await openDatabase(createInstrumentedIndexedDB() as unknown as IDBFactory, name);
	context.after(() => database.close());
	const port: StorageRepositoryPort = { memory: getMemoryDatabase(name), database: async () => database };
	const claims = new VideoProxyClaimRepository(port, { now: () => NOW + 100 });
	return {
		database,
		port,
		claims,
		repository: new FramescaperProjectV18PreservationRepository(PROFILE, { port, claims }),
	};
}

async function seedPreservation(
	fixture: Fixture,
	expected: FramescaperProjectV18,
	operationSuffix = 'default',
	claimSourceId = SOURCE_ID,
): Promise<{
	plans: Array<{ sourceId: string; plan: VideoProxyPreservationPlan }>;
	claims: [VideoProxyClaimRecord, VideoProxyClaimRecord];
}> {
	const baseFingerprint = framescaperProjectFingerprintV18(PROFILE, expected);
	const operationId = `preserve-${operationSuffix}`;
	const proxy = claim('proxy', operationId, baseFingerprint, claimSourceId);
	const timing = claim('timing', operationId, baseFingerprint, claimSourceId);
	await transact(
		fixture.database,
		['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
		'readwrite',
		({ mediaAssets, mediaAssetStaging }) => {
			mediaAssets.put(bodyRow('proxy'));
			mediaAssets.put(bodyRow('timing'));
			mediaAssetStaging.put(proxy);
			mediaAssetStaging.put(timing);
		},
	);
	const plan = await fixture.claims.preparePreservationPlan({
		operationId,
		projectId: PROJECT_ID,
		sourceId: claimSourceId,
		baseFingerprint,
		proxyClaimKey: proxy.key,
		timingClaimKey: timing.key,
	});
	return { plans: [{ sourceId: claimSourceId, plan }], claims: [proxy, timing] };
}

function baseProject(): FramescaperProjectV18 {
	return createFramescaperProjectV18(PROFILE, {
		id: PROJECT_ID, title: 'Before', now: '2026-08-13T10:00:00.000Z',
		sources: [createVideoSourceV10({
			id: SOURCE_ID, name: 'Video', storageKey: SOURCE_ID, mimeType: 'video/mp4',
			contentSha256: ORIGINAL_SHA, frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
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
	});
}

function attachedProject(base: FramescaperProjectV18): FramescaperProjectV18 {
	const project = structuredClone(base) as unknown as Record<string, unknown>;
	project.revision = 1;
	project.updatedAt = '2026-08-13T10:01:00.000Z';
	((project.sources as Record<string, unknown>[])[0]!).proxyAttachment = attachment();
	const manifest = project.featureRequirements as { schemaVersion: 2; requirements: unknown[] };
	project.featureRequirements = {
		schemaVersion: manifest.schemaVersion,
		requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return project as unknown as FramescaperProjectV18;
}

function attachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA}`, mimeType: 'video/mp4', byteLength: 4_096,
		sha256: PROXY_SHA, originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${TIMING_SHA}`,
			sha256: TIMING_SHA, sourceSha256: PROXY_SHA, byteLength: 64, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function claim(
	bodyKind: 'proxy' | 'timing',
	operationId: string,
	baseFingerprint: string,
	sourceId: string,
): VideoProxyClaimRecord {
	const row = bodyRow(bodyKind);
	const bodyKey = String(row.sourceId);
	return {
		key: videoProxyClaimKey(operationId, bodyKind, bodyKey),
		kind: 'video-proxy-claim', schemaVersion: 1, status: 'verified', operationId,
		projectId: PROJECT_ID, sourceId, baseFingerprint, bodyKind, bodyKey,
		generation: `${bodyKind}-generation-0001`,
		createdAt: NOW, updatedAt: NOW + 10, expiresAt: NOW + 10_000,
		rowIdentity: {
			sourceId: bodyKey,
			kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
			encoding: bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
			storage: 'opfs', path: String(row.path), mediaChunkToken: null,
			mediaChunkBytes: null, mediaChunkCount: null,
			mediaContentDigestVersion: 1, mediaContentToken: String(row.mediaContentToken),
			sha256: String(row.sha256), byteLength: Number(row.size), mimeType: String(row.mimeType),
		},
	};
}

function bodyRow(bodyKind: 'proxy' | 'timing'): Record<string, unknown> {
	const digest = bodyKind === 'proxy' ? PROXY_SHA : TIMING_SHA;
	const sourceId = `${bodyKind === 'proxy' ? 'video-proxy' : 'video-timing'}-sha256:${digest}`;
	return {
		sourceId,
		kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
		encoding: bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
		storage: 'opfs', path: `${bodyKind}/${digest}.bin`,
		mediaContentDigestVersion: 1,
		mediaContentToken: `media-content-${bodyKind}-0000000000000001`,
		sha256: digest, size: bodyKind === 'proxy' ? 4_096 : 64,
		mimeType: bodyKind === 'proxy' ? 'video/mp4' : 'application/vnd.soundscaper.video-timing',
		committedAt: '2026-08-13T00:00:00.000Z',
		pendingProjectUntil: '2026-08-14T00:00:00.000Z',
	};
}

function seedBase(database: IDBDatabase, project: unknown): Promise<void> {
	return transact(database, ['projects', 'revisions'], 'readwrite', ({ projects, revisions }) => {
		projects.put(project);
		revisions.put({ key: revisionKey(PROJECT_ID, 0), projectId: PROJECT_ID, revision: 0, project });
	});
}

function replaceBase(database: IDBDatabase, project: unknown): Promise<void> {
	return transact(database, 'projects', 'readwrite', ({ projects }) => { projects.put(project); });
}

function storedProject(database: IDBDatabase, projectId: string): Promise<unknown> {
	return transact(database, 'projects', 'readonly', ({ projects }) => request(projects.get(projectId)));
}

function storedRevision(database: IDBDatabase, projectId: string, revision: number): Promise<unknown> {
	return transact(database, 'revisions', 'readonly', ({ revisions }) => (
		request(revisions.get(revisionKey(projectId, revision)))
	));
}

function storedMediaRow(database: IDBDatabase, bodyKey: string): Promise<unknown> {
	return transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.get(bodyKey)));
}

function storedClaims(
	database: IDBDatabase,
	claims: readonly VideoProxyClaimRecord[],
): Promise<unknown[]> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', ({ mediaAssetStaging }) => (
		Promise.all(claims.map(({ key }) => request(mediaAssetStaging.get(key))))
	));
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
