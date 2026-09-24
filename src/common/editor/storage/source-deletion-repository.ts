/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectStorageKeys } from '../retention.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import { sameStoredSourceIdentity, type StorageRecord } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import type { RetentionSessionGuard } from './retention-session-guard.ts';
import {
	findMemoryDependentSourceId,
	findStoredDependentSourceId,
} from './source-dependency-query.ts';
import { deletePairedVideoDerivativeRecords } from './video-derivative-repository.ts';

const SOURCE_ANALYSIS_CACHE_PREFIXES = Object.freeze([
	'audio-editor-peaks-v1:',
	'audio-editor-peaks-v2:',
	'audio-editor-frequency-waveform-v1:',
]);

export type SourceStorageDeletionResult =
	| { readonly status: 'retained'; readonly dependentSourceId: string }
	| {
		readonly status: 'detached';
		readonly source: StorageRecord | null;
		readonly mediaAsset: StorageRecord | null;
		readonly derivatives: readonly StorageRecord[];
	};

/** Atomically detach one source generation and every by-id payload it currently owns. */
export class SourceDeletionRepository {
	readonly #port: StorageRepositoryPort;
	readonly #sessionGuard: RetentionSessionGuard | null;

	constructor(port: StorageRepositoryPort, sessionGuard: RetentionSessionGuard | null = null) {
		this.#port = port;
		this.#sessionGuard = sessionGuard;
	}

	async detachIfUnreferenced(sourceId: string): Promise<SourceStorageDeletionResult> {
		const database = await this.#port.database();
		if (!database) return this.#detachMemory(sourceId);
		await this.#sessionGuard?.reclaimStoppedSessions(database);
		return transact(database, [
			'projects',
			'revisions',
			'settings',
			'analysis',
			'sources',
			'sourceChunks',
			'mediaAssets',
			VIDEO_DERIVATIVE_STORE_NAME,
			DERIVATIVE_CACHE_ENTRY_STORE_NAME,
		], 'readwrite', async (stores) => {
			const [projects, revisions, otherSession] = await Promise.all([
				request(stores.projects.getAll()),
				request(stores.revisions.getAll()),
				this.#sessionGuard?.hasOtherOrLostSession(stores.settings) ?? false,
			]);
			if (otherSession) throw new Error(`Source ${sourceId} is retained by another open editor session.`);
			assertNotDurablyReferenced(sourceId, projects, revisions);
			const sources = stores.sources;
			const source = asStorageRecord(await request(sources.get(sourceId)));
			if (source) {
				const dependentSourceId = await findStoredDependentSourceId(sources, sourceId);
				if (dependentSourceId !== null) return { status: 'retained', dependentSourceId };
			}
			const [mediaAssetValue, ...waveformValues] = await Promise.all([
				request(stores.mediaAssets.get(sourceId)),
				...SOURCE_ANALYSIS_CACHE_PREFIXES.map((prefix) => (
					request(stores.analysis.get(`${prefix}${sourceId}`))
				)),
			]);
			const mediaAsset = asStorageRecord(mediaAssetValue);
			const derivatives = await deletePairedVideoDerivativeRecords(stores, sourceId);
			if (source) {
				sources.delete(sourceId);
				if (source.sourceToken) {
					await deleteByIndex(stores.sourceChunks.index('sourceToken'), source.sourceToken);
				}
			}
			if (mediaAsset) stores.mediaAssets.delete(sourceId);
			for (const [index, value] of waveformValues.entries()) {
				if (value !== undefined) {
					stores.analysis.delete(`${SOURCE_ANALYSIS_CACHE_PREFIXES[index]}${sourceId}`);
				}
			}
			return {
				status: 'detached',
				source: clone(source),
				mediaAsset: clone(mediaAsset),
				derivatives: Object.freeze(derivatives.map(clone)),
			};
		});
	}

