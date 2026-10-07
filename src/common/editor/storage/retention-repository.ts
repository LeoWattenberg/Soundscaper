/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectProjectStorageKeys,
	compactProjectSourceMetadata,
} from '../retention.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import { request, transact } from './indexeddb-backend.ts';
import {
	MEDIA_ASSET_CHUNK_STORE_NAME,
} from './media-asset-chunk-schema.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import { LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME } from './linked-original-provisional-root-schema.ts';
import { LINKED_VIDEO_ORIGINAL_STORE_NAME } from './linked-video-original-schema.ts';
import type {
	LocalStoreClearAdmission,
	LocalStoreClearOperation,
} from './linked-video-original-lifecycle-coordinator.ts';
import {
	candidateEligibleAt,
	isOpfsPcmStorage,
	protectSourceDependencies,
	sourceStorageCandidates,
	type StorageRecord,
} from './media-records.ts';
import type { MediaRepository } from './media-repository.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { RawPcmSpoolRepository } from './raw-pcm-spool-repository.ts';
import type { EncodedCaptureSpoolRepository } from './encoded-capture-spool-repository.ts';
import type { OpfsPreferredEncodedCaptureChunkPort } from './opfs-preferred-encoded-capture-chunk-port.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import type { RetentionSessionGuard } from './retention-session-guard.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';
import type { SourceRepository } from './source-repository.ts';
import type { SourceWriteMaintenance } from './source-write-lifecycle.ts';
import type { TransientAnalysisCacheRepository } from './transient-analysis-cache-repository.ts';
import type { AssistanceDerivativeRepositoryPort } from './deferred-assistance-derivative-repository.ts';
import { SOURCE_ANALYSIS_CACHE_PREFIXES } from '../source-analysis-cache.ts';

import { deleteIndexedDbRetentionCandidates } from './indexeddb-retention-prune.ts';
import { CATALOG_ORIGINAL_ROOT_STORE_NAME } from './media-catalog-original-schema.ts';
import { assertNoCatalogOriginalRoot } from './media-catalog-original-records.ts';

interface PruneOptions {
	readonly protectedProjects?: readonly unknown[];
	readonly protectedSourceIds?: readonly string[];
	readonly minimumAgeMs?: number;
	readonly now?: number;
}

export interface PruneResult {
	readonly deletedSourceIds: string[];
	readonly deferredSourceIds: string[];
	readonly retainedSourceIds: string[];
	readonly nextEligibleAt: number | null;
}

export interface RetentionRepositoryOptions {
	readonly port: StorageRepositoryPort;
	readonly sessionGuard?: RetentionSessionGuard;
	readonly sourceRecords: SourceRecordRepository;
	readonly sources: SourceRepository;
	readonly media: MediaRepository;
	readonly opfs: OpfsRepository;
	readonly rawPcmSpools: Pick<RawPcmSpoolRepository, 'listAll'>;
	readonly encodedCaptureSpools: Pick<EncodedCaptureSpoolRepository, 'retainedMediaChunkTokens'> | null;
	readonly encodedCaptureChunks: Pick<OpfsPreferredEncodedCaptureChunkPort, 'retainedPaths'> | null;
	readonly transientAnalysisCache: Pick<TransientAnalysisCacheRepository, 'purge'>;
	readonly assistanceDerivatives?: Pick<AssistanceDerivativeRepositoryPort, 'purge'>;
}

/** Cross-domain reachability, temporary cleanup, and whole-store clearing. */
export class RetentionRepository {
	readonly #options: RetentionRepositoryOptions;
	#prunePromise: Promise<unknown> = Promise.resolve();

	constructor(options: RetentionRepositoryOptions) {
		this.#options = options;
	}

	async ensureSession(): Promise<void> {
		await this.#options.port.database();
		void import('./temporary-export-recovery.ts').then(m => m.startTemporaryExportRecovery()).catch(() => undefined);
	}

	async releaseSession(database: IDBDatabase | null): Promise<void> {
		await this.#options.sessionGuard?.release(database);
	}

	async withSoleSession<Value>(
		operation: () => PromiseLike<Value> | Value,
	): Promise<Readonly<{ admitted: false } | { admitted: true; value: Value }>> {
		const guard = this.#options.sessionGuard;
		if (!guard) return { admitted: true, value: await operation() };
		const database = await this.#options.port.database();
		return guard.withSoleSession(database, operation);
	}

	prune(options: PruneOptions = {}): Promise<PruneResult> {
		const operation = this.#prunePromise.then(() => this.#runPrune(options));
		this.#prunePromise = operation.catch(() => undefined);
		return operation;
	}

