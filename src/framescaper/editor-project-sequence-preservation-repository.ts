/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../common/editor/storage/media-asset-staging-schema.ts';
import { publishSource, type StorageRecord } from '../common/editor/storage/media-records.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimRepository,
	type ConsumedVideoProxyPreservationClaims,
	type VideoProxyClaimRecord,
	type VideoProxyPreservationPlan,
} from '../common/editor/storage/video-proxy-claim-repository.ts';
import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsSequence,
} from './editor-project-feature-requirements-sequence.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-project-sequence-profile.ts';
import {
	cloneFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence.ts';

const TEXT_ENCODER = new TextEncoder();
const MAXIMUM_PRESERVATION_PLANS = 4_094;
const DEPENDENCY_FIELDS = ['port', 'claims'] as const;
const PUBLICATION_FIELDS = ['expected', 'project', 'plans'] as const;
const PLAN_FIELDS = ['sourceId', 'plan'] as const;

export interface FramescaperProjectSequencePreservationPlan {
	readonly sourceId: string;
	readonly plan: VideoProxyPreservationPlan;
}

export interface FramescaperProjectSequencePreservationPublication {
	readonly expected: unknown;
	readonly project: unknown;
	readonly plans: readonly FramescaperProjectSequencePreservationPlan[];
}

export interface FramescaperProjectSequencePreservationDependencies {
	readonly port: StorageRepositoryPort;
	readonly claims: VideoProxyClaimRepository;
}

interface AttachedSource {
	readonly sourceId: string;
	readonly attachment: Readonly<VideoProxyAttachmentV18>;
}

interface NormalizedPublication {
	readonly expected: FramescaperProjectSequence;
	readonly project: FramescaperProjectSequence;
	readonly plans: readonly FramescaperProjectSequencePreservationPlan[];
	readonly attachments: ReadonlyMap<string, Readonly<VideoProxyAttachmentV18>>;
	readonly baseFingerprint: string;
	readonly projectId: string;
	readonly baseRevision: number;
	readonly nextRevision: number;
}

/** Canonical digest used to bind a claim operation to one exact sequence predecessor. */
export function framescaperProjectFingerprintSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
): string {
	assertFramescaperProjectSequenceProfile(profile);
	const snapshot = cloneFramescaperProjectSequence(profile, project);
	return fingerprint(snapshot);
}

/**
 * The only dormant browser repository seam that can atomically reproduce or
 * introduce a non-null sequence proxy pointer. Ordinary project saves never receive
 * its repository-local, one-use claim capabilities.
 */
export class FramescaperProjectSequencePreservationRepository {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #port: StorageRepositoryPort;
	readonly #claims: VideoProxyClaimRepository;

	constructor(
		profile: EditorProjectRuntimeProfile | unknown,
		dependenciesValue: FramescaperProjectSequencePreservationDependencies | unknown,
	) {
		assertFramescaperProjectSequenceProfile(profile);
		const dependencies = closedRecord(
			dependenciesValue,
			DEPENDENCY_FIELDS,
			'Framescaper sequence preservation dependencies',
		);
		if (!dependencies.port || typeof dependencies.port !== 'object'
			|| typeof (dependencies.port as StorageRepositoryPort).database !== 'function') {
			throw new TypeError('A storage repository port is required for sequence preservation.');
		}
		if (!(dependencies.claims instanceof VideoProxyClaimRepository)) {
			throw new TypeError('A video proxy claim repository is required for sequence preservation.');
		}
		this.#profile = profile;
		this.#port = dependencies.port as StorageRepositoryPort;
		this.#claims = dependencies.claims;
	}

