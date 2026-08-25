/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	canonicalMediaContentBlob,
	digestMediaContent,
	MEDIA_CONTENT_DIGEST_CHUNK_BYTES,
} from '../common/editor/storage/media-content-digest.ts';
import type { VideoProxyClaimedMediaAssetWriter } from '../common/editor/storage/media-asset-write-contract.ts';
import { MediaPublicationReconciliationError } from '../common/editor/storage/media-asset-owned-publication.ts';
import type { VideoProxyClaimRecord } from '../common/editor/storage/video-proxy-claim-repository.ts';
import { VideoProxyClaimStagingRepository } from '../common/editor/storage/video-proxy-claim-staging-repository.ts';
import type { VideoProxyClaimStagingInput } from '../common/editor/storage/video-proxy-claim-staging-record.ts';
import type { VideoProxyRelationshipPreparationMaterial } from '../common/editor/video-proxy-relationship.ts';
import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import {
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingAssetReference,
} from '../common/editor/video-timing-asset.ts';

const PROXY_ENCODING = 'video-proxy-v1';
const TIMING_ENCODING = 'soundscaper-video-timing-v1';

export interface CapturedVideoProxyBodyStore {
	getMediaAssetMetadata(sourceId: string): Promise<unknown>;
	loadMediaAsset(sourceId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<unknown>;
	beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): Promise<VideoProxyClaimedMediaAssetWriter>;
}

export interface CapturedVideoProxyClaimContext {
	readonly operationId: string;
	readonly projectId: string;
	readonly sourceId: string;
	readonly baseFingerprint: string;
}

export interface StagedCapturedVideoProxyBody {
	readonly bodyKind: 'proxy' | 'timing';
	readonly created: boolean;
	readonly claim: Readonly<VideoProxyClaimRecord>;
}

/** Preserve exact accumulated claim/body ownership when a later body cannot stage. */
export class CapturedVideoProxyBodyStagingError extends Error {
	readonly staged: readonly StagedCapturedVideoProxyBody[];

	constructor(cause: unknown, staged: readonly StagedCapturedVideoProxyBody[]) {
		super(cause instanceof Error ? cause.message : 'Captured proxy body staging failed.', { cause });
		this.name = 'CapturedVideoProxyBodyStagingError';
		this.staged = Object.freeze([...staged]);
	}
}

interface BodySpec {
	readonly bodyKind: 'proxy' | 'timing';
	readonly key: string;
	readonly kind: 'video-proxy' | 'video-timing';
	readonly encoding: typeof PROXY_ENCODING | typeof TIMING_ENCODING;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly body: Blob | Uint8Array;
	readonly timing: Readonly<VideoTimingAssetReference> | null;
}

export async function createCapturedVideoProxyAttachment(
	material: VideoProxyRelationshipPreparationMaterial,
	source: Readonly<Record<string, unknown>>,
	signal?: AbortSignal,
): Promise<Readonly<VideoProxyAttachmentV18>> {
	throwIfAborted(signal);
	const digest = await digestMediaContent(material.candidate, {
		chunkBytes: MEDIA_CONTENT_DIGEST_CHUNK_BYTES,
		...(signal ? { signal } : {}),
	});
	throwIfAborted(signal);
	if (digest !== material.info.candidateSha256
		|| material.candidate.size !== material.info.candidateByteLength
		|| material.candidate.type !== material.info.candidateMimeType) {
		throw new Error('The captured proxy candidate changed before durable staging.');
	}
	const timing = material.timingPublication;
	const index = validateVideoTimingAssetBytes(timing.reference, timing.bytes);
	if (timing.reference.sourceSha256 !== digest || index.frameCount !== material.info.frameCount) {
		throw new Error('The captured proxy timing publication changed before durable staging.');
	}
	if (source.kind !== 'video'
		|| source.contentSha256 !== material.info.originalSha256
		|| source.sourceFrameCount !== material.info.frameCount) {
		throw new Error('The prepared proxy does not match the captured source generation.');
	}
	return normalizeVideoProxyAttachmentV18({
		kind: 'video-proxy-attachment', version: 1, rule: material.info.rule,
		storageKey: `video-proxy-sha256:${digest}`,
		mimeType: material.info.candidateMimeType,
		byteLength: material.info.candidateByteLength,
		sha256: digest,
		originalSha256: material.info.originalSha256,
		originalAuthorityKind: material.info.originalAuthorityKind,
		generatorId: material.info.generatorId,
		generatorVersion: material.info.generatorVersion,
		recipeId: material.info.recipeId,
		recipeVersion: material.info.recipeVersion,
		timingBackendId: material.info.timingBackendId,
		timingRule: material.info.timingRule,
		frameCount: material.info.frameCount,
		boundaryCount: material.info.boundaryCount,
		timingAsset: timing.reference,
		audioPolicy: material.info.audioPolicy,
	});
}

