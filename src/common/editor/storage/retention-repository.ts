/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectProjectStorageKeys,
	compactProjectSourceMetadata,
} from '../retention.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
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
import type { SourceRecordRepository } from './source-record-repository.ts';
import type { SourceRepository } from './source-repository.ts';
import type { TransientAnalysisCacheRepository } from './transient-analysis-cache-repository.ts';

const WAVEFORM_PEAK_CACHE_PREFIXES = Object.freeze(['audio-editor-peaks-v1:', 'audio-editor-peaks-v2:']);

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
	readonly sourceRecords: SourceRecordRepository;
	readonly sources: SourceRepository;
	readonly media: MediaRepository;
	readonly opfs: OpfsRepository;
	readonly rawPcmSpools: Pick<RawPcmSpoolRepository, 'listAll'>;
	readonly encodedCaptureSpools: Pick<EncodedCaptureSpoolRepository, 'retainedMediaChunkTokens'>;
	readonly encodedCaptureChunks: Pick<OpfsPreferredEncodedCaptureChunkPort, 'retainedPaths'>;
	readonly transientAnalysisCache: Pick<TransientAnalysisCacheRepository, 'purge'>;
}

/** Cross-domain reachability, temporary cleanup, and whole-store clearing. */
export class RetentionRepository {
	readonly #options: RetentionRepositoryOptions;
	#prunePromise: Promise<unknown> = Promise.resolve();

	constructor(options: RetentionRepositoryOptions) {
		this.#options = options;
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
		for (const spool of await this.#options.rawPcmSpools.listAll()) tokens.add(spool.spoolToken);
		const encodedCaptureTokens = await this.#options.encodedCaptureSpools.retainedMediaChunkTokens();
		for (const token of encodedCaptureTokens) tokens.add(token);
		const mediaAssets = await this.#options.media.assetRecords();
		const binaryRecords = [
			...mediaAssets,
			...await this.#options.media.allDerivativeRecords(),
		];
		const paths = new Set([
			...sources.map((source) => source.path),
			...binaryRecords.map((record) => record.path),
		].filter(isString));
		for (const path of activeStaging.paths) paths.add(path);
		for (const path of await this.#options.encodedCaptureChunks.retainedPaths(encodedCaptureTokens)) {
			paths.add(path);
		}
		await this.#options.sourceRecords.cleanupStaleChunks(tokens, cutoff);
		await this.#options.media.cleanupStaleAssetChunks(
			mediaAssets,
			cutoff,
			new Set([...activeStaging.mediaChunkTokens, ...encodedCaptureTokens]),
		);
		await this.#options.opfs.cleanupOrphans(paths, cutoff);
	}

	clear(): Promise<void> {
		return this.beginClear().completion;
	}

	beginClear(): LocalStoreClearOperation {
		return this.admitClear().begin();
	}

