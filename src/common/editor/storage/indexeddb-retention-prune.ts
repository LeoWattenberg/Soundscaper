/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectStorageKeys, compactProjectSourceMetadata } from '../retention.js';
import { DERIVATIVE_CACHE_ENTRY_STORE_NAME, VIDEO_DERIVATIVE_STORE_NAME } from './derivative-cache-entry.ts';
import { deleteByIndex, readCursorPage, request, transact } from './indexeddb-backend.ts';
import { candidateEligibleAt, protectSourceDependencies, sourceStorageCandidates, type StorageRecord } from './media-records.ts';
import { CATALOG_ORIGINAL_PAGE_SIZE, CATALOG_ORIGINAL_ROOT_STORE_NAME } from './media-catalog-original-schema.ts';
import { catalogOriginalCount, hasCatalogOriginalRoot } from './media-catalog-original-records.ts';
import type { RetentionSessionGuard } from './retention-session-guard.ts';
import { SOURCE_ANALYSIS_CACHE_PREFIXES } from '../source-analysis-cache.ts';

/** Legacy timeline roots remain unchanged; catalog originals never enter its candidate inventory. */
export async function deleteIndexedDbRetentionCandidates(
	database: IDBDatabase,
	sessionGuard: RetentionSessionGuard | undefined,
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
		'projects', 'revisions', 'settings', 'analysis', 'sources', 'sourceChunks', 'mediaAssets',
		VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME, CATALOG_ORIGINAL_ROOT_STORE_NAME,
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
		const storedMediaAssets = await unretainedMediaAssets(mediaAssets, stores[CATALOG_ORIGINAL_ROOT_STORE_NAME]);
		const storedVideoDerivatives = (await request(derivativeCacheEntries.getAll())) as StorageRecord[];
		protectSourceDependencies(state.protectedIds, storedSources);
		const candidates = sourceStorageCandidates(storedSources, storedMediaAssets, storedVideoDerivatives);
		if (await sessionGuard?.hasOtherOrLostSession(stores.settings)) {
			for (const sourceId of candidates.keys()) state.protectedIds.add(sourceId);
		}
		const removedSources: StorageRecord[] = [];
		const removedBinaryRecords: StorageRecord[] = [];
		const removedSourceIds: string[] = [];
		for (const [sourceId, candidate] of candidates) {
			if (state.protectedIds.has(sourceId) || await hasCatalogOriginalRoot(stores[CATALOG_ORIGINAL_ROOT_STORE_NAME], sourceId)) continue;
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
			for (const prefix of SOURCE_ANALYSIS_CACHE_PREFIXES) analysis.delete(`${prefix}${sourceId}`);
		}
		for (const project of projectUpdates) projects.put(project);
		for (const revision of revisionUpdates) revisions.put(revision);
		return { removedSources, removedBinaryRecords, removedSourceIds };
	});
}

async function unretainedMediaAssets(mediaAssets: IDBObjectStore, roots: IDBObjectStore): Promise<StorageRecord[]> {
	const unretained: StorageRecord[] = [];
	let afterPrimaryKey: IDBValidKey | undefined;
	while (true) {
		const page = await readCursorPage(mediaAssets, {
			afterPrimaryKey, limit: CATALOG_ORIGINAL_PAGE_SIZE,
			project: (value, key) => {
				const record = value as StorageRecord;
				return { key, record: catalogOriginalCount(record) > 0 ? null : record };
			},
		});
		if (!page.length) return unretained;
		afterPrimaryKey = page.at(-1)?.key;
		for (const { record } of page) {
			if (record?.sourceId && !await hasCatalogOriginalRoot(roots, record.sourceId)) unretained.push(record);
		}
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}
