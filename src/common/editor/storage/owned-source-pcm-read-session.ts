/* SPDX-License-Identifier: AGPL-3.0-only */

import { PCM_CONTAINER_STORAGE_TYPE } from '../wavpack/index.js';
import {
	sameStoredSourceIdentity,
	type StorageRecord,
} from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { PcmRepository } from './pcm-repository.ts';
import {
	combineSourceReadAbortSignals,
	createSourcePcmReadSession,
} from './source-pcm-read-session.ts';
import type {
	SourcePcmChunk,
	SourcePcmReadSession,
	SourceReadOptions,
} from './source-read-repository.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';

export const OWNED_SOURCE_PCM_MAXIMUM_DEPENDENCY_COUNT = 4_094;

const SESSION_CLEANUP_REASON = new Error('Owned source PCM read sessions are being released.');

export interface OwnedSourcePcmReadSessionRepositoryOptions {
	readonly records: SourceRecordRepository;
	readonly pcm: PcmRepository;
	readonly opfs: OpfsRepository;
	/** Lower-only test seam. */
	readonly maximumDependencyCount?: number;
}

/** Exact-generation sessions over owned PCM and their linear copy-on-write ancestry. */
export class OwnedSourcePcmReadSessionRepository {
	readonly #options: OwnedSourcePcmReadSessionRepositoryOptions;
	readonly #maximumDependencyCount: number;
	readonly #openings = new Set<Readonly<{
		abort: AbortController;
		promise: Promise<SourcePcmReadSession | null>;
	}>>();
	readonly #sessions = new Set<SourcePcmReadSession>();

	constructor(options: OwnedSourcePcmReadSessionRepositoryOptions) {
		this.#options = options;
		this.#maximumDependencyCount = maximumDependencyCount(options.maximumDependencyCount);
	}

	openSession(
		sourceId: string,
		options: SourceReadOptions = {},
	): Promise<SourcePcmReadSession | null> {
		const abort = new AbortController();
		const signals = combineSourceReadAbortSignals(abort.signal, options.signal);
		const opening = Promise.resolve().then(async () => {
			const generation = await this.#captureGeneration(
				sourceId,
				options.expectedSource,
				signals.signal,
			);
			if (!generation) return null;
			throwIfAborted(signals.signal);
			const session = createSourcePcmReadSession({
				readChunk: (chunkIndex, signal) => this.#readChunk(generation, chunkIndex, signal),
				release: noOpRelease,
				onRelease: () => { this.#sessions.delete(session); },
			});
			this.#sessions.add(session);
			return session;
		}).finally(signals.dispose);
		const record = Object.freeze({ abort, promise: opening });
		this.#openings.add(record);
		void opening.then(
			() => { this.#openings.delete(record); },
			() => { this.#openings.delete(record); },
		);
		return opening;
	}

	async releaseSessions(): Promise<void> {
		const openings = [...this.#openings];
		for (const opening of openings) opening.abort.abort(SESSION_CLEANUP_REASON);
		const openingResults = await Promise.allSettled(openings.map(({ promise }) => promise));
		const releaseResults = await Promise.allSettled([...this.#sessions].map(
			(session) => Promise.resolve(session.release()),
		));
		const failures = [...openingResults, ...releaseResults]
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.filter(({ reason }) => reason !== SESSION_CLEANUP_REASON)
			.map(({ reason }) => reason as unknown);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Owned source PCM read-session cleanup failed.');
		}
	}

	async #captureGeneration(
		sourceId: string,
		expectedSource: StorageRecord | undefined,
		signal: AbortSignal,
	): Promise<readonly StorageRecord[] | null> {
		const rootId = nonEmptySourceId(sourceId);
		const sources: StorageRecord[] = [];
		const seen = new Set<string>();
		let currentId = rootId;
		while (true) {
			throwIfAborted(signal);
			if (seen.has(currentId)) {
				throw new Error('The immutable source dependency graph contains a cycle.');
			}
			if (sources.length >= this.#maximumDependencyCount) {
				throw new RangeError(
					`An owned PCM read session cannot exceed ${this.#maximumDependencyCount} source generations.`,
				);
			}
			seen.add(currentId);
			const source = await this.#options.records.getMetadata(currentId);
			throwIfAborted(signal);
			if (!source) {
				if (!sources.length) return null;
				throw new Error(`Copy-on-write source dependency ${currentId} is missing.`);
			}
			if (source.id !== currentId) {
				throw new Error('Owned source metadata does not match its requested identity.');
			}
			sources.push(source);
			if (sources.length === 1 && expectedSource
				&& !sameStoredSourceIdentity(source, expectedSource)) {
				throw generationChangedError();
			}
			if (source.storage !== 'copy-on-write') break;
			currentId = nonEmptyBaseSourceId(source.baseSourceId);
		}
		await this.#assertGenerationCurrent(sources, signal);
		return Object.freeze(sources);
	}

	async #readChunk(
		generation: readonly StorageRecord[],
		chunkIndex: number,
		signal?: AbortSignal,
	): Promise<SourcePcmChunk> {
		const root = generation[0];
		if (!root || chunkIndex >= nonNegativeInteger(root.chunkCount, 0)) {
			throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
		}
		await this.#assertGenerationCurrent(generation, signal);
		let chunk: SourcePcmChunk | null = null;
		for (const source of generation) {
			throwIfAborted(signal);
			if (source.storage === 'copy-on-write') {
				const replacement = await this.#options.records.chunk(
					nonEmptySourceToken(source.sourceToken),
					chunkIndex,
				);
				throwIfAborted(signal);
				if (!replacement) continue;
				chunk = await this.#options.pcm.decodeRecord(replacement, source, signal);
				break;
			}
			chunk = await this.#readPhysicalChunk(source, chunkIndex, signal);
			break;
		}
		if (!chunk) throw new Error(`Source storage chunk ${chunkIndex} is missing.`);
		throwIfAborted(signal);
		await this.#assertGenerationCurrent(generation, signal);
		return chunk;
	}

	async #readPhysicalChunk(
		source: StorageRecord,
		chunkIndex: number,
		signal?: AbortSignal,
	): Promise<SourcePcmChunk> {
		if (source.storage === PCM_CONTAINER_STORAGE_TYPE) {
			return this.#options.opfs.readPcmContainerChunk(
				source,
				chunkIndex,
				this.#options.pcm.decodeRecord.bind(this.#options.pcm),
				signal,
			);
		}
		if (source.storage === 'opfs') {
			return this.#options.opfs.readLegacyChunk(source, chunkIndex, signal);
		}
		const record = await this.#options.records.chunk(
			nonEmptySourceToken(source.sourceToken),
			chunkIndex,
		);
		throwIfAborted(signal);
		if (!record) throw new Error(`Source storage chunk ${chunkIndex} is missing.`);
		return this.#options.pcm.decodeRecord(record, source, signal);
	}

	async #assertGenerationCurrent(
		generation: readonly StorageRecord[],
		signal?: AbortSignal,
	): Promise<void> {
		for (const expected of generation) {
			throwIfAborted(signal);
			const current = await this.#options.records.getMetadata(expected.id as string);
			throwIfAborted(signal);
			if (!sameStoredSourceIdentity(current, expected)) throw generationChangedError();
		}
	}
}