	async cleanupTemporaryAssets({ maximumAgeMs = 24 * 60 * 60 * 1000 } = {}): Promise<void> {
		const cutoff = Date.now() - maximumAgeMs;
		const activeStaging = await this.#options.media.activeAssetStaging();
		const sources = await this.#options.sources.list();
		const tokens = new Set(sources.map((source) => source.sourceToken).filter(isString));
		for (const token of activeStaging.mediaChunkTokens) tokens.add(token);
		for (const spool of await this.#options.rawPcmSpools.listAll()) tokens.add(spool.spoolToken);
		const encodedCaptureTokens = this.#options.encodedCaptureSpools
			? await this.#options.encodedCaptureSpools.retainedMediaChunkTokens() : new Set<string>();
		for (const token of encodedCaptureTokens) tokens.add(token);
		const paths = new Set(sources.map((source) => source.path).filter(isString));
		for (const path of activeStaging.paths) paths.add(path);
		for (const path of this.#options.encodedCaptureChunks
			? await this.#options.encodedCaptureChunks.retainedPaths(encodedCaptureTokens) : []) {
			paths.add(path);
		}
		await this.#options.sourceRecords.cleanupStaleChunks(tokens, cutoff);
		await this.#options.media.cleanupStaleAssetChunks(
			[],
			cutoff,
			new Set([...activeStaging.mediaChunkTokens, ...encodedCaptureTokens]),
		);
		await this.#options.opfs.cleanupOrphans(paths, cutoff, (path) => this.#options.media.hasBinaryPathReference(path));
	}

	clear(): Promise<void> {
		return this.beginClear().completion;
	}

	beginClear(): LocalStoreClearOperation {
		return this.admitClear().begin();
	}

