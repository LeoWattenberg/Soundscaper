/* SPDX-License-Identifier: AGPL-3.0-only */

import { PCM_CONTAINER_STORAGE_TYPE } from '../wavpack/index.js';
import { createAbortGuard } from '../abort-error.ts';
import {
	sameStoredSourceIdentity,
	type StorageRecord,
} from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { OpfsPcmReadView } from './opfs-pcm-read-view.ts';
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
const throwIfAborted = createAbortGuard('Owned source PCM reading was cancelled.');

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
		sourceId: string;
		abort: AbortController;
		promise: Promise<SourcePcmReadSession | null>;
	}>>();
	readonly #sessions = new Map<SourcePcmReadSession, string>();

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
			const physical = generation.at(-1)!;
			const view = physical.storage === PCM_CONTAINER_STORAGE_TYPE && typeof this.#options.opfs.openPcmContainerReadView === 'function'
				? await this.#options.opfs.openPcmContainerReadView(physical, this.#options.pcm.decodeRecord.bind(this.#options.pcm), signals.signal) : null;
			try {
				throwIfAborted(signals.signal);
				if (view) await this.#assertGenerationCurrent(generation, signals.signal);
			} catch (error) {
				try { await view?.release(); }
				catch (cleanup) { throw new AggregateError([error, cleanup], 'Owned PCM session admission and cleanup both failed.', { cause: cleanup }); }
				throw error;
			}
			const session = createSourcePcmReadSession({
				readChunk: (chunkIndex, signal) => this.#readChunk(generation, chunkIndex, signal, view),
				release: () => view?.release() ?? noOpRelease(),
				onRelease: () => { this.#sessions.delete(session); },
			});
			this.#sessions.set(session, sourceId);
			return session;
		}).finally(signals.dispose);
		const record = Object.freeze({ sourceId, abort, promise: opening });
		this.#openings.add(record);
		void opening.then(
			() => { this.#openings.delete(record); },
			() => { this.#openings.delete(record); },
		);
		return opening;
	}

	async releaseSessions(sourceIds?: ReadonlySet<string>): Promise<void> {
		const openings = [...this.#openings].filter((opening) => !sourceIds || sourceIds.has(opening.sourceId));
		// A provider may reopen while an aborted admission is still settling.
		// Retire only the sessions owned when this cleanup started.
		const sessions = [...this.#sessions].filter(([, sourceId]) => !sourceIds || sourceIds.has(sourceId));
		for (const opening of openings) opening.abort.abort(SESSION_CLEANUP_REASON);
		const results = await Promise.allSettled([
			...openings.map(({ promise }) => promise),
			...sessions.map(([session]) => Promise.resolve(session.release())),
		]);
		const failures = results
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
		view: OpfsPcmReadView | null = null,
	): Promise<SourcePcmChunk> {
		const root = generation[0];
		if (!root || chunkIndex >= nonNegativeInteger(root.chunkCount, 0)) {
			throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
		}
		await this.#assertGenerationCurrent(generation, signal);
		let chunk: SourcePcmChunk | null = null;
		const cow = generation.slice(0, -1);
		if (cow.length && typeof this.#options.records.firstChunk === 'function') {
			const found = await this.#options.records.firstChunk(cow.map((source) => nonEmptySourceToken(source.sourceToken)), chunkIndex, signal);
			throwIfAborted(signal);
			chunk = found ? await this.#options.pcm.decodeRecord(found.record, cow[found.ownerIndex]!, signal)
				: await this.#readPhysicalChunk(generation.at(-1)!, chunkIndex, signal, view);
		} else {
			for (const source of generation) {
				throwIfAborted(signal);
				if (source.storage === 'copy-on-write') {
					const replacement = await this.#options.records.chunk(nonEmptySourceToken(source.sourceToken), chunkIndex);
					throwIfAborted(signal);
					if (!replacement) continue;
					chunk = await this.#options.pcm.decodeRecord(replacement, source, signal);
					break;
				}
				chunk = await this.#readPhysicalChunk(source, chunkIndex, signal, view);
				break;
			}
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
		view: OpfsPcmReadView | null = null,
	): Promise<SourcePcmChunk> {
		if (source.storage === PCM_CONTAINER_STORAGE_TYPE) {
			if (view) return view.chunk(chunkIndex, signal);
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
		throwIfAborted(signal);
		const current = await this.#options.records.getMetadataMany(generation.map((expected) => expected.id as string));
		throwIfAborted(signal);
		for (let index = 0; index < generation.length; index += 1) {
			if (!sameStoredSourceIdentity(current[index], generation[index])) throw generationChangedError();
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