function generationChangedError(): Error {
	return new Error('The owned source PCM generation changed during reading.');
}

function noOpRelease(): Promise<void> {
	return Promise.resolve();
}

function maximumDependencyCount(value: unknown): number {
	if (value === undefined) return OWNED_SOURCE_PCM_MAXIMUM_DEPENDENCY_COUNT;
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > OWNED_SOURCE_PCM_MAXIMUM_DEPENDENCY_COUNT) {
		throw new RangeError(
			`Owned source PCM dependency limit must be between 1 and ${OWNED_SOURCE_PCM_MAXIMUM_DEPENDENCY_COUNT}.`,
		);
	}
	return Number(value);
}

function nonEmptySourceId(value: unknown): string {
	if (typeof value !== 'string' || !value) throw new TypeError('A source id is required.');
	return value;
}

function nonEmptyBaseSourceId(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new Error('A copy-on-write source has no immutable base source.');
	}
	return value;
}

function nonEmptySourceToken(value: unknown): string {
	if (typeof value !== 'string' || !value) throw new Error('Owned source metadata has no storage token.');
	return value;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') {
		throw new DOMException('Owned source PCM reading was cancelled.', 'AbortError');
	}
	const error = new Error('Owned source PCM reading was cancelled.');
	error.name = 'AbortError';
	throw error;
}
