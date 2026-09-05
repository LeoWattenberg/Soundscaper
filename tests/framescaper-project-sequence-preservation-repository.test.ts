/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimRepository,
	videoProxyClaimKey,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsSequence,
} from '../src/framescaper/editor-project-feature-requirements-sequence.ts';
import {
	FramescaperProjectSequencePreservationRepository,
	framescaperProjectFingerprintSequence,
} from '../src/framescaper/editor-project-sequence-preservation-repository.ts';
import {
	cloneFramescaperProjectSequence,
	createFramescaperProjectSequence,
} from '../src/framescaper/editor-project-sequence.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;
type BodyKind = 'proxy' | 'timing';
type Change = (candidate: Data) => void;

const PROJECT_ID = 'framescaper-sequence-project';
const SOURCE_ID = 'camera-a';
const SECOND_SOURCE_ID = 'camera-b';
const OPERATION_ID = 'sequence-preservation-0001';
const ORIGINAL_DIGEST = 'a'.repeat(64);
const PROXY_DIGEST = 'b'.repeat(64);
const TIMING_DIGEST = 'c'.repeat(64);
const OTHER_DIGEST = 'd'.repeat(64);
const BASE_UPDATED_AT = '2026-01-01T00:00:00.000Z';
const NEXT_UPDATED_AT = '2026-01-02T00:00:00.000Z';
const PENDING_UNTIL = '2026-01-03T00:00:00.000Z';
const FRAME_COUNT = 20;
const PROXY_BYTES = 4_096;
const TIMING_BYTES = 32 + FRAME_COUNT * 8;
const MAXIMUM_PLANS = 4_094;
const STAGING = MEDIA_ASSET_STAGING_STORE_NAME;
const PLAN_ENTRY = { sourceId: SOURCE_ID, plan: {} };

test('a publication is a closed record of exactly its expected project, next project and plans', async (context) => {
	const { repository } = await storage(context);
	const expected = baseProject();
	const project = attachedNext(expected);
	const closure = /unsupported, missing, or extra fields/u;

	await assert.rejects(() => repository.publishIfCurrent({}), closure);
	await assert.rejects(() => repository.publishIfCurrent({ expected, project }), closure);
	await assert.rejects(
		() => repository.publishIfCurrent({ ...publication(expected, project), extra: 1 }),
		closure,
	);
	await assert.rejects(
		() => repository.publishIfCurrent(Object.defineProperty({ expected, project }, 'plans', {
			configurable: true, enumerable: true, get: () => [PLAN_ENTRY],
		})),
		/publication\.plans must be an enumerable data property/u,
	);
});

test('preservation may not change identity, skip a revision, or exceed the revision ceiling', async (context) => {
	const { repository } = await storage(context);
	const expected = baseProject();
	const ceiling = baseProject({ revision: Number.MAX_SAFE_INTEGER });

	await assert.rejects(
		() => repository.publishIfCurrent(publication(expected, attachedNext(expected, (candidate) => {
			candidate.id = 'other-project';
		}))),
		/cannot change project identity/u,
	);
	await assert.rejects(
		() => repository.publishIfCurrent(publication(expected, attachedNext(expected, (candidate) => {
			candidate.revision = 2;
		}))),
		/must publish exactly the next revision/u,
	);
	await assert.rejects(
		() => repository.publishIfCurrent(publication(ceiling, ceiling)),
		{ name: 'RangeError', message: /revision cannot be incremented safely/u },
	);
});

test('a publication that attaches no proxy at all is refused before any claim is consumed', async (context) => {
	const { repository } = await storage(context);
	const expected = baseProject();

	await assert.rejects(
		() => repository.publishIfCurrent(publication(expected, nextProject(expected, () => undefined), [])),
		/requires at least one non-null proxy attachment/u,
	);
});

