/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CapturedVideoProxyBodyStagingError, createCapturedVideoProxyAttachment,
	releaseReusedCapturedVideoProxyClaims, stageCapturedVideoProxyBodies,
	type CapturedVideoProxyBodyStore, type CapturedVideoProxyClaimContext,
	type StagedCapturedVideoProxyBody,
} from '../src/framescaper/editor-captured-video-proxy-bodies.ts';
import { MediaPublicationReconciliationError } from '../src/common/editor/storage/media-asset-owned-publication.ts';
import type { VideoProxyClaimedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import { digestMediaContent, MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../src/common/editor/storage/media-content-digest.ts';
import type { VideoProxyClaimRecord } from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import type { VideoProxyClaimStagingInput } from '../src/common/editor/storage/video-proxy-claim-staging-record.ts';
import type { VideoProxyClaimStagingRepository } from '../src/common/editor/storage/video-proxy-claim-staging-repository.ts';
import type { VideoProxyAttachmentV18 } from '../src/common/editor/video-proxy-attachment-v18.ts';
import type {
	VideoProxyRelationshipInfo as Info,
	VideoProxyRelationshipPreparationMaterial as Material,
} from '../src/common/editor/video-proxy-relationship.ts';
import {
	createVideoTimingAssetPublication, VIDEO_TIMING_ASSET_MIME_TYPE, type VideoTimingAssetPublication,
} from '../src/common/editor/video-timing-asset.ts';

const CANDIDATE_TEXT = 'canonical-captured-proxy-body';
const CANDIDATE_BYTES = 29;
const TIMING_BYTES = 56;
const CHUNK_BYTES = 8;
const ORIGINAL_SHA256 = 'a1'.repeat(32);
const OTHER_SHA256 = 'b2'.repeat(32);
const TIMING_INPUT = Object.freeze({
	timescale: 24_000,
	presentationTicks: Object.freeze([0n, 1001n, 2002n]) as readonly bigint[],
	finalFrameDurationTicks: 1001n,
});
const CONTEXT: CapturedVideoProxyClaimContext = Object.freeze({
	operationId: 'capture-operation-1', projectId: 'captured-project',
	sourceId: 'captured-source', baseFingerprint: 'c3'.repeat(32),
});

type Attachment = Readonly<VideoProxyAttachmentV18>;
type Claim = Readonly<VideoProxyClaimRecord>;
type Data = Readonly<Record<string, unknown>>;
type Signalled = Readonly<{ signal?: AbortSignal }>;

interface WriteAttempt {
	readonly key: string; readonly metadata: Data; readonly expectedBytes: number;
	readonly expectedSha256: string; readonly signalled: boolean; readonly chunks: number[];
	committed: VideoProxyClaimStagingInput | null; commitSignalled: boolean; aborts: number;
}

/** The module never inspects a claim beyond its body identity, so a shaped stand-in suffices. */
function claimRecord(input: VideoProxyClaimStagingInput, status: 'unverified' | 'verified'): Claim {
	return Object.freeze({
		key: `video-proxy-claim:${input.bodyKey}`, kind: 'video-proxy-claim', schemaVersion: 1,
		status, generation: 'video-proxy-generation-fixture', ...input,
		rowIdentity: Object.freeze({ byteLength: input.byteLength, mimeType: input.mimeType }),
	}) as unknown as Claim;
}

class FakeStore implements CapturedVideoProxyBodyStore {
	readonly rows = new Map<string, unknown>();
	readonly bodies = new Map<string, Uint8Array>();
	readonly metadataProbes: string[] = [];
	readonly loads: [string, boolean][] = [];
	readonly writes: WriteAttempt[] = [];
	writerOverride: unknown = undefined;
	onWrite: ((attempt: WriteAttempt, index: number) => void) | null = null;
	loadOverride: ((key: string) => unknown) | null = null;
	commitFailure: unknown = null; abortFailure: unknown = null;

	async getMediaAssetMetadata(sourceId: string): Promise<unknown> {
		this.metadataProbes.push(sourceId);
		return this.rows.has(sourceId) ? this.rows.get(sourceId) : null;
	}

	async loadMediaAsset(sourceId: string, options: Signalled = {}): Promise<unknown> {
		this.loads.push([sourceId, Boolean(options.signal)]);
		if (this.loadOverride) return this.loadOverride(sourceId);
		const bytes = this.bodies.get(sourceId);
		if (!bytes) throw new Error(`The fixture holds no body for ${sourceId}.`);
		return new Blob([bytes as Uint8Array<ArrayBuffer>]);
	}

	async beginMediaAssetWrite(
		sourceId: string, metadata: Data,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): Promise<VideoProxyClaimedMediaAssetWriter> {
		const attempt: WriteAttempt = {
			key: sourceId, metadata, expectedBytes: options.expectedBytes,
			expectedSha256: options.expectedSha256, signalled: Boolean(options.signal),
			chunks: [], committed: null, commitSignalled: false, aborts: 0,
		};
		this.writes.push(attempt);
		if (this.writerOverride !== undefined) return this.writerOverride as VideoProxyClaimedMediaAssetWriter;
		return this.#writer(attempt);
	}

	/** Only the four members assertWriter demands are modelled; the owned commits never run. */
	#writer(attempt: WriteAttempt): VideoProxyClaimedMediaAssetWriter {
		const parts: Uint8Array[] = [];
		const written = (): number => parts.reduce((total, part) => total + part.byteLength, 0);
		// Arrow members so the fake writer reads the store it belongs to without
		// aliasing `this` into a local the lint rule forbids.
		return {
			maximumChunkBytes: CHUNK_BYTES,
			write: async (bytes: Uint8Array): Promise<void> => {
				const index = attempt.chunks.length;
				attempt.chunks.push(bytes.byteLength);
				this.onWrite?.(attempt, index);
				parts.push(bytes.slice());
			},
			commitVideoProxyClaim: async (input: VideoProxyClaimStagingInput, options: Signalled = {}) => {
				attempt.committed = input;
				attempt.commitSignalled = Boolean(options.signal);
				if (this.commitFailure) throw this.commitFailure;
				const joined = new Uint8Array(written());
				let offset = 0;
				for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
				this.bodies.set(attempt.key, joined);
				return Object.freeze({ metadata: {}, claim: claimRecord(input, 'unverified') });
			},
			abort: async (): Promise<void> => {
				attempt.aborts += 1;
				if (this.abortFailure) throw this.abortFailure;
			},
		} as unknown as VideoProxyClaimedMediaAssetWriter;
	}
}

class FakeStaging {
	readonly created: VideoProxyClaimStagingInput[] = []; readonly verifiedNew: Claim[] = [];
	readonly released: Claim[] = []; readonly signals: boolean[] = [];
	verifyFailure: ((claim: Claim) => unknown) | null = null;
	releaseFailure: ((claim: Claim) => unknown) | null = null;

	async createVerifiedClaim(input: VideoProxyClaimStagingInput, options: Signalled = {}): Promise<Claim> {
		this.created.push(input);
		this.signals.push(Boolean(options.signal));
		return claimRecord(input, 'verified');
	}

	async verifyNewBodyClaim(claim: Claim, options: Signalled = {}): Promise<Claim> {
		this.verifiedNew.push(claim);
		this.signals.push(Boolean(options.signal));
		const failure = this.verifyFailure?.(claim);
		if (failure !== undefined && failure !== null) throw failure;
		return Object.freeze({ ...claim, status: 'verified' }) as unknown as Claim;
	}

	async releaseVerifiedClaimIfCurrent(claim: Claim): Promise<boolean> {
		const failure = this.releaseFailure?.(claim);
		if (failure !== undefined && failure !== null) throw failure;
		this.released.push(claim);
		return true;
	}

	repository(): VideoProxyClaimStagingRepository {
		return this as unknown as VideoProxyClaimStagingRepository;
	}
}

async function buildMaterial(
	options: Readonly<{ info?: Data; timingPublication?: VideoTimingAssetPublication }> = {},
): Promise<Material> {
	const candidate = new Blob([CANDIDATE_TEXT], { type: 'video/webm' });
	const candidateSha256 = await digestMediaContent(candidate);
	const info: Data = {
		kind: 'video-proxy-relationship', version: 1, projectId: CONTEXT.projectId,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		originalSourceId: CONTEXT.sourceId, originalSha256: ORIGINAL_SHA256, originalAuthorityKind: 'owned',
		candidateSha256, candidateByteLength: candidate.size, candidateMimeType: candidate.type,
		generatorId: 'fixture-generator', generatorVersion: 3, recipeId: 'fixture-proxy-recipe',
		recipeVersion: 7, timingBackendId: 'fixture-timing-backend',
		timingRule: 'exact-presentation-boundaries-v1', frameCount: TIMING_INPUT.presentationTicks.length,
		boundaryCount: TIMING_INPUT.presentationTicks.length + 1,
		audioPolicy: 'ignore-proxy-container-audio-v1', ...options.info,
	};
	return {
		relationship: Object.freeze({ kind: 'video-proxy-relationship', version: 1 }) as never,
		candidate,
		timingPublication: options.timingPublication
			?? createVideoTimingAssetPublication(candidateSha256, TIMING_INPUT),
		info: info as unknown as Info,
	};
}

function sourceRecord(material: Material, overrides: Data = {}): Data {
	return {
		kind: 'video', contentSha256: material.info.originalSha256,
		sourceFrameCount: material.info.frameCount, ...overrides,
	};
}

async function scene() {
	const material = await buildMaterial();
	const attachment = await createCapturedVideoProxyAttachment(material, sourceRecord(material));
	const store = new FakeStore();
	const staging = new FakeStaging();
	return {
		material, attachment, store, staging,
		proxyKey: attachment.storageKey, timingKey: attachment.timingAsset.storageKey,
		stage: (signal?: AbortSignal): Promise<readonly StagedCapturedVideoProxyBody[]> =>
			stageCapturedVideoProxyBodies(store, staging.repository(), material, attachment, CONTEXT, signal),
	};
}

function proxyRow(attachment: Attachment): Record<string, unknown> {
	return {
		sourceId: attachment.storageKey, kind: 'video-proxy', encoding: 'video-proxy-v1',
		sha256: attachment.sha256, size: attachment.byteLength, mimeType: attachment.mimeType,
	};
}

function timingRow(attachment: Attachment): Record<string, unknown> {
	return {
		sourceId: attachment.timingAsset.storageKey, kind: 'video-timing',
		encoding: 'soundscaper-video-timing-v1', sha256: attachment.timingAsset.sha256,
		size: attachment.timingAsset.byteLength, mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
	};
}

function attachmentRefusal(material: Material, source: Data, refusal: RegExp): Promise<void> {
	return assert.rejects(() => createCapturedVideoProxyAttachment(material, source), refusal);
}

async function stagingFailure(run: () => Promise<unknown>): Promise<CapturedVideoProxyBodyStagingError> {
	try {
		await run();
	} catch (error) {
		assert.ok(error instanceof CapturedVideoProxyBodyStagingError, String(error));
		return error;
	}
	return assert.fail('staging resolved where a refusal was required');
}

test('a matching candidate, timing publication and source yield the frozen proxy attachment', async () => {
	const material = await buildMaterial();
	const attachment = await createCapturedVideoProxyAttachment(material, sourceRecord(material));
	assert.equal(attachment.sha256, material.info.candidateSha256);
	assert.equal(attachment.storageKey, `video-proxy-sha256:${material.info.candidateSha256}`);
	assert.equal(attachment.byteLength, CANDIDATE_BYTES);
	assert.equal(attachment.mimeType, 'video/webm');
	assert.deepEqual([attachment.frameCount, attachment.boundaryCount], [3, 4]);
	assert.equal(attachment.originalSha256, ORIGINAL_SHA256);
	assert.deepEqual(attachment.timingAsset, material.timingPublication.reference);
	assert.equal(attachment.timingAsset.byteLength, TIMING_BYTES);
	assert.equal(Object.isFrozen(attachment), true);
});

test('an already cancelled attachment request throws its own abort reason', async () => {
	const material = await buildMaterial();
	const controller = new AbortController();
	const reason = new Error('the capture was cancelled by its caller');
	controller.abort(reason);
	await assert.rejects(
		() => createCapturedVideoProxyAttachment(material, sourceRecord(material), controller.signal),
		(error: unknown) => error === reason,
	);
	// A reasonless aborted signal is the only path to the module's own cancellation error.
	const reasonless = { aborted: true, reason: undefined } as unknown as AbortSignal;
	await assert.rejects(
		() => createCapturedVideoProxyAttachment(material, sourceRecord(material), reasonless),
		(error: unknown) => {
			assert.ok(error instanceof DOMException);
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /video proxy work was cancelled/u);
			return true;
		},
	);
});

