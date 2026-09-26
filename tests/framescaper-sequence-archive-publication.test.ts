/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimRepository,
	type VideoProxyPreservationPlan,
	videoProxyClaimKey,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	FramescaperProjectSequenceArchiveRepository,
	type FramescaperProjectSequenceArchivePublicationMode,
} from '../src/framescaper/editor-project-sequence-archive-repository.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsSequence,
} from '../src/framescaper/editor-project-feature-requirements-sequence.ts';
import {
	framescaperProjectFingerprintSequence,
} from '../src/framescaper/editor-project-sequence-preservation-repository.ts';
import {
	cloneFramescaperProjectSequence,
	createFramescaperProjectSequence,
} from '../src/framescaper/editor-project-sequence.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;
type BodyKind = 'proxy' | 'timing';

const SOURCE_IDS = ['camera-a', 'camera-b'] as const;
const ORIGINAL_DIGESTS = ['a'.repeat(64), 'f'.repeat(64)] as const;
const PROXY_DIGESTS = ['b'.repeat(64), 'd'.repeat(64)] as const;
const TIMING_DIGESTS = ['c'.repeat(64), 'e'.repeat(64)] as const;
const CREATED_AT = '2026-01-01T00:00:00.000Z';
const UPDATED_AT = '2026-01-02T00:00:00.000Z';
const PENDING_UNTIL = '2026-01-03T00:00:00.000Z';
const FRAME_COUNT = 20;
const PROXY_BYTES = 4_096;
const TIMING_BYTES = 32 + FRAME_COUNT * 8;
const STAGING = MEDIA_ASSET_STAGING_STORE_NAME;

test('durable archive publication commits create, copy, and compare-and-swap modes', async (context) => {
	for (const mode of ['create', 'copy', 'compare-and-swap'] as const) {
		await context.test(mode, async (nested) => {
			const fixture = await prepared(nested, mode);

			const published = await fixture.repository.publish(fixture.publication as never);

			assert.deepEqual(published, fixture.target);
			assert.notEqual(published, fixture.publication.project, 'the result must be a detached snapshot');
			assert.deepEqual(await read(fixture.database, 'projects', fixture.projectId), fixture.target);
			assert.deepEqual(await read(fixture.database, 'revisions', fixture.revisionKey), {
				key: fixture.revisionKey,
				projectId: fixture.projectId,
				revision: fixture.target.revision,
				project: fixture.target,
			});
			for (const claim of fixture.claimRecords) {
				assert.equal(await read(fixture.database, STAGING, String(claim.key)), undefined);
			}
			for (const body of fixture.bodyRows) {
				const stored = await read(fixture.database, 'mediaAssets', String(body.sourceId)) as Data;
				assert.equal(Object.hasOwn(stored, 'pendingProjectUntil'), false);
				assert.equal(stored.sha256, body.sha256);
			}
		});
	}
});

test('stale, occupied, and orphaned archive destinations do not spend claims', async (context) => {
	const stale = await prepared(context, 'compare-and-swap');
	await write(stale.database, 'projects', {
		...stale.target,
		title: 'Concurrent edit',
	});
	assert.equal(await stale.repository.publish(stale.publication as never), null);
	await assertClaimsRemain(stale);
	assert.equal(await read(stale.database, 'revisions', stale.revisionKey), undefined);

	const occupied = await prepared(context, 'copy');
	await write(occupied.database, 'projects', occupied.target);
	assert.equal(await occupied.repository.publish(occupied.publication as never), null);
	await assertClaimsRemain(occupied);
	assert.equal(await read(occupied.database, 'revisions', occupied.revisionKey), undefined);

	const orphaned = await prepared(context, 'create');
	await write(orphaned.database, 'revisions', {
		key: orphaned.revisionKey,
		projectId: orphaned.projectId,
		revision: orphaned.target.revision,
		project: orphaned.target,
	});
	await assert.rejects(
		() => orphaned.repository.publish(orphaned.publication as never),
		/orphaned revision state/u,
	);
	await assertClaimsRemain(orphaned);
});