export async function stageCapturedVideoProxyBodies(
	store: CapturedVideoProxyBodyStore,
	staging: VideoProxyClaimStagingRepository,
	material: VideoProxyRelationshipPreparationMaterial,
	attachment: Readonly<VideoProxyAttachmentV18>,
	context: CapturedVideoProxyClaimContext,
	signal?: AbortSignal,
): Promise<readonly StagedCapturedVideoProxyBody[]> {
	const staged: StagedCapturedVideoProxyBody[] = [];
	for (const spec of bodySpecs(material, attachment)) {
		let current: StagedCapturedVideoProxyBody | null = null;
		try {
			const input = claimInput(context, spec);
			const body = await stageBody(store, spec, input, signal);
			if (body.created) {
				current = Object.freeze({
					bodyKind: spec.bodyKind, created: true, claim: body.claim!,
				});
				const claim = await staging.verifyNewBodyClaim(body.claim!, signal ? { signal } : {});
				current = Object.freeze({ bodyKind: spec.bodyKind, created: true, claim });
			} else {
				const claim = await staging.createVerifiedClaim(input, signal ? { signal } : {});
				current = Object.freeze({ bodyKind: spec.bodyKind, created: false, claim });
			}
			staged.push(current);
			if (spec.timing) await verifyStoredTiming(store, spec, signal);
		} catch (error) {
			if (current && !staged.includes(current)) staged.push(current);
			throw new CapturedVideoProxyBodyStagingError(error, staged);
		}
	}
	return Object.freeze(staged);
}

export async function releaseReusedCapturedVideoProxyClaims(
	staging: VideoProxyClaimStagingRepository,
	staged: readonly StagedCapturedVideoProxyBody[],
): Promise<unknown[]> {
	const failures: unknown[] = [];
	for (const body of staged) {
		if (body.created) continue;
		try { await staging.releaseVerifiedClaimIfCurrent(body.claim); }
		catch (error) { failures.push(error); }
	}
	return failures;
}

function bodySpecs(
	material: VideoProxyRelationshipPreparationMaterial,
	attachment: Readonly<VideoProxyAttachmentV18>,
): readonly BodySpec[] {
	return Object.freeze([Object.freeze({
		bodyKind: 'proxy', key: attachment.storageKey, kind: 'video-proxy',
		encoding: PROXY_ENCODING, mimeType: attachment.mimeType,
		byteLength: attachment.byteLength, sha256: attachment.sha256,
		body: material.candidate, timing: null,
	}), Object.freeze({
		bodyKind: 'timing', key: attachment.timingAsset.storageKey, kind: 'video-timing',
		encoding: TIMING_ENCODING, mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		byteLength: attachment.timingAsset.byteLength, sha256: attachment.timingAsset.sha256,
		body: material.timingPublication.bytes, timing: attachment.timingAsset,
	})]);
}

function claimInput(context: CapturedVideoProxyClaimContext, spec: BodySpec): VideoProxyClaimStagingInput {
	return Object.freeze({
		...context,
		bodyKind: spec.bodyKind,
		bodyKey: spec.key,
		byteLength: spec.byteLength,
		mimeType: spec.mimeType,
	});
}