test('a candidate or captured source that no longer matches the prepared proxy is refused', async () => {
	for (const info of [
		{ candidateSha256: OTHER_SHA256 },
		{ candidateByteLength: CANDIDATE_BYTES + 1 },
		{ candidateMimeType: 'video/mp4' },
	]) {
		const moved = await buildMaterial({ info });
		await attachmentRefusal(moved, sourceRecord(moved), /candidate changed before durable staging/u);
	}
	const material = await buildMaterial();
	const mismatch = /does not match the captured source generation/u;
	for (const source of [{ kind: 'audio' }, { contentSha256: OTHER_SHA256 }, { sourceFrameCount: 99 }]) {
		await attachmentRefusal(material, sourceRecord(material, source), mismatch);
	}
});

test('a timing publication bound to another digest, frame count or byte sequence is refused', async () => {
	const foreign = await buildMaterial({
		timingPublication: createVideoTimingAssetPublication(OTHER_SHA256, TIMING_INPUT),
	});
	const changed = /timing publication changed before durable staging/u;
	await attachmentRefusal(foreign, sourceRecord(foreign), changed);
	const miscounted = await buildMaterial({ info: { frameCount: 4, boundaryCount: 5 } });
	await attachmentRefusal(miscounted, sourceRecord(miscounted), changed);
	const base = await buildMaterial();
	const bytes = base.timingPublication.bytes.slice();
	bytes[40] = (bytes[40] ?? 0) ^ 0xff;
	const corrupt = await buildMaterial({
		timingPublication: { reference: base.timingPublication.reference, bytes },
	});
	await attachmentRefusal(corrupt, sourceRecord(corrupt), /timing asset bytes failed their immutable digest/u);
});