test('failure consuming the second source rolls back the first source and project publication', async (context) => {
	const fixture = await prepared(context, 'create', 2);
	const plans = fixture.publication.plans as Data[];
	fixture.publication.plans = [plans[0], { sourceId: SOURCE_IDS[1], plan: {} }];

	await assert.rejects(
		() => fixture.repository.publish(fixture.publication as never),
		/not authentic or was already consumed/u,
	);

	await assertUnpublished(fixture);
	await assertClaimsRemain(fixture);
	await assertClaimsCanBePreparedAgain(fixture);
});

test('failure publishing the second source body rolls back claims, bodies, and project rows', async (context) => {
	const fixture = await prepared(context, 'copy', 2);
	const secondProxy = fixture.bodyRows[2]!;
	await write(fixture.database, 'mediaAssets', {
		...secondProxy,
		size: Number(secondProxy.size) + 1,
	});

	await assert.rejects(
		() => fixture.repository.publish(fixture.publication as never),
		/archive body row changed after verification/u,
	);

	await assertUnpublished(fixture);
	await assertClaimsRemain(fixture);
	for (const body of fixture.bodyRows) {
		const stored = await read(fixture.database, 'mediaAssets', String(body.sourceId)) as Data;
		assert.equal(stored.pendingProjectUntil, PENDING_UNTIL, 'no earlier body may lose its staging fence');
	}
	await assertClaimsCanBePreparedAgain(fixture);
});

interface Prepared {
	readonly database: IDBDatabase;
	readonly claims: VideoProxyClaimRepository;
	readonly repository: FramescaperProjectSequenceArchiveRepository;
	readonly publication: Data;
	readonly target: Data;
	readonly projectId: string;
	readonly revisionKey: string;
	readonly claimRecords: readonly Data[];
	readonly bodyRows: readonly Data[];
	readonly planRequests: readonly Data[];
}

async function prepared(
	context: TestContext,
	mode: FramescaperProjectSequenceArchivePublicationMode,
	sourceCount = 1,
): Promise<Prepared> {
	const database = await openDatabase(
		createInstrumentedIndexedDB() as unknown as IDBFactory,
		`sequence-archive-${mode}-${Math.random().toString(36).slice(2)}`,
	);
	context.after(() => database.close());
	const port = { database: async () => database } as unknown as StorageRepositoryPort;
	const claims = new VideoProxyClaimRepository(port);
	const repository = new FramescaperProjectSequenceArchiveRepository(PROFILE, { port, claims });
	const sources = SOURCE_IDS.slice(0, sourceCount);
	const originId = `archive-${mode}-origin`;
	const origin = attachedProject(baseProject(originId, sources), sources);
	const expected = mode === 'compare-and-swap' ? origin : null;
	const target = mode === 'copy'
		? copiedProject(origin, `archive-${mode}-destination`)
		: mode === 'compare-and-swap'
			? nextProject(origin)
			: origin;
	const projectId = String(target.id);
	if (expected) {
		await write(database, 'projects', expected);
		await write(database, 'revisions', revisionRecord(expected));
	}
	const fingerprint = framescaperProjectFingerprintSequence(PROFILE, origin);
	const claimRecords: Data[] = [];
	const bodyRows: Data[] = [];
	const planRequests: Data[] = [];
	const plans: Array<{ sourceId: string; plan: VideoProxyPreservationPlan }> = [];
	for (const [index, sourceId] of sources.entries()) {
		const binding = { projectId, sourceId, baseFingerprint: fingerprint };
		const proxy = claimRecord(index, 'proxy', binding);
		const timing = claimRecord(index, 'timing', binding);
		const requestValue = {
			operationId: operationId(index),
			projectId,
			sourceId,
			baseFingerprint: fingerprint,
			proxyClaimKey: proxy.key,
			timingClaimKey: timing.key,
		};
		claimRecords.push(proxy, timing);
		bodyRows.push(mediaRow(index, 'proxy'), mediaRow(index, 'timing'));
		planRequests.push(requestValue);
	}
	await write(database, STAGING, ...claimRecords);
	await write(database, 'mediaAssets', ...bodyRows);
	for (const [index, sourceId] of sources.entries()) {
		plans.push({
			sourceId,
			plan: await claims.preparePreservationPlan(planRequests[index] as never),
		});
	}
	return {
		database,
		claims,
		repository,
		publication: { mode, origin, expected, project: target, plans },
		target,
		projectId,
		revisionKey: revisionKey(projectId, Number(target.revision)),
		claimRecords,
		bodyRows,
		planRequests,
	};
}

