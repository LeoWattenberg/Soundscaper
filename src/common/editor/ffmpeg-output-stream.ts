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
		const admittedSource = normalizeSource(source);
		const admittedSink = normalizeSink(sink);
		const settings = normalizeOptions(options);
		validatePath(path);
		const maximumChunkBytes = normalizeMaximumChunkBytes(settings.maximumChunkBytes);
		assertFfmpegOutputReady(settings);
		const stat = await admittedSource.statFile(path, signalOptions(settings.signal));
		assertFfmpegOutputReady(settings);
		const byteLength = normalizeFileSize(stat);
		await admittedSink.open(byteLength);
		assertFfmpegOutputReady(settings);

		let offset = 0;
		let chunkCount = 0;
		while (offset < byteLength) {
			assertFfmpegOutputReady(settings);
			const requestedByteLength = Math.min(maximumChunkBytes, byteLength - offset);
			const chunk: unknown = await admittedSource.readFileRange(
				path,
				offset,
				requestedByteLength,
				signalOptions(settings.signal),
			);
			assertFfmpegOutputReady(settings);
			validateRange(chunk, requestedByteLength, offset);
			await admittedSink.write(chunk);
			assertFfmpegOutputReady(settings);
			offset += chunk.byteLength;
			chunkCount += 1;
		}
		if (offset !== byteLength) {
			throw new Error('FFmpeg output stream did not reach the exact statted byte length.');
		}
		const output = await admittedSink.close();
		assertFfmpegOutputReady(settings);
		return Object.freeze({ output, byteLength, chunkCount });
	} catch (primary) {
		throw await abortFfmpegOutputSink(sink, primary);
	}
}

function normalizeSource(source: FfmpegOutputFileSource): FfmpegOutputFileSource {
	const statFile = dataMethod(source, 'statFile', 'FFmpeg output source');
	const readFileRange = dataMethod(source, 'readFileRange', 'FFmpeg output source');
	return Object.freeze({
		statFile(path: string, options?: Readonly<{ signal?: AbortSignal }>) {
			return Reflect.apply(statFile, source, [path, options]) as PromiseLike<FfmpegOutputFileStat>;
		},
		readFileRange(
			path: string,
			offset: number,
			maximumBytes: number,
			options?: Readonly<{ signal?: AbortSignal }>,
		) {
			return Reflect.apply(
				readFileRange, source, [path, offset, maximumBytes, options],
			) as PromiseLike<Uint8Array>;
		},
	});
}

function normalizeSink<Output>(sink: FfmpegOutputSink<Output>): FfmpegOutputSink<Output> {
	const open = dataMethod(sink, 'open', 'FFmpeg output sink');
	const write = dataMethod(sink, 'write', 'FFmpeg output sink');
	const close = dataMethod(sink, 'close', 'FFmpeg output sink');
	const abort = dataMethod(sink, 'abort', 'FFmpeg output sink');
	return Object.freeze({
		open(exactByteLength: number) {
			return Reflect.apply(open, sink, [exactByteLength]) as Promise<void>;
		},
		write(chunk: Uint8Array) { return Reflect.apply(write, sink, [chunk]) as Promise<void>; },
		close() { return Reflect.apply(close, sink, []) as Promise<Output>; },
		abort(reason?: unknown) { return Reflect.apply(abort, sink, [reason]) as Promise<void>; },
	});
}

function normalizeOptions(value: FfmpegOutputStreamOptions): FfmpegOutputStreamOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('FFmpeg output stream options must be an object.');
	}
	const admitted: { signal?: AbortSignal | null; assertCurrent?: () => void; maximumChunkBytes?: number } = {};
	for (const key of Reflect.ownKeys(value)) {
		if (key !== 'signal' && key !== 'assertCurrent' && key !== 'maximumChunkBytes') {
			throw new TypeError('FFmpeg output stream options have an unsupported field.');
		}
		const member = ownData(value, key, 'FFmpeg output stream options');
		if (key === 'signal') admitted.signal = member as AbortSignal | null | undefined;
		else if (key === 'assertCurrent') admitted.assertCurrent = member as (() => void) | undefined;
		else admitted.maximumChunkBytes = member as number | undefined;
	}
	if (admitted.signal !== undefined && admitted.signal !== null
		&& (typeof AbortSignal !== 'function' || !(admitted.signal instanceof AbortSignal))) {
		throw new TypeError('FFmpeg output stream signal must be an AbortSignal.');
	}
	if (admitted.assertCurrent !== undefined && typeof admitted.assertCurrent !== 'function') {
		throw new TypeError('FFmpeg output stream assertCurrent must be a function.');
	}
	return Object.freeze(admitted);
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
	const size = stat && typeof stat === 'object'
		? ownData(stat, 'size', 'FFmpeg output stat')
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
	let abort: (...arguments_: never[]) => unknown;
	try { abort = dataMethod(sink, 'abort', 'FFmpeg output sink'); } catch { return primary; }
	try {
		await Reflect.apply(abort, sink, [primary]);
		return primary;
	} catch (cleanup) {
		return new AggregateError(
			[primary, cleanup],
			'FFmpeg output operation failed and its sink could not be aborted.',
		);
	}
}

function dataMethod(value: unknown, key: string, name: string): (...arguments_: never[]) => unknown {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError(`${name} must be an object.`);
	}
	let owner: object | null = value;
	while (owner) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
				throw new TypeError(`${name}.${key} must be a data property function.`);
			}
			return descriptor.value as (...arguments_: never[]) => unknown;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError(`${name}.${key} must be a data property function.`);
}

function ownData(value: object, key: PropertyKey, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${String(key)} must be an own data property.`);
	}
	return descriptor.value;
}

function createAbortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