test('preservation plans must be a dense ordinary array within the plan limit', async (context) => {
	const { repository } = await storage(context);
	const expected = baseProject();
	const project = attachedNext(expected);
	const publish = (plans: unknown): Promise<unknown> => (
		repository.publishIfCurrent(publication(expected, project, plans))
	);
	const sparse: unknown[] = [];
	sparse[1] = PLAN_ENTRY;

	await assert.rejects(() => publish({ length: 1, 0: PLAN_ENTRY }), /plans must be a dense ordinary array/u);
	await assert.rejects(() => publish(sparse), /plans\[0\] must be an enumerable data property/u);
	await assert.rejects(
		() => publish(Object.assign([PLAN_ENTRY], { extra: 1 })),
		/plans has unsupported properties/u,
	);
	await assert.rejects(
		() => publish(Array.from({ length: MAXIMUM_PLANS + 1 }, () => PLAN_ENTRY)),
		{ name: 'RangeError', message: /plan limit was exceeded/u },
	);
});

test('every attachment needs exactly one plan and no source may be planned twice', async (context) => {
	const { repository } = await storage(context);
	const expected = baseProject();
	const project = attachedNext(expected);
	const pair = baseProject({ sources: [videoSource(SOURCE_ID), videoSource(SECOND_SOURCE_ID)] });
	const bothAttached = attachedNext(pair, (candidate) => { attachTo(candidate, SECOND_SOURCE_ID); });

	await assert.rejects(
		() => repository.publishIfCurrent(publication(expected, project, [PLAN_ENTRY, PLAN_ENTRY])),
		/duplicate preservation plans/u,
	);
	await assert.rejects(
		() => repository.publishIfCurrent(publication(expected, project, [{ sourceId: SECOND_SOURCE_ID, plan: {} }])),
		/preservation plan source is not attached/u,
	);
	await assert.rejects(
		() => repository.publishIfCurrent(publication(expected, project, [{ ...PLAN_ENTRY, extra: 1 }])),
		/preservation plan 0 has unsupported, missing, or extra fields/u,
	);
	await assert.rejects(
		() => repository.publishIfCurrent(publication(pair, bothAttached, [PLAN_ENTRY])),
		/Every sequence attachment requires one complete preservation plan/u,
	);
});

test('a pointer publication attaches exactly one source starting from an all-null base', async (context) => {
	const { repository } = await storage(context);
	const pair = baseProject({ sources: [videoSource(SOURCE_ID), videoSource(SECOND_SOURCE_ID)] });
	const bothAttached = attachedNext(pair, (candidate) => { attachTo(candidate, SECOND_SOURCE_ID); });
	const attached = attachedNext(baseProject());
	const refusal = /requires one attachment from an exact all-null base/u;

	await assert.rejects(
		() => repository.publishIfCurrent(publication(pair, bothAttached, [
			PLAN_ENTRY, { sourceId: SECOND_SOURCE_ID, plan: {} },
		])),
		refusal,
	);
	await assert.rejects(
		() => repository.publishIfCurrent(publication(
			attached,
			nextProject(attached, () => undefined, '2026-01-03T00:00:00.000Z'),
		)),
		refusal,
	);
});

test('a pointer publication requires one fresh canonical updatedAt', async (context) => {
	const { repository } = await storage(context);
	const expected = baseProject();
	const publish = (updatedAt: string): Promise<unknown> => repository.publishIfCurrent(
		publication(expected, attachedNext(expected, () => undefined, updatedAt)),
	);

	await assert.rejects(() => publish(BASE_UPDATED_AT), /requires one fresh canonical updatedAt/u);
	await assert.rejects(() => publish('2025-12-31T00:00:00.000Z'), /requires one fresh canonical updatedAt/u);
});

test('a pointer publication may change only its target attachment, requirement and timestamp', async (context) => {
	const { repository } = await storage(context);
	const expected = baseProject();

	await assert.rejects(
		() => repository.publishIfCurrent(publication(expected, attachedNext(expected, (candidate) => {
			candidate.title = 'Renamed';
		}))),
		/may change only its target attachment, owned requirement, revision, and timestamp/u,
	);
});