async function stageBody(
	store: CapturedVideoProxyBodyStore,
	spec: BodySpec,
	input: VideoProxyClaimStagingInput,
	signal?: AbortSignal,
): Promise<Readonly<{
	readonly created: boolean;
	readonly claim: Readonly<VideoProxyClaimRecord> | null;
}>> {
	throwIfAborted(signal);
	const existing = await store.getMediaAssetMetadata(spec.key);
	if (existing !== null && existing !== undefined) {
		assertBodyMetadata(existing, spec);
		return Object.freeze({ created: false, claim: null });
	}
	const writer = await store.beginMediaAssetWrite(spec.key, {
		name: spec.key, kind: spec.kind, encoding: spec.encoding, mimeType: spec.mimeType,
		...(spec.timing ? {
			frameCount: spec.timing.frameCount,
			timescale: spec.timing.timescale,
			finalFrameDurationTicks: spec.timing.finalFrameDurationTicks,
		} : {}),
	}, {
		expectedBytes: spec.byteLength,
		expectedSha256: spec.sha256,
		...(signal ? { signal } : {}),
	});
	assertWriter(writer);
	try {
		await writeBody(writer, spec.body, signal);
		const publication = await writer.commitVideoProxyClaim(input, signal ? { signal } : {});
		return Object.freeze({ created: true, claim: publication.claim });
	} catch (error) {
		try { await writer.abort(); }
		catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Captured proxy body write cleanup failed.', { cause: error });
		}
		if (error instanceof MediaPublicationReconciliationError) throw error;
		const raced = await store.getMediaAssetMetadata(spec.key);
		if (raced !== null && raced !== undefined) {
			assertBodyMetadata(raced, spec);
			return Object.freeze({ created: false, claim: null });
		}
		throw error;
	}
}

async function writeBody(
	writer: VideoProxyClaimedMediaAssetWriter,
	body: Blob | Uint8Array,
	signal?: AbortSignal,
): Promise<void> {
	const size = body instanceof Blob ? body.size : body.byteLength;
	for (let offset = 0; offset < size; offset += writer.maximumChunkBytes) {
		throwIfAborted(signal);
		const end = Math.min(size, offset + writer.maximumChunkBytes);
		const bytes = body instanceof Blob
			? new Uint8Array(await body.slice(offset, end).arrayBuffer())
			: body.slice(offset, end);
		if (bytes.byteLength !== end - offset) throw new Error('Captured proxy body returned an inexact slice.');
		await writer.write(bytes, signal ? { signal } : {});
	}
}

async function verifyStoredTiming(
	store: CapturedVideoProxyBodyStore,
	spec: BodySpec,
	signal?: AbortSignal,
): Promise<void> {
	const loaded = canonicalMediaContentBlob(await store.loadMediaAsset(
		spec.key,
		signal ? { signal } : {},
	));
	if (loaded.size !== spec.byteLength) throw new Error('The captured timing body length changed.');
	validateVideoTimingAssetBytes(spec.timing, new Uint8Array(await loaded.arrayBuffer()));
}

function assertBodyMetadata(value: unknown, spec: BodySpec): void {
	if (!value || typeof value !== 'object') throw new Error('The captured proxy body row is missing.');
	const row = value as Record<string, unknown>;
	const encodingMatches = row.encoding === spec.encoding
		|| (spec.bodyKind === 'timing' && row.encoding === undefined);
	if (row.sourceId !== spec.key || row.kind !== spec.kind || !encodingMatches
		|| row.sha256 !== spec.sha256 || row.size !== spec.byteLength || row.mimeType !== spec.mimeType) {
		throw new Error('The captured proxy body conflicts with its immutable descriptor.');
	}
}

function assertWriter(value: unknown): asserts value is VideoProxyClaimedMediaAssetWriter {
	const writer = value as Partial<VideoProxyClaimedMediaAssetWriter> | null;
	if (!writer || typeof writer.write !== 'function' || typeof writer.commitVideoProxyClaim !== 'function'
		|| typeof writer.abort !== 'function' || !Number.isSafeInteger(writer.maximumChunkBytes)
		|| Number(writer.maximumChunkBytes) < 1 || Number(writer.maximumChunkBytes) > MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
		throw new TypeError('An exact bounded captured proxy media writer is required.');
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Captured video proxy work was cancelled.', 'AbortError');
}
