/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createScapeDigest,
	scapeAudioSourceStream,
	scapeHex,
	type ScapeAudioSource,
} from '../scape-archive-media.ts';
import {
	isMediaContentSha256,
} from '../storage/media-content-provenance.ts';
import {
	sameStoredSourceIdentity,
	type StorageRecord,
} from '../storage/media-records.ts';
import type {
	SourcePcmChunk,
	SourcePcmReadSession,
} from '../storage/source-read-repository.ts';

export const TRANSIENT_ANALYSIS_MAXIMUM_PCM_BYTES = 256 * 1024 * 1024;

export interface TransientAnalysisPcmSource extends ScapeAudioSource {
	readonly kind?: 'audio' | 'video';
	readonly sampleRate?: number;
	readonly contentSha256?: unknown;
}

export interface TransientAnalysisPcmStore {
	getSourceMetadata(sourceId: string): PromiseLike<StorageRecord | null> | StorageRecord | null;
	readSourceChunks(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): AsyncIterable<SourcePcmChunk | readonly Float32Array[]>;
	openSourceReadSession(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal; expectedSource?: StorageRecord }>,
	): PromiseLike<SourcePcmReadSession | null> | SourcePcmReadSession | null;
}

export interface TransientAnalysisPcmAccessOptions {
	readonly store: TransientAnalysisPcmStore;
	/** Lower-only test and deployment seam for the planar worker transfer. */
	readonly maximumRangePcmBytes?: number;
}

export interface TransientAnalysisPcmAccess {
	resolveSourceSha256(
		projectId: string,
		source: TransientAnalysisPcmSource,
		signal: AbortSignal,
	): Promise<string>;
	readSourceRange(
		source: TransientAnalysisPcmSource,
		range: Readonly<{ startFrame: number; endFrame: number }>,
		signal: AbortSignal,
	): Promise<readonly Float32Array[]>;
	dispose(): void;
}

interface DigestMemoEntry {
	readonly fingerprint: string;
	readonly abort: AbortController;
	readonly promise: Promise<string>;
}