	admitClear(): LocalStoreClearAdmission {
		const maintenance = this.#options.media.beginAssetMaintenance();
		let sourceWriteMaintenance: SourceWriteMaintenance;
		try { sourceWriteMaintenance = this.#options.sources.beginWriteMaintenance(); }
		catch (error) {
			maintenance.release();
			throw error;
		}
		let databasePromise: Promise<IDBDatabase | null>;
		try { databasePromise = this.#options.port.database(); }
		catch (error) { databasePromise = Promise.reject(error); }
		void databasePromise.catch(() => undefined);
		let pending = true;
		return Object.freeze({
			begin: () => {
				if (!pending) throw new Error('The retention clear admission is no longer current.');
				pending = false;
				return this.#beginClear(maintenance, sourceWriteMaintenance, databasePromise);
			},
			cancel: () => {
				if (!pending) return;
				pending = false;
				maintenance.release();
				sourceWriteMaintenance.release();
			},
		});
	}

	#beginClear(
		maintenance: ReturnType<MediaRepository['beginAssetMaintenance']>,
		sourceWriteMaintenance: SourceWriteMaintenance,
		databasePromise: Promise<IDBDatabase | null>,
	): LocalStoreClearOperation {
		let committed = false;
		let resolveLocalCommit!: (value: boolean) => void;
		const localCommit = new Promise<boolean>((resolve) => { resolveLocalCommit = resolve; });
		const completion = this.#clear(maintenance, sourceWriteMaintenance, databasePromise, () => {
			committed = true;
			resolveLocalCommit(true);
		});
		void completion.then(
			() => { if (!committed) resolveLocalCommit(false); },
			() => { if (!committed) resolveLocalCommit(false); },
		);
		return Object.freeze({ localCommit, completion });
	}

	async #clear(
		maintenance: ReturnType<MediaRepository['beginAssetMaintenance']>,
		sourceWriteMaintenance: SourceWriteMaintenance,
		databasePromise: Promise<IDBDatabase | null>,
		onLocalCommit: () => void,
	): Promise<void> {
		try {
			await abortStoreWriters(maintenance, sourceWriteMaintenance);
			await this.#options.sources.stopBackgroundWork();
			const opfsRecords: StorageRecord[] = [];
			const stagedPaths = new Set<string>();
			const database = await databasePromise;
			if (!database) {
				if (this.#options.sessionGuard?.hasOtherMemorySession()) {
					throw new Error('Another editor session still owns local source history.');
				}
				const invalidated = this.#options.media.invalidateAssetStagingMemory();
				for (const path of invalidated.paths) stagedPaths.add(path);
				opfsRecords.push(
					...[...this.#options.port.memory.sources.values()].map(asStorageRecord).filter(isOpfsSource),
					...[...this.#options.port.memory.mediaAssets.values()].map(asStorageRecord).filter(isOpfsRecord),
					...[...this.#options.port.memory.videoDerivatives.values()].map(asStorageRecord).filter(isOpfsRecord),
				);
				for (const value of Object.values(this.#options.port.memory)) {
					if (value !== this.#options.port.memory.mediaAssetStaging) value.clear();
				}
			} else {
				await this.#options.sessionGuard?.reclaimStoppedSessions(database);
				await transact(database, [
					'projects',
					'revisions',
					'settings',
					'analysis',
					'sources',
					'sourceChunks',
					'mediaAssets',
					MEDIA_ASSET_CHUNK_STORE_NAME,
					MEDIA_ASSET_STAGING_STORE_NAME,
					VIDEO_DERIVATIVE_STORE_NAME,
					DERIVATIVE_CACHE_ENTRY_STORE_NAME,
					LINKED_VIDEO_ORIGINAL_STORE_NAME,
					LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
					CATALOG_ORIGINAL_ROOT_STORE_NAME,
				], 'readwrite', async (stores) => {
					await assertNoCatalogOriginalRoot(stores[CATALOG_ORIGINAL_ROOT_STORE_NAME]);
					const retainedSessions = this.#options.sessionGuard
						? await this.#options.sessionGuard.retainedSessionRecords(stores.settings) : [];
					if (retainedSessions.length > 1) {
						throw new Error('Another editor session still owns local source history.');
					}
					const storedSourcesRequest = request(stores.sources.getAll()) as Promise<StorageRecord[]>;
					const storedMediaAssetsRequest = request(stores.mediaAssets.getAll()) as Promise<StorageRecord[]>;
					const storedDerivativeEntriesRequest = request(
						stores[DERIVATIVE_CACHE_ENTRY_STORE_NAME].getAll(),
					) as Promise<StorageRecord[]>;
					opfsRecords.push(...await storedSourcesRequest);
					opfsRecords.push(...await storedMediaAssetsRequest);
					opfsRecords.push(...await storedDerivativeEntriesRequest);
					const invalidated = await this.#options.media.invalidateAssetStagingStore(
						stores[MEDIA_ASSET_STAGING_STORE_NAME],
					);
					for (const path of invalidated.paths) stagedPaths.add(path);
					for (const [storeName, store] of Object.entries(stores)) {
						if (storeName !== MEDIA_ASSET_STAGING_STORE_NAME) store.clear();
					}
					for (const retainedSession of retainedSessions) stores.settings.put(retainedSession);
				});
			}
			onLocalCommit();
			for (const record of opfsRecords) {
				if (record.sourceToken) await this.#options.sources.deleteStored(record);
				else await this.#options.opfs.deleteBinaryRecords([record]);
			}
			for (const path of stagedPaths) await this.#options.opfs.deletePath(path);
		} finally {
			maintenance.release();
			sourceWriteMaintenance.release();
		}
	}

	async #runPrune({
		protectedProjects = [],
		protectedSourceIds = [],
		minimumAgeMs = 60_000,
		now = Date.now(),
	}: PruneOptions): Promise<PruneResult> {
		const protectedIds = new Set(protectedSourceIds || []);
		for (const project of protectedProjects || []) collectProjectStorageKeys(project, protectedIds);
		const maximumAge = Math.max(0, Number(minimumAgeMs) || 0);
		const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
		const deletedSources: StorageRecord[] = [];
		const deletedBinaryRecords: StorageRecord[] = [];
		const deletedSourceIds: string[] = [];
		const deferredSourceIds: string[] = [];
		let nextEligibleAt: number | null = null;
		const database = await this.#options.port.database();
		if (database) await this.#options.sessionGuard?.reclaimStoppedSessions(database);

		if (!database) {
			this.#collectMemoryRoots(protectedIds);
			const storedSources = [...this.#options.port.memory.sources.values()].map(asStorageRecord).filter(isRecord);
			protectSourceDependencies(protectedIds, storedSources);
			const candidates = sourceStorageCandidates(
				storedSources,
				[...this.#options.port.memory.mediaAssets.values()].map(asStorageRecord).filter(isRecord),
				[...this.#options.port.memory.videoDerivatives.values()].map(asStorageRecord).filter(isRecord),
			);
			if (this.#options.sessionGuard?.hasOtherMemorySession()) {
				for (const sourceId of candidates.keys()) protectedIds.add(sourceId);
			}
			for (const [sourceId, candidate] of candidates) {
				if (protectedIds.has(sourceId)) continue;
				const eligibleAt = candidateEligibleAt(candidate, maximumAge);
				if (eligibleAt > currentTime) {
					deferredSourceIds.push(sourceId);
					nextEligibleAt = nextEligibleAt === null ? eligibleAt : Math.min(nextEligibleAt, eligibleAt);
					continue;
				}
				deletedSourceIds.push(sourceId);
				if (candidate.source) deletedSources.push(candidate.source);
				if (candidate.mediaAsset) deletedBinaryRecords.push(candidate.mediaAsset);
				deletedBinaryRecords.push(...candidate.derivatives);
				this.#deleteMemoryCandidate(sourceId, candidate.source, candidate.derivatives);
			}
		} else {
			const result = await deleteIndexedDbRetentionCandidates(database, this.#options.sessionGuard, {
				protectedIds,
				maximumAge,
				currentTime,
				deferredSourceIds,
				getNextEligibleAt: () => nextEligibleAt,
				setNextEligibleAt: (value) => { nextEligibleAt = value; },
			});
			deletedSources.push(...result.removedSources);
			deletedBinaryRecords.push(...result.removedBinaryRecords);
			deletedSourceIds.push(...result.removedSourceIds);
		}
		if (deletedSourceIds.length > 0) {
			// Retire reads only for detached payloads; retained playback and analysis
			// sessions must survive saves that prune unrelated source history.
			await this.#options.sources.stopBackgroundWork({ sourceIds: new Set(deletedSourceIds) });
			// Reproducible analyses are availability-only. A failed bounded purge
			// remains retryable and cannot change authoritative reachability truth.
			await this.#options.transientAnalysisCache.purge().catch(() => undefined);
			await this.#options.assistanceDerivatives?.purge().catch(() => undefined);
		}

		for (const source of deletedSources) {
			if (isOpfsPcmStorage(source.storage)) await this.#options.sources.deleteStored(source);
		}
		const disposableBinaryRecords: StorageRecord[] = [];
		for (const record of deletedBinaryRecords) {
			const disposable = await this.#options.media.prepareDetachedPayloadDisposal(record);
			if (disposable) disposableBinaryRecords.push(disposable);
		}
		await this.#options.opfs.deleteBinaryRecords(disposableBinaryRecords);
		return { deletedSourceIds, deferredSourceIds, retainedSourceIds: [...protectedIds], nextEligibleAt };
	}

	#collectMemoryRoots(protectedIds: Set<string>): void {
		for (const [id, project] of this.#options.port.memory.projects) {
			const compacted = compactProjectSourceMetadata(project);
			if (compacted !== project) this.#options.port.memory.projects.set(id, compacted);
			collectProjectStorageKeys(compacted, protectedIds);
		}
		for (const [key, value] of this.#options.port.memory.revisions) {
			const record = asRecord(value);
			if (!record) continue;
			const compacted = compactProjectSourceMetadata(record.project);
			if (compacted !== record.project) this.#options.port.memory.revisions.set(key, { ...record, project: compacted });
			collectProjectStorageKeys(compacted, protectedIds);
		}
	}

	#deleteMemoryCandidate(
		sourceId: string,
		source: StorageRecord | null,
		derivatives: readonly StorageRecord[],
	): void {
		const memory = this.#options.port.memory;
		memory.sources.delete(sourceId);
		memory.mediaAssets.delete(sourceId);
		for (const derivative of derivatives) {
			if (typeof derivative.key === 'string') memory.videoDerivatives.delete(derivative.key);
		}
		for (const prefix of SOURCE_ANALYSIS_CACHE_PREFIXES) memory.analysis.delete(`${prefix}${sourceId}`);
		for (const [key, value] of memory.sourceChunks) {
			const chunk = asRecord(value);
			if (source?.sourceToken && chunk?.sourceToken === source.sourceToken) memory.sourceChunks.delete(key);
		}
	}


}

async function abortStoreWriters(
	mediaMaintenance: ReturnType<MediaRepository['beginAssetMaintenance']>,
	sourceWriteMaintenance: SourceWriteMaintenance,
): Promise<void> {
	const results = await Promise.allSettled([
		mediaMaintenance.abortActive(),
		sourceWriteMaintenance.abortActive(),
	]);
	const failures = results
		.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		throw new AggregateError(failures, 'Project storage writer cleanup failed.');
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asStorageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function isRecord(value: StorageRecord | null): value is StorageRecord {
	return value !== null;
}

function isOpfsSource(value: StorageRecord | null): value is StorageRecord {
	return Boolean(value && isOpfsPcmStorage(value.storage));
}

function isOpfsRecord(value: StorageRecord | null): value is StorageRecord {
	return Boolean(value?.storage === 'opfs');
}
function isString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
