/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectSourceIds, compactProjectSourceMetadata } from '../retention.js';
import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import {
	candidateEligibleAt,
	isOpfsPcmStorage,
	protectSourceDependencies,
	sourceStorageCandidates,
	type StorageRecord,
} from './media-records.ts';
import type { MediaRepository } from './media-repository.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';
import type { SourceRepository } from './source-repository.ts';

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
		const sources = await this.#options.sources.list();
		const tokens = new Set(sources.map((source) => source.sourceToken).filter(isString));
		const binaryRecords = [
			...await this.#options.media.assetRecords(),
			...await this.#options.media.allDerivativeRecords(),
		];
		const paths = new Set([
			...sources.map((source) => source.path),
			...binaryRecords.map((record) => record.path),
		].filter(isString));
		const cutoff = Date.now() - maximumAgeMs;
		await this.#options.sourceRecords.cleanupStaleChunks(tokens, cutoff);
		await this.#options.opfs.cleanupOrphans(paths, cutoff);
	}

	async clear(): Promise<void> {
		await this.#options.sources.stopBackgroundWork();
		const opfsRecords: StorageRecord[] = [];
		const database = await this.#options.port.database();
		if (!database) {
			opfsRecords.push(
				...[...this.#options.port.memory.sources.values()].map(asStorageRecord).filter(isOpfsSource),
				...[...this.#options.port.memory.mediaAssets.values()].map(asStorageRecord).filter(isOpfsRecord),
				...[...this.#options.port.memory.videoDerivatives.values()].map(asStorageRecord).filter(isOpfsRecord),
			);
			for (const value of Object.values(this.#options.port.memory)) value.clear();
		} else {
			opfsRecords.push(
				...await readAllRecords(database, 'sources'),
				...await readAllRecords(database, 'mediaAssets'),
				...await readAllRecords(database, 'videoDerivatives'),
			);
			await transact(database, [
				'projects',
				'revisions',
				'settings',
				'analysis',
				'sources',
				'sourceChunks',
				'mediaAssets',
				'videoDerivatives',
			], 'readwrite', (stores) => {
				for (const store of Object.values(stores)) store.clear();
			});
		}
		for (const record of opfsRecords) {
			if (record.sourceToken) await this.#options.sources.deleteStored(record);
			else await this.#options.opfs.deleteBinaryRecords([record]);
		}
	}

	async #runPrune({
		protectedProjects = [],
		protectedSourceIds = [],
		minimumAgeMs = 60_000,
		now = Date.now(),
	}: PruneOptions): Promise<PruneResult> {
		const migrationsToResume = this.#options.sources.pendingMigrationSourceIds();
		await this.#options.sources.stopBackgroundWork({ clearFailures: false });
		const protectedIds = new Set(protectedSourceIds || []);
		for (const project of protectedProjects || []) collectProjectSourceIds(project, protectedIds);
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

		for (const source of deletedSources) {
			if (isOpfsPcmStorage(source.storage)) await this.#options.sources.deleteStored(source);
		}
		await this.#options.opfs.deleteBinaryRecords(deletedBinaryRecords);
		const deletedSourceIdSet = new Set(deletedSourceIds);
		this.#options.sources.forgetMigrationFailures(deletedSourceIdSet);
		for (const sourceId of migrationsToResume) {
			if (deletedSourceIdSet.has(sourceId)) continue;
			const source = await this.#options.sources.getMetadata(sourceId);
			if (source) this.#options.sources.queueMigration(source);
		}
		return { deletedSourceIds, deferredSourceIds, retainedSourceIds: [...protectedIds], nextEligibleAt };
	}

	#collectMemoryRoots(protectedIds: Set<string>): void {
		for (const [id, project] of this.#options.port.memory.projects) {
			const compacted = compactProjectSourceMetadata(project);
			if (compacted !== project) this.#options.port.memory.projects.set(id, compacted);
			collectProjectSourceIds(compacted, protectedIds);
		}
		for (const [key, value] of this.#options.port.memory.revisions) {
			const record = asRecord(value);
			if (!record) continue;
			const compacted = compactProjectSourceMetadata(record.project);
			if (compacted !== record.project) this.#options.port.memory.revisions.set(key, { ...record, project: compacted });
			collectProjectSourceIds(compacted, protectedIds);
		}
	}

	#deleteMemoryCandidate(sourceId: string, source: StorageRecord | null, derivatives: readonly StorageRecord[]): void {
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
			'projects', 'revisions', 'analysis', 'sources', 'sourceChunks', 'mediaAssets', 'videoDerivatives',
		], 'readwrite', async ({ projects, revisions, analysis, sources, sourceChunks, mediaAssets, videoDerivatives }) => {
			for (const saved of await request(projects.getAll())) {
				const compacted = compactProjectSourceMetadata(saved);
				if (compacted !== saved) projects.put(compacted);
				collectProjectSourceIds(compacted, state.protectedIds);
			}
			for (const value of await request(revisions.getAll())) {
				const record = asRecord(value);
				if (!record) continue;
				const compacted = compactProjectSourceMetadata(record.project);
				if (compacted !== record.project) revisions.put({ ...record, project: compacted });
				collectProjectSourceIds(compacted, state.protectedIds);
			}
			const storedSources = (await request(sources.getAll())) as StorageRecord[];
			const storedMediaAssets = (await request(mediaAssets.getAll())) as StorageRecord[];
			const storedVideoDerivatives = (await request(videoDerivatives.getAll())) as StorageRecord[];
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
					videoDerivatives.delete(derivative.key as string);
				}
				for (const prefix of WAVEFORM_PEAK_CACHE_PREFIXES) analysis.delete(`${prefix}${sourceId}`);
			}
			return { removedSources, removedBinaryRecords, removedSourceIds };
		});
	}
}

async function readAllRecords(database: IDBDatabase, storeName: string): Promise<StorageRecord[]> {
	return transact(database, storeName, 'readonly', (stores) => request(stores[storeName].getAll())) as Promise<StorageRecord[]>;
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
