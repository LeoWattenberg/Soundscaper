/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from '../pcm-chunks.js';
import { DESKTOP_READ_HARD_LIMIT_BYTES } from '../desktop-read-materialization.ts';
import { inspectWavBlobPcm } from '../wav-import.js';
import { ascii, readBlobBytes } from '../wav-import-io.ts';
import {
	createWavBlobPcmChunkReader,
	type WavBlobPcmChunkReader,
	type WavPcmDescriptor,
} from '../wav-pcm-chunk-reader.ts';
import type { LinkedAudioOriginalBinding } from './linked-original-binding.ts';
import {
	type LinkedAudioOriginalSource,
	type LinkedOriginalResolver,
} from './linked-original-resolver.ts';
import type { LinkedOriginalRepository } from './linked-original-repository.ts';
import type { StorageRecord } from './media-records.ts';
import type {
	SourcePcmChunk,
	SourceReadFallback,
	SourceReadOptions,
} from './source-read-repository.ts';

export const LINKED_AUDIO_ORIGINAL_SOURCE_STORAGE_TYPE = 'linked-audio-original-v1' as const;

export interface LinkedAudioOriginalSourceReaderOptions {
	readonly bindings: LinkedOriginalRepository;
	readonly resolver: LinkedOriginalResolver;
}

interface LinkedAudioReadSession {
	readonly aliases: readonly LinkedAudioOriginalBinding[];
	readonly binding: LinkedAudioOriginalBinding;
	readonly reader: WavBlobPcmChunkReader;
}

const WAV_MIME_TYPES = new Set(['audio/rf64', 'audio/wav']);

/** Verified canonical Float32 reads from a bounded, pathless local WAV binding. */
export class LinkedAudioOriginalSourceReader implements SourceReadFallback {
	readonly #options: LinkedAudioOriginalSourceReaderOptions;

	constructor(options: LinkedAudioOriginalSourceReaderOptions) {
		if (!options?.bindings || typeof options.bindings.listByStorageKey !== 'function') {
			throw new TypeError('A linked original binding repository is required.');
		}
		if (!options.resolver || typeof options.resolver.resolve !== 'function'
			|| typeof options.resolver.assertBindingCurrent !== 'function') {
			throw new TypeError('A linked original resolver is required.');
		}
		this.#options = options;
	}

	async getMetadata(storageKey: string): Promise<StorageRecord | null> {
		const aliases = await this.#audioAliases(storageKey);
		return aliases ? sourceMetadata(aliases[0] as LinkedAudioOriginalBinding) : null;
	}

	async chunk(
		storageKey: string,
		chunkIndex: number,
		{ signal }: SourceReadOptions = {},
	): Promise<SourcePcmChunk> {
		if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
			throw new RangeError('Source chunk index must be a non-negative integer.');
		}
		const session = await this.#startRead(storageKey, signal);
		return this.#readChunk(session, chunkIndex, signal);
	}

	async *chunks(
		storageKey: string,
		{ signal }: SourceReadOptions = {},
	): AsyncGenerator<SourcePcmChunk> {
		const session = await this.#startRead(storageKey, signal);
		for (let index = 0; index < session.reader.chunkCount; index += 1) {
			yield await this.#readChunk(session, index, signal);
		}
	}

	async #startRead(
		storageKey: string,
		signal?: AbortSignal,
	): Promise<LinkedAudioReadSession> {
		throwIfAborted(signal);
		const aliases = await this.#audioAliases(storageKey);
		if (!aliases) throw new Error('The requested audio source could not be found.');
		const binding = aliases[0] as LinkedAudioOriginalBinding;
		const source = sourceFromBinding(binding);
		const resolved = await this.#options.resolver.resolve(
			binding.projectId,
			source,
			signal ? { signal } : {},
		);
		if (!resolved || resolved.binding.kind !== 'audio'
			|| !sameBinding(resolved.binding, binding)) {
			throw new Error('The linked audio original binding changed during resolution.');
		}
		assertMaterializedBinding(binding);
		if (resolved.blob.type !== binding.mimeType) {
			throw new Error('The linked audio original MIME type changed during resolution.');
		}
		const descriptor = await inspectLinkedWav(resolved.blob, signal);
		assertCanonicalGeometry(binding, descriptor);
		const reader = createWavBlobPcmChunkReader(resolved.blob, {
			descriptor,
			chunkFrames: binding.sourceShape.chunkFrames,
		});
		await this.#assertAliasesCurrent(aliases, binding, signal);
		return Object.freeze({ aliases, binding, reader });
	}

	async #readChunk(
		session: LinkedAudioReadSession,
		chunkIndex: number,
		signal?: AbortSignal,
	): Promise<SourcePcmChunk> {
		await this.#assertAliasesCurrent(session.aliases, session.binding, signal);
		const chunk = await session.reader.readChunk(chunkIndex, signal ? { signal } : {});
		await this.#assertAliasesCurrent(session.aliases, session.binding, signal);
		return Object.freeze({
			index: chunk.index,
			frames: chunk.frames,
			channels: chunk.channels,
		});
	}

	async #audioAliases(storageKey: string): Promise<readonly LinkedAudioOriginalBinding[] | null> {
		const aliases = await this.#options.bindings.listByStorageKey(storageKey);
		if (!aliases.length || aliases[0]?.kind === 'video') return null;
		if (aliases.some((binding) => binding.kind !== 'audio')) {
			throw new Error('Linked original storage aliases contain mixed media kinds.');
		}
		const audioAliases = aliases as readonly LinkedAudioOriginalBinding[];
		assertMaterializedBinding(audioAliases[0] as LinkedAudioOriginalBinding);
		return audioAliases;
	}

	async #assertAliasesCurrent(
		expected: readonly LinkedAudioOriginalBinding[],
		binding: LinkedAudioOriginalBinding,
		signal?: AbortSignal,
	): Promise<void> {
		throwIfAborted(signal);
		await this.#options.resolver.assertBindingCurrent(
			binding.projectId,
			sourceFromBinding(binding),
			binding,
			signal ? { signal } : {},
		);
		const current = await this.#options.bindings.listByStorageKey(binding.storageKey);
		throwIfAborted(signal);
		if (!sameAliases(current, expected)) {
			throw new Error('The linked audio original alias group changed during resolution.');
		}
	}
}

