/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { mediaAssetChunkKey } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORE_NAME } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import type { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { videoProxyClaimKey } from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import { createVideoProxyCleanupTombstone, videoProxyCleanupTombstoneKey } from
	'../src/common/editor/storage/video-proxy-cleanup-tombstone.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { reconcileFramescaperProjectFeatureRequirements } from
	'../src/framescaper/editor-project-feature-requirements.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FramescaperProjectSequenceClaimCleanupRepository } from
	'../src/framescaper/editor-project-sequence-claim-cleanup-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;
type BodyKind = 'proxy' | 'timing';

const STAGING = MEDIA_ASSET_STAGING_STORE_NAME;
const CHUNKS = MEDIA_ASSET_CHUNK_STORE_NAME;
const PROJECT_ID = 'framescaper-cleanup-project';
const SOURCE_ID = 'camera-a';
const OPERATION_ID = 'sequence-cleanup-0001';
const OTHER_OPERATION = 'sequence-cleanup-0002';
const ORIGINAL_DIGEST = 'a'.repeat(64);
const PROXY_DIGEST = 'b'.repeat(64);
const TIMING_DIGEST = 'c'.repeat(64);
const CHUNKED_DIGEST = 'd'.repeat(64);
const SPARE_DIGEST = 'e'.repeat(64);
const FINGERPRINT = 'f'.repeat(64);
const CHUNK_TOKEN = 'media-chunk-token-0000000000000001';
const FRAME_COUNT = 20;
const PROXY_BYTES = 4_096;
const TIMING_BYTES = 32 + FRAME_COUNT * 8;
const CREATED_AT = 1_700_000_000_000;
const LAPSED_AT = 1_700_000_100_000;
const LIVE_AT = 1_900_000_000_000;
const NOW = 1_800_000_000_000;
const GRACE = '2030-01-01T00:00:00.000Z';
const PROXY_BODY = bodyKey('proxy', PROXY_DIGEST);
const TIMING_BODY = bodyKey('timing', TIMING_DIGEST);
const CHUNKED_BODY = bodyKey('proxy', CHUNKED_DIGEST);
const EMPTY_SCOPE = { sessionProjects: [], histories: [], pendingSaveSnapshots: [] };
const OPERATION = { operationId: OPERATION_ID, projectId: PROJECT_ID, sourceId: SOURCE_ID, baseFingerprint: FINGERPRINT };

test('the constructor refuses dependencies without a durable port, an OPFS repository and a clock', () => {
	const port = { memory: {}, database: async () => null } as unknown as StorageRepositoryPort;
	const opfs = { directory: async () => null } as unknown as OpfsRepository;
	const build = (dependencies: unknown): unknown => (
		new FramescaperProjectSequenceClaimCleanupRepository(PROFILE, dependencies)
	);

	assert.throws(() => build({ port, opfs, extra: 1 }), /dependencies has an unsupported field/u);
	assert.throws(() => build({ opfs }), /dependencies\.port is required/u);
	assert.throws(() => build({ port: {}, opfs }), /storage repository port is required/u);
	assert.throws(() => build({ port, opfs: {} }), /OPFS repository is required/u);
	assert.throws(() => build({ port, opfs, now: 5 }), /clock must be a function/u);
	assert.throws(
		() => build({ port, opfs, maximumInventory: 0 }),
		{ name: 'RangeError', message: /inventory limit must be a positive safe integer/u },
	);
	assert.throws(() => new FramescaperProjectSequenceClaimCleanupRepository({}, { port, opfs }), TypeError);
});

test('reconcile refuses a scope that is not a closed record of dense project collections', async (context) => {
	const { repository } = await harness(context);
	const sparse: unknown[] = [];
	sparse[1] = project();

	await assert.rejects(() => repository.reconcile({ sessionProjects: [] }), /scope\.histories is required/u);
	await assert.rejects(() => repository.reconcile({ ...EMPTY_SCOPE, extra: 1 }), /scope has an unsupported field/u);
	await assert.rejects(
		() => repository.reconcile({ ...EMPTY_SCOPE, sessionProjects: sparse }), /session projects is sparse/u,
	);
	await assert.rejects(
		() => repository.reconcile({ ...EMPTY_SCOPE, pendingSaveSnapshots: new Map() }),
		/pending saves must be a dense array or plain Set/u,
	);
});

test('reconcile refuses a runtime scope wider than the bounded inventory limit', async (context) => {
	const { repository } = await harness(context, { maximumInventory: 1 });
	const present = project();

	await assert.rejects(
		() => repository.reconcile({
			sessionProjects: [present],
			histories: [{ limit: 50, present, undoStack: [], redoStack: [] }],
			pendingSaveSnapshots: [],
		}),
		{ name: 'RangeError', message: /runtime inventory limit was exceeded/u },
	);
});

test('reconcile refuses to run at all without durable storage', async (context) => {
	const { repository } = await harness(context, { database: null });

	await assert.rejects(() => repository.reconcile(EMPTY_SCOPE), /memory sequence claim cleanup is unsupported/u);
});

test('reconcile reserves, deletes and settles one lapsed OPFS claim', async (context) => {
	const identity = opfsIdentity('proxy', PROXY_DIGEST);
	const { repository, database, removed } = await harness(context, {
		staging: [claim(identity)], rows: [mediaRow(identity)],
	});

	const result = await repository.reconcile(EMPTY_SCOPE);

	assert.deepEqual(result, { status: 'settled', promotedClaimKeys: [], cleanedBodyKeys: [PROXY_BODY], issues: [] });
	assert.deepEqual(removed, [identity.path]);
	assert.deepEqual(await stagingKeys(database), ['state']);
	assert.equal(await read(database, 'mediaAssets', PROXY_BODY), undefined);
});

test('a chunk-stored claim is cleaned only while its exact chunk generation is still present', async (context) => {
	const identity = chunkIdentity(CHUNKED_DIGEST);
	const seed = { staging: [claim(identity)], rows: [mediaRow(identity)] };
	const intact = await harness(context, { ...seed, chunks: [chunkRecord(CHUNKED_BODY)] });
	const emptied = await harness(context, seed);

	const intactResult = await intact.repository.reconcile(EMPTY_SCOPE);
	const emptiedResult = await emptied.repository.reconcile(EMPTY_SCOPE);

	assert.deepEqual(intactResult, {
		status: 'settled', promotedClaimKeys: [], cleanedBodyKeys: [CHUNKED_BODY], issues: [],
	});
	assert.deepEqual(intact.removed, [], 'a chunk-stored body never reaches the OPFS directory');
	assert.deepEqual(await storeValues(intact.database, CHUNKS), []);
	assert.deepEqual(emptiedResult, indeterminate('chunk-generation-changed', CHUNKED_BODY));
	assert.notEqual(await read(emptied.database, 'mediaAssets', CHUNKED_BODY), undefined);
});

test('a claim is left alone while its own lease or its body row grace still runs', async (context) => {
	const identity = opfsIdentity('proxy', PROXY_DIGEST);
	const leased = await harness(context, {
		staging: [claim(identity, { expiresAt: LIVE_AT })], rows: [mediaRow(identity)],
	});
	const graced = await harness(context, {
		staging: [claim(identity)], rows: [mediaRow(identity, { pendingProjectUntil: GRACE })],
	});

	assert.deepEqual(await leased.repository.reconcile(EMPTY_SCOPE), settled());
	assert.deepEqual(await graced.repository.reconcile(EMPTY_SCOPE), settled());
	assert.equal((await stagingKeys(leased.database)).length, 2);
	assert.equal((await stagingKeys(graced.database)).length, 2);
});

test('a body still rooted by a runtime project or claimed twice is reported as another root', async (context) => {
	const identity = opfsIdentity('proxy', PROXY_DIGEST);
	const rooted = await harness(context, { staging: [claim(identity)], rows: [mediaRow(identity)] });
	const shared = await harness(context, {
		staging: [claim(identity), claim(identity, { operationId: OTHER_OPERATION })],
		rows: [mediaRow(identity)],
	});

	const rootedResult = await rooted.repository.reconcile({
		...EMPTY_SCOPE, pendingSaveSnapshots: new Set([attachedProject()]),
	});
	const sharedResult = await shared.repository.reconcile(EMPTY_SCOPE);

	assert.deepEqual(rootedResult, indeterminate('other-root', PROXY_BODY));
	assert.deepEqual(sharedResult, indeterminate('other-root', PROXY_BODY));
	assert.equal((await stagingKeys(shared.database)).length, 3, 'both claims survive');
});

test('a body row that vanished or no longer matches the claim generation stops the cleanup', async (context) => {
	const identity = opfsIdentity('proxy', PROXY_DIGEST);
	const resized = await harness(context, {
		staging: [claim(identity)], rows: [mediaRow(identity, { size: PROXY_BYTES + 1 })],
	});
	const missing = await harness(context, { staging: [claim(identity)] });

	const changed = indeterminate('body-generation-changed', PROXY_BODY);

	assert.deepEqual(await resized.repository.reconcile(EMPTY_SCOPE), changed);
	assert.deepEqual(await missing.repository.reconcile(EMPTY_SCOPE), changed);
});

test('a physical path a second media row also references is reported as a shared identity', async (context) => {
	const identity = opfsIdentity('proxy', PROXY_DIGEST);
	const { repository, database } = await harness(context, {
		staging: [claim(identity)],
		rows: [mediaRow(identity), mediaRow(identity, { sourceId: bodyKey('proxy', SPARE_DIGEST) })],
	});

	const result = await repository.reconcile(EMPTY_SCOPE);

	assert.deepEqual(result, indeterminate('shared-physical-identity', PROXY_BODY));
	assert.notEqual(await read(database, 'mediaAssets', PROXY_BODY), undefined);
});

test('a foreign staging record already holding the tombstone key blocks the reservation', async (context) => {
	const identity = opfsIdentity('proxy', PROXY_DIGEST);
	const { repository, database } = await harness(context, {
		staging: [claim(identity), { key: videoProxyCleanupTombstoneKey(PROXY_BODY), kind: 'lease' }],
		rows: [mediaRow(identity)],
	});

	const result = await repository.reconcile(EMPTY_SCOPE);

	assert.deepEqual(result, indeterminate('tombstone-reservation-conflict', PROXY_BODY));
	assert.notEqual(await read(database, 'mediaAssets', PROXY_BODY), undefined);
});

test('colliding tombstones and an overflowing durable inventory both invalidate the run', async (context) => {
	const proxy = opfsIdentity('proxy', PROXY_DIGEST);
	const collided = await harness(context, {
		staging: [
			tombstone(claim(proxy)),
			tombstone(claim(opfsIdentity('timing', TIMING_DIGEST, { path: String(proxy.path) }))),
		],
	});
	const overflowing = await harness(context, {
		maximumInventory: 1, staging: [claim(proxy)], rows: [mediaRow(proxy)],
	});

	const invalid = indeterminate('inventory-invalid', null);

	assert.deepEqual(await collided.repository.reconcile(EMPTY_SCOPE), invalid);
	assert.deepEqual(
		await overflowing.repository.reconcile({ ...EMPTY_SCOPE, sessionProjects: [project()] }), invalid,
	);
});

test('a claim pair committed by a durable revision is promoted out of staging', async (context) => {
	const proxy = opfsIdentity('proxy', PROXY_DIGEST);
	const timing = opfsIdentity('timing', TIMING_DIGEST);
	const { repository, database, removed } = await harness(context, {
		staging: [claim(proxy), claim(timing)],
		rows: [mediaRow(proxy, { pendingProjectUntil: GRACE }), mediaRow(timing, { pendingProjectUntil: GRACE })],
		revisions: [revisionRecord(attachedProject())],
	});

	const result = await repository.reconcile(EMPTY_SCOPE);

	assert.deepEqual(result, {
		status: 'settled',
		promotedClaimKeys: [
			videoProxyClaimKey(OPERATION_ID, 'proxy', PROXY_BODY),
			videoProxyClaimKey(OPERATION_ID, 'timing', TIMING_BODY),
		].sort(),
		cleanedBodyKeys: [], issues: [],
	});
	assert.deepEqual(await stagingKeys(database), ['state']);
	assert.deepEqual(removed, [], 'a promoted body is never physically deleted');
	const published = await read(database, 'mediaAssets', PROXY_BODY) as Data;
	assert.equal(Object.hasOwn(published, 'pendingProjectUntil'), false);
});

test('a committed attachment without its exact verified claim pair is reported as a mismatch', async (context) => {
	const proxy = opfsIdentity('proxy', PROXY_DIGEST);
	const timing = opfsIdentity('timing', TIMING_DIGEST);
	const lone = await harness(context, {
		staging: [claim(proxy)], rows: [mediaRow(proxy)], projects: [attachedProject()],
	});
	const unverified = await harness(context, {
		staging: [claim(proxy), claim(timing, { status: 'unverified' })],
		rows: [mediaRow(proxy), mediaRow(timing)],
		projects: [attachedProject()],
	});

	const mismatch = indeterminate('committed-claim-mismatch', PROXY_BODY);

	assert.deepEqual(await lone.repository.reconcile(EMPTY_SCOPE), mismatch);
	assert.deepEqual(await unverified.repository.reconcile(EMPTY_SCOPE), {
		status: 'indeterminate', promotedClaimKeys: [], cleanedBodyKeys: [],
		issues: [PROXY_BODY, TIMING_BODY].map((body) => ({ code: 'committed-claim-mismatch', bodyKey: body })),
	});
	assert.equal((await stagingKeys(lone.database)).length, 2, 'the claim is retained for a retry');
});

test('an indeterminate physical deletion retains a failed tombstone for a later attempt', async (context) => {
	const identity = opfsIdentity('proxy', PROXY_DIGEST);
	const seed = { staging: [claim(identity)], rows: [mediaRow(identity)] };
	const failing = await harness(context, { ...seed, removeFailure: new Error('device busy') });
	const unavailable = await harness(context, { ...seed, directory: null });

	const failingResult = await failing.repository.reconcile(EMPTY_SCOPE);
	const unavailableResult = await unavailable.repository.reconcile(EMPTY_SCOPE);

	const failed = indeterminate('physical-cleanup-failed', PROXY_BODY);
	assert.deepEqual(failingResult, failed);
	assert.deepEqual(unavailableResult, failed);
	const retained = await read(failing.database, STAGING, videoProxyCleanupTombstoneKey(PROXY_BODY)) as Data;
	assert.equal(retained.status, 'cleanup-failed');
	assert.equal(retained.failureCount, 1);
	assert.equal(retained.updatedAt, NOW);
});

test('an already absent OPFS entry settles the cleanup instead of failing it', async (context) => {
	const identity = opfsIdentity('proxy', PROXY_DIGEST);
	const { repository, database } = await harness(context, {
		staging: [claim(identity)],
		rows: [mediaRow(identity)],
		removeFailure: new DOMException('already gone', 'NotFoundError'),
	});

	const result = await repository.reconcile(EMPTY_SCOPE);

	assert.deepEqual(result.cleanedBodyKeys, [PROXY_BODY]);
	assert.equal(result.status, 'settled');
	assert.deepEqual(await stagingKeys(database), ['state']);
});

test('cleanupOperation refuses an identity that is not a closed record with a SHA-256 fingerprint', async (context) => {
	const { repository } = await harness(context);

	const refuse = (operation: Data, message: RegExp): Promise<void> => assert.rejects(
		() => repository.cleanupOperation({ ...OPERATION, ...operation }, EMPTY_SCOPE), message,
	);

	await refuse({ extra: 1 }, /operation has an unsupported field/u);
	await refuse({ baseFingerprint: 'F'.repeat(64) }, /lowercase SHA-256 cleanup base fingerprint is required/u);
	await refuse({ sourceId: 'with space' }, /bounded printable cleanup source id is required/u);
});

test('cleanupOperation cleans only its own live claim and leaves every other operation staged', async (context) => {
	const mine = opfsIdentity('proxy', PROXY_DIGEST);
	const theirs = opfsIdentity('proxy', SPARE_DIGEST);
	const { repository, database, removed } = await harness(context, {
		staging: [
			claim(mine, { expiresAt: LIVE_AT }),
			claim(theirs, { expiresAt: LIVE_AT, operationId: OTHER_OPERATION }),
		],
		rows: [mediaRow(mine), mediaRow(theirs)],
	});

	const result = await repository.cleanupOperation(OPERATION, EMPTY_SCOPE);

	assert.deepEqual(result.cleanedBodyKeys, [PROXY_BODY]);
	assert.equal(result.status, 'settled');
	assert.deepEqual(removed, [mine.path]);
	assert.deepEqual(await stagingKeys(database), [
		'state', videoProxyClaimKey(OTHER_OPERATION, 'proxy', bodyKey('proxy', SPARE_DIGEST)),
	].sort());
});

test('a durable revision record that is not its exact project snapshot fails the reconcile', async (context) => {
	const attached = attachedProject();
	const renumbered = await harness(context, { revisions: [{ ...revisionRecord(attached), revision: 7 }] });
	const forged = await harness(context, {
		revisions: [{ ...revisionRecord(attached), creationFence: 'project_creation_nope' }],
	});

	await assert.rejects(
		() => renumbered.repository.reconcile(EMPTY_SCOPE), /revision record must match its exact project snapshot/u,
	);
	await assert.rejects(() => forged.repository.reconcile(EMPTY_SCOPE), /revision creation fence is invalid/u);
});

interface Harness {
	readonly database: IDBDatabase;
	readonly repository: FramescaperProjectSequenceClaimCleanupRepository;
	readonly removed: string[];
}

interface HarnessOptions {
	readonly database?: IDBDatabase | null;
	readonly directory?: null;
	readonly removeFailure?: unknown;
	readonly maximumInventory?: number;
	readonly staging?: readonly Data[];
	readonly rows?: readonly Data[];
	readonly chunks?: readonly Data[];
	readonly projects?: readonly Data[];
	readonly revisions?: readonly Data[];
}

async function harness(context: TestContext, options: HarnessOptions = {}): Promise<Harness> {
	const database = await openDatabase(
		createInstrumentedIndexedDB() as unknown as IDBFactory,
		`sequence-claim-cleanup-${Math.random().toString(36).slice(2)}`,
	);
	context.after(() => database.close());
	const removed: string[] = [];
	const directory = {
		async removeEntry(path: string): Promise<void> {
			removed.push(path);
			if (options.removeFailure !== undefined) throw options.removeFailure;
		},
	};
	const repository = new FramescaperProjectSequenceClaimCleanupRepository(PROFILE, {
		port: {
			memory: {},
			database: async () => (options.database === undefined ? database : options.database),
		} as unknown as StorageRepositoryPort,
		opfs: { directory: async () => (options.directory === null ? null : directory) } as unknown as OpfsRepository,
		now: () => NOW,
		...(options.maximumInventory === undefined ? {} : { maximumInventory: options.maximumInventory }),
	});
	await write(database, STAGING, options.staging);
	await write(database, 'mediaAssets', options.rows);
	await write(database, CHUNKS, options.chunks);
	await write(database, 'projects', options.projects);
	await write(database, 'revisions', options.revisions);
	return { database, repository, removed };
}

function settled(): Data {
	return { status: 'settled', promotedClaimKeys: [], cleanedBodyKeys: [], issues: [] };
}

function indeterminate(code: string, key: string | null): Data {
	return {
		status: 'indeterminate', promotedClaimKeys: [], cleanedBodyKeys: [],
		issues: [{ code, bodyKey: key }],
	};
}

function bodyKey(bodyKind: BodyKind, digest: string): string {
	return `${bodyKind === 'proxy' ? 'video-proxy-sha256:' : 'video-timing-sha256:'}${digest}`;
}

function identityBase(bodyKind: BodyKind, digest: string): Data {
	const proxy = bodyKind === 'proxy';
	return {
		sourceId: bodyKey(bodyKind, digest), kind: proxy ? 'video-proxy' : 'video-timing',
		encoding: proxy ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
		mediaContentDigestVersion: 1, mediaContentToken: `media-content-${bodyKind}-0000000000000001`,
		sha256: digest, byteLength: proxy ? PROXY_BYTES : TIMING_BYTES,
		mimeType: proxy ? 'video/mp4' : 'application/vnd.soundscaper.video-timing',
	};
}

function opfsIdentity(bodyKind: BodyKind, digest: string, overrides: Data = {}): Data {
	return {
		...identityBase(bodyKind, digest), storage: 'opfs', path: `proxy/${bodyKind}-${digest}.bin`,
		mediaChunkToken: null, mediaChunkBytes: null, mediaChunkCount: null, ...overrides,
	};
}

function chunkIdentity(digest: string): Data {
	return {
		...identityBase('proxy', digest), storage: 'indexeddb-media-chunks-v1', path: null,
		mediaChunkToken: CHUNK_TOKEN, mediaChunkBytes: PROXY_BYTES, mediaChunkCount: 1,
	};
}

function claim(identity: Data, overrides: Data = {}): Data {
	const bodyKind: BodyKind = identity.kind === 'video-proxy' ? 'proxy' : 'timing';
	const body = String(identity.sourceId);
	const operationId = String(overrides.operationId ?? OPERATION_ID);
	return {
		key: videoProxyClaimKey(operationId, bodyKind, body), kind: 'video-proxy-claim',
		schemaVersion: 1, status: 'verified', operationId, projectId: PROJECT_ID, sourceId: SOURCE_ID,
		baseFingerprint: FINGERPRINT, bodyKind, bodyKey: body, generation: 'cleanup-generation-0001',
		createdAt: CREATED_AT, updatedAt: CREATED_AT, expiresAt: LAPSED_AT, rowIdentity: identity,
		...overrides,
	};
}

function tombstone(claimRecord: Data): Data {
	return createVideoProxyCleanupTombstone(claimRecord, CREATED_AT) as unknown as Data;
}

function mediaRow(identity: Data, overrides: Data = {}): Data {
	return {
		sourceId: identity.sourceId, kind: identity.kind, encoding: identity.encoding,
		storage: identity.storage, path: identity.path, mediaChunkToken: identity.mediaChunkToken,
		mediaChunkBytes: identity.mediaChunkBytes, mediaChunkCount: identity.mediaChunkCount,
		mediaContentDigestVersion: identity.mediaContentDigestVersion,
		mediaContentToken: identity.mediaContentToken, sha256: identity.sha256,
		size: identity.byteLength, mimeType: identity.mimeType, ...overrides,
	};
}

function chunkRecord(sourceId: string): Data {
	return {
		key: mediaAssetChunkKey(CHUNK_TOKEN, 0), sourceId, mediaChunkToken: CHUNK_TOKEN, index: 0,
		payload: new Blob([new Uint8Array(PROXY_BYTES)]), byteLength: PROXY_BYTES, createdAt: CREATED_AT,
	};
}

/** An attachment is admissible only on a source that has an occurrence, so bin the source. */
function project(): Data {
	return createFramescaperProject(PROFILE, {
		id: PROJECT_ID, title: 'Cleanup',
		createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
		sources: [{
			id: SOURCE_ID, kind: 'video', name: SOURCE_ID, sampleFrameCount: 48_000,
			width: 1_920, height: 1_080, sourceFrameCount: FRAME_COUNT, contentSha256: ORIGINAL_DIGEST,
		}],
		projectBin: {
			clips: [{
				id: `${SOURCE_ID}-occurrence`, kind: 'video', sourceId: SOURCE_ID,
				sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
			}],
		},
	} as never) as unknown as Data;
}

/** The creator drops a proxy attachment, so attach it the way the editor does: mutate, reconcile. */
function attachedProject(): Data {
	const attached = structuredClone(project());
	(attached.sources as Data[])[0]!.proxyAttachment = {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: PROXY_BODY, mimeType: 'video/mp4',
		byteLength: PROXY_BYTES, sha256: PROXY_DIGEST,
		originalSha256: ORIGINAL_DIGEST, originalAuthorityKind: 'owned',
		generatorId: 'framescaper-native-media-host', generatorVersion: 1,
		recipeId: 'framescaper-proxy-mp4-v1', recipeVersion: 1,
		timingBackendId: 'ffmpeg-9.0.1', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: FRAME_COUNT, boundaryCount: FRAME_COUNT + 1,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: TIMING_BODY,
			sha256: TIMING_DIGEST, sourceSha256: PROXY_DIGEST, byteLength: TIMING_BYTES,
			frameCount: FRAME_COUNT, timescale: 1, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	attached.featureRequirements = reconcileFramescaperProjectFeatureRequirements(PROFILE, attached);
	return attached;
}

function revisionRecord(snapshot: Data): Data {
	const revision = Number(snapshot.revision);
	return {
		key: `${PROJECT_ID}:${String(revision).padStart(12, '0')}`,
		projectId: PROJECT_ID, revision, project: snapshot,
	};
}

function write(database: IDBDatabase, storeName: string, records: readonly Data[] = []): Promise<void> {
	return transact(database, storeName, 'readwrite', (stores) => {
		for (const record of records) stores[storeName]!.put(record);
	});
}

function read(database: IDBDatabase, storeName: string, key: string): Promise<unknown> {
	return transact(database, storeName, 'readonly', (stores) => request(stores[storeName]!.get(key)));
}

function storeValues(database: IDBDatabase, storeName: string): Promise<Data[]> {
	return transact(database, storeName, 'readonly', (stores) => (
		request(stores[storeName]!.getAll() as IDBRequest<Data[]>)
	));
}

async function stagingKeys(database: IDBDatabase): Promise<string[]> {
	return (await storeValues(database, STAGING)).map((value) => String(value.key)).sort();
}