/** Controller-local, streaming PCM identity and exact bounded-range access. */
export function createTransientAnalysisPcmAccess(
	options: Readonly<TransientAnalysisPcmAccessOptions>,
): Readonly<TransientAnalysisPcmAccess> {
	if (!options?.store?.getSourceMetadata || !options.store.readSourceChunks
		|| !options.store.openSourceReadSession) {
		throw new TypeError('Transient analysis requires canonical PCM storage access.');
	}
	const maximumRangePcmBytes = maximumPcmBytes(options.maximumRangePcmBytes);
	const memo = new Map<string, DigestMemoEntry>();
	let disposed = false;
	return Object.freeze({ resolveSourceSha256, readSourceRange, dispose });

	async function resolveSourceSha256(
		projectIdValue: string,
		sourceValue: TransientAnalysisPcmSource,
		signal: AbortSignal,
	): Promise<string> {
		assertUsable(signal);
		const projectId = stableId(projectIdValue, 'A project id is required for PCM identity.');
		const source = canonicalSource(sourceValue);
		if (isMediaContentSha256(source.contentSha256)) return source.contentSha256;
		const key = `${projectId}\u0000${source.id}`;
		const fingerprint = sourceFingerprint(source);
		const current = memo.get(key);
		if (current?.fingerprint === fingerprint) return awaitForCaller(current.promise, signal);
		current?.abort.abort(new Error('The PCM digest source authority was replaced.'));
		const abort = new AbortController();
		const promise = digestCanonicalSource(options.store, source, abort.signal);
		const entry = Object.freeze({ fingerprint, abort, promise });
		memo.set(key, entry);
		void promise.catch(() => {
			if (memo.get(key) === entry) memo.delete(key);
		});
		return awaitForCaller(promise, signal);
	}

	async function readSourceRange(
		sourceValue: TransientAnalysisPcmSource,
		rangeValue: Readonly<{ startFrame: number; endFrame: number }>,
		signal: AbortSignal,
	): Promise<readonly Float32Array[]> {
		assertUsable(signal);
		const source = canonicalSource(sourceValue);
		const range = canonicalRange(rangeValue, source.frameCount);
		const rangeFrames = range.endFrame - range.startFrame;
		const byteLength = BigInt(rangeFrames) * BigInt(source.channelCount) * 4n;
		if (byteLength > BigInt(maximumRangePcmBytes)) {
			throw new RangeError(
				`Transient analysis PCM range exceeds the ${String(maximumRangePcmBytes)}-byte bound.`,
			);
		}
		const expected = await sourceMetadata(options.store, source, signal);
		const session = await options.store.openSourceReadSession(sourceStorageKey(source), {
			signal,
			expectedSource: expected,
		});
		throwIfAborted(signal);
		if (!session) throw new Error(`Stored PCM for ${source.id} is unavailable.`);
		const channels = Array.from(
			{ length: source.channelCount },
			() => new Float32Array(rangeFrames),
		);
		let readFailure: unknown = null;
		try {
			const firstChunk = Math.floor(range.startFrame / source.chunkFrames);
			const finalChunk = Math.ceil(range.endFrame / source.chunkFrames);
			for (let chunkIndex = firstChunk; chunkIndex < finalChunk; chunkIndex += 1) {
				throwIfAborted(signal);
				const chunk = await session.chunk(chunkIndex, { signal });
				const normalized = canonicalChunk(chunk, source, chunkIndex);
				const chunkStart = chunkIndex * source.chunkFrames;
				const copyStart = Math.max(range.startFrame, chunkStart);
				const copyEnd = Math.min(range.endFrame, chunkStart + normalized.frames);
				for (let channelIndex = 0; channelIndex < source.channelCount; channelIndex += 1) {
					channels[channelIndex]!.set(
						normalized.channels[channelIndex]!.subarray(
							copyStart - chunkStart,
							copyEnd - chunkStart,
						),
						copyStart - range.startFrame,
					);
				}
			}
		} catch (error) {
			readFailure = error;
			throw error;
		} finally {
			try {
				await session.release();
			} catch (releaseError) {
				if (readFailure !== null) {
					throw new AggregateError(
						[readFailure, releaseError],
						'Transient PCM reading and session release both failed.',
						{ cause: readFailure },
					);
				}
				throw releaseError;
			}
		}
		const current = await sourceMetadata(options.store, source, signal);
		if (!sameStoredSourceAuthority(current, expected)) throw generationChangedError();
		return Object.freeze(channels);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const entry of memo.values()) {
			entry.abort.abort(new Error('Transient PCM access was disposed.'));
		}
		memo.clear();
	}

	function assertUsable(signal: AbortSignal): void {
		if (disposed) throw new Error('Transient PCM access was disposed.');
		throwIfAborted(signal);
	}
}

async function digestCanonicalSource(
	store: TransientAnalysisPcmStore,
	source: TransientAnalysisPcmSource,
	signal: AbortSignal,
): Promise<string> {
	const expected = await sourceMetadata(store, source, signal);
	const digest = createScapeDigest();
	const stream = scapeAudioSourceStream(store, source, digest, () => undefined, signal);
	const reader = stream.getReader();
	try {
		while (!(await reader.read()).done) throwIfAborted(signal);
	} finally {
		reader.releaseLock();
	}
	const current = await sourceMetadata(store, source, signal);
	if (!sameStoredSourceAuthority(current, expected)) throw generationChangedError();
	return scapeHex(digest.digest());
}

async function sourceMetadata(
	store: TransientAnalysisPcmStore,
	source: TransientAnalysisPcmSource,
	signal: AbortSignal,
): Promise<StorageRecord> {
	throwIfAborted(signal);
	const metadata = await store.getSourceMetadata(sourceStorageKey(source));
	throwIfAborted(signal);
	if (!metadata || !sameSourceGeometry(metadata, source)) {
		throw new Error(`Stored PCM metadata for ${source.id} does not match its project authority.`);
	}
	return metadata;
}

function canonicalSource(value: TransientAnalysisPcmSource): TransientAnalysisPcmSource {
	if (!value || typeof value !== 'object' || value.kind === 'video') {
		throw new TypeError('Transient analysis requires an audio PCM source.');
	}
	const source = Object.freeze({
		...value,
		id: stableId(value.id, 'A source id is required for transient analysis.'),
		...(value.storageKey == null ? {} : {
			storageKey: stableId(value.storageKey, 'A source storage key must be non-empty.'),
		}),
		frameCount: positiveSafeInteger(value.frameCount, 'source frame count'),
		channelCount: boundedPositiveSafeInteger(value.channelCount, 32, 'source channel count'),
		chunkFrames: positiveSafeInteger(value.chunkFrames, 'source chunk frames'),
		...(value.sampleRate == null ? {} : {
			sampleRate: positiveSafeInteger(value.sampleRate, 'source sample rate'),
		}),
	});
	return source;
}