test('a stored project that no longer matches the expected base is refused without consuming claims', async (context) => {
	const fixture = await prepared(context, { currentProject: baseProject({ title: 'Renamed' }) });

	assert.equal(await fixture.repository.publishIfCurrent(fixture.publication), null);
	assert.deepEqual(
		await read(fixture.database, STAGING, String(fixture.proxyClaim.key)),
		fixture.proxyClaim,
		'a stale compare-and-swap must leave the one-use claims spendable',
	);
	assert.equal(await read(fixture.database, 'revisions', nextRevisionKey(fixture)), undefined);
});

test('the exact base revision record must exist and agree with the current project', async (context) => {
	const missing = await prepared(context, { baseRevisionProject: null });
	const conflicting = await prepared(context, { baseRevisionProject: baseProject({ title: 'Renamed' }) });

	await assert.rejects(
		() => missing.repository.publishIfCurrent(missing.publication),
		/base revision is missing or conflicts with the current project/u,
	);
	await assert.rejects(
		() => conflicting.repository.publishIfCurrent(conflicting.publication),
		/base revision is missing or conflicts with the current project/u,
	);
	assert.deepEqual(await read(conflicting.database, 'projects', PROJECT_ID), conflicting.expected);
});

test('an already occupied next revision refuses the publication', async (context) => {
	const fixture = await prepared(context, { occupyNextRevision: true });

	await assert.rejects(
		() => fixture.repository.publishIfCurrent(fixture.publication),
		/next revision is already occupied/u,
	);
	assert.deepEqual(await read(fixture.database, STAGING, String(fixture.timingClaim.key)), fixture.timingClaim);
});

test('a matching base publishes the attachment, its revision record and both claimed bodies', async (context) => {
	const fixture = await prepared(context);

	const published = await fixture.repository.publishIfCurrent(fixture.publication);

	assert.deepEqual(published, fixture.next);
	assert.notEqual(published, fixture.publication.project, 'the caller must receive a detached snapshot');
	assert.deepEqual(await read(fixture.database, 'projects', PROJECT_ID), fixture.next);
	assert.deepEqual(await read(fixture.database, 'revisions', nextRevisionKey(fixture)), {
		key: nextRevisionKey(fixture), projectId: PROJECT_ID, revision: 1, project: fixture.next,
	});
	assert.deepEqual(await read(fixture.database, STAGING, String(fixture.proxyClaim.key)), undefined);
	assert.deepEqual(await read(fixture.database, STAGING, String(fixture.timingClaim.key)), undefined);
	for (const [kind, digest] of [['proxy', PROXY_DIGEST], ['timing', TIMING_DIGEST]] as const) {
		const row = await read(fixture.database, 'mediaAssets', bodyKey(kind, digest)) as Data;
		assert.equal(Object.hasOwn(row, 'pendingProjectUntil'), false, 'a published body loses its staging fence');
		assert.equal(row.sha256, digest);
	}
	assert.equal(
		await fixture.repository.publishIfCurrent(fixture.publication),
		null,
		'the same publication cannot land twice; its base is no longer current',
	);
});

test('a timing body row that predates the optional summary fields still publishes', async (context) => {
	const fixture = await prepared(context, { timingRow: mediaRow('timing', TIMING_DIGEST, false) });

	assert.deepEqual(await fixture.repository.publishIfCurrent(fixture.publication), fixture.next);
});

test('a forged preservation plan cannot drive a publication and leaves the base untouched', async (context) => {
	const fixture = await prepared(context);

	await assert.rejects(
		() => fixture.repository.publishIfCurrent(publication(fixture.expected, fixture.next)),
		{ name: 'TypeError', message: /not authentic or was already consumed/u },
	);
	assert.deepEqual(await read(fixture.database, 'projects', PROJECT_ID), fixture.expected);
	assert.deepEqual(await read(fixture.database, STAGING, String(fixture.proxyClaim.key)), fixture.proxyClaim);
	assert.equal(await read(fixture.database, 'revisions', nextRevisionKey(fixture)), undefined);
});

