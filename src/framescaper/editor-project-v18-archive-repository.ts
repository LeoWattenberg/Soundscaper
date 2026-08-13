/* SPDX-License-Identifier: AGPL-3.0-only */

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
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	framescaperProjectFingerprintV18,
} from './editor-project-v18-preservation-repository.ts';
import {
	cloneFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';

export type FramescaperProjectV18ArchivePublicationMode =
	| 'create'
	| 'copy'
	| 'compare-and-swap';

export interface FramescaperProjectV18ArchivePreservationPlan {
	readonly sourceId: string;
	readonly plan: VideoProxyPreservationPlan;
}

export interface FramescaperProjectV18ArchivePublication {
	readonly mode: FramescaperProjectV18ArchivePublicationMode;
	readonly origin: unknown;
	readonly expected: unknown | null;
	readonly project: unknown;
	readonly plans: readonly FramescaperProjectV18ArchivePreservationPlan[];
}

export interface FramescaperProjectV18ArchiveRepositoryDependencies {
	readonly port: StorageRepositoryPort;
	readonly claims: VideoProxyClaimRepository;
}

interface NormalizedPublication {
	readonly mode: FramescaperProjectV18ArchivePublicationMode;
	readonly origin: FramescaperProjectV18;
	readonly expected: FramescaperProjectV18 | null;
	readonly project: FramescaperProjectV18;
	readonly plans: readonly FramescaperProjectV18ArchivePreservationPlan[];
	readonly attachments: ReadonlyMap<string, Readonly<VideoProxyAttachmentV18>>;
	readonly originFingerprint: string;
	readonly projectId: string;
	readonly projectRevision: number;
}

const DEPENDENCY_FIELDS = ['port', 'claims'] as const;
const PUBLICATION_FIELDS = ['mode', 'origin', 'expected', 'project', 'plans'] as const;
const PLAN_FIELDS = ['sourceId', 'plan'] as const;
const MAXIMUM_PLANS = 4_094;

/** Atomic create/collision-copy/replacement owner for imported attached V18 documents. */
export class FramescaperProjectV18ArchiveRepository {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #port: StorageRepositoryPort;
	readonly #claims: VideoProxyClaimRepository;

	constructor(
		profile: EditorProjectRuntimeProfile | unknown,
		dependenciesValue: FramescaperProjectV18ArchiveRepositoryDependencies | unknown,
	) {
		assertFramescaperProjectV18Profile(profile);
		const dependencies = closedRecord(
			dependenciesValue,
			DEPENDENCY_FIELDS,
			'Framescaper V18 archive repository dependencies',
		);
		if (!dependencies.port || typeof dependencies.port !== 'object'
			|| typeof (dependencies.port as StorageRepositoryPort).database !== 'function') {
			throw new TypeError('A durable repository port is required for V18 archive publication.');
		}
		if (!(dependencies.claims instanceof VideoProxyClaimRepository)) {
			throw new TypeError('The V18 archive repository requires its exact claim authority.');
		}
		this.#profile = profile;
		this.#port = dependencies.port as StorageRepositoryPort;
		this.#claims = dependencies.claims;
	}

	async publish(
		publicationValue: FramescaperProjectV18ArchivePublication | unknown,
	): Promise<FramescaperProjectV18 | null> {
		const publication = normalizePublication(this.#profile, publicationValue);
		const database = await this.#port.database();
		if (!database) throw new Error('Durable storage is required for V18 archive publication.');
		const published = await publishTransaction(database, publication, this.#claims);
		return published ? cloneFramescaperProjectV18(this.#profile, publication.project) : null;
	}
}

async function publishTransaction(
	database: IDBDatabase,
	publication: NormalizedPublication,
	claims: VideoProxyClaimRepository,
): Promise<boolean> {
	return transact(
		database,
		['projects', 'revisions', 'mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
		'readwrite',
		async ({ projects, revisions, mediaAssets, mediaAssetStaging }) => {
			const projectId = publication.projectId;
			const current = await request(projects.get(projectId));
			if (publication.mode === 'compare-and-swap') {
				if (!sameProject(current, publication.expected)) return false;
				const expected = publication.expected!;
				const expectedRevision = projectRevision(expected);
				const baseKey = revisionKey(projectId, expectedRevision);
				const base = record(await request(revisions.get(baseKey)));
				if (!base || base.key !== baseKey || base.projectId !== projectId
					|| base.revision !== expectedRevision || !sameProject(base.project, expected)) {
					throw new Error('The exact archive replacement base revision is missing.');
				}
			} else {
				if (current !== undefined) return false;
				if (await request(revisions.index('projectId').count(projectId)) !== 0) {
					throw new Error('The archive destination has orphaned revision state.');
				}
			}

			const targetKey = revisionKey(projectId, publication.projectRevision);
			if (await request(revisions.get(targetKey)) !== undefined) {
				throw new Error('The archive target revision is already occupied.');
			}
			for (const sourcePlan of publication.plans) {
				const attachment = publication.attachments.get(sourcePlan.sourceId);
				if (!attachment) throw new Error('An archive preservation plan has no attached source.');
				const consumed = await claims.consumePreservationPlan(sourcePlan.plan, mediaAssetStaging);
				assertClaims(consumed, publication, sourcePlan.sourceId, attachment);
				await assertAndPublishBody(mediaAssets, consumed.proxy, attachment);
				await assertAndPublishBody(mediaAssets, consumed.timing, attachment);
			}
			projects.put(publication.project);
			revisions.put({
				key: targetKey, projectId, revision: publication.projectRevision,
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
	const raw = closedRecord(value, PUBLICATION_FIELDS, 'Framescaper V18 archive publication');
	const mode = publicationMode(raw.mode);
	const origin = cloneFramescaperProjectV18(profile, raw.origin);
	const project = cloneFramescaperProjectV18(profile, raw.project);
	const expected = raw.expected === null ? null : cloneFramescaperProjectV18(profile, raw.expected);
	const originId = projectIdentifier(origin);
	const projectId = projectIdentifier(project);
	const projectRevisionValue = projectRevision(project);
	if (mode === 'create') {
		if (expected !== null || !sameProject(project, origin)) {
			throw new Error('Archive create must publish the exact inspected project into an absent destination.');
		}
	} else if (mode === 'copy') {
		if (expected !== null || projectId === originId || projectRevisionValue !== 0) {
			throw new Error('Archive copy requires a fresh project identity at revision 0.');
		}
	} else {
		if (!expected || projectId !== projectIdentifier(expected) || originId !== projectIdentifier(expected)
			|| projectRevisionValue !== nextRevision(projectRevision(expected))) {
			throw new Error('Archive replacement must compare and swap exactly the next revision.');
		}
	}
	assertSamePreservedAttachments(origin, project);
	const attachments = attachedSources(project);
	if (attachments.size === 0) throw new Error('Format-2 archive publication requires an attachment.');
	const plans = normalizePlans(raw.plans, attachments);
	return {
		mode, origin, expected, project, plans, attachments,
		originFingerprint: framescaperProjectFingerprintV18(profile, origin),
		projectId,
		projectRevision: projectRevisionValue,
	};
}

function normalizePlans(
	value: unknown,
	attachments: ReadonlyMap<string, Readonly<VideoProxyAttachmentV18>>,
): readonly FramescaperProjectV18ArchivePreservationPlan[] {
	const input = denseArray(value, 'Framescaper V18 archive preservation plans');
	if (input.length > MAXIMUM_PLANS) throw new RangeError('The archive preservation plan limit was exceeded.');
	const seen = new Set<string>();
	const plans = input.map((entry, index) => {
		const raw = closedRecord(entry, PLAN_FIELDS, `archive preservation plan ${String(index)}`);
		const sourceId = identifier(raw.sourceId, 'archive preservation source id');
		if (seen.has(sourceId) || !attachments.has(sourceId)) {
			throw new Error('Archive preservation plans must map once to every attached source.');
		}
		seen.add(sourceId);
		return Object.freeze({ sourceId, plan: raw.plan as VideoProxyPreservationPlan });
	});
	if (seen.size !== attachments.size) throw new Error('Every attached source requires an archive preservation plan.');
	return Object.freeze(plans);
}

function assertSamePreservedAttachments(
	origin: FramescaperProjectV18,
	target: FramescaperProjectV18,
): void {
	const inventory = (project: FramescaperProjectV18): string[] => [...attachedSources(project).values()]
		.map((attachment) => JSON.stringify(attachment)).sort();
	if (JSON.stringify(inventory(origin)) !== JSON.stringify(inventory(target))) {
		throw new Error('Archive copy or replacement cannot introduce, remove, or change an attachment.');
	}
}

function attachedSources(
	project: FramescaperProjectV18,
): ReadonlyMap<string, Readonly<VideoProxyAttachmentV18>> {
	const attachments = new Map<string, Readonly<VideoProxyAttachmentV18>>();
	for (const source of project.sources) {
		if (source.kind === 'video' && source.proxyAttachment !== null) {
			attachments.set(identifier(source.id, 'attached source id'), source.proxyAttachment);
		}
	}
	return attachments;
}

function assertClaims(
	claims: Readonly<ConsumedVideoProxyPreservationClaims>,
	publication: NormalizedPublication,
	sourceId: string,
	attachment: Readonly<VideoProxyAttachmentV18>,
): void {
	for (const claim of [claims.proxy, claims.timing]) {
		if (claim.projectId !== publication.projectId || claim.sourceId !== sourceId
			|| claim.baseFingerprint !== publication.originFingerprint) {
			throw new Error('An archive claim does not match its project, source, or inspected document.');
		}
	}
	if (claims.proxy.bodyKind !== 'proxy' || claims.proxy.bodyKey !== attachment.storageKey
		|| claims.proxy.rowIdentity.sha256 !== attachment.sha256
		|| claims.proxy.rowIdentity.byteLength !== attachment.byteLength
		|| claims.proxy.rowIdentity.mimeType !== attachment.mimeType) {
		throw new Error('The archive proxy claim does not match its attachment.');
	}
	const timing = attachment.timingAsset;
	if (claims.timing.bodyKind !== 'timing' || claims.timing.bodyKey !== timing.storageKey
		|| claims.timing.rowIdentity.sha256 !== timing.sha256
		|| claims.timing.rowIdentity.byteLength !== timing.byteLength
		|| claims.timing.rowIdentity.encoding !== timing.encoding) {
		throw new Error('The archive timing claim does not match its attachment.');
	}
}

async function assertAndPublishBody(
	mediaAssets: IDBObjectStore,
	claim: Readonly<VideoProxyClaimRecord>,
	attachment: Readonly<VideoProxyAttachmentV18>,
): Promise<void> {
	const row = record(await request(mediaAssets.get(claim.bodyKey)));
	if (!row || !sameBodyRow(row, claim)) throw new Error('An archive body row changed after verification.');
	if (claim.bodyKind === 'timing' && (Object.hasOwn(row, 'frameCount')
		|| Object.hasOwn(row, 'timescale') || Object.hasOwn(row, 'finalFrameDurationTicks'))
		&& (row.frameCount !== attachment.timingAsset.frameCount
			|| row.timescale !== attachment.timingAsset.timescale
			|| row.finalFrameDurationTicks !== attachment.timingAsset.finalFrameDurationTicks)) {
		throw new Error('The archive timing row summary changed before publication.');
	}
	mediaAssets.put(publishSource(row as StorageRecord));
}

function sameBodyRow(row: Record<string, unknown>, claim: Readonly<VideoProxyClaimRecord>): boolean {
	const identity = claim.rowIdentity;
	return row.sourceId === identity.sourceId && row.kind === identity.kind
		&& row.encoding === identity.encoding && row.storage === identity.storage
		&& (row.path ?? null) === identity.path && (row.mediaChunkToken ?? null) === identity.mediaChunkToken
		&& (row.mediaChunkBytes ?? null) === identity.mediaChunkBytes
		&& (row.mediaChunkCount ?? null) === identity.mediaChunkCount
		&& row.mediaContentDigestVersion === identity.mediaContentDigestVersion
		&& row.mediaContentToken === identity.mediaContentToken && row.sha256 === identity.sha256
		&& row.size === identity.byteLength && row.mimeType === identity.mimeType;
}

function sameProject(value: unknown, expected: FramescaperProjectV18 | null): boolean {
	if (!expected) return false;
	try { return serializeScapeProjectDocument(value) === serializeScapeProjectDocument(expected); }
	catch { return false; }
}

function publicationMode(value: unknown): FramescaperProjectV18ArchivePublicationMode {
	if (value === 'create' || value === 'copy' || value === 'compare-and-swap') return value;
	throw new TypeError('A supported V18 archive publication mode is required.');
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}

function nextRevision(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
		throw new RangeError('The archive replacement revision cannot be incremented safely.');
	}
	return value + 1;
}

function projectIdentifier(project: FramescaperProjectV18): string {
	return identifier(project.id, 'project id');
}

function projectRevision(project: FramescaperProjectV18): number {
	if (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw new RangeError('A non-negative V18 project revision is required.');
	}
	return Number(project.revision);
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
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
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name} is sparse.`);
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== result.length + 1) throw new TypeError(`${name} has extra properties.`);
	return result;
}

function closedRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	name: string,
): Record<Fields[number], unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
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
		? value as Record<string, unknown> : null;
}