test('staging two new bodies writes each one in bounded chunks and verifies both claims', async () => {
	const fixture = await scene();
	const staged = await fixture.stage(new AbortController().signal);

	assert.deepEqual([Object.isFrozen(staged), Object.isFrozen(staged[0])], [true, true]);
	assert.deepEqual(staged.map((body) => body.bodyKind), ['proxy', 'timing']);
	assert.deepEqual(staged.map((body) => body.created), [true, true]);
	assert.deepEqual(staged.map((body) => body.claim.status), ['verified', 'verified']);
	assert.deepEqual(fixture.store.metadataProbes, [fixture.proxyKey, fixture.timingKey]);
	assert.deepEqual(fixture.store.writes[0]?.metadata, {
		name: fixture.proxyKey, kind: 'video-proxy', encoding: 'video-proxy-v1', mimeType: 'video/webm',
	});
	assert.deepEqual(fixture.store.writes[1]?.metadata, {
		name: fixture.timingKey, kind: 'video-timing',
		encoding: 'soundscaper-video-timing-v1', mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		frameCount: 3, timescale: 24_000, finalFrameDurationTicks: '1001',
	});
	assert.deepEqual(fixture.store.writes[0]?.chunks, [8, 8, 8, 5]);
	assert.deepEqual(fixture.store.writes[1]?.chunks, [8, 8, 8, 8, 8, 8, 8]);
	assert.deepEqual(fixture.store.writes.map((write) => [
		write.expectedBytes, write.expectedSha256, write.committed?.bodyKey,
		write.signalled, write.commitSignalled,
	]), [
		[CANDIDATE_BYTES, fixture.attachment.sha256, fixture.proxyKey, true, true],
		[TIMING_BYTES, fixture.attachment.timingAsset.sha256, fixture.timingKey, true, true],
	]);
	assert.deepEqual(fixture.staging.created, []);
	assert.deepEqual(fixture.staging.verifiedNew.map((claim) => claim.status), ['unverified', 'unverified']);
	assert.deepEqual(fixture.staging.signals, [true, true]);
	assert.deepEqual(fixture.store.loads, [[fixture.timingKey, true]]);
});

