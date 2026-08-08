/* SPDX-License-Identifier: AGPL-3.0-only */

import { PCM_CONTAINER_STORAGE_TYPE } from '../wavpack/index.js';
import { sameStoredSourceIdentity, type StorageRecord } from './media-records.ts';
import { OwnedSourcePcmReadSessionRepository } from './owned-source-pcm-read-session.ts';
import type { PcmMigrationRepository } from './pcm-migration-repository.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { PcmRepository } from './pcm-repository.ts';
import { combineSourceReadAbortSignals } from './source-pcm-read-session.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';

const SESSION_CLEANUP_REASON = new Error('Source PCM read sessions are being released.');

export interface SourcePcmChunk {
	readonly index: unknown;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

/** One explicitly owned canonical PCM read lifetime. */
export interface SourcePcmReadSession {
	chunk(chunkIndex: number, options?: SourceReadOptions): Promise<SourcePcmChunk>;
	release(): Promise<void>;
}

interface DestinationAudioBuffer {
	copyToChannel?(source: Float32Array, channel: number, offset?: number): void;
	getChannelData(channel: number): Float32Array;
}

interface AudioContextLike {
	createBuffer(channelCount: number, frameCount: number, sampleRate: number): DestinationAudioBuffer;
}

export interface SourceReadRepositoryOptions {
	readonly records: SourceRecordRepository;
	readonly pcm: PcmRepository;
	readonly opfs: OpfsRepository;
	readonly migrations: PcmMigrationRepository;
	readonly fallback?: SourceReadFallback | null;
}

export interface SourceReadOptions {
	readonly signal?: AbortSignal;
	readonly migrateLegacyPcmOnAccess?: boolean;
	readonly expectedSource?: StorageRecord;
}

/** Read-only canonical PCM supplied outside the owned source-record store. */
export interface SourceReadFallback {
	getMetadata(sourceId: string): PromiseLike<StorageRecord | null> | StorageRecord | null;
	openSession?(
		sourceId: string,
		options?: SourceReadOptions,
	): PromiseLike<SourcePcmReadSession | null> | SourcePcmReadSession | null;
	releaseSessions?(): PromiseLike<void> | void;
	chunks(sourceId: string, options?: SourceReadOptions): AsyncIterable<SourcePcmChunk>;
	chunk(
		sourceId: string,
		chunkIndex: number,
		options?: SourceReadOptions,
	): PromiseLike<SourcePcmChunk> | SourcePcmChunk;
}

/** Ordered and random-access PCM reads across all source storage formats. */
export class SourceReadRepository {
	readonly #options: SourceReadRepositoryOptions;
	readonly #ownedSessions: OwnedSourcePcmReadSessionRepository;
	readonly #openings = new Set<Readonly<{
		abort: AbortController;
		promise: Promise<SourcePcmReadSession | null>;
	}>>();

	constructor(options: SourceReadRepositoryOptions) {
		this.#options = options;
		this.#ownedSessions = new OwnedSourcePcmReadSessionRepository(options);
	}

	async getMetadata(sourceId: string): Promise<StorageRecord | null> {
		const owned = await this.#options.records.getMetadata(sourceId);
		return owned ?? await this.#options.fallback?.getMetadata(sourceId) ?? null;
	}