	/** Detach only the named generation, with the same retention checks as public deletion. */
	async discardCurrentIfUnreferenced(expected: StorageRecord): Promise<boolean> {
		if (!expected.id) return false;
		const sourceId = expected.id;
		const database = await this.#port.database();
		if (!database) {
			const memory = this.#port.memory;
			if (!sameStoredSourceIdentity(asStorageRecord(memory.sources.get(sourceId)), expected)) return false;
			if (this.#sessionGuard?.hasOtherMemorySession()) {
				throw new Error(`Source ${sourceId} is retained by another open editor session.`);
			}
			assertNotDurablyReferenced(sourceId, [...memory.projects.values()], [...memory.revisions.values()]);
			const dependentSourceId = findMemoryDependentSourceId(memory.sources, sourceId);
			if (dependentSourceId !== null) {
				throw new Error(`Source ${sourceId} is retained by derived source ${dependentSourceId}.`);
			}
			memory.sources.delete(sourceId);
			return true;
		}
		await this.#sessionGuard?.reclaimStoppedSessions(database);
		return transact(database, ['projects', 'revisions', 'settings', 'sources'], 'readwrite', async (stores) => {
			const sources = stores.sources;
			const current = asStorageRecord(await request(sources.get(sourceId)));
			if (!sameStoredSourceIdentity(current, expected)) return false;
			const [projects, revisions, otherSession] = await Promise.all([
				request(stores.projects.getAll()),
				request(stores.revisions.getAll()),
				this.#sessionGuard?.hasOtherOrLostSession(stores.settings) ?? false,
			]);
			if (otherSession) throw new Error(`Source ${sourceId} is retained by another open editor session.`);
			assertNotDurablyReferenced(sourceId, projects, revisions);
			const dependentSourceId = await findStoredDependentSourceId(sources, sourceId);
			if (dependentSourceId !== null) {
				throw new Error(`Source ${sourceId} is retained by derived source ${dependentSourceId}.`);
			}
			sources.delete(sourceId);
			return true;
		});
	}

	#detachMemory(sourceId: string): SourceStorageDeletionResult {
		const memory = this.#port.memory;
		if (this.#sessionGuard?.hasOtherMemorySession()) {
			throw new Error(`Source ${sourceId} is retained by another open editor session.`);
		}
		assertNotDurablyReferenced(sourceId, [...memory.projects.values()], [...memory.revisions.values()]);
		const source = asStorageRecord(memory.sources.get(sourceId));
		if (source) {
			const dependentSourceId = findMemoryDependentSourceId(memory.sources, sourceId);
			if (dependentSourceId !== null) {
				return { status: 'retained', dependentSourceId };
			}
		}
		const mediaAsset = asStorageRecord(memory.mediaAssets.get(sourceId));
		const derivatives = [...memory.videoDerivatives.values()]
			.map(asStorageRecord)
			.filter((candidate): candidate is StorageRecord => candidate?.sourceId === sourceId);
		if (source) {
			memory.sources.delete(sourceId);
			for (const [key, value] of memory.sourceChunks) {
				if (source.sourceToken && asStorageRecord(value)?.sourceToken === source.sourceToken) {
					memory.sourceChunks.delete(key);
				}
			}
		}
		if (mediaAsset) memory.mediaAssets.delete(sourceId);
		for (const prefix of SOURCE_ANALYSIS_CACHE_PREFIXES) {
			memory.analysis.delete(`${prefix}${sourceId}`);
		}
		for (const derivative of derivatives) {
			if (typeof derivative.key === 'string') memory.videoDerivatives.delete(derivative.key);
		}
		return {
			status: 'detached',
			source: clone(source),
			mediaAsset: clone(mediaAsset),
			derivatives: Object.freeze(derivatives.map(clone)),
		};
	}
}

function assertNotDurablyReferenced(sourceId: string, projects: unknown[], revisions: unknown[]): void {
	const retained = new Set<string>();
	for (const project of projects) collectProjectStorageKeys(project, retained);
	for (const revision of revisions) collectProjectStorageKeys(asStorageRecord(revision)?.project, retained);
	if (retained.has(sourceId)) throw new Error(`Source ${sourceId} is retained by a saved project or revision.`);
}

function asStorageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
