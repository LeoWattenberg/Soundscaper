/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_PCM_CHUNK_FRAMES } from '../pcm-chunks.js';
import { DESKTOP_READ_HARD_LIMIT_BYTES } from '../desktop-read-materialization.ts';
import {
	createAiffBlobPcmChunkReader,
	inspectAiffBlobPcm,
	type AiffPcmDescriptor,
} from '../aiff-pcm-chunk-reader.ts';
import { inspectWavBlobPcm } from '../wav-import.js';
import { ascii } from '../wav-import-io.ts';
import {
	createWavBlobPcmChunkReader,
	type WavBlobPcmChunkReader,
	type WavBlobPcmSource,
	type WavPcmDescriptor,
} from '../wav-pcm-chunk-reader.ts';
import type { LinkedAudioOriginalBinding } from './linked-original-binding.ts';
import {
	type LinkedAudioOriginalSource,
	type LinkedOriginalResolver,
} from './linked-original-resolver.ts';
import { createLinkedOriginalRangeBlobSource } from './linked-original-range-blob-source.ts';
import type { LinkedOriginalRepository } from './linked-original-repository.ts';
import type { StorageRecord } from './media-records.ts';
import type {
	SourcePcmChunk,
	SourcePcmReadSession,
	SourceReadFallback,
	SourceReadOptions,
} from './source-read-repository.ts';
import {
	combineSourceReadAbortSignals,
	createSourcePcmReadSession,
} from './source-pcm-read-session.ts';

export const LINKED_AUDIO_ORIGINAL_SOURCE_STORAGE_TYPE = 'linked-audio-original-v1' as const;

export interface LinkedAudioOriginalSourceReaderOptions {
	readonly bindings: LinkedOriginalRepository;
	readonly resolver: LinkedOriginalResolver;
}

interface LinkedAudioReadSession {
	readonly aliases: readonly LinkedAudioOriginalBinding[];
	readonly binding: LinkedAudioOriginalBinding;
	readonly rangeSignals: LinkedAudioRangeSignalScope | null;
	readonly reader: LinkedAudioPcmChunkReader;
	release(): Promise<void>;
}

interface LinkedAudioRangeSignalScope {
	current(): AbortSignal | undefined;
	run<Value>(
		signal: AbortSignal | undefined,
		operation: () => Promise<Value>,
	): Promise<Value>;
}

type LinkedAudioPcmDescriptor = WavPcmDescriptor | AiffPcmDescriptor;
type LinkedAudioPcmChunkReader = WavBlobPcmChunkReader | ReturnType<typeof createAiffBlobPcmChunkReader>;

const LINKED_AUDIO_MIME_TYPES = new Set(['audio/aiff', 'audio/rf64', 'audio/wav']);
const NO_PRIMARY_FAILURE = Symbol('no linked-audio read failure');
const SESSION_CLEANUP_REASON = new Error('Linked audio read sessions are being released.');