test('bodies already stored under their descriptors are reused as verified claims without writing', async () => {
	const fixture = await scene();
	fixture.store.rows.set(fixture.proxyKey, proxyRow(fixture.attachment));
	fixture.store.rows.set(fixture.timingKey, timingRow(fixture.attachment));
	fixture.store.bodies.set(fixture.timingKey, fixture.material.timingPublication.bytes);
	const staged = await fixture.stage();

	assert.deepEqual(staged.map((body) => body.created), [false, false]);
	assert.deepEqual(fixture.store.writes, []);
	assert.deepEqual(fixture.staging.verifiedNew, []);
	assert.deepEqual(fixture.staging.created, [
		{
			...CONTEXT, bodyKind: 'proxy', bodyKey: fixture.proxyKey,
			byteLength: CANDIDATE_BYTES, mimeType: 'video/webm',
		}, {
			...CONTEXT, bodyKind: 'timing', bodyKey: fixture.timingKey,
			byteLength: TIMING_BYTES, mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		},
	]);
	assert.deepEqual(fixture.staging.signals, [false, false]);
});

test('a timing row predating the encoding column is reused while other row mismatches are refused', async () => {
	const fixture = await scene();
	const untypedTiming = timingRow(fixture.attachment);
	delete untypedTiming.encoding;
	fixture.store.rows.set(fixture.proxyKey, proxyRow(fixture.attachment));
	fixture.store.rows.set(fixture.timingKey, untypedTiming);
	fixture.store.bodies.set(fixture.timingKey, fixture.material.timingPublication.bytes);
	assert.deepEqual((await fixture.stage()).map((body) => body.created), [false, false]);
	const strict = await scene();
	const untypedProxy = proxyRow(strict.attachment);
	delete untypedProxy.encoding;
	strict.store.rows.set(strict.proxyKey, untypedProxy);
	assert.match((await stagingFailure(() => strict.stage())).message, /conflicts with its immutable descriptor/u);
	const resized = await scene();
	resized.store.rows.set(resized.timingKey, { ...timingRow(resized.attachment), size: 12 });
	const error = await stagingFailure(() => resized.stage());
	assert.match(error.message, /conflicts with its immutable descriptor/u);
	assert.ok(error.cause instanceof Error);
	assert.equal(Object.isFrozen(error.staged), true);
	assert.deepEqual(error.staged.map((body) => [body.bodyKind, body.created]), [['proxy', true]]);
	const absent = await scene();
	absent.store.rows.set(absent.proxyKey, 0);
	assert.match((await stagingFailure(() => absent.stage())).message, /proxy body row is missing/u);
});