function canonicalRange(
	value: Readonly<{ startFrame: number; endFrame: number }>,
	sourceFrameCount: number,
): Readonly<{ startFrame: number; endFrame: number }> {
	const startFrame = nonNegativeSafeInteger(value?.startFrame, 'transient source range start');
	const endFrame = positiveSafeInteger(value?.endFrame, 'transient source range end');
	if (endFrame <= startFrame || endFrame > sourceFrameCount) {
		throw new RangeError('Transient source range must be positive and remain within its source.');
	}
	return Object.freeze({ startFrame, endFrame });
}

function canonicalChunk(
	value: SourcePcmChunk,
	source: TransientAnalysisPcmSource,
	chunkIndex: number,
): SourcePcmChunk {
	const expectedFrames = Math.min(
		source.chunkFrames,
		source.frameCount - chunkIndex * source.chunkFrames,
	);
	if (!value || value.index !== chunkIndex || value.frames !== expectedFrames
		|| !Array.isArray(value.channels) || value.channels.length !== source.channelCount
		|| value.channels.some((channel) => (
			!(channel instanceof Float32Array) || channel.length !== expectedFrames
		))) {
		throw new Error(`Stored PCM chunk ${String(chunkIndex)} for ${source.id} is invalid.`);
	}
	return value;
}

function sameSourceGeometry(metadata: StorageRecord, source: TransientAnalysisPcmSource): boolean {
	return metadata.id === sourceStorageKey(source)
		&& metadata.frameCount === source.frameCount
		&& metadata.channelCount === source.channelCount
		&& metadata.chunkFrames === source.chunkFrames
		&& (source.sampleRate == null || metadata.sampleRate === source.sampleRate);
}

function sameStoredSourceAuthority(left: StorageRecord, right: StorageRecord): boolean {
	return sameStoredSourceIdentity(left, right)
		&& left.frameCount === right.frameCount
		&& left.channelCount === right.channelCount
		&& left.chunkFrames === right.chunkFrames
		&& left.sampleRate === right.sampleRate;
}

function sourceFingerprint(source: TransientAnalysisPcmSource): string {
	return JSON.stringify([
		sourceStorageKey(source), source.frameCount, source.channelCount,
		source.chunkFrames, source.sampleRate ?? null,
	]);
}

function sourceStorageKey(source: TransientAnalysisPcmSource): string {
	return source.storageKey || source.id;
}

function generationChangedError(): Error {
	return new Error('The source PCM generation changed while its digest was resolved.');
}

function awaitForCaller<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
	throwIfAborted(signal);
	return new Promise<Value>((resolve, reject) => {
		const aborted = () => reject(abortReason(signal));
		signal.addEventListener('abort', aborted, { once: true });
		void promise.then(
			(value) => { signal.removeEventListener('abort', aborted); resolve(value); },
			(error: unknown) => { signal.removeEventListener('abort', aborted); reject(error); },
		);
	});
}

function maximumPcmBytes(value: unknown): number {
	if (value === undefined) return TRANSIENT_ANALYSIS_MAXIMUM_PCM_BYTES;
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > TRANSIENT_ANALYSIS_MAXIMUM_PCM_BYTES) {
		throw new RangeError(
			`Transient analysis PCM bound must be from 1 through ${String(TRANSIENT_ANALYSIS_MAXIMUM_PCM_BYTES)} bytes.`,
		);
	}
	return Number(value);
}

function stableId(value: unknown, message: string): string {
	if (typeof value !== 'string' || !value || value.trim() !== value) throw new TypeError(message);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	const normalized = nonNegativeSafeInteger(value, name);
	if (normalized < 1) throw new RangeError(`${name} must be positive.`);
	return normalized;
}

function boundedPositiveSafeInteger(value: unknown, maximum: number, name: string): number {
	const normalized = positiveSafeInteger(value, name);
	if (normalized > maximum) throw new RangeError(`${name} cannot exceed ${String(maximum)}.`);
	return normalized;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
	if (signal.reason !== undefined) return signal.reason;
	if (typeof DOMException === 'function') return new DOMException('Transient PCM access was cancelled.', 'AbortError');
	const error = new Error('Transient PCM access was cancelled.');
	error.name = 'AbortError';
	return error;
}