test('claims bound to another project, source or base generation are refused', async (context) => {
	const foreignProject = await prepared(context, { claimProjectId: 'other-project' });
	const foreignSource = await prepared(context, { claimSourceId: SECOND_SOURCE_ID });
	const staleBase = await prepared(context, { claimFingerprint: ORIGINAL_DIGEST });

	for (const fixture of [foreignProject, foreignSource, staleBase]) {
		await assert.rejects(
			() => fixture.repository.publishIfCurrent(fixture.publication),
			/does not match its project, source, or base generation/u,
		);
	}
	assert.deepEqual(await read(staleBase.database, 'projects', PROJECT_ID), staleBase.expected);
});

test('a claim that does not describe the exact attachment body is refused', async (context) => {
	const proxy = await prepared(context, { proxyDigest: OTHER_DIGEST });
	const timing = await prepared(context, { timingDigest: OTHER_DIGEST });

	await assert.rejects(
		() => proxy.repository.publishIfCurrent(proxy.publication),
		/proxy claim does not match the exact sequence attachment/u,
	);
	await assert.rejects(
		() => timing.repository.publishIfCurrent(timing.publication),
		/timing claim does not match the exact sequence attachment/u,
	);
});

test('a body row that vanished or changed after claim verification stops the publication', async (context) => {
	const missing = await prepared(context, { proxyRow: null });
	const resized = await prepared(context, {
		timingRow: { ...mediaRow('timing', TIMING_DIGEST), size: TIMING_BYTES + 1 },
	});
	const resummarized = await prepared(context, {
		timingRow: { ...mediaRow('timing', TIMING_DIGEST), frameCount: FRAME_COUNT + 1 },
	});

	await assert.rejects(
		() => missing.repository.publishIfCurrent(missing.publication),
		/The proxy body row changed after claim generation verification/u,
	);
	await assert.rejects(
		() => resized.repository.publishIfCurrent(resized.publication),
		/The timing body row changed after claim generation verification/u,
	);
	await assert.rejects(
		() => resummarized.repository.publishIfCurrent(resummarized.publication),
		/timing body row summary changed before publication/u,
	);
	assert.deepEqual(await read(missing.database, 'projects', PROJECT_ID), missing.expected);
	assert.equal(await read(missing.database, 'revisions', nextRevisionKey(missing)), undefined);
});

function publication(expected: Data, project: Data, plans: unknown = [PLAN_ENTRY]): Data {
	return { expected, project, plans };
}

interface Harness {
	readonly database: IDBDatabase;
	readonly claims: VideoProxyClaimRepository;
	readonly repository: FramescaperProjectSequencePreservationRepository;
}

interface PreparedOptions {
	readonly currentProject?: Data;
	readonly baseRevisionProject?: Data | null;
	readonly occupyNextRevision?: boolean;
	readonly proxyDigest?: string;
	readonly timingDigest?: string;
	readonly claimProjectId?: string;
	readonly claimSourceId?: string;
	readonly claimFingerprint?: string;
	readonly proxyRow?: Data | null;
	readonly timingRow?: Data | null;
}

interface Prepared extends Harness {
	readonly expected: Data;
	readonly next: Data;
	readonly publication: Data;
	readonly proxyClaim: Data;
	readonly timingClaim: Data;
}

async function storage(context: TestContext): Promise<Harness> {
	const database = await openDatabase(
		createInstrumentedIndexedDB() as unknown as IDBFactory,
		`sequence-preservation-${Math.random().toString(36).slice(2)}`,
	);
	context.after(() => database.close());
	const port = { database: async () => database } as unknown as StorageRepositoryPort;
	const claims = new VideoProxyClaimRepository(port);
	const repository = new FramescaperProjectSequencePreservationRepository(PROFILE, { port, claims });
	return { database, claims, repository };
}

