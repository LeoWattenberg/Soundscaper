/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS,
	AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES,
} from '../pcm-sink-admission.ts';
import { DIRECT_SAVE_FINAL_PREFIX_BYTE_LENGTH } from '../file-save-stream.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export const DIRECT_PCM_DESTINATION_WRITE_BYTES = 4 * 1024 * 1024;
export const DIRECT_PCM_MAXIMUM_FILE_BYTES = 65 * 1024 ** 3;
export const DIRECT_PCM_MAXIMUM_PENDING_BYTES = AUDIO_EDITOR_PCM_SINK_MAX_PENDING_BYTES;
export const DIRECT_PCM_RENDER_CHUNK_FRAMES = AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES;

export function directPcmMaximumPendingChunks(
	channelCount: number,
	containerLabel = 'PCM',
): number {
	if (!Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > AUDIO_EDITOR_PCM_SINK_MAX_CHANNELS) {
		throw new RangeError(`Direct ${containerLabel} render channel count must be an integer from 1 to 32.`);
	}
	return Math.floor(DIRECT_PCM_MAXIMUM_PENDING_BYTES / (
		DIRECT_PCM_RENDER_CHUNK_FRAMES * channelCount * Float32Array.BYTES_PER_ELEMENT
	));
}

export function directPcmRenderQueueOptions(
	channelCount: number,
	containerLabel = 'PCM',
): Readonly<{
	chunkFrames: number;
	maximumPendingChunks: number;
	backpressureHighWaterChunks: number;
}> {
	return Object.freeze({
		chunkFrames: DIRECT_PCM_RENDER_CHUNK_FRAMES,
		maximumPendingChunks: directPcmMaximumPendingChunks(channelCount, containerLabel),
		// Suspend before the main-thread encoder/resampler can starve a streamed source.
		backpressureHighWaterChunks: 1,
	});
}

interface PreparedPcmStream {
	readonly mode: 'stream';
	createWritable(
		byteLength: number,
		sizeMode: DirectPcmDestinationSizeMode,
		options?: DirectPcmWritableOptions,
	): Promise<WritableStream<Uint8Array>>;
	patchFinalPrefix?(bytes: Uint8Array): Awaitable<void>;
	bytesWritten(): number;
	commit(): Awaitable<Readonly<Record<string, unknown>>>;
	abort(reason?: unknown): Awaitable<unknown>;
}

export interface DirectPcmContainerEncoder {
	write(channels: readonly Float32Array[]): unknown;
	finalize(): unknown;
}

export interface DirectPcmDestination {
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<void>;
	patchFinalPrefix?(bytes: Uint8Array): Promise<void>;
	abort(reason?: unknown): Promise<void>;
	bytesWritten(): number;
	commit(): Promise<Readonly<Record<string, unknown>>>;
}

export interface DirectPcmEncoder {
	write(channels: readonly Float32Array[]): Promise<void>;
	finalize(): Promise<number>;
}

export type DirectPcmDestinationSizeMode = 'exact' | 'maximum';

export interface DirectPcmWritableOptions {
	readonly finalPrefixByteLength?: number;
}

export type DirectPcmPreparation = Readonly<{
	cancelled: Readonly<Record<string, unknown>> | null;
	destination: DirectPcmDestination | null;
}>;

export async function openDirectPcmDestination(
	prepared: unknown,
	plannedByteLength: number,
	containerLabel = 'PCM',
	sizeMode: DirectPcmDestinationSizeMode = 'exact',
	writableOptions: DirectPcmWritableOptions = {},
): Promise<DirectPcmPreparation> {
	if (!prepared || typeof prepared !== 'object') {
		throw new TypeError(`The prepared ${containerLabel} destination is invalid.`);
	}
	const normalizedWritableOptions = normalizeWritableOptions(
		writableOptions,
		sizeMode,
		plannedByteLength,
	);
	const mode = (prepared as Readonly<{ mode?: unknown }>).mode;
	if (mode === 'cancelled') {
		return Object.freeze({
			cancelled: prepared as Readonly<Record<string, unknown>>,
			destination: null,
		});
	}
	if (mode === 'blob') return emptyPreparation();
	if (mode !== 'stream') {
		throw new TypeError(`The prepared ${containerLabel} destination has an unsupported mode.`);
	}
	const stream = prepared as PreparedPcmStream;
	assertPreparedStream(stream, containerLabel, Boolean(normalizedWritableOptions.finalPrefixByteLength));
	try {
		const writable = await stream.createWritable(plannedByteLength, sizeMode, normalizedWritableOptions);
		if (!writable || typeof writable.getWriter !== 'function') {
			throw new TypeError(`The prepared ${containerLabel} destination is not writable.`);
		}
		return Object.freeze({
			cancelled: null,
			destination: directDestination(stream, writable.getWriter(), containerLabel),
		});
	} catch (error) {
		try {
			await stream.abort(error);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				`The ${containerLabel} destination open and cleanup both failed.`,
			);
		}
		throw error;
	}
}

