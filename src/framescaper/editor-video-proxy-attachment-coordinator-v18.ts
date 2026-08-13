/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	canonicalMediaContentBlob,
	digestMediaContent,
	MEDIA_CONTENT_DIGEST_CHUNK_BYTES,
} from '../common/editor/storage/media-content-digest.ts';
import type {
	VideoProxyClaimedMediaAssetWriter,
} from '../common/editor/storage/media-asset-write-contract.ts';
import { MediaPublicationReconciliationError } from '../common/editor/storage/media-asset-owned-publication.ts';
import {
	VideoProxyClaimRepository,
	type VideoProxyClaimRecord,
} from '../common/editor/storage/video-proxy-claim-repository.ts';
import {
	VideoProxyClaimStagingRepository,
} from '../common/editor/storage/video-proxy-claim-staging-repository.ts';
import type {
	VideoProxyClaimStagingInput,
} from '../common/editor/storage/video-proxy-claim-staging-record.ts';
import {
	assertVideoProxyRelationshipAdoptionCurrent,
	captureVideoProxyRelationshipAdoptionLease,
	consumePreparedVideoProxyRelationship,
	releaseVideoProxyRelationshipAdoptionLease,
	type PreparedVideoProxyRelationship,
	type VideoProxyRelationshipAdoptionLease,
	type VideoProxyRelationshipAuthority,
	type VideoProxyRelationshipPreparationMaterial,
} from '../common/editor/video-proxy-relationship.ts';
import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import {
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingAssetReference,
} from '../common/editor/video-timing-asset.ts';
import {
	assertFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from './editor-project-environment-v18.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV18,
} from './editor-project-feature-requirements-v18.ts';
import { framescaperProjectStoreAuthorityV18 } from './editor-project-store-v18.ts';
import {
	framescaperProjectFingerprintV18,
	FramescaperProjectV18PreservationRepository,
} from './editor-project-v18-preservation-repository.ts';
import {
	cloneFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';
import {
	assertFramescaperVideoProxyAttachmentControllerGateV18,
	type FramescaperVideoProxyAttachmentGateTicketV18,
	FramescaperVideoProxyAttachmentControllerGateV18,
} from './editor-video-proxy-controller-gate-v18.ts';
import {
	acquireFramescaperVideoProxyAttachmentBudgetV18,
	assertFramescaperVideoProxyAttachmentCapacityV18,
	FramescaperVideoProxyAttachmentCapacityErrorV18,
	type FramescaperVideoProxyCapacityStoreV18,
} from './editor-video-proxy-attachment-capacity-v18.ts';

const REQUEST_FIELDS = ['preparation', 'sourceId', 'operationId'] as const;
const REQUEST_OPTIONAL_FIELDS = ['signal'] as const;
const PROXY_ENCODING = 'video-proxy-v1';
const TIMING_ENCODING = 'soundscaper-video-timing-v1';

interface AttachmentStoreV18 extends FramescaperVideoProxyCapacityStoreV18 {
	getMediaAssetMetadata(sourceId: string): Promise<unknown>;
	loadMediaAsset(sourceId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<unknown>;
	beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): Promise<VideoProxyClaimedMediaAssetWriter>;
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

interface StagedBody {
	readonly spec: BodySpec;
	readonly input: VideoProxyClaimStagingInput;
	readonly created: boolean;
	claim: Readonly<VideoProxyClaimRecord> | null;
	claimAttempted: boolean;
}

export interface FramescaperVideoProxyAttachmentRequestV18 {
	readonly preparation: PreparedVideoProxyRelationship;
	readonly sourceId: string;
	readonly operationId: string;
	readonly signal?: AbortSignal;
}

export interface FramescaperVideoProxyAttachmentResultV18 {
	readonly committed: true;
	readonly project: FramescaperProjectV18;
	readonly attachment: Readonly<VideoProxyAttachmentV18>;
}

export { FramescaperVideoProxyAttachmentCapacityErrorV18 };

export class FramescaperVideoProxyAttachmentCommittedErrorV18 extends Error {
	readonly committed = true;
	readonly project: FramescaperProjectV18;
	constructor(project: FramescaperProjectV18, cause: unknown) {
		super('The V18 proxy attachment committed, but controller reconciliation or cleanup failed.', { cause });
		this.name = 'FramescaperVideoProxyAttachmentCommittedErrorV18';
		this.project = project;
	}
}

/** First maintained owner of the private prepared proxy relationship material. */
export class FramescaperVideoProxyAttachmentCoordinatorV18 {
	readonly #environment: Readonly<FramescaperEditorProjectEnvironmentV18>;
	readonly #gate: FramescaperVideoProxyAttachmentControllerGateV18;
	readonly #relationshipAuthority: VideoProxyRelationshipAuthority;
	readonly #store: AttachmentStoreV18;
	readonly #claims: VideoProxyClaimRepository;
	readonly #claimStaging: VideoProxyClaimStagingRepository;
	readonly #repository: FramescaperProjectV18PreservationRepository;

	constructor(
		environmentValue: FramescaperEditorProjectEnvironmentV18 | unknown,
		gateValue: FramescaperVideoProxyAttachmentControllerGateV18 | unknown,
		relationshipAuthority: VideoProxyRelationshipAuthority,
	) {
		const environment = assertFramescaperEditorProjectEnvironmentV18(environmentValue);
		assertFramescaperVideoProxyAttachmentControllerGateV18(gateValue);
		gateValue.assertComposition(environment);
		if (!relationshipAuthority || typeof relationshipAuthority !== 'object') {
			throw new TypeError('An authentic video proxy relationship authority is required.');
		}
		const authority = framescaperProjectStoreAuthorityV18(environment.runtime.profile, environment.store);
		if (!authority.opfs) throw new TypeError('The exact V18 OPFS authority is required.');
		this.#environment = environment;
		this.#gate = gateValue;
		this.#relationshipAuthority = relationshipAuthority;
		this.#store = assertStore(environment.store);
		this.#claims = new VideoProxyClaimRepository(authority.port);
		this.#claimStaging = new VideoProxyClaimStagingRepository(authority.port, authority.opfs);
		this.#repository = new FramescaperProjectV18PreservationRepository(environment.runtime.profile, {
			port: authority.port,
			claims: this.#claims,
		});
	}

	async attach(
		requestValue: FramescaperVideoProxyAttachmentRequestV18 | unknown,
	): Promise<Readonly<FramescaperVideoProxyAttachmentResultV18>> {
		const request = captureRequest(requestValue);
		const releaseBudget = await acquireFramescaperVideoProxyAttachmentBudgetV18(this.#store);
		let ticket: FramescaperVideoProxyAttachmentGateTicketV18 | null = null;
		const staged: StagedBody[] = [];
		let committed: FramescaperProjectV18 | null = null;
		let installed = false;
		let adoption: VideoProxyRelationshipAdoptionLease | null = null;
		try {
			ticket = await this.#gate.capture({
				sourceId: request.sourceId,
				...(request.signal ? { signal: request.signal } : {}),
			});
			const gate = this.#gate.snapshot(ticket);
			const material = consumePreparedVideoProxyRelationship(request.preparation);
			assertMaterialTarget(material, gate.projectId, request.sourceId);
			adoption = await captureVideoProxyRelationshipAdoptionLease(
				this.#relationshipAuthority,
				material.relationship,
				{ sourceId: request.sourceId, ...(request.signal ? { signal: request.signal } : {}) },
			);
			assertVideoProxyRelationshipAdoptionCurrent(adoption);
			const attachment = await attachmentFromMaterial(material, gate.base, request.sourceId, request.signal);
			const next = nextAttachedProject(this.#environment, gate.base, request.sourceId, attachment);
			await assertFramescaperVideoProxyAttachmentCapacityV18(
				this.#store, gate.base, next, material, request.signal,
			);
			this.#gate.assertCurrent(ticket);
			assertVideoProxyRelationshipAdoptionCurrent(adoption);

			const baseFingerprint = framescaperProjectFingerprintV18(
				this.#environment.runtime.profile,
				gate.base,
			);
			const specs = bodySpecs(material, attachment);
			for (const spec of specs) {
				const input = claimInput(request, gate.projectId, baseFingerprint, spec);
				staged.push(await stageBody(this.#store, spec, input, request.signal));
			}
			this.#gate.assertCurrent(ticket);
			assertVideoProxyRelationshipAdoptionCurrent(adoption);

			for (const body of staged) {
				body.claimAttempted = true;
				body.claim = body.created
					? await this.#claimStaging.verifyNewBodyClaim(
						body.claim!,
						request.signal ? { signal: request.signal } : {},
					)
					: await this.#claimStaging.createVerifiedClaim(
						body.input,
						request.signal ? { signal: request.signal } : {},
					);
				if (body.spec.timing) await verifyStoredTiming(this.#store, body.spec, request.signal);
			}
			this.#gate.assertCurrent(ticket);
			assertVideoProxyRelationshipAdoptionCurrent(adoption);
			const proxy = staged.find((body) => body.spec.bodyKind === 'proxy')!.claim!;
			const timing = staged.find((body) => body.spec.bodyKind === 'timing')!.claim!;
			const plan = await this.#claims.preparePreservationPlan({
				operationId: request.operationId,
				projectId: gate.projectId,
				sourceId: request.sourceId,
				baseFingerprint,
				proxyClaimKey: proxy.key,
				timingClaimKey: timing.key,
			});
			this.#gate.assertCurrent(ticket);
			assertVideoProxyRelationshipAdoptionCurrent(adoption);
			committed = await this.#repository.publishIfCurrent({
				expected: gate.base,
				project: next,
				plans: [{ sourceId: request.sourceId, plan }],
			});
			if (!committed) throw new DOMException('The durable V18 attachment base became stale.', 'AbortError');
			try {
				const installedProject = this.#gate.installCommitted(ticket, committed);
				installed = true;
				assertVideoProxyRelationshipAdoptionCurrent(adoption);
				await releaseVideoProxyRelationshipAdoptionLease(adoption);
				adoption = null;
				return Object.freeze({ committed: true, project: installedProject, attachment });
			} catch (error) {
				throw new FramescaperVideoProxyAttachmentCommittedErrorV18(committed, error);
			}
		} catch (error) {
			const releaseErrors: unknown[] = [];
			if (adoption) {
				try { await releaseVideoProxyRelationshipAdoptionLease(adoption); adoption = null; }
				catch (releaseError) { releaseErrors.push(releaseError); }
			}
			if (committed) {
				if (releaseErrors.length) throw new FramescaperVideoProxyAttachmentCommittedErrorV18(
					committed,
					new AggregateError([error, ...releaseErrors], 'Committed attachment cleanup failed.', { cause: error }),
				);
				throw error;
			}
			const cleanupErrors = await this.#cleanup(request, ticket, staged);
			cleanupErrors.push(...releaseErrors);
			if (cleanupErrors.length) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'V18 proxy attachment and determinate cleanup both failed.',
					{ cause: error },
				);
			}
			throw error;
		} finally {
			if (ticket && (!committed || installed)) await this.#gate.release(ticket);
			releaseBudget();
		}
	}

	async #cleanup(
		request: Readonly<FramescaperVideoProxyAttachmentRequestV18>,
		ticket: FramescaperVideoProxyAttachmentGateTicketV18 | null,
		staged: readonly StagedBody[],
	): Promise<unknown[]> {
		const errors: unknown[] = [];
		for (const body of staged) {
			if (body.created || !body.claim) continue;
			try { await this.#claimStaging.releaseVerifiedClaimIfCurrent(body.claim); }
			catch (error) { errors.push(error); }
		}
		if (errors.length) return errors;
		const snapshot = ticket ? this.#gate.snapshot(ticket) : null;
		const newClaimRooted = staged.some((body) => body.created && body.claimAttempted && body.claim);
		if (snapshot && newClaimRooted) {
			try {
				const cleanup = await this.#environment.claimCleanup.cleanupOperation({
					operationId: request.operationId,
					projectId: snapshot.projectId,
					sourceId: request.sourceId,
					baseFingerprint: framescaperProjectFingerprintV18(
						this.#environment.runtime.profile,
						snapshot.base,
					),
				}, {
					sessionProjects: [snapshot.base],
					histories: [snapshot.history],
					pendingSaveSnapshots: [],
				});
				if (cleanup.status !== 'settled') errors.push(new Error('V18 proxy claim cleanup is indeterminate.'));
			} catch (error) { errors.push(error); }
		}
		return errors;
	}
}