/** Seed one all-null base, its revision record, one verified claim pair and both bodies. */
async function prepared(context: TestContext, options: PreparedOptions = {}): Promise<Prepared> {
	const { database, claims, repository } = await storage(context);
	const expected = baseProject();
	const next = attachedNext(expected);
	const proxyDigest = options.proxyDigest ?? PROXY_DIGEST;
	const timingDigest = options.timingDigest ?? TIMING_DIGEST;
	const binding = {
		projectId: options.claimProjectId ?? PROJECT_ID,
		sourceId: options.claimSourceId ?? SOURCE_ID,
		baseFingerprint: options.claimFingerprint ?? framescaperProjectFingerprintSequence(PROFILE, expected),
	};
	const proxyClaim = claimRecord('proxy', proxyDigest, binding);
	const timingClaim = claimRecord('timing', timingDigest, binding);
	const baseRevisionProject = options.baseRevisionProject === undefined
		? expected
		: options.baseRevisionProject;
	const rows = [
		options.proxyRow === undefined ? mediaRow('proxy', proxyDigest) : options.proxyRow,
		options.timingRow === undefined ? mediaRow('timing', timingDigest) : options.timingRow,
	].filter((row): row is Data => row !== null);
	await write(database, 'projects', options.currentProject ?? expected);
	if (baseRevisionProject) await write(database, 'revisions', revisionRecord(baseRevisionProject, 0));
	if (options.occupyNextRevision) await write(database, 'revisions', revisionRecord(next, 1));
	await write(database, STAGING, proxyClaim, timingClaim);
	if (rows.length > 0) await write(database, 'mediaAssets', ...rows);
	const plan = await claims.preparePreservationPlan({
		operationId: OPERATION_ID,
		proxyClaimKey: String(proxyClaim.key),
		timingClaimKey: String(timingClaim.key),
		...binding,
	});
	return {
		database, claims, repository, expected, next, proxyClaim, timingClaim,
		publication: { expected, project: next, plans: [{ sourceId: SOURCE_ID, plan }] },
	};
}

function videoSource(id: string): Data {
	return {
		id, kind: 'video', name: id, sampleFrameCount: 48_000, width: 1_920, height: 1_080,
		sourceFrameCount: FRAME_COUNT, contentSha256: ORIGINAL_DIGEST,
	};
}

/** An attachment is admissible only on a source that has an occurrence, so bin every source. */
function baseProject(overrides: Data = {}): Data {
	const sources = (overrides.sources as Data[] | undefined) ?? [videoSource(SOURCE_ID)];
	return createFramescaperProjectSequence(PROFILE, {
		id: PROJECT_ID,
		title: 'Sequence',
		createdAt: BASE_UPDATED_AT,
		updatedAt: BASE_UPDATED_AT,
		sources,
		projectBin: {
			clips: sources.map((source) => ({
				id: `${String(source.id)}-occurrence`, kind: 'video', sourceId: source.id,
				sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
			})),
		},
		...overrides,
	} as never) as unknown as Data;
}

/** Mirror the transition the repository recomputes: change, reconcile, revalidate. */
function nextProject(expected: Data, change: Change, updatedAt = NEXT_UPDATED_AT): Data {
	const candidate = structuredClone(expected) as Data;
	candidate.revision = Number(expected.revision) + 1;
	candidate.updatedAt = updatedAt;
	change(candidate);
	candidate.featureRequirements = reconcileFramescaperProjectFeatureRequirementsSequence(PROFILE, candidate);
	return cloneFramescaperProjectSequence(PROFILE, candidate) as unknown as Data;
}

function attachedNext(expected: Data, change: Change = () => undefined, updatedAt = NEXT_UPDATED_AT): Data {
	return nextProject(expected, (candidate) => { attachTo(candidate, SOURCE_ID); change(candidate); }, updatedAt);
}

function attachTo(candidate: Data, sourceId: string): void {
	const source = (candidate.sources as Data[]).find((entry) => entry.id === sourceId);
	if (!source) throw new Error(`The fixture has no video source ${sourceId}.`);
	source.proxyAttachment = attachment();
}