test('a writer without the exact bounded chunk contract is refused before any byte is written', async () => {
	const bounded = {
		write: () => Promise.resolve(), commitVideoProxyClaim: () => Promise.resolve(),
		abort: () => Promise.resolve(), maximumChunkBytes: CHUNK_BYTES,
	};
	for (const writer of [
		null,
		{ ...bounded, maximumChunkBytes: 0 },
		{ ...bounded, maximumChunkBytes: MEDIA_CONTENT_DIGEST_CHUNK_BYTES + 1 },
		{ ...bounded, maximumChunkBytes: 8.5 },
		{ ...bounded, commitVideoProxyClaim: 'not-a-function' },
		{ ...bounded, abort: undefined },
	]) {
		const fixture = await scene();
		fixture.store.writerOverride = writer;
		const error = await stagingFailure(() => fixture.stage());
		assert.ok(error.cause instanceof TypeError);
		assert.match(error.message, /bounded captured proxy media writer is required/u);
		assert.deepEqual(error.staged, []);
		assert.deepEqual(fixture.staging.verifiedNew, []);
	}
});

test('a failed write aborts its writer and reuses a body that raced into storage', async () => {
	const fixture = await scene();
	const failure = new Error('the durable chunk write failed');
	fixture.store.onWrite = (attempt, index) => {
		if (attempt.key !== fixture.proxyKey || index !== 0) return;
		fixture.store.rows.set(fixture.proxyKey, proxyRow(fixture.attachment));
		throw failure;
	};
	const staged = await fixture.stage();
	assert.deepEqual(staged.map((body) => body.created), [false, true]);
	assert.equal(fixture.store.writes[0]?.aborts, 1);
	assert.deepEqual(fixture.store.metadataProbes, [fixture.proxyKey, fixture.proxyKey, fixture.timingKey]);
	assert.deepEqual(fixture.staging.created.map((input) => input.bodyKind), ['proxy']);
	const conflicting = await scene();
	conflicting.store.onWrite = (attempt, index) => {
		if (attempt.key !== conflicting.proxyKey || index !== 0) return;
		conflicting.store.rows.set(conflicting.proxyKey, {
			...proxyRow(conflicting.attachment), sha256: OTHER_SHA256,
		});
		throw failure;
	};
	assert.match((await stagingFailure(() => conflicting.stage())).message, /conflicts with its immutable descriptor/u);
});