async function attachmentFromMaterial(
	material: VideoProxyRelationshipPreparationMaterial,
	base: FramescaperProjectV18,
	sourceId: string,
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
		throw new Error('The prepared V18 proxy candidate changed before durable staging.');
	}
	const timing = material.timingPublication;
	const index = validateVideoTimingAssetBytes(timing.reference, timing.bytes);
	if (timing.reference.sourceSha256 !== digest || index.frameCount !== material.info.frameCount) {
		throw new Error('The prepared V18 proxy timing publication changed before durable staging.');
	}
	const source = base.sources.find((candidate) => candidate.id === sourceId);
	if (!source || source.kind !== 'video'
		|| source.contentSha256 !== material.info.originalSha256
		|| source.sourceFrameCount !== material.info.frameCount) {
		throw new Error('The prepared relationship does not match the exact V18 source generation.');
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

function nextAttachedProject(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
	base: FramescaperProjectV18,
	sourceId: string,
	attachment: Readonly<VideoProxyAttachmentV18>,
): FramescaperProjectV18 {
	if (base.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('The V18 attachment revision cannot advance safely.');
	const draft = structuredClone(base) as unknown as Record<string, unknown>;
	const source = (draft.sources as Record<string, unknown>[]).find((candidate) => candidate.id === sourceId);
	if (!source || source.kind !== 'video' || source.proxyAttachment !== null) {
		throw new Error('The exact all-null V18 attachment target changed.');
	}
	source.proxyAttachment = attachment;
	draft.revision = Number(base.revision) + 1;
	const baseTime = new Date(String(base.updatedAt)).getTime();
	const now = Date.now();
	draft.updatedAt = new Date(Math.max(now, baseTime + 1)).toISOString();
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV18(
		environment.runtime.profile,
		draft,
	);
	return cloneFramescaperProjectV18(environment.runtime.profile, draft);
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

function claimInput(
	request: Readonly<FramescaperVideoProxyAttachmentRequestV18>,
	projectId: string,
	baseFingerprint: string,
	spec: BodySpec,
): VideoProxyClaimStagingInput {
	return Object.freeze({
		operationId: request.operationId,
		projectId,
		sourceId: request.sourceId,
		baseFingerprint,
		bodyKind: spec.bodyKind,
		bodyKey: spec.key,
		byteLength: spec.byteLength,
		mimeType: spec.mimeType,
	});
}

async function stageBody(
	store: AttachmentStoreV18,
	spec: BodySpec,
	input: VideoProxyClaimStagingInput,
	signal?: AbortSignal,
): Promise<StagedBody> {
	throwIfAborted(signal);
	const existing = await store.getMediaAssetMetadata(spec.key);
	if (existing !== null && existing !== undefined) {
		assertBodyMetadata(existing, spec);
		return { spec, input, created: false, claim: null, claimAttempted: false };
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
		const publication = await writer.commitVideoProxyClaim(
			input,
			signal ? { signal } : {},
		);
		return {
			spec,
			input,
			created: true,
			claim: publication.claim,
			claimAttempted: true,
		};
	} catch (error) {
		try {
			await writer.abort();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'V18 proxy body write and cleanup both failed.', { cause: error });
		}
		if (error instanceof MediaPublicationReconciliationError) throw error;
		const raced = await store.getMediaAssetMetadata(spec.key);
		if (raced !== null && raced !== undefined) {
			assertBodyMetadata(raced, spec);
			return { spec, input, created: false, claim: null, claimAttempted: false };
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
		if (bytes.byteLength !== end - offset) throw new Error('V18 proxy body returned an inexact bounded slice.');
		await writer.write(bytes, signal ? { signal } : {});
	}
}

async function verifyStoredTiming(store: AttachmentStoreV18, spec: BodySpec, signal?: AbortSignal): Promise<void> {
	const loaded = canonicalMediaContentBlob(await store.loadMediaAsset(spec.key, signal ? { signal } : {}));
	if (loaded.size !== spec.byteLength) throw new Error('The claimed V18 timing body length changed.');
	validateVideoTimingAssetBytes(spec.timing, new Uint8Array(await loaded.arrayBuffer()));
}

function assertBodyMetadata(value: unknown, spec: BodySpec): void {
	if (!value || typeof value !== 'object') throw new Error('The V18 proxy body row is missing.');
	const row = value as Record<string, unknown>;
	if (row.sourceId !== spec.key || row.kind !== spec.kind || row.encoding !== spec.encoding
		|| row.sha256 !== spec.sha256 || row.size !== spec.byteLength || row.mimeType !== spec.mimeType) {
		throw new Error('The V18 proxy body row conflicts with its exact immutable descriptor.');
	}
}

function assertWriter(value: unknown): asserts value is VideoProxyClaimedMediaAssetWriter {
	const writer = value as Partial<VideoProxyClaimedMediaAssetWriter> | null;
	if (!writer || typeof writer.write !== 'function' || typeof writer.commitVideoProxyClaim !== 'function'
		|| typeof writer.abort !== 'function' || !Number.isSafeInteger(writer.maximumChunkBytes)
		|| Number(writer.maximumChunkBytes) < 1 || Number(writer.maximumChunkBytes) > MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
		throw new TypeError('An exact bounded V18 owned media writer is required.');
	}
}

function captureRequest(value: unknown): Readonly<FramescaperVideoProxyAttachmentRequestV18> {
	const raw = allowedRecord(value, REQUEST_FIELDS, REQUEST_OPTIONAL_FIELDS, 'Framescaper V18 proxy attachment request');
	if (!raw.preparation || typeof raw.preparation !== 'object') throw new TypeError('An authentic prepared relationship is required.');
	return Object.freeze({
		preparation: raw.preparation as PreparedVideoProxyRelationship,
		sourceId: identifier(raw.sourceId, 'attachment source id'),
		operationId: identifier(raw.operationId, 'attachment operation id'),
		...(raw.signal === undefined ? {} : { signal: abortSignal(raw.signal) }),
	});
}

function assertMaterialTarget(material: VideoProxyRelationshipPreparationMaterial, projectId: string, sourceId: string): void {
	if (material.info.projectId !== projectId || material.info.originalSourceId !== sourceId) {
		throw new Error('The prepared relationship targets a different V18 project or source.');
	}
}

function assertStore(value: unknown): AttachmentStoreV18 {
	if (!value || typeof value !== 'object') throw new TypeError('The exact V18 attachment body store is required.');
	for (const method of [
		'estimateStorage', 'queryPersistentStorage', 'getMediaAssetMetadata',
		'loadMediaAsset', 'beginMediaAssetWrite',
	] as const) {
		if (typeof (value as Record<string, unknown>)[method] !== 'function') {
			throw new TypeError(`The exact V18 attachment body store requires ${method}.`);
		}
	}
	return value as AttachmentStoreV18;
}

function allowedRecord(
	value: unknown,
	required: readonly string[],
	optional: readonly string[],
	name: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string'
		|| !required.includes(key) && !optional.includes(key))) throw new TypeError(`${name} has an unsupported field.`);
	const result: Record<string, unknown> = {};
	for (const field of [...required, ...optional]) {
		const descriptor = descriptors[field];
		if (!descriptor) {
			if (required.includes(field)) throw new TypeError(`${name}.${field} is required.`);
			continue;
		}
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${field} must be data.`);
		result[field] = descriptor.value;
	}
	return result;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError(`A bounded printable ${name} is required.`);
	}
	return value;
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A V18 attachment AbortSignal is required.');
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('V18 video proxy attachment was cancelled.', 'AbortError');
}
