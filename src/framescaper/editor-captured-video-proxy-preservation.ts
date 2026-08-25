/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { isFramescaperSequenceProjectSchema } from '../common/editor/project-schema-version.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../common/editor/storage/media-asset-staging-schema.ts';
import { publishSource, type StorageRecord } from '../common/editor/storage/media-records.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimRepository,
	normalizeVideoProxyClaimRecord,
	type ConsumedVideoProxyPreservationClaims,
	type VideoProxyClaimRecord,
	type VideoProxyPreservationPlan,
} from '../common/editor/storage/video-proxy-claim-repository.ts';
import { videoProxyCleanupTombstoneKey } from '../common/editor/storage/video-proxy-cleanup-tombstone-schema.ts';
import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import { reconcileFramescaperProjectFeatureRequirementsV18 } from './editor-project-feature-requirements-v18.ts';
import { reconcileFramescaperProjectFeatureRequirementsV19 } from './editor-project-feature-requirements-v19.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import { cloneFramescaperProjectV19, type FramescaperProjectV19 } from './editor-project-v19.ts';
import { reconcileFramescaperProjectFeatureRequirementsV20 } from './editor-project-feature-requirements-v20.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from './editor-project-feature-requirements-v27.ts';
import { assertFramescaperProjectV20Profile } from './editor-project-v20-profile.ts';
import { cloneFramescaperProjectV20, type FramescaperProjectV20 } from './editor-project-v20.ts';
import { cloneFramescaperProjectV27, type FramescaperProjectV27 } from './editor-project-v27.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import { reconcileFramescaperProjectFeatureRequirementsV28 } from './editor-project-feature-requirements-v28.ts';
import { reconcileFramescaperProjectFeatureRequirementsV31 } from './editor-project-feature-requirements-v31.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { cloneFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { cloneFramescaperProjectV31, type FramescaperProjectV31 } from './editor-project-v31.ts';

const TEXT_ENCODER = new TextEncoder();

export type FramescaperCapturedVideoProxySchemaVersion = 18 | 19 | 20 | 27 | 28 | 31;
export type FramescaperCapturedVideoProxyProject =
	FramescaperProjectV18 | FramescaperProjectV19 | FramescaperProjectV20
	| FramescaperProjectV27 | FramescaperProjectV28 | FramescaperProjectV31;

export interface FramescaperCapturedVideoProxyPreservationPublication {
	readonly expected: unknown;
	readonly project: unknown;
	readonly sourceId: string;
	readonly plan: VideoProxyPreservationPlan;
}

/**
 * Product-private one-source CAS publisher used by post-capture proxy work.
 * One exact null or attached target may become the proven attachment in the
 * same transaction that consumes and publishes its two body claims.
 */
export class FramescaperCapturedVideoProxyPreservationRepository {
	readonly #schemaVersion: FramescaperCapturedVideoProxySchemaVersion;
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #port: StorageRepositoryPort;
	readonly #claims: VideoProxyClaimRepository;

	constructor(
		schemaVersion: FramescaperCapturedVideoProxySchemaVersion,
		profile: EditorProjectRuntimeProfile,
		dependencies: Readonly<{
			readonly port: StorageRepositoryPort;
			readonly claims: VideoProxyClaimRepository;
		}>,
	) {
		if (!isFramescaperSequenceProjectSchema(schemaVersion)) {
			throw new TypeError('Captured proxy preservation requires a maintained Framescaper schema.');
		}
		if (!dependencies?.port || typeof dependencies.port.database !== 'function'
			|| !(dependencies.claims instanceof VideoProxyClaimRepository)) {
			throw new TypeError('Captured proxy preservation requires its exact durable authorities.');
		}
		assertProfile(schemaVersion, profile);
		this.#schemaVersion = schemaVersion;
		this.#profile = profile;
		this.#port = dependencies.port;
		this.#claims = dependencies.claims;
	}