test('a cleanup failure and a reconciliation failure both bypass the raced-body probe', async () => {
	const fixture = await scene();
	const failure = new Error('the durable chunk write failed');
	const cleanupFailure = new Error('the writer could not be aborted');
	fixture.store.onWrite = () => { throw failure; };
	fixture.store.abortFailure = cleanupFailure;
	const error = await stagingFailure(() => fixture.stage());
	assert.ok(error.cause instanceof AggregateError);
	assert.equal(error.cause.message, 'Captured proxy body write cleanup failed.');
	assert.deepEqual(error.cause.errors, [failure, cleanupFailure]);
	assert.equal(error.cause.cause, failure);
	assert.deepEqual(fixture.store.metadataProbes, [fixture.proxyKey]);
	const reconciling = await scene();
	const reconciliation = new MediaPublicationReconciliationError(
		new Error('the claim commit failed'), new Error('the payload could not be discarded'),
	);
	reconciling.store.commitFailure = reconciliation;
	const rethrown = await stagingFailure(() => reconciling.stage());
	assert.equal(rethrown.cause, reconciliation);
	assert.deepEqual(reconciling.store.metadataProbes, [reconciling.proxyKey]);
	assert.equal(reconciling.store.writes[0]?.aborts, 1);
	assert.deepEqual(rethrown.staged, []);
});

test('a body slice shorter than its requested span fails staging rather than writing short', async () => {
	const fixture = await scene();
	const truncating = new Blob([CANDIDATE_TEXT], { type: 'video/webm' });
	Object.defineProperty(truncating, 'slice', { value: () => new Blob(['x']) });
	const error = await stagingFailure(() => stageCapturedVideoProxyBodies(
		fixture.store, fixture.staging.repository(),
		{ ...fixture.material, candidate: truncating }, fixture.attachment, CONTEXT,
	));
	assert.match(error.message, /proxy body returned an inexact slice/u);
	assert.equal(fixture.store.writes[0]?.aborts, 1);
	assert.deepEqual(fixture.store.writes[0]?.chunks, []);
});