async function inspectLinkedWav(blob: Blob, signal?: AbortSignal): Promise<WavPcmDescriptor> {
	if (blob.size < 4) throw new Error('The linked WAV file is too small to contain a RIFF header.');
	const signature = ascii(await readBlobBytes(blob, 0, 4, signal), 0, 4);
	if (signature !== 'RIFF' && signature !== 'RF64') {
		throw new Error('Linked audio fallback supports RIFF and RF64 WAV containers only.');
	}
	const descriptor = await inspectWavBlobPcm(blob, signal ? { signal } : {});
	return descriptor as WavPcmDescriptor;
}

function sourceMetadata(binding: LinkedAudioOriginalBinding): StorageRecord {
	assertMaterializedBinding(binding);
	const shape = binding.sourceShape;
	return Object.freeze({
		id: binding.storageKey,
		sourceId: binding.storageKey,
		storage: LINKED_AUDIO_ORIGINAL_SOURCE_STORAGE_TYPE,
		sourceToken: `linked-audio-v1:${binding.locatorRevision}:${binding.sha256}`,
		baseSourceId: null,
		path: null,
		committedAt: binding.boundAt,
		kind: 'audio',
		mimeType: binding.mimeType,
		size: binding.byteLength,
		sha256: binding.sha256,
		frameCount: shape.frameCount,
		frameLength: shape.frameCount,
		channelCount: shape.channelCount,
		sampleRate: shape.sampleRate,
		originalSampleRate: shape.originalSampleRate,
		sampleFormat: shape.sampleFormat,
		chunkFrames: shape.chunkFrames,
		chunkCount: Math.ceil(shape.frameCount / shape.chunkFrames),
	});
}

function sourceFromBinding(binding: LinkedAudioOriginalBinding): LinkedAudioOriginalSource {
	return Object.freeze({
		kind: 'audio',
		id: binding.sourceId,
		storageKey: binding.storageKey,
		mimeType: binding.mimeType,
		...binding.sourceShape,
	});
}

function assertMaterializedBinding(binding: LinkedAudioOriginalBinding): void {
	if (!WAV_MIME_TYPES.has(binding.mimeType)) {
		throw new TypeError('Linked audio fallback requires a WAV or RF64 MIME type.');
	}
	if (binding.byteLength > DESKTOP_READ_HARD_LIMIT_BYTES) {
		throw new RangeError('Linked audio original exceeds its materialized read limit.');
	}
	if (binding.sourceShape.chunkFrames > AUDIO_EDITOR_PCM_CHUNK_FRAMES) {
		throw new RangeError('Linked audio original chunk geometry exceeds its canonical limit.');
	}
}

function assertCanonicalGeometry(
	binding: LinkedAudioOriginalBinding,
	descriptor: WavPcmDescriptor,
): void {
	const shape = binding.sourceShape;
	if (descriptor.sourceByteLength !== binding.byteLength
		|| descriptor.frameCount !== shape.frameCount
		|| descriptor.channelCount !== shape.channelCount
		|| descriptor.sampleRate !== shape.sampleRate
		|| descriptor.sampleRate !== shape.originalSampleRate) {
		throw new Error('The linked WAV PCM geometry does not match its canonical project source.');
	}
}

function sameAliases(
	current: readonly unknown[],
	expected: readonly LinkedAudioOriginalBinding[],
): boolean {
	return current.length === expected.length
		&& current.every((binding, index) => JSON.stringify(binding) === JSON.stringify(expected[index]));
}

function sameBinding(left: LinkedAudioOriginalBinding, right: LinkedAudioOriginalBinding): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') {
		throw new DOMException('Linked audio source loading was cancelled.', 'AbortError');
	}
	const error = new Error('Linked audio source loading was cancelled.');
	error.name = 'AbortError';
	throw error;
}