function baseProject(id: string, sourceIds: readonly string[]): Data {
	const sources = sourceIds.map((sourceId, index) => ({
		id: sourceId,
		kind: 'video',
		name: sourceId,
		sampleFrameCount: 48_000,
		width: 1_920,
		height: 1_080,
		sourceFrameCount: FRAME_COUNT,
		contentSha256: ORIGINAL_DIGESTS[index],
	}));
	return createFramescaperProjectSequence(PROFILE, {
		id,
		title: 'Archived sequence',
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
		sources,
		projectBin: {
			clips: sources.map((source) => ({
				id: `${source.id}-occurrence`,
				kind: 'video',
				sourceId: source.id,
				sequenceStartFrame: 0,
				sequenceFrameCount: 10,
				sourceInFrame: 0,
				sourceFrameCount: 10,
			})),
		},
	} as never) as unknown as Data;
}

function attachedProject(project: Data, sourceIds: readonly string[]): Data {
	const candidate = structuredClone(project) as Data;
	for (const [index, sourceId] of sourceIds.entries()) {
		const source = (candidate.sources as Data[]).find((entry) => entry.id === sourceId);
		if (!source) throw new Error(`Missing archive fixture source ${sourceId}.`);
		source.proxyAttachment = attachment(index);
	}
	candidate.featureRequirements = reconcileFramescaperProjectFeatureRequirementsSequence(PROFILE, candidate);
	return cloneFramescaperProjectSequence(PROFILE, candidate) as unknown as Data;
}

function copiedProject(origin: Data, id: string): Data {
	const candidate = structuredClone(origin) as Data;
	candidate.id = id;
	candidate.revision = 0;
	return cloneFramescaperProjectSequence(PROFILE, candidate) as unknown as Data;
}

function nextProject(expected: Data): Data {
	const candidate = structuredClone(expected) as Data;
	candidate.revision = Number(expected.revision) + 1;
	candidate.updatedAt = UPDATED_AT;
	return cloneFramescaperProjectSequence(PROFILE, candidate) as unknown as Data;
}