	admitClear(): LocalStoreClearAdmission {
		const maintenance = this.#options.media.beginAssetMaintenance();
		let databasePromise: Promise<IDBDatabase | null>;
		try { databasePromise = this.#options.port.database(); }
		catch (error) { databasePromise = Promise.reject(error); }
		void databasePromise.catch(() => undefined);
		let pending = true;
		return Object.freeze({
			begin: () => {
				if (!pending) throw new Error('The retention clear admission is no longer current.');
				pending = false;
				return this.#beginClear(maintenance, databasePromise);
			},
			cancel: () => {
				if (!pending) return;
				pending = false;
				maintenance.release();
			},
		});
	}

	#beginClear(
		maintenance: ReturnType<MediaRepository['beginAssetMaintenance']>,
		databasePromise: Promise<IDBDatabase | null>,
	): LocalStoreClearOperation {
		let committed = false;
		let resolveLocalCommit!: (value: boolean) => void;
		const localCommit = new Promise<boolean>((resolve) => { resolveLocalCommit = resolve; });
		const completion = this.#clear(maintenance, databasePromise, () => {
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
		databasePromise: Promise<IDBDatabase | null>,
		onLocalCommit: () => void,
	): Promise<void> {
		try {
			await maintenance.abortActive();
			await this.#options.sources.stopBackgroundWork();
			const opfsRecords: StorageRecord[] = [];
			const stagedPaths = new Set<string>();
			const database = await databasePromise;
			if (!database) {
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
				], 'readwrite', async (stores) => {
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
		}
	}

	async #runPrune({
		protectedProjects = [],
		protectedSourceIds = [],
		minimumAgeMs = 60_000,
		now = Date.now(),
	}: PruneOptions): Promise<PruneResult> {
		await this.#options.sources.stopBackgroundWork();
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

		if (!database) {
			this.#collectMemoryRoots(protectedIds);
			const storedSources = [...this.#options.port.memory.sources.values()].map(asStorageRecord).filter(isRecord);
			protectSourceDependencies(protectedIds, storedSources);
			const candidates = sourceStorageCandidates(
				storedSources,
				[...this.#options.port.memory.mediaAssets.values()].map(asStorageRecord).filter(isRecord),
				[...this.#options.port.memory.videoDerivatives.values()].map(asStorageRecord).filter(isRecord),
			);
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
			const result = await this.#deleteIndexedDbCandidates(database, {
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
			// Reproducible analyses are availability-only. A failed bounded purge
			// remains retryable and cannot change authoritative reachability truth.
			await this.#options.transientAnalysisCache.purge().catch(() => undefined);
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
		for (const prefix of WAVEFORM_PEAK_CACHE_PREFIXES) memory.analysis.delete(`${prefix}${sourceId}`);
		for (const [key, value] of memory.sourceChunks) {
			const chunk = asRecord(value);
			if (source?.sourceToken && chunk?.sourceToken === source.sourceToken) memory.sourceChunks.delete(key);
		}
	}

	async #deleteIndexedDbCandidates(
		database: IDBDatabase,
		state: {
			readonly protectedIds: Set<string>;
			readonly maximumAge: number;
			readonly currentTime: number;
			readonly deferredSourceIds: string[];
			readonly getNextEligibleAt: () => number | null;
			readonly setNextEligibleAt: (value: number) => void;
		},
	): Promise<{ removedSources: StorageRecord[]; removedBinaryRecords: StorageRecord[]; removedSourceIds: string[] }> {
		return transact(database, [
			'projects', 'revisions', 'analysis', 'sources', 'sourceChunks', 'mediaAssets',
			VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME,
		], 'readwrite', async (stores) => {
			const {
				projects, revisions, analysis, sources, sourceChunks, mediaAssets,
			} = stores;
			const videoDerivatives = stores[VIDEO_DERIVATIVE_STORE_NAME];
			const derivativeCacheEntries = stores[DERIVATIVE_CACHE_ENTRY_STORE_NAME];
			const projectUpdates: unknown[] = [];
			const revisionUpdates: Record<string, unknown>[] = [];
			for (const saved of await request(projects.getAll())) {
				const compacted = compactProjectSourceMetadata(saved);
				if (compacted !== saved) projectUpdates.push(compacted);
				collectProjectStorageKeys(compacted, state.protectedIds);
			}
			for (const value of await request(revisions.getAll())) {
				const record = asRecord(value);
				if (!record) continue;
				const compacted = compactProjectSourceMetadata(record.project);
				if (compacted !== record.project) revisionUpdates.push({ ...record, project: compacted });
				collectProjectStorageKeys(compacted, state.protectedIds);
			}
			const storedSources = (await request(sources.getAll())) as StorageRecord[];
			const storedMediaAssets = (await request(mediaAssets.getAll())) as StorageRecord[];
			const storedVideoDerivatives = (await request(derivativeCacheEntries.getAll())) as StorageRecord[];
			protectSourceDependencies(state.protectedIds, storedSources);
			const candidates = sourceStorageCandidates(storedSources, storedMediaAssets, storedVideoDerivatives);
			const removedSources: StorageRecord[] = [];
			const removedBinaryRecords: StorageRecord[] = [];
			const removedSourceIds: string[] = [];
			for (const [sourceId, candidate] of candidates) {
				if (state.protectedIds.has(sourceId)) continue;
				const eligibleAt = candidateEligibleAt(candidate, state.maximumAge);
				if (eligibleAt > state.currentTime) {
					state.deferredSourceIds.push(sourceId);
					const next = state.getNextEligibleAt();
					state.setNextEligibleAt(next === null ? eligibleAt : Math.min(next, eligibleAt));
					continue;
				}
				removedSourceIds.push(sourceId);
				if (candidate.source) {
					removedSources.push(candidate.source);
					sources.delete(sourceId);
					if (candidate.source.sourceToken) {
						await deleteByIndex(sourceChunks.index('sourceToken'), candidate.source.sourceToken);
					}
				}
				if (candidate.mediaAsset) {
					removedBinaryRecords.push(candidate.mediaAsset);
					mediaAssets.delete(sourceId);
				}
				for (const derivative of candidate.derivatives) {
					removedBinaryRecords.push(derivative);
					const key = derivative.key as string;
					videoDerivatives.delete(key);
					derivativeCacheEntries.delete(key);
				}
				for (const prefix of WAVEFORM_PEAK_CACHE_PREFIXES) analysis.delete(`${prefix}${sourceId}`);
			}
			for (const project of projectUpdates) projects.put(project);
			for (const revision of revisionUpdates) revisions.put(revision);
			return { removedSources, removedBinaryRecords, removedSourceIds };
		});
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
