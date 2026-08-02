/* SPDX-License-Identifier: AGPL-3.0-only */

export const FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES = 1024 * 1024;

export interface FfmpegOutputFileStat {
	readonly size: number;
}

export interface FfmpegOutputFileSource {
	statFile(
		path: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<FfmpegOutputFileStat>;
	readFileRange(
		path: string,
		offset: number,
		maximumBytes: number,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<Uint8Array>;
}

export interface FfmpegOutputSink<Output> {
	open(exactByteLength: number): Promise<void>;
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<Output>;
	abort(reason?: unknown): Promise<void>;
}

export interface FfmpegOutputStreamOptions {
	readonly signal?: AbortSignal | null;
	readonly assertCurrent?: () => void;
	readonly maximumChunkBytes?: number;
}

export interface FfmpegOutputStreamResult<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly chunkCount: number;
}

export async function cleanupFfmpegOutputRuntime(
	steps: readonly (() => PromiseLike<unknown>)[],
	terminate: () => void,
	primary?: unknown,
): Promise<void> {
	const cleanupFailures: unknown[] = [];
	for (const step of steps) {
		try {
			await step();
		} catch (error) {
			cleanupFailures.push(error);
		}
	}
	if (cleanupFailures.length === 0) return;
	try {
		terminate();
	} catch (error) {
		cleanupFailures.push(error);
	}
	if (primary === undefined && cleanupFailures.length === 1) throw cleanupFailures[0];
	throw new AggregateError(
		primary === undefined ? cleanupFailures : [primary, ...cleanupFailures],
		'FFmpeg output operation and runtime cleanup did not both complete successfully.',
	);
}

export async function streamFfmpegOutputFile<Output>(
	source: FfmpegOutputFileSource,
	path: string,
	sink: FfmpegOutputSink<Output>,
	options: FfmpegOutputStreamOptions = {},
): Promise<FfmpegOutputStreamResult<Output>> {
	try {
		validateSource(source);
		validateSink(sink);
		validatePath(path);
		const maximumChunkBytes = normalizeMaximumChunkBytes(options.maximumChunkBytes);
		assertFfmpegOutputReady(options);
		const stat = await source.statFile(path, signalOptions(options.signal));
		assertFfmpegOutputReady(options);
		const byteLength = normalizeFileSize(stat);
		await sink.open(byteLength);
		assertFfmpegOutputReady(options);

		let offset = 0;
		let chunkCount = 0;
		while (offset < byteLength) {
			assertFfmpegOutputReady(options);
			const requestedByteLength = Math.min(maximumChunkBytes, byteLength - offset);
			const chunk: unknown = await source.readFileRange(
				path,
				offset,
				requestedByteLength,
				signalOptions(options.signal),
			);
			assertFfmpegOutputReady(options);
			validateRange(chunk, requestedByteLength, offset);
			await sink.write(chunk);
			assertFfmpegOutputReady(options);
			offset += chunk.byteLength;
			chunkCount += 1;
		}
		if (offset !== byteLength) {
			throw new Error('FFmpeg output stream did not reach the exact statted byte length.');
		}
		const output = await sink.close();
		assertFfmpegOutputReady(options);
		return Object.freeze({ output, byteLength, chunkCount });
	} catch (primary) {
		throw await abortFfmpegOutputSink(sink, primary);
	}
}

function validateSource(source: FfmpegOutputFileSource): void {
	if (!source || typeof source.statFile !== 'function' || typeof source.readFileRange !== 'function') {
		throw new TypeError('Expected an FFmpeg output source with statFile and readFileRange methods.');
	}
}

function validateSink<Output>(sink: FfmpegOutputSink<Output>): void {
	if (
		!sink
		|| typeof sink.open !== 'function'
		|| typeof sink.write !== 'function'
		|| typeof sink.close !== 'function'
		|| typeof sink.abort !== 'function'
	) {
		throw new TypeError('Expected an FFmpeg output sink with open, write, close, and abort methods.');
	}
}

function validatePath(path: string): void {
	if (typeof path !== 'string' || path.length === 0 || path.includes('\u0000')) {
		throw new TypeError('Expected a non-empty FFmpeg output path without NUL bytes.');
	}
}

function normalizeMaximumChunkBytes(value: number | undefined): number {
	const normalized = value ?? FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES;
	if (
		!Number.isSafeInteger(normalized)
		|| normalized <= 0
		|| normalized > FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES
	) {
		throw new RangeError(
			`FFmpeg output maximumChunkBytes must be a positive safe integer no greater than ${FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES}.`,
		);
	}
	return normalized;
}

function normalizeFileSize(stat: unknown): number {
	const size = stat && typeof stat === 'object' && 'size' in stat
		? (stat as { readonly size?: unknown }).size
		: undefined;
	if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
		throw new RangeError('FFmpeg output file size must be a safe non-negative integer.');
	}
	return size;
}

function validateRange(chunk: unknown, requestedByteLength: number, offset: number): asserts chunk is Uint8Array {
	if (!(chunk instanceof Uint8Array)) {
		throw new TypeError('FFmpeg output range expected Uint8Array bytes.');
	}
	if (chunk.byteLength === 0) {
		throw new Error(`FFmpeg output range made no forward progress at offset ${offset}.`);
	}
	if (chunk.byteLength < requestedByteLength) {
		throw new Error(
			`FFmpeg output returned a short range at offset ${offset}: expected ${requestedByteLength} bytes, received ${chunk.byteLength}.`,
		);
	}
	if (chunk.byteLength > requestedByteLength) {
		throw new Error(
			`FFmpeg output range exceeded the requested length at offset ${offset}: requested ${requestedByteLength} bytes, received ${chunk.byteLength}.`,
		);
	}
}

export function assertFfmpegOutputReady(options: FfmpegOutputStreamOptions): void {
	const signal = options.signal;
	if (signal?.aborted) throw signal.reason ?? createAbortError();
	options.assertCurrent?.();
}

function signalOptions(signal: AbortSignal | null | undefined): Readonly<{ signal?: AbortSignal }> | undefined {
	return signal ? { signal } : undefined;
}

export async function abortFfmpegOutputSink<Output>(
	sink: FfmpegOutputSink<Output>,
	primary: unknown,
): Promise<unknown> {
	if (!sink || typeof sink.abort !== 'function') return primary;
	try {
		await sink.abort(primary);
		return primary;
	} catch (cleanup) {
		return new AggregateError(
			[primary, cleanup],
			'FFmpeg output operation failed and its sink could not be aborted.',
		);
	}
}

function createAbortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