function attachment(index: number): Data {
	return {
		kind: 'video-proxy-attachment',
		version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: bodyKey(index, 'proxy'),
		mimeType: 'video/mp4',
		byteLength: PROXY_BYTES,
		sha256: PROXY_DIGESTS[index],
		originalSha256: ORIGINAL_DIGESTS[index],
		originalAuthorityKind: 'owned',
		generatorId: 'framescaper-native-media-host',
		generatorVersion: 1,
		recipeId: 'framescaper-proxy-mp4-v1',
		recipeVersion: 1,
		timingBackendId: 'ffmpeg-9.0.1',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: FRAME_COUNT,
		boundaryCount: FRAME_COUNT + 1,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: bodyKey(index, 'timing'),
			sha256: TIMING_DIGESTS[index],
			sourceSha256: PROXY_DIGESTS[index],
			byteLength: TIMING_BYTES,
			frameCount: FRAME_COUNT,
			timescale: 1,
			finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function operationId(index: number): string {
	return `archive-operation-${String(index + 1).padStart(4, '0')}`;
}

function bodyKey(index: number, bodyKind: BodyKind): string {
	const digest = bodyKind === 'proxy' ? PROXY_DIGESTS[index] : TIMING_DIGESTS[index];
	return `${bodyKind === 'proxy' ? 'video-proxy-sha256:' : 'video-timing-sha256:'}${digest}`;
}

function rowIdentity(index: number, bodyKind: BodyKind): Data {
	const proxy = bodyKind === 'proxy';
	const digest = proxy ? PROXY_DIGESTS[index] : TIMING_DIGESTS[index];
	return {
		sourceId: bodyKey(index, bodyKind),
		kind: proxy ? 'video-proxy' : 'video-timing',
		encoding: proxy ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
		storage: 'opfs',
		path: `proxy/${bodyKind}-${digest}.bin`,
		mediaChunkToken: null,
		mediaChunkBytes: null,
		mediaChunkCount: null,
		mediaContentDigestVersion: 1,
		mediaContentToken: `media-content-${bodyKind}-${String(index + 1).padStart(16, '0')}`,
		sha256: digest,
		byteLength: proxy ? PROXY_BYTES : TIMING_BYTES,
		mimeType: proxy ? 'video/mp4' : 'application/vnd.soundscaper.video-timing',
	};
}

function claimRecord(
	index: number,
	bodyKind: BodyKind,
	binding: Readonly<{ projectId: string; sourceId: string; baseFingerprint: string }>,
): Data {
	const body = bodyKey(index, bodyKind);
	return {
		key: videoProxyClaimKey(operationId(index), bodyKind, body),
		kind: 'video-proxy-claim',
		schemaVersion: 1,
		status: 'verified',
		operationId: operationId(index),
		projectId: binding.projectId,
		sourceId: binding.sourceId,
		baseFingerprint: binding.baseFingerprint,
		bodyKind,
		bodyKey: body,
		generation: `archive-generation-${String(index + 1).padStart(4, '0')}`,
		createdAt: 1_786_550_400_000,
		updatedAt: 1_786_550_400_100,
		expiresAt: 4_102_444_800_000,
		rowIdentity: rowIdentity(index, bodyKind),
	};
}

function mediaRow(index: number, bodyKind: BodyKind): Data {
	const identity = rowIdentity(index, bodyKind);
	const summary = bodyKind === 'timing'
		? { frameCount: FRAME_COUNT, timescale: 1, finalFrameDurationTicks: '1' }
		: {};
	return {
		sourceId: identity.sourceId,
		kind: identity.kind,
		encoding: identity.encoding,
		storage: identity.storage,
		path: identity.path,
		mediaContentDigestVersion: identity.mediaContentDigestVersion,
		mediaContentToken: identity.mediaContentToken,
		sha256: identity.sha256,
		size: identity.byteLength,
		mimeType: identity.mimeType,
		pendingProjectUntil: PENDING_UNTIL,
		...summary,
	};
}

function revisionRecord(project: Data): Data {
	const projectId = String(project.id);
	const revision = Number(project.revision);
	return { key: revisionKey(projectId, revision), projectId, revision, project };
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}

async function assertUnpublished(fixture: Prepared): Promise<void> {
	assert.equal(await read(fixture.database, 'projects', fixture.projectId), undefined);
	assert.equal(await read(fixture.database, 'revisions', fixture.revisionKey), undefined);
}

async function assertClaimsRemain(fixture: Prepared): Promise<void> {
	for (const claim of fixture.claimRecords) {
		assert.deepEqual(await read(fixture.database, STAGING, String(claim.key)), claim);
	}
}

async function assertClaimsCanBePreparedAgain(fixture: Prepared): Promise<void> {
	for (const requestValue of fixture.planRequests) {
		await fixture.claims.preparePreservationPlan(requestValue as never);
	}
}

function write(database: IDBDatabase, storeName: string, ...records: readonly Data[]): Promise<void> {
	return transact(database, storeName, 'readwrite', (stores) => {
		for (const record of records) stores[storeName]!.put(record);
	});
}

function read(database: IDBDatabase, storeName: string, key: string): Promise<unknown> {
	return transact(database, storeName, 'readonly', (stores) => request(stores[storeName]!.get(key)));
}