/** Verified canonical Float32 reads from a bounded, pathless local PCM-container binding. */
export class LinkedAudioOriginalSourceReader implements SourceReadFallback {
	readonly #options: LinkedAudioOriginalSourceReaderOptions;
	readonly #openings = new Set<Readonly<{
		abort: AbortController;
		promise: Promise<SourcePcmReadSession>;
	}>>();
	readonly #sessions = new Set<SourcePcmReadSession>();

	constructor(options: LinkedAudioOriginalSourceReaderOptions) {
		if (!options?.bindings || typeof options.bindings.listByStorageKey !== 'function') {
			throw new TypeError('A linked original binding repository is required.');
		}
		if (!options.resolver || typeof options.resolver.resolve !== 'function'
			|| typeof options.resolver.resolveRange !== 'function'
			|| typeof options.resolver.assertBindingCurrent !== 'function') {
			throw new TypeError('A linked original resolver is required.');
		}
		this.#options = options;
	}

	async getMetadata(storageKey: string): Promise<StorageRecord | null> {
		const aliases = await this.#audioAliases(storageKey);
		return aliases ? sourceMetadata(aliases[0] as LinkedAudioOriginalBinding) : null;
	}

	openSession(
		storageKey: string,
		{ signal }: SourceReadOptions = {},
	): Promise<SourcePcmReadSession> {
		const abort = new AbortController();
		const signals = combineSourceReadAbortSignals(abort.signal, signal);
		const opening = Promise.resolve().then(async () => {
			const state = await this.#startRead(storageKey, signals.signal);
			try {
				throwIfAborted(signals.signal);
			} catch (error) {
				return failReadSessionStart(error, state.release);
			}
			const session = createSourcePcmReadSession({
				readChunk: (chunkIndex, readSignal) => this.#readChunk(state, chunkIndex, readSignal),
				release: state.release,
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
		const openingResults = await Promise.allSettled(openings.map((opening) => opening.promise));
		const results = await Promise.allSettled([...this.#sessions].map(
			(session) => Promise.resolve(session.release()),
		));
		const failures = [...openingResults, ...results]
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.filter((result) => result.reason !== SESSION_CLEANUP_REASON)
			.map((result) => result.reason as unknown);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Linked audio read-session cleanup failed.');
		}
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
		let primaryFailure: unknown = NO_PRIMARY_FAILURE;
		try {
			return await this.#readChunk(session, chunkIndex, signal);
		} catch (error) {
			primaryFailure = error;
			throw error;
		} finally {
			await releaseReadSession(session.release, primaryFailure);
		}
	}

	async *chunks(
		storageKey: string,
		{ signal }: SourceReadOptions = {},
	): AsyncGenerator<SourcePcmChunk> {
		const session = await this.#startRead(storageKey, signal);
		let primaryFailure: unknown = NO_PRIMARY_FAILURE;
		try {
			for (let index = 0; index < session.reader.chunkCount; index += 1) {
				yield await this.#readChunk(session, index, signal);
			}
		} catch (error) {
			primaryFailure = error;
			throw error;
		} finally {
			await releaseReadSession(session.release, primaryFailure);
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
		const ranged = await this.#options.resolver.resolveRange(
			binding.projectId,
			source,
			signal ? { signal } : {},
		);
		if (ranged) {
			try {
				if (ranged.binding.kind !== 'audio' || !sameBinding(ranged.binding, binding)) {
					throw new Error('The linked audio original binding changed during range resolution.');
				}
				assertMaterializedBinding(binding);
				if (ranged.source.type !== binding.mimeType) {
					throw new Error('The linked audio original MIME type changed during range resolution.');
				}
				const rangeSignals = createRangeSignalScope();
				const pcmSource = createLinkedOriginalRangeBlobSource(ranged.source, rangeSignals.current);
				const descriptor = await rangeSignals.run(
					signal,
					() => inspectLinkedAudio(pcmSource, binding.mimeType, signal),
				);
				assertCanonicalGeometry(binding, descriptor);
				const reader = createLinkedAudioPcmChunkReader(
					pcmSource,
					descriptor,
					binding.sourceShape.chunkFrames,
				);
				await this.#assertAliasesCurrent(aliases, binding, signal);
				return Object.freeze({ aliases, binding, rangeSignals, reader, release: ranged.release });
			} catch (error) {
				return failReadSessionStart(error, ranged.release);
			}
		}
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
		const descriptor = await inspectLinkedAudio(resolved.blob, binding.mimeType, signal);
		assertCanonicalGeometry(binding, descriptor);
		const reader = createLinkedAudioPcmChunkReader(
			resolved.blob,
			descriptor,
			binding.sourceShape.chunkFrames,
		);
		await this.#assertAliasesCurrent(aliases, binding, signal);
		return Object.freeze({ aliases, binding, rangeSignals: null, reader, release: noOpRelease });
	}

	async #readChunk(
		session: LinkedAudioReadSession,
		chunkIndex: number,
		signal?: AbortSignal,
	): Promise<SourcePcmChunk> {
		await this.#assertAliasesCurrent(session.aliases, session.binding, signal);
		const read = async (): Promise<SourcePcmChunk> =>
			await session.reader.readChunk(chunkIndex, signal ? { signal } : {});
		const chunk = session.rangeSignals
			? await session.rangeSignals.run(signal, read)
			: await read();
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

async function inspectLinkedWav(source: WavBlobPcmSource, signal?: AbortSignal): Promise<WavPcmDescriptor> {
	if (source.size < 4) throw new Error('The linked WAV file is too small to contain a RIFF header.');
	const signature = ascii(await readWavSourceBytes(source, 0, 4, signal), 0, 4);
	if (signature !== 'RIFF' && signature !== 'RF64' && signature !== 'BW64') {
		throw new Error('Linked audio fallback supports RIFF, RF64, and BW64 WAV containers only.');
	}
	const descriptor = await inspectWavBlobPcm(source, signal ? { signal } : {});
	return descriptor as WavPcmDescriptor;
}

async function inspectLinkedAudio(
	source: WavBlobPcmSource,
	mimeType: string,
	signal?: AbortSignal,
): Promise<LinkedAudioPcmDescriptor> {
	if (mimeType === 'audio/aiff') return inspectAiffBlobPcm(source, signal ? { signal } : {});
	return inspectLinkedWav(source, signal);
}

function createLinkedAudioPcmChunkReader(
	source: WavBlobPcmSource,
	descriptor: LinkedAudioPcmDescriptor,
	chunkFrames: number,
): LinkedAudioPcmChunkReader {
	return descriptor.container === 'aiff'
		? createAiffBlobPcmChunkReader(source, { descriptor, chunkFrames })
		: createWavBlobPcmChunkReader(source, { descriptor, chunkFrames });
}

async function readWavSourceBytes(
	source: WavBlobPcmSource,
	start: number,
	end: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	throwIfAborted(signal);
	const buffer = await source.slice(start, end).arrayBuffer();
	throwIfAborted(signal);
	if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - start) {
		throw new Error('A linked WAV range returned an unexpected number of bytes.');
	}
	return new Uint8Array(buffer);
}

async function failReadSessionStart(
	error: unknown,
	release: () => Promise<void>,
): Promise<never> {
	try {
		await release();
	} catch (cleanupError) {
		throw new AggregateError(
			[error, cleanupError],
			'Linked audio range setup and cleanup both failed.',
			{ cause: error },
		);
	}
	throw error;
}

async function releaseReadSession(
	release: () => Promise<void>,
	primaryFailure: unknown,
): Promise<void> {
	try {
		await release();
	} catch (cleanupError) {
		if (primaryFailure !== NO_PRIMARY_FAILURE) {
			throw new AggregateError(
				[primaryFailure, cleanupError],
				'Linked audio range reading and cleanup both failed.',
				{ cause: primaryFailure },
			);
		}
		throw cleanupError;
	}
}

function noOpRelease(): Promise<void> {
	return Promise.resolve();
}

function createRangeSignalScope(): LinkedAudioRangeSignalScope {
	let active = false;
	let activeSignal: AbortSignal | undefined;
	return Object.freeze({
		current: () => activeSignal,
		async run<Value>(
			signal: AbortSignal | undefined,
			operation: () => Promise<Value>,
		): Promise<Value> {
			if (active) throw new Error('Linked audio range reads must be serialized.');
			active = true;
			activeSignal = signal;
			try {
				return await operation();
			} finally {
				active = false;
				activeSignal = undefined;
			}
		},
	});
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
	if (!LINKED_AUDIO_MIME_TYPES.has(binding.mimeType)) {
		throw new TypeError('Linked audio fallback requires an AIFF, WAV, or RF64 MIME type.');
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
	descriptor: LinkedAudioPcmDescriptor,
): void {
	const shape = binding.sourceShape;
	if (descriptor.sourceByteLength !== binding.byteLength
		|| descriptor.frameCount !== shape.frameCount
		|| descriptor.channelCount !== shape.channelCount
		|| descriptor.sampleRate !== shape.sampleRate
		|| descriptor.sampleRate !== shape.originalSampleRate) {
		throw new Error('The linked WAV or AIFF PCM geometry does not match its canonical project source.');
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