	async publishIfCurrent(
		publicationValue: FramescaperCapturedVideoProxyPreservationPublication,
	): Promise<FramescaperCapturedVideoProxyProject | null> {
		const publication = normalizePublication(
			this.#schemaVersion,
			this.#profile,
			publicationValue,
		);
		const database = await this.#port.database();
		if (!database) throw new Error('Durable storage is required for captured proxy preservation.');
		const published = await publishInTransaction(database, publication, this.#claims);
		return published
			? cloneProject(this.#schemaVersion, this.#profile, publication.project)
			: null;
	}

	/** Rewind only this exact tentative local publication after desktop CAS refusal. */
	async rollbackIfCurrent(
		expectedValue: unknown,
		publishedValue: unknown,
		sourceIdValue: string,
		claimsValue: readonly unknown[] = [],
	): Promise<boolean> {
		const expected = cloneProject(this.#schemaVersion, this.#profile, expectedValue);
		const published = cloneProject(this.#schemaVersion, this.#profile, publishedValue);
		const sourceId = identifier(sourceIdValue, 'source id');
		const attachment = exactSource(published, sourceId).proxyAttachment;
		if (!attachment) throw new Error('Captured proxy rollback requires one published attachment.');
		assertExactTransition(
			this.#schemaVersion, this.#profile, expected, published, sourceId, attachment,
		);
		const claims = rollbackClaims(expected, published, sourceId, claimsValue);
		if (published.id !== expected.id || published.revision !== Number(expected.revision) + 1) {
			throw new Error('Captured proxy rollback requires its exact next revision.');
		}
		const database = await this.#port.database();
		if (!database) throw new Error('Durable storage is required for captured proxy rollback.');
		return transact(
			database,
			['projects', 'revisions', 'mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
			'readwrite',
			async ({ projects, revisions, mediaAssets, mediaAssetStaging }) => {
			const current = await request(projects.get(String(expected.id)));
			if (!sameProject(current, published)) return false;
			const baseKey = revisionKey(String(expected.id), Number(expected.revision));
			const nextKey = revisionKey(String(expected.id), Number(published.revision));
			const [baseRevision, nextRevision] = await Promise.all([
				request(revisions.get(baseKey)),
				request(revisions.get(nextKey)),
			]);
			if (!sameProject(record(baseRevision)?.project, expected)
				|| !sameProject(record(nextRevision)?.project, published)) {
				throw new Error('Captured proxy rollback revision evidence changed.');
			}
			for (const claim of claims) {
				const [stored, tombstone, row] = await Promise.all([
					request(mediaAssetStaging.get(claim.key)),
					request(mediaAssetStaging.get(videoProxyCleanupTombstoneKey(claim.bodyKey))),
					request(mediaAssets.get(claim.bodyKey)),
				]);
				if (stored !== undefined || tombstone !== undefined || !sameBodyRow(record(row) ?? {}, claim)) {
					throw new Error('Captured proxy rollback cleanup evidence changed.');
				}
			}
			await Promise.all([
				request(projects.put(expected)),
				request(revisions.delete(nextKey)),
				...claims.map((claim) => request(mediaAssetStaging.put(claim))),
			]);
			return true;
			},
		);
	}
}

export function framescaperCapturedVideoProxyProjectFingerprint(
	schemaVersion: FramescaperCapturedVideoProxySchemaVersion,
	profile: EditorProjectRuntimeProfile,
	project: unknown,
): string {
	return fingerprint(cloneProject(schemaVersion, profile, project));
}

interface NormalizedPublication {
	readonly expected: FramescaperCapturedVideoProxyProject;
	readonly project: FramescaperCapturedVideoProxyProject;
	readonly sourceId: string;
	readonly attachment: Readonly<VideoProxyAttachmentV18>;
	readonly plan: VideoProxyPreservationPlan;
	readonly baseFingerprint: string;
	readonly projectId: string;
	readonly baseRevision: number;
	readonly nextRevision: number;
}

function normalizePublication(
	schemaVersion: FramescaperCapturedVideoProxySchemaVersion,
	profile: EditorProjectRuntimeProfile,
	value: FramescaperCapturedVideoProxyPreservationPublication,
): NormalizedPublication {
	if (!value || typeof value !== 'object') throw new TypeError('A captured proxy publication is required.');
	const expected = cloneProject(schemaVersion, profile, value.expected);
	const project = cloneProject(schemaVersion, profile, value.project);
	const projectId = identifier(expected.id, 'project id');
	const sourceId = identifier(value.sourceId, 'source id');
	const baseRevision = revision(expected.revision, 'base');
	const nextRevision = safeNextRevision(baseRevision);
	if (project.id !== projectId || project.revision !== nextRevision) {
		throw new Error('Captured proxy preservation requires the exact next project revision.');
	}
	const baseSource = exactSource(expected, sourceId);
	const nextSource = exactSource(project, sourceId);
	if (baseSource.kind !== 'video' || nextSource.kind !== 'video'
		|| nextSource.proxyAttachment === null) {
		throw new Error('Captured proxy preservation requires one video attachment target.');
	}
	assertExactTransition(schemaVersion, profile, expected, project, sourceId, nextSource.proxyAttachment);
	return Object.freeze({
		expected,
		project,
		sourceId,
		attachment: nextSource.proxyAttachment,
		plan: value.plan,
		baseFingerprint: fingerprint(expected),
		projectId,
		baseRevision,
		nextRevision,
	});
}

function assertExactTransition(
	schemaVersion: FramescaperCapturedVideoProxySchemaVersion,
	profile: EditorProjectRuntimeProfile,
	expected: FramescaperCapturedVideoProxyProject,
	project: FramescaperCapturedVideoProxyProject,
	sourceId: string,
	attachment: Readonly<VideoProxyAttachmentV18>,
): void {
	const timestamp = new Date(String(project.updatedAt));
	const baseTimestamp = new Date(String(expected.updatedAt));
	if (Number.isNaN(timestamp.getTime()) || Number.isNaN(baseTimestamp.getTime())
		|| timestamp.toISOString() !== project.updatedAt
		|| timestamp.getTime() < baseTimestamp.getTime()
		|| project.updatedAt === expected.updatedAt) {
		throw new Error('Captured proxy preservation requires one fresh canonical timestamp.');
	}
	const candidate = structuredClone(expected) as unknown as Record<string, unknown>;
	candidate.revision = project.revision;
	candidate.updatedAt = project.updatedAt;
	const source = exactSource(candidate as unknown as FramescaperCapturedVideoProxyProject, sourceId);
	source.proxyAttachment = attachment;
	candidate.featureRequirements = reconcileRequirements(schemaVersion, profile, candidate);
	const normalized = cloneProject(schemaVersion, profile, candidate);
	if (!sameProject(normalized, project)) {
		throw new Error('Captured proxy publication may change only its target attachment and owned revision fields.');
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
			if (!baseRecord || baseRecord.key !== baseKey
				|| baseRecord.projectId !== publication.projectId
				|| baseRecord.revision !== publication.baseRevision
				|| !sameProject(baseRecord.project, publication.expected)) {
				throw new Error('The captured proxy base revision is missing or inconsistent.');
			}
			const nextKey = revisionKey(publication.projectId, publication.nextRevision);
			if (await request(revisions.get(nextKey)) !== undefined) {
				throw new Error('The captured proxy next revision is already occupied.');
			}
			const consumed = await claims.consumePreservationPlan(publication.plan, mediaAssetStaging);
			assertClaims(consumed, publication);
			await assertAndPublishBody(mediaAssets, consumed.proxy, publication.attachment);
			await assertAndPublishBody(mediaAssets, consumed.timing, publication.attachment);
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

function assertClaims(
	claims: Readonly<ConsumedVideoProxyPreservationClaims>,
	publication: NormalizedPublication,
): void {
	for (const claim of [claims.proxy, claims.timing]) {
		if (claim.projectId !== publication.projectId
			|| claim.sourceId !== publication.sourceId
			|| claim.baseFingerprint !== publication.baseFingerprint) {
			throw new Error('A captured proxy claim does not match its exact source generation.');
		}
	}
	const attachment = publication.attachment;
	if (claims.proxy.bodyKind !== 'proxy'
		|| claims.proxy.bodyKey !== attachment.storageKey
		|| claims.proxy.rowIdentity.sha256 !== attachment.sha256
		|| claims.proxy.rowIdentity.byteLength !== attachment.byteLength
		|| claims.proxy.rowIdentity.mimeType !== attachment.mimeType) {
		throw new Error('The captured proxy body claim does not match its attachment.');
	}
	if (claims.timing.bodyKind !== 'timing'
		|| claims.timing.bodyKey !== attachment.timingAsset.storageKey
		|| claims.timing.rowIdentity.sha256 !== attachment.timingAsset.sha256
		|| claims.timing.rowIdentity.byteLength !== attachment.timingAsset.byteLength
		|| claims.timing.rowIdentity.encoding !== attachment.timingAsset.encoding) {
		throw new Error('The captured timing body claim does not match its attachment.');
	}
}

async function assertAndPublishBody(
	mediaAssets: IDBObjectStore,
	claim: Readonly<VideoProxyClaimRecord>,
	attachment: Readonly<VideoProxyAttachmentV18>,
): Promise<void> {
	const row = record(await request(mediaAssets.get(claim.bodyKey)));
	if (!row || !sameBodyRow(row, claim)) {
		throw new Error(`The captured ${claim.bodyKind} row changed before publication.`);
	}
	if (claim.bodyKind === 'timing') {
		const timing = attachment.timingAsset;
		const hasSummary = Object.hasOwn(row, 'frameCount')
			|| Object.hasOwn(row, 'timescale')
			|| Object.hasOwn(row, 'finalFrameDurationTicks');
		if (hasSummary && (row.frameCount !== timing.frameCount
			|| row.timescale !== timing.timescale
			|| row.finalFrameDurationTicks !== timing.finalFrameDurationTicks)) {
			throw new Error('The captured timing row summary changed before publication.');
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

function rollbackClaims(
	expected: FramescaperCapturedVideoProxyProject,
	published: FramescaperCapturedVideoProxyProject,
	sourceId: string,
	values: readonly unknown[],
): readonly Readonly<VideoProxyClaimRecord>[] {
	if (!Array.isArray(values) || values.length > 2) {
		throw new RangeError('Captured proxy rollback cleanup claims are invalid.');
	}
	const attachment = exactSource(published, sourceId).proxyAttachment;
	if (!attachment) {
		throw new Error('Captured proxy rollback cleanup requires its attached transition.');
	}
	const allowed = new Map([
		['proxy', attachment.storageKey],
		['timing', attachment.timingAsset.storageKey],
	]);
	const claims = values.map(normalizeVideoProxyClaimRecord);
	if (new Set(claims.map(({ bodyKind }) => bodyKind)).size !== claims.length) {
		throw new Error('Captured proxy rollback cleanup claims must have unique roles.');
	}
	for (const claim of claims) {
		if (claim.status !== 'verified' || claim.projectId !== expected.id || claim.sourceId !== sourceId
			|| claim.baseFingerprint !== fingerprint(expected)
			|| claim.bodyKey !== allowed.get(claim.bodyKind)) {
			throw new Error('A captured proxy rollback cleanup claim changed identity.');
		}
	}
	return Object.freeze(claims);
}

function cloneProject(
	schemaVersion: FramescaperCapturedVideoProxySchemaVersion,
	profile: EditorProjectRuntimeProfile,
	project: unknown,
): FramescaperCapturedVideoProxyProject {
	if (schemaVersion === 18) return cloneFramescaperProjectV18(profile, project);
	if (schemaVersion === 19) return cloneFramescaperProjectV19(profile, project);
	if (schemaVersion === 20) return cloneFramescaperProjectV20(profile, project);
	if (schemaVersion === 27) return cloneFramescaperProjectV27(profile, project);
	if (schemaVersion === 28) return cloneFramescaperProjectV28(profile, project);
	return cloneFramescaperProjectV31(profile, project);
}

function assertProfile(
	schemaVersion: FramescaperCapturedVideoProxySchemaVersion,
	profile: EditorProjectRuntimeProfile,
): void {
	if (schemaVersion === 18) assertFramescaperProjectV18Profile(profile);
	else if (schemaVersion === 19) assertFramescaperProjectV19Profile(profile);
	else if (schemaVersion === 20) assertFramescaperProjectV20Profile(profile);
	else if (schemaVersion === 27) assertFramescaperProjectV27Profile(profile);
	else if (schemaVersion === 28) assertFramescaperProjectV28Profile(profile);
	else assertFramescaperProjectV31Profile(profile);
}

function reconcileRequirements(
	schemaVersion: FramescaperCapturedVideoProxySchemaVersion,
	profile: EditorProjectRuntimeProfile,
	project: unknown,
): unknown {
	if (schemaVersion === 18) return reconcileFramescaperProjectFeatureRequirementsV18(profile, project);
	if (schemaVersion === 19) return reconcileFramescaperProjectFeatureRequirementsV19(profile, project);
	if (schemaVersion === 20) return reconcileFramescaperProjectFeatureRequirementsV20(profile, project);
	if (schemaVersion === 27) return reconcileFramescaperProjectFeatureRequirementsV27(profile, project);
	if (schemaVersion === 28) return reconcileFramescaperProjectFeatureRequirementsV28(profile, project);
	return reconcileFramescaperProjectFeatureRequirementsV31(profile, project);
}

function exactSource(
	project: FramescaperCapturedVideoProxyProject,
	sourceId: string,
): Record<string, unknown> & { kind: unknown; proxyAttachment: VideoProxyAttachmentV18 | null } {
	const sources = (project as unknown as { sources: readonly Record<string, unknown>[] }).sources;
	const matches = sources.filter((source) => source.id === sourceId);
	if (matches.length !== 1) throw new Error('The captured proxy source is missing or ambiguous.');
	return matches[0] as Record<string, unknown> & {
		kind: unknown;
		proxyAttachment: VideoProxyAttachmentV18 | null;
	};
}

function fingerprint(project: FramescaperCapturedVideoProxyProject): string {
	return bytesToHex(sha256(TEXT_ENCODER.encode(serializeScapeProjectDocument(project))));
}

function sameProject(value: unknown, expected: FramescaperCapturedVideoProxyProject): boolean {
	try { return serializeScapeProjectDocument(value) === serializeScapeProjectDocument(expected); }
	catch { return false; }
}

function revisionKey(projectId: string, value: number): string {
	return `${projectId}:${String(value).padStart(12, '0')}`;
}

function revision(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The captured proxy ${label} revision is invalid.`);
	}
	return Number(value);
}

function safeNextRevision(value: number): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError('The captured proxy revision cannot advance.');
	return value + 1;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError(`A bounded printable captured proxy ${name} is required.`);
	}
	return value;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}