	async publishIfCurrent(
		publicationValue: FramescaperProjectSequencePreservationPublication | unknown,
	): Promise<FramescaperProjectSequence | null> {
		const database = await this.#port.database();
		if (!database) {
			throw new Error('Durable storage is required; memory sequence preservation is unsupported.');
		}
		const publication = normalizePublication(this.#profile, publicationValue);
		const published = await publishInTransaction(database, publication, this.#claims);
		return published ? cloneFramescaperProjectSequence(this.#profile, publication.project) : null;
	}
}

async function publishInTransaction(
	database: IDBDatabase,
	publication: NormalizedPublication,
	claims: VideoProxyClaimRepository,
): Promise<boolean> {
	return transact(
		database,
		['projects', 'revisions', 'mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
		'readwrite',
		async ({ projects, revisions, mediaAssets, mediaAssetStaging }) => {
			const current = await request(projects.get(publication.projectId));
			if (!sameProject(current, publication.expected)) return false;

			const baseKey = revisionKey(publication.projectId, publication.baseRevision);
			const baseRecord = record(await request(revisions.get(baseKey)));
			if (!baseRecord
				|| baseRecord.key !== baseKey
				|| baseRecord.projectId !== publication.projectId
				|| baseRecord.revision !== publication.baseRevision
				|| !sameProject(baseRecord.project, publication.expected)) {
				throw new Error('The exact sequence base revision is missing or conflicts with the current project.');
			}

			const nextKey = revisionKey(publication.projectId, publication.nextRevision);
			if (await request(revisions.get(nextKey)) !== undefined) {
				throw new Error('The next revision is already occupied.');
			}

			for (const sourcePlan of publication.plans) {
				const attachment = publication.attachments.get(sourcePlan.sourceId);
				if (!attachment) throw new Error('A preservation plan has no exact attached source.');
				const consumed = await claims.consumePreservationPlan(
					sourcePlan.plan,
					mediaAssetStaging,
				);
				assertClaimsMatchPublication(consumed, publication, sourcePlan.sourceId, attachment);
				await assertAndPublishBody(mediaAssets, consumed.proxy, attachment);
				await assertAndPublishBody(mediaAssets, consumed.timing, attachment);
			}

			projects.put(publication.project);
			revisions.put({
				key: nextKey,
				projectId: publication.projectId,
				revision: publication.nextRevision,
				project: publication.project,
			});
			return true;
		},
	);
}

function normalizePublication(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
): NormalizedPublication {
	const raw = closedRecord(value, PUBLICATION_FIELDS, 'Framescaper sequence preservation publication');
	const expected = cloneFramescaperProjectSequence(profile, raw.expected);
	const project = cloneFramescaperProjectSequence(profile, raw.project);
	const projectId = requiredIdentifier(expected.id, 'base project id');
	if (project.id !== projectId) {
		throw new Error('sequence preservation cannot change project identity.');
	}
	const baseRevision = revision(expected.revision, 'base');
	const nextRevision = safeNextRevision(baseRevision);
	if (project.revision !== nextRevision) {
		throw new Error('sequence preservation must publish exactly the next revision.');
	}
	const attachedSources = collectAttachedSources(project);
	if (attachedSources.length === 0) {
		throw new Error('sequence preservation requires at least one non-null proxy attachment.');
	}
	const attachments = new Map(attachedSources.map(({ sourceId, attachment }) => [sourceId, attachment]));
	const plans = normalizePlans(raw.plans, attachments);
	assertExactAttachmentTransition(profile, expected, project, plans);
	return {
		expected,
		project,
		plans,
		attachments,
		baseFingerprint: fingerprint(expected),
		projectId,
		baseRevision,
		nextRevision,
	};
}

function assertExactAttachmentTransition(
	profile: EditorProjectRuntimeProfile,
	expected: FramescaperProjectSequence,
	project: FramescaperProjectSequence,
	plans: readonly FramescaperProjectSequencePreservationPlan[],
): void {
	if (plans.length !== 1 || collectAttachedSources(expected).length !== 0) {
		throw new Error('sequence pointer publication requires one attachment from an exact all-null base.');
	}
	const sourceId = plans[0]!.sourceId;
	const attachment = collectAttachedSources(project).find((source) => source.sourceId === sourceId)?.attachment;
	if (!attachment) throw new Error('The sequence pointer publication target attachment is missing.');
	const timestamp = new Date(String(project.updatedAt));
	const baseTimestamp = new Date(String(expected.updatedAt));
	if (Number.isNaN(timestamp.getTime()) || Number.isNaN(baseTimestamp.getTime())
		|| timestamp.toISOString() !== project.updatedAt
		|| timestamp.getTime() < baseTimestamp.getTime()
		|| project.updatedAt === expected.updatedAt) {
		throw new Error('sequence pointer publication requires one fresh canonical updatedAt.');
	}
	const candidate = structuredClone(expected) as unknown as Record<string, unknown>;
	candidate.revision = project.revision;
	candidate.updatedAt = project.updatedAt;
	const sources = candidate.sources as Record<string, unknown>[];
	const matching = sources.filter((source) => source.id === sourceId);
	if (matching.length !== 1 || matching[0]!.kind !== 'video'
		|| matching[0]!.proxyAttachment !== null) {
		throw new Error('The sequence pointer publication source is not the exact all-null video target.');
	}
	matching[0]!.proxyAttachment = attachment;
	candidate.featureRequirements = reconcileFramescaperProjectFeatureRequirementsSequence(profile, candidate);
	const normalized = cloneFramescaperProjectSequence(profile, candidate);
	if (!sameProject(normalized, project)) {
		throw new Error('sequence pointer publication may change only its target attachment, owned requirement, revision, and timestamp.');
	}
}

function normalizePlans(
	value: unknown,
	attachments: ReadonlyMap<string, Readonly<VideoProxyAttachmentV18>>,
): readonly FramescaperProjectSequencePreservationPlan[] {
	const values = denseArray(value, 'Framescaper sequence preservation plans');
	if (values.length > MAXIMUM_PRESERVATION_PLANS) {
		throw new RangeError('The sequence preservation plan limit was exceeded.');
	}
	const seen = new Set<string>();
	const plans = values.map((entry, index) => {
		const raw = closedRecord(entry, PLAN_FIELDS, `sequence preservation plan ${String(index)}`);
		const sourceId = requiredIdentifier(raw.sourceId, 'preservation source id');
		if (seen.has(sourceId)) throw new Error('A sequence attachment has duplicate preservation plans.');
		if (!attachments.has(sourceId)) throw new Error('A preservation plan source is not attached.');
		seen.add(sourceId);
		return Object.freeze({
			sourceId,
			plan: raw.plan as VideoProxyPreservationPlan,
		});
	});
	if (seen.size !== attachments.size) {
		throw new Error('Every sequence attachment requires one complete preservation plan.');
	}
	return Object.freeze(plans);
}

function collectAttachedSources(project: FramescaperProjectSequence): readonly AttachedSource[] {
	const sources: AttachedSource[] = [];
	for (const source of project.sources) {
		if (source.kind !== 'video' || source.proxyAttachment === null) continue;
		sources.push({
			sourceId: requiredIdentifier(source.id, 'attached video source id'),
			attachment: source.proxyAttachment,
		});
	}
	return sources;
}

function assertClaimsMatchPublication(
	claims: Readonly<ConsumedVideoProxyPreservationClaims>,
	publication: NormalizedPublication,
	sourceId: string,
	attachment: Readonly<VideoProxyAttachmentV18>,
): void {
	for (const claim of [claims.proxy, claims.timing]) {
		if (claim.projectId !== publication.projectId
			|| claim.sourceId !== sourceId
			|| claim.baseFingerprint !== publication.baseFingerprint) {
			throw new Error('A preservation claim does not match its project, source, or base generation.');
		}
	}
	if (claims.proxy.bodyKind !== 'proxy'
		|| claims.proxy.bodyKey !== attachment.storageKey
		|| claims.proxy.rowIdentity.sha256 !== attachment.sha256
		|| claims.proxy.rowIdentity.byteLength !== attachment.byteLength
		|| claims.proxy.rowIdentity.mimeType !== attachment.mimeType) {
		throw new Error('The proxy claim does not match the exact sequence attachment.');
	}
	if (claims.timing.bodyKind !== 'timing'
		|| claims.timing.bodyKey !== attachment.timingAsset.storageKey
		|| claims.timing.rowIdentity.sha256 !== attachment.timingAsset.sha256
		|| claims.timing.rowIdentity.byteLength !== attachment.timingAsset.byteLength
		|| claims.timing.rowIdentity.encoding !== attachment.timingAsset.encoding) {
		throw new Error('The timing claim does not match the exact sequence attachment.');
	}
}

async function assertAndPublishBody(
	mediaAssets: IDBObjectStore,
	claim: Readonly<VideoProxyClaimRecord>,
	attachment: Readonly<VideoProxyAttachmentV18>,
): Promise<void> {
	const row = record(await request(mediaAssets.get(claim.bodyKey)));
	if (!row || !sameBodyRow(row, claim)) {
		throw new Error(`The ${claim.bodyKind} body row changed after claim generation verification.`);
	}
	if (claim.bodyKind === 'timing') {
		if (row.frameCount !== attachment.timingAsset.frameCount
			|| row.timescale !== attachment.timingAsset.timescale
			|| row.finalFrameDurationTicks !== attachment.timingAsset.finalFrameDurationTicks) {
			// Timing summary fields are optional on legacy verified rows, but when
			// present they must retain the attachment's exact public summary.
			const hasSummary = Object.hasOwn(row, 'frameCount')
				|| Object.hasOwn(row, 'timescale')
				|| Object.hasOwn(row, 'finalFrameDurationTicks');
			if (hasSummary) throw new Error('The timing body row summary changed before publication.');
		}
	}
	mediaAssets.put(publishSource(row as StorageRecord));
}

function sameBodyRow(row: Record<string, unknown>, claim: Readonly<VideoProxyClaimRecord>): boolean {
	const identity = claim.rowIdentity;
	return row.sourceId === identity.sourceId
		&& row.kind === identity.kind
		&& row.encoding === identity.encoding
		&& row.storage === identity.storage
		&& (row.path ?? null) === identity.path
		&& (row.mediaChunkToken ?? null) === identity.mediaChunkToken
		&& (row.mediaChunkBytes ?? null) === identity.mediaChunkBytes
		&& (row.mediaChunkCount ?? null) === identity.mediaChunkCount
		&& row.mediaContentDigestVersion === identity.mediaContentDigestVersion
		&& row.mediaContentToken === identity.mediaContentToken
		&& row.sha256 === identity.sha256
		&& row.size === identity.byteLength
		&& row.mimeType === identity.mimeType;
}

function fingerprint(project: FramescaperProjectSequence): string {
	return bytesToHex(sha256(TEXT_ENCODER.encode(serializeScapeProjectDocument(project))));
}

function sameProject(value: unknown, expected: FramescaperProjectSequence): boolean {
	try {
		return serializeScapeProjectDocument(value) === serializeScapeProjectDocument(expected);
	} catch {
		return false;
	}
}

function revisionKey(projectId: string, value: number): string {
	return `${projectId}:${String(value).padStart(12, '0')}`;
}

function revision(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The sequence ${label} revision must be a non-negative safe integer.`);
	}
	return Number(value);
}

function safeNextRevision(value: number): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError('The sequence revision cannot be incremented safely.');
	return value + 1;
}

function requiredIdentifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256
		|| !/^[\x21-\x7e]+$/u.test(value)) {
		throw new TypeError(`A bounded printable ${name} is required.`);
	}
	return value;
}

function denseArray(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a dense ordinary array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an enumerable data property.`);
		}
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'length'
		&& (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)
			|| Number(key) >= value.length))) {
		throw new TypeError(`${name} has unsupported properties.`);
	}
	return result;
}

function closedRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	name: string,
): Record<Fields[number], unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has unsupported, missing, or extra fields.`);
	}
	const result = Object.create(null) as Record<Fields[number], unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an enumerable data property.`);
		}
		result[field as Fields[number]] = descriptor.value;
	}
	return result;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}