/**
 * Adapt a synchronous PCM container encoder to bounded destination writes.
 * `onChunk` stays synchronous and emissions enter one fixed coalescing buffer;
 * each consumer write awaits a full destination write before accepting its next
 * PCM block. The realtime renderer separately throttles its upstream producer.
 */
export async function createDirectPcmEncoder(
	destination: DirectPcmDestination,
	createEncoder: (options: Readonly<Record<string, unknown>>) => DirectPcmContainerEncoder,
	options: Readonly<Record<string, unknown>>,
	containerLabel = 'PCM',
): Promise<DirectPcmEncoder> {
	let emitted: Uint8Array[] = [];
	const pending = new Uint8Array(DIRECT_PCM_DESTINATION_WRITE_BYTES);
	let pendingBytes = 0;
	let active = false;
	let finalized = false;
	const encoder = createEncoder({
		...options,
		collect: false,
		onChunk(chunk: unknown) {
			if (!(chunk instanceof Uint8Array)) {
				throw new TypeError(`The ${containerLabel} encoder emitted invalid bytes.`);
			}
			if (emitted.length >= 3) {
				throw new RangeError(`The ${containerLabel} encoder emitted too many undrained chunks.`);
			}
			emitted.push(chunk);
		},
	});
	if (emitted.length !== 1) {
		throw new Error(`The ${containerLabel} encoder must emit exactly one initial header.`);
	}
	await drain(true);

	return Object.freeze({
		async write(channels: readonly Float32Array[]): Promise<void> {
			if (active || finalized) throw new Error(`The direct ${containerLabel} encoder is not writable.`);
			active = true;
			try {
				encoder.write(channels);
				if (emitted.length !== 1) {
					throw new Error(`Each ${containerLabel} PCM block must emit exactly one chunk.`);
				}
				await drain();
			} finally {
				active = false;
			}
		},
		async finalize(): Promise<number> {
			if (active || finalized) {
				throw new Error(`The direct ${containerLabel} encoder cannot be finalized.`);
			}
			finalized = true;
			const result = encoder.finalize() as Readonly<{ readonly byteLength?: unknown }> | null;
			if (!Number.isSafeInteger(result?.byteLength) || Number(result?.byteLength) <= 0) {
				throw new Error(`The ${containerLabel} encoder did not report a valid final byte length.`);
			}
			await drain(true);
			await destination.close();
			return result!.byteLength as number;
		},
	});

	async function drain(flush = false): Promise<void> {
		const chunks = emitted;
		emitted = [];
		for (const chunk of chunks) await append(chunk);
		if (flush) await flushPending();
	}

	async function append(chunk: Uint8Array): Promise<void> {
		let offset = 0;
		while (offset < chunk.byteLength) {
			if (pendingBytes === 0 && chunk.byteLength - offset >= DIRECT_PCM_DESTINATION_WRITE_BYTES) {
				await destination.write(chunk.subarray(offset, offset + DIRECT_PCM_DESTINATION_WRITE_BYTES));
				offset += DIRECT_PCM_DESTINATION_WRITE_BYTES;
				continue;
			}
			const copied = Math.min(DIRECT_PCM_DESTINATION_WRITE_BYTES - pendingBytes, chunk.byteLength - offset);
			pending.set(chunk.subarray(offset, offset + copied), pendingBytes);
			pendingBytes += copied;
			offset += copied;
			if (pendingBytes === DIRECT_PCM_DESTINATION_WRITE_BYTES) await flushPending();
		}
	}

	async function flushPending(): Promise<void> {
		if (!pendingBytes) return;
		const chunk = pending.slice(0, pendingBytes);
		pendingBytes = 0;
		await destination.write(chunk);
	}
}

