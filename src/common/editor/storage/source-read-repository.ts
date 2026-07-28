/* SPDX-License-Identifier: AGPL-3.0-only */

import { PCM_CONTAINER_STORAGE_TYPE } from '../wavpack/index.js';
import type { PcmMigrationRepository } from './pcm-migration-repository.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { PcmRepository } from './pcm-repository.ts';
import type { SourceRecordRepository } from './source-record-repository.ts';

export interface SourcePcmChunk {
	readonly index: unknown;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
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
}

/** Ordered and random-access PCM reads across all source storage formats. */
export class SourceReadRepository {
	readonly #options: SourceReadRepositoryOptions;

	constructor(options: SourceReadRepositoryOptions) {
		this.#options = options;
	}

	async *chunks(
		sourceId: string,
		{ signal }: { readonly signal?: AbortSignal } = {},
	): AsyncGenerator<SourcePcmChunk> {
		throwIfAborted(signal);
		yield* this.#chunks(sourceId, new Set(), signal);
		throwIfAborted(signal);
	}

	async chunk(sourceId: string, chunkIndex: number, { signal }: { readonly signal?: AbortSignal } = {}): Promise<SourcePcmChunk> {
		const index = nonNegativeInteger(chunkIndex, -1);
		if (index < 0) throw new RangeError('Source chunk index must be a non-negative integer.');
		throwIfAborted(signal);
		const result = await this.#chunk(sourceId, index, new Set(), signal);
		throwIfAborted(signal);
		return result;
	}

	async loadAudioBuffer(sourceId: string, audioContext: AudioContextLike): Promise<DestinationAudioBuffer> {
		if (!audioContext?.createBuffer) throw new TypeError('An AudioContext is required to load a source.');
		const source = await this.#options.records.getMetadata(sourceId);
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

	async #chunk(
		sourceId: string,
		chunkIndex: number,
		ancestors: ReadonlySet<string>,
		signal?: AbortSignal,
	): Promise<SourcePcmChunk> {
		const source = await this.#options.records.getMetadata(sourceId);
		if (!source) throw new Error('The requested audio source could not be found.');
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
				: await this.#chunk(source.baseSourceId as string, chunkIndex, nextAncestors, signal);
			this.#options.migrations.queue(source);
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
			this.#options.migrations.queue(source);
			return chunk;
		}
		const record = await this.#options.records.chunk(source.sourceToken as string, chunkIndex);
		if (!record) throw new Error(`Source storage chunk ${chunkIndex} is missing.`);
		const chunk = await this.#options.pcm.decodeRecord(record, source, signal);
		this.#options.migrations.queue(source);
		return chunk;
	}

	async *#chunks(
		sourceId: string,
		ancestors: ReadonlySet<string>,
		signal?: AbortSignal,
	): AsyncGenerator<SourcePcmChunk> {
		throwIfAborted(signal);
		const source = await this.#options.records.getMetadata(sourceId);
		throwIfAborted(signal);
		if (!source) throw new Error('The requested audio source could not be found.');
		if (ancestors.has(sourceId)) throw new Error('The immutable source dependency graph contains a cycle.');
		const nextAncestors = new Set(ancestors).add(sourceId);
		if (source.storage === 'copy-on-write') {
			const replacementIterator = this.#options.records.chunks(source.sourceToken as string)[Symbol.asyncIterator]();
			let migrationQueued = false;
			try {
				let replacement = await replacementIterator.next();
				throwIfAborted(signal);
				for await (const baseChunk of this.#chunks(source.baseSourceId as string, nextAncestors, signal)) {
					throwIfAborted(signal);
					if (!replacement.done && replacement.value.index < Number(baseChunk.index)) {
						throw new Error('A derived source replacement points beyond its base source.');
					}
					if (replacement.done || replacement.value.index !== baseChunk.index) {
						if (!migrationQueued) {
							migrationQueued = true;
							this.#options.migrations.queue(source);
						}
						yield baseChunk;
						continue;
					}
					const chunk = await this.#options.pcm.decodeRecord(replacement.value, source, signal);
					throwIfAborted(signal);
					if (!migrationQueued) {
						migrationQueued = true;
						this.#options.migrations.queue(source);
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
					this.#options.migrations.queue(source);
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
				this.#options.migrations.queue(source);
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

function nonNegativeInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