function attachment(): Data {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: bodyKey('proxy', PROXY_DIGEST), mimeType: 'video/mp4',
		byteLength: PROXY_BYTES, sha256: PROXY_DIGEST,
		originalSha256: ORIGINAL_DIGEST, originalAuthorityKind: 'owned',
		generatorId: 'framescaper-native-media-host', generatorVersion: 1,
		recipeId: 'framescaper-proxy-mp4-v1', recipeVersion: 1,
		timingBackendId: 'ffmpeg-9.0.1', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: FRAME_COUNT, boundaryCount: FRAME_COUNT + 1,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: bodyKey('timing', TIMING_DIGEST),
			sha256: TIMING_DIGEST, sourceSha256: PROXY_DIGEST, byteLength: TIMING_BYTES,
			frameCount: FRAME_COUNT, timescale: 1, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function bodyKey(bodyKind: BodyKind, digest: string): string {
	return `${bodyKind === 'proxy' ? 'video-proxy-sha256:' : 'video-timing-sha256:'}${digest}`;
}

function rowIdentity(bodyKind: BodyKind, digest: string): Data {
	const proxy = bodyKind === 'proxy';
	return {
		sourceId: bodyKey(bodyKind, digest), kind: proxy ? 'video-proxy' : 'video-timing',
		encoding: proxy ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
		storage: 'opfs', path: `proxy/${bodyKind}-${digest}.bin`,
		mediaChunkToken: null, mediaChunkBytes: null, mediaChunkCount: null,
		mediaContentDigestVersion: 1,
		mediaContentToken: `media-content-${bodyKind}-0000000000000001`,
		sha256: digest, byteLength: proxy ? PROXY_BYTES : TIMING_BYTES,
		mimeType: proxy ? 'video/mp4' : 'application/vnd.soundscaper.video-timing',
	};
}

function claimRecord(
	bodyKind: BodyKind,
	digest: string,
	binding: Readonly<{ projectId: string; sourceId: string; baseFingerprint: string }>,
): Data {
	const key = bodyKey(bodyKind, digest);
	return {
		key: videoProxyClaimKey(OPERATION_ID, bodyKind, key),
		kind: 'video-proxy-claim', schemaVersion: 1, status: 'verified',
		operationId: OPERATION_ID, projectId: binding.projectId, sourceId: binding.sourceId,
		baseFingerprint: binding.baseFingerprint, bodyKind, bodyKey: key,
		generation: 'sequence-proxy-generation-0001',
		createdAt: 1_786_550_400_000, updatedAt: 1_786_550_400_100, expiresAt: 4_102_444_800_000,
		rowIdentity: rowIdentity(bodyKind, digest),
	};
}

function mediaRow(bodyKind: BodyKind, digest: string, withSummary = true): Data {
	const identity = rowIdentity(bodyKind, digest);
	const summary = bodyKind === 'timing' && withSummary
		? { frameCount: FRAME_COUNT, timescale: 1, finalFrameDurationTicks: '1' }
		: {};
	return {
		sourceId: identity.sourceId, kind: identity.kind, encoding: identity.encoding,
		storage: identity.storage, path: identity.path,
		mediaContentDigestVersion: identity.mediaContentDigestVersion,
		mediaContentToken: identity.mediaContentToken, sha256: identity.sha256,
		size: identity.byteLength, mimeType: identity.mimeType,
		pendingProjectUntil: PENDING_UNTIL, ...summary,
	};
}

function revisionRecord(project: Data, revision: number): Data {
	return { key: revisionKey(String(project.id), revision), projectId: project.id, revision, project };
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}

function nextRevisionKey(fixture: Prepared): string {
	return revisionKey(PROJECT_ID, Number(fixture.next.revision));
}

function write(database: IDBDatabase, storeName: string, ...records: readonly Data[]): Promise<void> {
	return transact(database, storeName, 'readwrite', (stores) => {
		for (const record of records) stores[storeName]!.put(record);
	});
}

function read(database: IDBDatabase, storeName: string, key: string): Promise<unknown> {
	return transact(database, storeName, 'readonly', (stores) => request(stores[storeName]!.get(key)));
}