export async function commitDirectPcmDestination(
	destination: DirectPcmDestination,
	plannedByteLength: number,
	encodedByteLength: number,
	assertReadyToCommit: () => void,
	containerLabel = 'PCM',
): Promise<Readonly<Record<string, unknown>>> {
	if (encodedByteLength !== plannedByteLength) {
		throw new Error(`The streamed ${containerLabel} encoder byte count does not match its planned file size.`);
	}
	if (destination.bytesWritten() !== plannedByteLength) {
		throw new Error(`The streamed ${containerLabel} destination byte count does not match its planned file size.`);
	}
	assertReadyToCommit();
	const published = await destination.commit();
	if (published.size !== plannedByteLength) {
		throw new Error(`The committed ${containerLabel} file byte count does not match its planned file size.`);
	}
	return published;
}

function directDestination(
	prepared: PreparedPcmStream,
	writer: WritableStreamDefaultWriter<Uint8Array>,
	containerLabel: string,
): DirectPcmDestination {
	let closed = false;
	let committed = false;
	let abortPromise: Promise<void> | null = null;
	return Object.freeze({
		async write(chunk: Uint8Array): Promise<void> {
			if (closed || committed || abortPromise) {
				throw new Error(`The direct ${containerLabel} destination is not writable.`);
			}
			await writer.write(chunk);
		},
		async close(): Promise<void> {
			if (closed) return;
			if (committed || abortPromise) {
				throw new Error(`The direct ${containerLabel} destination cannot be closed.`);
			}
			await writer.close();
			closed = true;
		},
		async patchFinalPrefix(bytes: Uint8Array): Promise<void> {
			if (committed || abortPromise) {
				throw new Error(`The direct ${containerLabel} destination cannot patch its final prefix.`);
			}
			if (typeof prepared.patchFinalPrefix !== 'function') {
				throw new Error(`The direct ${containerLabel} destination cannot patch a final prefix.`);
			}
			await prepared.patchFinalPrefix(bytes);
		},
		abort(reason?: unknown): Promise<void> {
			if (committed) return Promise.resolve();
			abortPromise ??= Promise.resolve().then(() => prepared.abort(reason)).then(() => undefined);
			return abortPromise;
		},
		bytesWritten(): number {
			return prepared.bytesWritten();
		},
		async commit(): Promise<Readonly<Record<string, unknown>>> {
			if (!closed || committed || abortPromise) {
				throw new Error(`The direct ${containerLabel} destination is not ready to commit.`);
			}
			const result = await prepared.commit();
			committed = true;
			return result;
		},
	});
}

function assertPreparedStream(
	value: PreparedPcmStream,
	containerLabel: string,
	requireFinalPrefix: boolean,
): void {
	for (const method of ['createWritable', 'bytesWritten', 'commit', 'abort'] as const) {
		if (typeof value[method] !== 'function') {
			throw new TypeError(`The prepared ${containerLabel} destination lacks ${method}.`);
		}
	}
	if (requireFinalPrefix && typeof value.patchFinalPrefix !== 'function') {
		throw new TypeError(`The prepared ${containerLabel} destination lacks patchFinalPrefix.`);
	}
}

function normalizeWritableOptions(
	options: DirectPcmWritableOptions,
	sizeMode: DirectPcmDestinationSizeMode,
	plannedByteLength: number,
): DirectPcmWritableOptions {
	const finalPrefixByteLength = options.finalPrefixByteLength ?? 0;
	if (finalPrefixByteLength === 0) return Object.freeze({});
	if (finalPrefixByteLength !== DIRECT_SAVE_FINAL_PREFIX_BYTE_LENGTH) {
		throw new RangeError(
			`Direct destination final prefixes must contain exactly ${DIRECT_SAVE_FINAL_PREFIX_BYTE_LENGTH} bytes.`,
		);
	}
	if (sizeMode !== 'exact') {
		throw new RangeError('Direct destination final prefixes require exact-size mode.');
	}
	if (!Number.isSafeInteger(plannedByteLength) || plannedByteLength < finalPrefixByteLength) {
		throw new RangeError('The direct destination size is smaller than its final prefix.');
	}
	return Object.freeze({ finalPrefixByteLength });
}

function emptyPreparation(): DirectPcmPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
