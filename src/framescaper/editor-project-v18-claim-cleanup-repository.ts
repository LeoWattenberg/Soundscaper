/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	createVideoProxyCleanupTombstone,
	failVideoProxyCleanupTombstone,
	normalizeVideoProxyCleanupTombstoneRecord,
	type VideoProxyCleanupTombstoneRecord,
	VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND,
} from '../common/editor/storage/video-proxy-cleanup-tombstone.ts';
import {
	normalizeVideoProxyClaimRecord,
	type VideoProxyClaimRecord,
	VIDEO_PROXY_CLAIM_KIND,
} from '../common/editor/storage/video-proxy-claim-repository.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import {
	MEDIA_ASSET_CHUNK_STORE_NAME,
} from '../common/editor/storage/media-asset-chunk-schema.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../common/editor/storage/media-asset-staging-schema.ts';
import { publishSource, type StorageRecord } from '../common/editor/storage/media-records.ts';
import type { OpfsRepository } from '../common/editor/storage/opfs-repository.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import { cloneFramescaperProjectHistoryV18 } from './editor-project-v18-history.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import {
	appendCleanupMapValue,
	boundedCleanupInventory,
	cleanupClosedRecord,
	cleanupCollection,
	cleanupDenseArray,
	CleanupInventoryError,
	cleanupOptionalClosedRecord,
	cleanupPhysicalKey,
	cleanupPhysicalKeyForClaim,
	exactCleanupChunks,
	groupCleanupClaims,
	hasAnyCleanupPhysicalReference,
	hasOnlyExactCleanupPhysicalReference,
	isCleanupNotFound,
	normalizeCleanupOperation,
	safeCleanupNow,
	sameCleanupBodyRow,
	sameCleanupTombstone,
	type CleanupOperationIdentity,
} from './editor-project-v18-claim-cleanup-support.ts';

const DEPENDENCY_FIELDS = ['port', 'opfs', 'now', 'maximumInventory'] as const;
const SCOPE_FIELDS = ['sessionProjects', 'histories', 'pendingSaveSnapshots'] as const;

export type FramescaperProjectV18ClaimCleanupIssueCode =
	| 'inventory-invalid'
	| 'committed-claim-mismatch'
	| 'other-root'
	| 'body-generation-changed'
	| 'shared-physical-identity'
	| 'chunk-generation-changed'
	| 'tombstone-reservation-conflict'
	| 'physical-cleanup-failed';

export interface FramescaperProjectV18ClaimCleanupIssue {
	readonly code: FramescaperProjectV18ClaimCleanupIssueCode;
	readonly bodyKey: string | null;
}

export interface FramescaperProjectV18ClaimCleanupResult {
	readonly status: 'settled' | 'indeterminate';
	readonly promotedClaimKeys: readonly string[];
	readonly cleanedBodyKeys: readonly string[];
	readonly issues: readonly FramescaperProjectV18ClaimCleanupIssue[];
}

export interface FramescaperProjectV18ClaimCleanupScope {
	readonly sessionProjects: readonly unknown[];
	readonly histories: readonly unknown[];
	readonly pendingSaveSnapshots: readonly unknown[] | ReadonlySet<unknown>;
}

export interface FramescaperProjectV18ClaimCleanupDependencies {
	readonly port: StorageRepositoryPort;
	readonly opfs: OpfsRepository;
	readonly now?: () => number;
	readonly maximumInventory?: number;
}

export type FramescaperProjectV18ClaimCleanupOperation = CleanupOperationIdentity;

interface NormalizedScope {
	readonly projects: readonly FramescaperProjectV18[];
	readonly inputCount: number;
}

interface AttachmentRoot {
	readonly projectId: string;
	readonly sourceId: string;
	readonly attachment: Readonly<VideoProxyAttachmentV18>;
}

interface Inventory {
	readonly claims: readonly Readonly<VideoProxyClaimRecord>[];
	readonly tombstones: readonly Readonly<VideoProxyCleanupTombstoneRecord>[];
	readonly roots: ReadonlySet<string>;
	readonly committedAttachments: ReadonlyMap<string, readonly AttachmentRoot[]>;
}

interface MetadataPhase {
	readonly promotedClaimKeys: readonly string[];
	readonly tombstones: readonly Readonly<VideoProxyCleanupTombstoneRecord>[];
	readonly issues: readonly FramescaperProjectV18ClaimCleanupIssue[];
}