test('cancelling before or during a write surfaces the caller abort reason', async () => {
	const fixture = await scene();
	const controller = new AbortController();
	const reason = new Error('the capture operation was superseded');
	fixture.store.onWrite = () => { controller.abort(reason); };
	const error = await stagingFailure(() => fixture.stage(controller.signal));
	assert.equal(error.cause, reason);
	assert.deepEqual(fixture.store.writes[0]?.chunks, [8]);
	assert.equal(fixture.store.writes[0]?.aborts, 1);
	assert.equal(fixture.store.writes[0]?.committed, null);
	const upfront = await scene();
	const early = new AbortController();
	early.abort(reason);
	const refusal = await stagingFailure(() => upfront.stage(early.signal));
	assert.equal(refusal.cause, reason);
	assert.deepEqual(upfront.store.metadataProbes, []);
	assert.deepEqual(refusal.staged, []);
});

test('a claim verification failure keeps the unverified claim and every earlier body staged', async () => {
	const fixture = await scene();
	const failure = new Error('the claimed body failed digest verification');
	fixture.staging.verifyFailure = (claim) => (claim.bodyKind === 'timing' ? failure : null);
	const error = await stagingFailure(() => fixture.stage());
	assert.equal(error.cause, failure);
	assert.deepEqual(error.staged.map((body) => body.bodyKind), ['proxy', 'timing']);
	assert.deepEqual(error.staged.map((body) => body.created), [true, true]);
	assert.deepEqual(error.staged.map((body) => body.claim.status), ['verified', 'unverified']);
	assert.deepEqual(error.staged.map((body) => body.claim.bodyKey), [fixture.proxyKey, fixture.timingKey]);
	const thrown = await scene();
	thrown.staging.verifyFailure = () => 'the staging seam rejected the claim';
	const opaque = await stagingFailure(() => thrown.stage());
	assert.equal(opaque.name, 'CapturedVideoProxyBodyStagingError');
	assert.equal(opaque.message, 'Captured proxy body staging failed.');
	assert.equal(opaque.cause, 'the staging seam rejected the claim');
});

test('timing bytes that do not load back exactly fail staging after their claim was recorded', async () => {
	const shortened = await scene();
	shortened.store.loadOverride = () => new Blob(['short']);
	const shortError = await stagingFailure(() => shortened.stage());
	assert.match(shortError.message, /timing body length changed/u);
	assert.deepEqual(shortError.staged.map((body) => body.bodyKind), ['proxy', 'timing']);
	const foreign = await scene();
	foreign.store.loadOverride = () => ({ size: TIMING_BYTES, slice: () => ({}) });
	const foreignError = await stagingFailure(() => foreign.stage());
	assert.ok(foreignError.cause instanceof TypeError);
	assert.match(foreignError.message, /must be a genuine Blob or File/u);
	const corrupt = await scene();
	corrupt.store.loadOverride = (key) => {
		const bytes = corrupt.store.bodies.get(key)!.slice();
		bytes[40] = (bytes[40] ?? 0) ^ 0xff;
		return new Blob([bytes as Uint8Array<ArrayBuffer>]);
	};
	assert.match((await stagingFailure(() => corrupt.stage())).message, /timing asset bytes failed their immutable digest/u);
});

test('releasing skips created bodies and collects each reuse failure without stopping', async () => {
	const staging = new FakeStaging();
	const body = (bodyKind: 'proxy' | 'timing', created: boolean): StagedCapturedVideoProxyBody => Object.freeze({
		bodyKind,
		created,
		claim: claimRecord({
			...CONTEXT, bodyKind, bodyKey: `staged-${bodyKind}-body`, byteLength: 32, mimeType: 'video/webm',
		}, 'verified'),
	});
	assert.deepEqual(
		await releaseReusedCapturedVideoProxyClaims(staging.repository(), [
			body('proxy', true), body('timing', false),
		]),
		[],
	);
	assert.deepEqual(staging.released.map((claim) => claim.bodyKind), ['timing']);
	const refusal = new Error('the verified claim changed before release');
	staging.releaseFailure = (claim) => (claim.bodyKind === 'proxy' ? refusal : null);
	const failures = await releaseReusedCapturedVideoProxyClaims(staging.repository(), [
		body('proxy', true), body('proxy', false), body('timing', false),
	]);
	assert.deepEqual(failures, [refusal]);
	assert.deepEqual(staging.released.map((claim) => claim.bodyKind), ['timing', 'timing']);
});
