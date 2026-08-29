/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A leased FFmpeg runtime that works on files and reports what it logged.
 *
 * Two of the editor's FFmpeg operations need the same thing and nothing more:
 * put a file where FFmpeg can read it, run FFmpeg, read what came out, and see
 * the log lines that run produced. The timing probe needs the logs because its
 * whole answer is in them; the trim rewriter needs them because the keyframe
 * index it must have is only ever printed, never returned.
 *
 * The lease shape is deliberately small. It is the same five operations either
 * caller performs, so neither reaches for the raw instance and neither has to
 * know how the runtime is queued, mounted, or torn down.
 *
 * Every path a caller writes is its own to delete. This deletes nothing on its
 * behalf, because a caller that wrote a dozen parts and a concat list knows
 * their names and the order to remove them in, and a scaffold guessing at that
 * would either miss some or remove them too early.
 */

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface FfmpegMediaFileLease {
	/** Put bytes at a fresh path FFmpeg can read, and answer that path. */
	writeInput(bytes: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<string>;
	writeText(path: string, text: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	/** Run FFmpeg and answer its exit code together with what it logged. */
	exec(
		arguments_: readonly string[],
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<{ exitCode: number; logs: readonly string[] }>>;
	readOutput(path: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<Uint8Array>;
	deletePath(path: string): Promise<void>;
}

interface RawFfmpegInstance {
	writeFile(path: string, data: Uint8Array | string, options?: unknown): Awaitable<unknown>;
	readFile(path: string, encoding?: string, options?: unknown): Awaitable<unknown>;
	deleteFile(path: string): Awaitable<unknown>;
	exec(arguments_: readonly string[], timeout?: number, options?: unknown): Awaitable<number>;
	on(event: string, listener: (entry: { message?: string }) => void): unknown;
	off(event: string, listener: (entry: { message?: string }) => void): unknown;
}

export interface FfmpegMediaFileOperationOptions {
	readonly signal?: AbortSignal;
	/** Distinguishes one operation's paths from another's in the same runtime. */
	readonly prefix?: string;
}

export interface FfmpegMediaFileOperationHost {
	run<Output>(
		operation: (instance: RawFfmpegInstance) => Awaitable<Output>,
		beforeLoad?: () => void,
	): Promise<Output>;
	terminateRuntime(): void;
}

/**
 * Lend a file-shaped FFmpeg lease for the duration of one callback.
 *
 * Aborting terminates the runtime rather than merely rejecting: an `exec` that
 * has already started cannot be called back, so the only way to stop it is to
 * take the runtime away, and a half-run FFmpeg holding a lease would block
 * every operation queued behind it.
 */
export function runFfmpegMediaFileOperation<Output>(
	host: FfmpegMediaFileOperationHost,
	operation: (lease: FfmpegMediaFileLease) => Awaitable<Output>,
	options: FfmpegMediaFileOperationOptions = {},
): Promise<Output> {
	if (typeof operation !== 'function') {
		throw new TypeError('An FFmpeg media file operation requires a callback.');
	}
	const signal = options.signal;
	if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
	const prefix = String(options.prefix || 'editor-media');
	return host.run(async (instance) => {
		if (signal?.aborted) throw signal.reason ?? abortError();
		const logs: string[] = [];
		const handleLog = ({ message = '' }: { message?: string }) => {
			if (typeof message === 'string') logs.push(message);
		};
		const onAbort = () => host.terminateRuntime();
		instance.on('log', handleLog);
		signal?.addEventListener('abort', onAbort, { once: true });
		let counter = 0;
		const stamp = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
		try {
			const lease: FfmpegMediaFileLease = {
				async writeInput(bytes, callOptions) {
					const path = `${prefix}-${stamp}-${counter += 1}`;
					await instance.writeFile(path, bytes, signalOptions(callOptions?.signal ?? signal));
					return path;
				},
				async writeText(path, text, callOptions) {
					await instance.writeFile(path, text, signalOptions(callOptions?.signal ?? signal));
				},
				async exec(arguments_, callOptions) {
					const start = logs.length;
					const exitCode = await instance.exec(
						arguments_, -1, signalOptions(callOptions?.signal ?? signal),
					);
					// Only what this exec printed, so a caller parsing an index cannot
					// read an earlier run's output as its own.
					return Object.freeze({ exitCode, logs: Object.freeze(logs.slice(start)) });
				},
				async readOutput(path, callOptions) {
					const data = await instance.readFile(
						path, 'binary', signalOptions(callOptions?.signal ?? signal),
					);
					if (!(data instanceof Uint8Array)) {
						throw new TypeError(`FFmpeg did not return bytes for ${path}.`);
					}
					return data;
				},
				async deletePath(path) {
					await instance.deleteFile(path);
				},
			};
			return await operation(Object.freeze(lease));
		} finally {
			signal?.removeEventListener('abort', onAbort);
			try { instance.off('log', handleLog); } catch { /* the runtime may be gone */ }
		}
	}, () => {
		if (signal?.aborted) throw signal.reason ?? abortError();
	});
}

function signalOptions(signal: AbortSignal | undefined) {
	return signal ? { signal } : undefined;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