type ClaimSelector = (claim: Readonly<VideoProxyClaimRecord>) => boolean;

/** Durable-only startup and maintenance owner for abandoned V18 body claims. */
export class FramescaperProjectV18ClaimCleanupRepository {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #port: StorageRepositoryPort;
	readonly #opfs: OpfsRepository;
	readonly #now: () => number;
	readonly #maximumInventory: number;

	constructor(
		profile: EditorProjectRuntimeProfile | unknown,
		dependenciesValue: FramescaperProjectV18ClaimCleanupDependencies | unknown,
	) {
		assertFramescaperProjectV18Profile(profile);
		const dependencies = cleanupOptionalClosedRecord(
			dependenciesValue,
			DEPENDENCY_FIELDS,
			['port', 'opfs'],
			'Framescaper V18 claim cleanup dependencies',
		);
		if (!dependencies.port || typeof dependencies.port !== 'object'
			|| typeof (dependencies.port as StorageRepositoryPort).database !== 'function') {
			throw new TypeError('A storage repository port is required for V18 claim cleanup.');
		}
		if (!dependencies.opfs || typeof dependencies.opfs !== 'object'
			|| typeof (dependencies.opfs as OpfsRepository).directory !== 'function') {
			throw new TypeError('An OPFS repository is required for V18 claim cleanup.');
		}
		if (dependencies.now !== undefined && typeof dependencies.now !== 'function') {
			throw new TypeError('The V18 claim cleanup clock must be a function.');
		}
		this.#profile = profile;
		this.#port = dependencies.port as StorageRepositoryPort;
		this.#opfs = dependencies.opfs as OpfsRepository;
		this.#now = (dependencies.now as (() => number) | undefined) ?? Date.now;
		this.#maximumInventory = boundedCleanupInventory(dependencies.maximumInventory);
	}

	async reconcile(
		scopeValue: FramescaperProjectV18ClaimCleanupScope | unknown,
	): Promise<Readonly<FramescaperProjectV18ClaimCleanupResult>> {
		return this.#run(scopeValue, () => true);
	}