	openSession(
		sourceId: string,
		options: SourceReadOptions = {},
	): Promise<SourcePcmReadSession | null> {
		const abort = new AbortController();
		const signals = combineSourceReadAbortSignals(abort.signal, options.signal);
		const opening = Promise.resolve().then(() => this.#openSession(sourceId, {
			...options,
			signal: signals.signal,
		})).finally(signals.dispose);
		const record = Object.freeze({ abort, promise: opening });
		this.#openings.add(record);
		void opening.then(
			() => { this.#openings.delete(record); },
			() => { this.#openings.delete(record); },
		);
		return opening;
	}

	async #openSession(
		sourceId: string,
		options: SourceReadOptions,
	): Promise<SourcePcmReadSession | null> {
		const owned = await this.#ownedSessions.openSession(sourceId, options);
		try {
			throwIfSessionAdmissionAborted(options.signal);
		} catch (error) {
			if (owned) return failOpenedSession(error, owned);
			throw error;
		}
		if (owned) return owned;
		const fallback = this.#options.fallback;
		if (!fallback?.openSession) {
			if (options.expectedSource) throw sourceGenerationChangedError();
			return null;
		}
		if (options.expectedSource) {
			await this.#assertExpectedSourceCurrent(sourceId, options.expectedSource, options.signal);
		}
		const session = await fallback.openSession(sourceId, options);
		try {
			throwIfSessionAdmissionAborted(options.signal);
			if (options.expectedSource) {
				await this.#assertExpectedSourceCurrent(sourceId, options.expectedSource, options.signal);
			}
		} catch (error) {
			if (session) return failOpenedSession(error, session);
			throw error;
		}
		if (options.expectedSource) {
			if (!session) throw sourceGenerationChangedError();
			return this.#fencedFallbackSession(sourceId, options.expectedSource, session);
		}
		return session;
	}

	/**
	 * Fallback sources carry no copy-on-write generation records, so this fence
	 * rechecks only the admitted metadata identity around every chunk read.
	 */
	#fencedFallbackSession(
		sourceId: string,
		expected: StorageRecord,
		session: SourcePcmReadSession,
	): SourcePcmReadSession {
		const assertCurrent = (signal?: AbortSignal) => (
			this.#assertExpectedSourceCurrent(sourceId, expected, signal)
		);
		return Object.freeze({
			async chunk(chunkIndex: number, chunkOptions: SourceReadOptions = {}): Promise<SourcePcmChunk> {
				await assertCurrent(chunkOptions.signal);
				const chunk = await session.chunk(chunkIndex, chunkOptions);
				await assertCurrent(chunkOptions.signal);
				return chunk;
			},
			release(): Promise<void> {
				return session.release();
			},
		});
	}

	async releaseSessions(): Promise<void> {
		const openings = [...this.#openings];
		for (const opening of openings) opening.abort.abort(SESSION_CLEANUP_REASON);
		const results = await Promise.allSettled([
			...openings.map(({ promise }) => promise),
			this.#ownedSessions.releaseSessions(),
			Promise.resolve().then(() => this.#options.fallback?.releaseSessions?.()),
		]);
		const seenFailures = new Set<unknown>();
		const failures = results
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.filter(({ reason }) => reason !== SESSION_CLEANUP_REASON)
			.map(({ reason }) => reason as unknown)
			.filter((failure) => {
				if (seenFailures.has(failure)) return false;
				seenFailures.add(failure);
				return true;
			});
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Source PCM read-session cleanup failed.');
		}
	}

	async *chunks(
		sourceId: string,
		{ signal, migrateLegacyPcmOnAccess = true }: SourceReadOptions = {},
	): AsyncGenerator<SourcePcmChunk> {
		throwIfAborted(signal);
		yield* this.#chunks(sourceId, new Set(), signal, migrateLegacyPcmOnAccess);
		throwIfAborted(signal);
	}

	async chunk(sourceId: string, chunkIndex: number, { signal, migrateLegacyPcmOnAccess = true }: SourceReadOptions = {}): Promise<SourcePcmChunk> {
		const index = nonNegativeInteger(chunkIndex, -1);
		if (index < 0) throw new RangeError('Source chunk index must be a non-negative integer.');
		throwIfAborted(signal);
		const result = await this.#chunk(sourceId, index, new Set(), signal, migrateLegacyPcmOnAccess);
		throwIfAborted(signal);
		return result;
	}

	async loadAudioBuffer(sourceId: string, audioContext: AudioContextLike): Promise<DestinationAudioBuffer> {
		if (!audioContext?.createBuffer) throw new TypeError('An AudioContext is required to load a source.');
		const source = await this.getMetadata(sourceId);
		if (!source) throw new Error('The requested audio source could not be found.');
		const frameCount = nonNegativeInteger(source.frameCount ?? source.frameLength, 0);
		const channelCount = nonNegativeInteger(source.channelCount, 0);
		if (!frameCount || !channelCount) throw new Error('The stored audio source metadata is invalid.');
		const buffer = audioContext.createBuffer(channelCount, frameCount, Number(source.sampleRate) || 48_000);
		let offset = 0;
		for await (const chunk of this.chunks(sourceId)) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				const data = chunk.channels[channel];
				if (!data) throw new Error('A stored audio source channel is missing.');
				if (typeof buffer.copyToChannel === 'function') buffer.copyToChannel(data, channel, offset);
				else buffer.getChannelData(channel).set(data, offset);
			}
			offset += chunk.frames;
		}
		if (offset !== frameCount) throw new Error('The stored audio source frame count does not match its metadata.');
		return buffer;
	}

	async #assertExpectedSourceCurrent(
		sourceId: string,
		expected: StorageRecord,
		signal?: AbortSignal,
	): Promise<void> {
		throwIfSessionAdmissionAborted(signal);
		const current = await this.getMetadata(sourceId);
		throwIfSessionAdmissionAborted(signal);
		if (!sameStoredSourceIdentity(current, expected)) throw sourceGenerationChangedError();
	}

	async #chunk(
		sourceId: string,
		chunkIndex: number,
		ancestors: ReadonlySet<string>,
		signal?: AbortSignal,
		migrateLegacyPcmOnAccess = true,
	): Promise<SourcePcmChunk> {
		const source = await this.#options.records.getMetadata(sourceId);
		if (!source) {
			if (!this.#options.fallback) throw new Error('The requested audio source could not be found.');
			return await this.#options.fallback.chunk(sourceId, chunkIndex, {
				...(signal ? { signal } : {}),
				migrateLegacyPcmOnAccess,
			});
		}
		if (ancestors.has(sourceId)) throw new Error('The immutable source dependency graph contains a cycle.');
		if (chunkIndex >= nonNegativeInteger(source.chunkCount, 0)) {
			throw new RangeError(`Source storage chunk ${chunkIndex} does not exist.`);
		}
		const nextAncestors = new Set(ancestors).add(sourceId);
		throwIfAborted(signal);
		if (source.storage === 'copy-on-write') {
			const replacement = await this.#options.records.chunk(source.sourceToken as string, chunkIndex);
			const chunk = replacement
				? await this.#options.pcm.decodeRecord(replacement, source, signal)
				: await this.#chunk(source.baseSourceId as string, chunkIndex, nextAncestors, signal, migrateLegacyPcmOnAccess);
			if (migrateLegacyPcmOnAccess) this.#options.migrations.queue(source);
			return chunk;
		}
		if (source.storage === PCM_CONTAINER_STORAGE_TYPE) {
			return this.#options.opfs.readPcmContainerChunk(
				source,
				chunkIndex,
				this.#options.pcm.decodeRecord.bind(this.#options.pcm),
				signal,
			);
		}
		if (source.storage === 'opfs') {
			const chunk = await this.#options.opfs.readLegacyChunk(source, chunkIndex, signal);
			if (migrateLegacyPcmOnAccess) this.#options.migrations.queue(source);
			return chunk;
		}
		const record = await this.#options.records.chunk(source.sourceToken as string, chunkIndex);
		if (!record) throw new Error(`Source storage chunk ${chunkIndex} is missing.`);
		const chunk = await this.#options.pcm.decodeRecord(record, source, signal);
		if (migrateLegacyPcmOnAccess) this.#options.migrations.queue(source);
		return chunk;
	}

	async *#chunks(
		sourceId: string,
		ancestors: ReadonlySet<string>,
		signal?: AbortSignal,
		migrateLegacyPcmOnAccess = true,
	): AsyncGenerator<SourcePcmChunk> {
		throwIfAborted(signal);
		const source = await this.#options.records.getMetadata(sourceId);
		throwIfAborted(signal);
		if (!source) {
			if (!this.#options.fallback) throw new Error('The requested audio source could not be found.');
			yield* this.#options.fallback.chunks(sourceId, {
				...(signal ? { signal } : {}),
				migrateLegacyPcmOnAccess,
			});
			return;
		}
		if (ancestors.has(sourceId)) throw new Error('The immutable source dependency graph contains a cycle.');
		const nextAncestors = new Set(ancestors).add(sourceId);
		if (source.storage === 'copy-on-write') {
			const replacementIterator = this.#options.records.chunks(source.sourceToken as string)[Symbol.asyncIterator]();
			let migrationQueued = false;
			try {
				let replacement = await replacementIterator.next();
				throwIfAborted(signal);
				for await (const baseChunk of this.#chunks(
					source.baseSourceId as string,
					nextAncestors,
					signal,
					migrateLegacyPcmOnAccess,
				)) {
					throwIfAborted(signal);
					if (!replacement.done && replacement.value.index < Number(baseChunk.index)) {
						throw new Error('A derived source replacement points beyond its base source.');
					}
					if (replacement.done || replacement.value.index !== baseChunk.index) {
						if (!migrationQueued) {
							migrationQueued = true;
							if (migrateLegacyPcmOnAccess) this.#options.migrations.queue(source);
						}
						yield baseChunk;
						continue;
					}
					const chunk = await this.#options.pcm.decodeRecord(replacement.value, source, signal);
					throwIfAborted(signal);
					if (!migrationQueued) {
						migrationQueued = true;
						if (migrateLegacyPcmOnAccess) this.#options.migrations.queue(source);
					}
					yield chunk;
					replacement = await replacementIterator.next();
					throwIfAborted(signal);
				}
				if (!replacement.done) throw new Error('A derived source replacement points beyond its base source.');
			} finally {
				await replacementIterator.return?.(undefined);
			}
			return;
		}
		if (source.storage === PCM_CONTAINER_STORAGE_TYPE) {
			yield* this.#options.opfs.readPcmContainerChunks(
				source,
				this.#options.pcm.decodeRecord.bind(this.#options.pcm),
				{ signal },
			);
			return;
		}
		if (source.storage === 'opfs') {
			let migrationQueued = false;
			for await (const chunk of this.#options.opfs.readLegacyChunks(source, { signal })) {
				throwIfAborted(signal);
				if (!migrationQueued) {
					migrationQueued = true;
					if (migrateLegacyPcmOnAccess) this.#options.migrations.queue(source);
				}
				yield chunk;
			}
			return;
		}
		let migrationQueued = false;
		for await (const record of this.#options.records.chunks(source.sourceToken as string)) {
			throwIfAborted(signal);
			const chunk = await this.#options.pcm.decodeRecord(record, source, signal);
			throwIfAborted(signal);
			if (!migrationQueued) {
				migrationQueued = true;
				if (migrateLegacyPcmOnAccess) this.#options.migrations.queue(source);
			}
			yield chunk;
		}
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	const error = new Error('Audio source loading was cancelled.');
	error.name = 'AbortError';
	throw error;
}

async function failOpenedSession(
	error: unknown,
	session: SourcePcmReadSession,
): Promise<never> {
	try {
		await session.release();
	} catch (cleanupError) {
		if (error === SESSION_CLEANUP_REASON) throw cleanupError;
		throw new AggregateError(
			[error, cleanupError],
			'Source session opening and cleanup both failed.',
			{ cause: error },
		);
	}
	throw error;
}

function throwIfSessionAdmissionAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throwIfAborted(signal);
}

function sourceGenerationChangedError(): Error {
	return new Error('The source PCM generation changed during reading.');
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