	async cleanupOperation(
		operationValue: FramescaperProjectV18ClaimCleanupOperation | unknown,
		scopeValue: FramescaperProjectV18ClaimCleanupScope | unknown,
	): Promise<Readonly<FramescaperProjectV18ClaimCleanupResult>> {
		const operation = normalizeCleanupOperation(operationValue);
		return this.#run(scopeValue, (claim) => claim.operationId === operation.operationId
			&& claim.projectId === operation.projectId
			&& claim.sourceId === operation.sourceId
			&& claim.baseFingerprint === operation.baseFingerprint);
	}

	async #run(
		scopeValue: FramescaperProjectV18ClaimCleanupScope | unknown,
		select: ClaimSelector,
	): Promise<Readonly<FramescaperProjectV18ClaimCleanupResult>> {
		const scope = normalizeScope(this.#profile, scopeValue, this.#maximumInventory);
		const database = await this.#port.database();
		if (!database) {
			throw new Error('Durable storage is required; memory V18 claim cleanup is unsupported.');
		}
		let phase: MetadataPhase;
		try {
			phase = await reconcileMetadata(
				database,
				this.#profile,
				scope,
				this.#maximumInventory,
				safeCleanupNow(this.#now()),
				select,
			);
		} catch (error) {
			if (!(error instanceof CleanupInventoryError)) throw error;
			return result([], [], [issue('inventory-invalid', null)]);
		}

		const issues = [...phase.issues];
		const eligible = await recheckTombstones(
			database,
			this.#profile,
			scope,
			this.#maximumInventory,
			phase.tombstones,
			issues,
		);
		const physicallySettled: Readonly<VideoProxyCleanupTombstoneRecord>[] = [];
		for (const tombstone of eligible) {
			try {
				await deletePhysical(this.#opfs, tombstone);
				physicallySettled.push(tombstone);
			} catch {
				await retainCleanupFailure(database, tombstone, safeCleanupNow(this.#now()));
				issues.push(issue('physical-cleanup-failed', tombstone.claim.bodyKey));
			}
		}
		const cleanedBodyKeys = await finalizeTombstones(
			database,
			this.#profile,
			scope,
			this.#maximumInventory,
			physicallySettled,
			issues,
		);
		return result(phase.promotedClaimKeys, cleanedBodyKeys, issues);
	}
}

async function reconcileMetadata(
	database: IDBDatabase,
	profile: EditorProjectRuntimeProfile,
	scope: NormalizedScope,
	maximum: number,
	now: number,
	select: ClaimSelector,
): Promise<MetadataPhase> {
	return transact(database, [
		'projects', 'revisions', 'mediaAssets', MEDIA_ASSET_CHUNK_STORE_NAME,
		MEDIA_ASSET_STAGING_STORE_NAME,
	], 'readwrite', async (stores) => {
		const inventory = await readInventory(stores, profile, scope, maximum);
		const claimsByBody = groupCleanupClaims(inventory.claims);
		const tombstonesByBody = new Map(inventory.tombstones.map((value) => [value.claim.bodyKey, value]));
		const reservedPhysical = new Map(inventory.tombstones.map((value) => [cleanupPhysicalKey(value), value.claim.bodyKey]));
		const promoted: string[] = [];
		const created: Readonly<VideoProxyCleanupTombstoneRecord>[] = [];
		const issues: FramescaperProjectV18ClaimCleanupIssue[] = [];
		const processedClaims = new Set<string>();
		for (const claim of [...inventory.claims].filter(select).sort((left, right) => left.key.localeCompare(right.key))) {
			if (processedClaims.has(claim.key)) continue;
			const row = await request(stores.mediaAssets.get(claim.bodyKey));
			const committed = inventory.committedAttachments.get(claim.bodyKey)?.find((root) => (
				claimMatchesAttachment(claim, root)
			));
			if (committed) {
				const pair = committedClaimPair(claim, committed, inventory.claims);
				const rows = pair && await Promise.all(pair.map((value) => request(stores.mediaAssets.get(value.bodyKey))));
				if (!pair || !rows?.every((value, index) => sameCleanupBodyRow(value, pair[index]!))) {
					issues.push(issue('committed-claim-mismatch', claim.bodyKey));
					continue;
				}
				for (let index = 0; index < pair.length; index += 1) {
					await request(stores.mediaAssets.put(publishSource(rows[index] as StorageRecord)));
					await request(stores[MEDIA_ASSET_STAGING_STORE_NAME].delete(pair[index]!.key));
					processedClaims.add(pair[index]!.key);
					promoted.push(pair[index]!.key);
				}
				continue;
			}
			if (inventory.roots.has(claim.bodyKey)
				|| (claimsByBody.get(claim.bodyKey)?.length ?? 0) > 1
				|| tombstonesByBody.has(claim.bodyKey)) {
				issues.push(issue('other-root', claim.bodyKey));
				continue;
			}
			if (!sameCleanupBodyRow(row, claim)) {
				issues.push(issue('body-generation-changed', claim.bodyKey));
				continue;
			}
			const physical = cleanupPhysicalKeyForClaim(claim);
			if (reservedPhysical.has(physical)
				|| !await hasOnlyExactCleanupPhysicalReference(stores.mediaAssets, claim)) {
				issues.push(issue('shared-physical-identity', claim.bodyKey));
				continue;
			}
			if (!await exactCleanupChunks(stores[MEDIA_ASSET_CHUNK_STORE_NAME], claim, false)) {
				issues.push(issue('chunk-generation-changed', claim.bodyKey));
				continue;
			}
			const tombstone = createVideoProxyCleanupTombstone(claim, now);
			if (await request(stores[MEDIA_ASSET_STAGING_STORE_NAME].get(tombstone.key)) !== undefined) {
				issues.push(issue('tombstone-reservation-conflict', claim.bodyKey));
				continue;
			}
			await request(stores[MEDIA_ASSET_STAGING_STORE_NAME].put(tombstone));
			await request(stores[MEDIA_ASSET_STAGING_STORE_NAME].delete(claim.key));
			await request(stores.mediaAssets.delete(claim.bodyKey));
			await exactCleanupChunks(stores[MEDIA_ASSET_CHUNK_STORE_NAME], claim, true);
			reservedPhysical.set(physical, claim.bodyKey);
			created.push(tombstone);
		}
		return {
			promotedClaimKeys: Object.freeze(promoted.sort()),
			tombstones: Object.freeze([
				...inventory.tombstones.filter((value) => select(value.claim)),
				...created,
			]),
			issues: Object.freeze(issues),
		};
	});
}

async function recheckTombstones(
	database: IDBDatabase,
	profile: EditorProjectRuntimeProfile,
	scope: NormalizedScope,
	maximum: number,
	expected: readonly Readonly<VideoProxyCleanupTombstoneRecord>[],
	issues: FramescaperProjectV18ClaimCleanupIssue[],
): Promise<readonly Readonly<VideoProxyCleanupTombstoneRecord>[]> {
	if (expected.length === 0) return [];
	try {
		return await transact(database, [
			'projects', 'revisions', 'mediaAssets', MEDIA_ASSET_CHUNK_STORE_NAME,
			MEDIA_ASSET_STAGING_STORE_NAME,
		], 'readonly', async (stores) => {
			const inventory = await readInventory(stores, profile, scope, maximum);
			return classifyTombstones(stores, inventory, expected, issues);
		});
	} catch (error) {
		if (!(error instanceof CleanupInventoryError)) throw error;
		issues.push(issue('inventory-invalid', null));
		return [];
	}
}

async function finalizeTombstones(
	database: IDBDatabase,
	profile: EditorProjectRuntimeProfile,
	scope: NormalizedScope,
	maximum: number,
	expected: readonly Readonly<VideoProxyCleanupTombstoneRecord>[],
	issues: FramescaperProjectV18ClaimCleanupIssue[],
): Promise<readonly string[]> {
	if (expected.length === 0) return [];
	try {
		return await transact(database, [
			'projects', 'revisions', 'mediaAssets', MEDIA_ASSET_CHUNK_STORE_NAME,
			MEDIA_ASSET_STAGING_STORE_NAME,
		], 'readwrite', async (stores) => {
			const inventory = await readInventory(stores, profile, scope, maximum);
			const eligible = await classifyTombstones(stores, inventory, expected, issues);
			for (const tombstone of eligible) {
				await request(stores[MEDIA_ASSET_STAGING_STORE_NAME].delete(tombstone.key));
			}
			return Object.freeze(eligible.map((value) => value.claim.bodyKey).sort());
		});
	} catch (error) {
		if (!(error instanceof CleanupInventoryError)) throw error;
		issues.push(issue('inventory-invalid', null));
		return [];
	}
}

async function classifyTombstones(
	stores: Readonly<Record<string, IDBObjectStore>>,
	inventory: Inventory,
	expected: readonly Readonly<VideoProxyCleanupTombstoneRecord>[],
	issues: FramescaperProjectV18ClaimCleanupIssue[],
): Promise<readonly Readonly<VideoProxyCleanupTombstoneRecord>[]> {
	const claimsByBody = groupCleanupClaims(inventory.claims);
	const storedByKey = new Map(inventory.tombstones.map((value) => [value.key, value]));
	const physicalCounts = new Map<string, number>();
	for (const value of inventory.tombstones) {
		const key = cleanupPhysicalKey(value);
		physicalCounts.set(key, (physicalCounts.get(key) ?? 0) + 1);
	}
	const eligible: Readonly<VideoProxyCleanupTombstoneRecord>[] = [];
	for (const tombstone of expected) {
		const stored = storedByKey.get(tombstone.key);
		if (!stored || !sameCleanupTombstone(stored, tombstone)
			|| inventory.roots.has(tombstone.claim.bodyKey)
			|| claimsByBody.has(tombstone.claim.bodyKey)
			|| await request(stores.mediaAssets.get(tombstone.claim.bodyKey)) !== undefined
			|| (physicalCounts.get(cleanupPhysicalKey(tombstone)) ?? 0) !== 1
			|| await hasAnyCleanupPhysicalReference(stores.mediaAssets, tombstone)
			|| !await exactCleanupChunks(stores[MEDIA_ASSET_CHUNK_STORE_NAME], tombstone.claim, false, true)) {
			issues.push(issue('tombstone-reservation-conflict', tombstone.claim.bodyKey));
			continue;
		}
		eligible.push(stored);
	}
	return eligible;
}

async function readInventory(
	stores: Readonly<Record<string, IDBObjectStore>>,
	profile: EditorProjectRuntimeProfile,
	scope: NormalizedScope,
	maximum: number,
): Promise<Inventory> {
	try {
		const staging = stores[MEDIA_ASSET_STAGING_STORE_NAME];
		let remaining = maximum - scope.inputCount;
		if (remaining < 0) throw new CleanupInventoryError();
		const claimValues = await request(staging.index('kind').getAll(
			VIDEO_PROXY_CLAIM_KIND, remaining + 1,
		));
		remaining = remainingAfter(claimValues, remaining);
		const tombstoneValues = await request(staging.index('kind').getAll(
			VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND, remaining + 1,
		));
		remaining = remainingAfter(tombstoneValues, remaining);
		const projectValues = await request(stores.projects.getAll(undefined, remaining + 1));
		remaining = remainingAfter(projectValues, remaining);
		const revisionValues = await request(stores.revisions.getAll(undefined, remaining + 1));
		remainingAfter(revisionValues, remaining);
		const claims = claimValues.map(normalizeVideoProxyClaimRecord);
		const tombstones = tombstoneValues.map(normalizeVideoProxyCleanupTombstoneRecord);
		const durableProjects = projectValues.map((value) => cloneFramescaperProjectV18(profile, value));
		for (const value of revisionValues) durableProjects.push(revisionProject(profile, value));
		assertUniqueTombstones(tombstones);
		const roots = rootInventory(durableProjects, scope.projects);
		return {
			claims: Object.freeze(claims),
			tombstones: Object.freeze(tombstones),
			roots: roots.keys,
			committedAttachments: roots.committedAttachments,
		};
	} catch (error) {
		if (error instanceof CleanupInventoryError) throw error;
		throw new CleanupInventoryError(error);
	}
}

function rootInventory(
	durableProjects: readonly FramescaperProjectV18[],
	runtimeProjects: readonly FramescaperProjectV18[],
): { readonly keys: ReadonlySet<string>; readonly committedAttachments: ReadonlyMap<string, readonly AttachmentRoot[]> } {
	const keys = new Set<string>();
	const committedAttachments = new Map<string, AttachmentRoot[]>();
	for (const [projects, committed] of [[durableProjects, true], [runtimeProjects, false]] as const) {
		for (const project of projects) {
			for (const source of project.sources) {
				addStringRoot(keys, source.storageKey);
				if (source.kind !== 'video') continue;
				const originalTiming = source.timingAsset as Record<string, unknown> | null | undefined;
				addStringRoot(keys, originalTiming?.storageKey);
				if (source.proxyAttachment === null) continue;
				const root = {
					projectId: String(project.id),
					sourceId: String(source.id),
					attachment: source.proxyAttachment,
				};
				for (const bodyKey of [
					source.proxyAttachment.storageKey,
					source.proxyAttachment.timingAsset.storageKey,
				]) {
					keys.add(bodyKey);
				if (committed) appendCleanupMapValue(committedAttachments, bodyKey, root);
				}
			}
		}
	}
	return { keys, committedAttachments };
}

function normalizeScope(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
	maximum: number,
): NormalizedScope {
	const raw = cleanupClosedRecord(value, SCOPE_FIELDS, 'Framescaper V18 claim cleanup scope');
	const session = cleanupDenseArray(raw.sessionProjects, 'V18 cleanup session projects')
		.map((project) => cloneFramescaperProjectV18(profile, project));
	const pending = cleanupCollection(raw.pendingSaveSnapshots, 'V18 cleanup pending saves')
		.map((project) => cloneFramescaperProjectV18(profile, project));
	const histories = cleanupDenseArray(raw.histories, 'V18 cleanup histories')
		.map((history) => cloneFramescaperProjectHistoryV18(profile, history));
	const projects = [...session, ...pending];
	let inputCount = projects.length;
	for (const history of histories) {
		const snapshots = [
			history.present,
			...history.undoStack.map((entry) => entry.project),
			...history.redoStack.map((entry) => entry.project),
		];
		projects.push(...snapshots);
		inputCount += snapshots.length;
	}
	if (inputCount > maximum) throw new RangeError('The V18 claim cleanup runtime inventory limit was exceeded.');
	return { projects: Object.freeze(projects), inputCount };
}

function revisionProject(profile: EditorProjectRuntimeProfile, value: unknown): FramescaperProjectV18 {
	const raw = cleanupClosedRecord(value, ['key', 'projectId', 'revision', 'project'] as const, 'V18 revision record');
	const project = cloneFramescaperProjectV18(profile, raw.project);
	if (raw.projectId !== project.id || raw.revision !== project.revision
		|| raw.key !== `${String(project.id)}:${String(project.revision).padStart(12, '0')}`) {
		throw new TypeError('A V18 revision record must match its exact project snapshot.');
	}
	return project;
}

function claimMatchesAttachment(claim: Readonly<VideoProxyClaimRecord>, root: AttachmentRoot): boolean {
	if (claim.projectId !== root.projectId || claim.sourceId !== root.sourceId) return false;
	if (claim.bodyKind === 'proxy') {
		return claim.bodyKey === root.attachment.storageKey
			&& claim.rowIdentity.sha256 === root.attachment.sha256
			&& claim.rowIdentity.byteLength === root.attachment.byteLength
			&& claim.rowIdentity.mimeType === root.attachment.mimeType;
	}
	return claim.bodyKey === root.attachment.timingAsset.storageKey
		&& claim.rowIdentity.sha256 === root.attachment.timingAsset.sha256
		&& claim.rowIdentity.byteLength === root.attachment.timingAsset.byteLength
		&& claim.rowIdentity.encoding === root.attachment.timingAsset.encoding;
}

function committedClaimPair(
	claim: Readonly<VideoProxyClaimRecord>,
	root: AttachmentRoot,
	claims: readonly Readonly<VideoProxyClaimRecord>[],
): readonly Readonly<VideoProxyClaimRecord>[] | null {
	const pair = claims.filter((candidate) => candidate.operationId === claim.operationId
		&& candidate.projectId === claim.projectId && candidate.sourceId === claim.sourceId
		&& candidate.baseFingerprint === claim.baseFingerprint && candidate.status === 'verified'
		&& claimMatchesAttachment(candidate, root));
	return pair.length === 2 && pair.some((value) => value.bodyKind === 'proxy')
		&& pair.some((value) => value.bodyKind === 'timing') ? pair : null;
}

async function deletePhysical(opfs: OpfsRepository, tombstone: Readonly<VideoProxyCleanupTombstoneRecord>): Promise<void> {
	if (tombstone.claim.rowIdentity.storage !== 'opfs') return;
	const directory = await opfs.directory();
	if (!directory) throw new Error('OPFS cleanup is unavailable.');
	const path = tombstone.path;
	if (!path) throw new Error('The OPFS cleanup tombstone path is missing.');
	try {
		await directory.removeEntry(path);
	} catch (error) {
		if (!isCleanupNotFound(error)) throw error;
	}
}

async function retainCleanupFailure(
	database: IDBDatabase,
	expected: Readonly<VideoProxyCleanupTombstoneRecord>,
	now: number,
): Promise<void> {
	await transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', async ({ mediaAssetStaging }) => {
		const stored = await request(mediaAssetStaging.get(expected.key));
		if (!sameCleanupTombstone(stored, expected)) return;
		await request(mediaAssetStaging.put(failVideoProxyCleanupTombstone(expected, now)));
	});
}

function result(
	promotedClaimKeys: readonly string[],
	cleanedBodyKeys: readonly string[],
	issues: readonly FramescaperProjectV18ClaimCleanupIssue[],
): Readonly<FramescaperProjectV18ClaimCleanupResult> {
	const normalizedIssues = [...new Map(issues.map((value) => [`${value.code}:${String(value.bodyKey)}`, value])).values()];
	return Object.freeze({
		status: normalizedIssues.length === 0 ? 'settled' : 'indeterminate',
		promotedClaimKeys: Object.freeze([...promotedClaimKeys].sort()),
		cleanedBodyKeys: Object.freeze([...new Set(cleanedBodyKeys)].sort()),
		issues: Object.freeze(normalizedIssues),
	});
}

function issue(code: FramescaperProjectV18ClaimCleanupIssueCode, bodyKey: string | null): FramescaperProjectV18ClaimCleanupIssue {
	return Object.freeze({ code, bodyKey });
}

function assertUniqueTombstones(values: readonly Readonly<VideoProxyCleanupTombstoneRecord>[]): void {
	const bodyKeys = new Set<string>();
	const physical = new Set<string>();
	for (const value of values) {
		if (bodyKeys.has(value.claim.bodyKey) || physical.has(cleanupPhysicalKey(value))) throw new CleanupInventoryError();
		bodyKeys.add(value.claim.bodyKey);
		physical.add(cleanupPhysicalKey(value));
	}
}

function addStringRoot(target: Set<string>, value: unknown): void {
	if (typeof value === 'string' && value.length > 0) target.add(value);
}

function remainingAfter(values: readonly unknown[], remaining: number): number {
	if (values.length > remaining) throw new CleanupInventoryError();
	return remaining - values.length;
}
