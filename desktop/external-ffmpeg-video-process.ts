/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shell-free FFmpeg child process and backpressured private-pipe primitives. */

import type { Writable } from 'node:stream';

import { privateExternalFfmpegEnvironment } from './external-ffmpeg-environment.js';
import {
	spawnExternalFfmpegProcess,
	superviseExternalFfmpegProcess,
} from './external-ffmpeg-process-security.js';
import { shouldDetachProcessTree, terminateProcessTree } from './process-tree-termination.js';

export {
	curatedExternalFfmpegEnvironment as curatedExternalFfmpegVideoEnvironment,
} from './external-ffmpeg-environment.js';

const GUARDED_ARGUMENT_PREFIX = Object.freeze([
	'-nostdin', '-hide_banner', '-nostats', '-loglevel', 'error', '-xerror', '-y',
	'-protocol_whitelist', 'file,pipe,crypto,data',
]);

export interface ExternalFfmpegVideoChildProcess {
	readonly pid?: number;
	readonly stdout: Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }>;
	readonly stderr: Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }>;
	readonly stdio: readonly unknown[];
	once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
	once(
		event: 'close',
		listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
	): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ExternalFfmpegVideoLaunchOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly shell: false;
	readonly stdio: readonly string[];
	readonly windowsHide: true;
	readonly detached: boolean;
}

export type ExternalFfmpegVideoSpawn = (
	executablePath: string,
	arguments_: readonly string[],
	options: ExternalFfmpegVideoLaunchOptions,
) => ExternalFfmpegVideoChildProcess;

export const spawnExternalFfmpegVideoProcess =
	spawnExternalFfmpegProcess as unknown as ExternalFfmpegVideoSpawn;

export interface ExternalFfmpegVideoProcessLimits {
	readonly duration: number;
	readonly log: number;
	readonly terminationGrace: number;
	readonly killWait: number;
}

export interface ExternalFfmpegVideoProcess {
	readonly child: ExternalFfmpegVideoChildProcess;
	readonly videoInput: Writable;
	readonly audioInput: Writable | null;
	readonly completion: Promise<void>;
}

/** Add the invariant process guard without accepting executable or endpoint authority. */
export function guardExternalFfmpegVideoArguments(
	arguments_: readonly string[],
	maximumOutputBytes: number,
): readonly string[] {
	if (!Array.isArray(arguments_) || arguments_.length < 3
		|| arguments_[0] !== '-nostdin' || arguments_[1] !== '-y'
		|| arguments_.some((argument) => typeof argument !== 'string' || argument.includes('\0'))
		|| !Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1) {
		throw new TypeError('The admitted external FFmpeg video command is invalid.');
	}
	return Object.freeze([
		...GUARDED_ARGUMENT_PREFIX, ...arguments_.slice(2, -1),
		'-fs', String(maximumOutputBytes), arguments_.at(-1)!,
	]);
}

export function launchExternalFfmpegVideoProcess(options: Readonly<{
	readonly executablePath: string;
	readonly arguments: readonly string[];
	readonly scratchDirectory: string;
	readonly hasAudio: boolean;
	readonly signal: AbortSignal;
	readonly environment: Readonly<Record<string, string>>;
	readonly limits: ExternalFfmpegVideoProcessLimits;
	readonly spawn?: ExternalFfmpegVideoSpawn;
	readonly error: (reason: string, message: string) => Error;
}>): ExternalFfmpegVideoProcess {
	const launch = options.spawn ?? spawnExternalFfmpegVideoProcess;
	let child: ExternalFfmpegVideoChildProcess;
	try {
		child = launch(options.executablePath, options.arguments, Object.freeze({
			cwd: options.scratchDirectory,
			env: privateExternalFfmpegEnvironment(options.environment, options.scratchDirectory),
			shell: false,
			stdio: Object.freeze(options.hasAudio
				? ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
				: ['ignore', 'pipe', 'pipe', 'pipe']),
			windowsHide: true,
			detached: shouldDetachProcessTree(),
		}));
	} catch { throw options.error('spawn-failed', 'The external FFmpeg video process could not start.'); }
	const completion = superviseProcess(child, options.signal, options);
	try {
		return Object.freeze({
			child,
			videoInput: writableAt(child, 3, options.error),
			audioInput: options.hasAudio ? writableAt(child, 4, options.error) : null,
			completion,
		});
	} catch (error) {
		// A successfully launched process is always supervised and terminated,
		// even when its expected private stdio shape is malformed.
		void terminateProcessTree(child, 'SIGKILL', { environment: options.environment });
		void completion.catch(() => undefined);
		throw error;
	}
}

export function writeExternalFfmpegVideoInput(
	stream: Writable,
	bytes: Uint8Array,
	signal: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const onAbort = (): void => reject(signal.reason ?? abortError('Desktop video input was cancelled.'));
		signal.addEventListener('abort', onAbort, { once: true });
		stream.write(Buffer.from(bytes), (error?: Error | null) => {
			signal.removeEventListener('abort', onAbort);
			if (error) reject(error); else if (signal.aborted) onAbort(); else resolve();
		});
	});
}

export function closeExternalFfmpegVideoInput(
	stream: Writable,
	signal: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const onAbort = (): void => reject(signal.reason ?? abortError('Desktop video input was cancelled.'));
		signal.addEventListener('abort', onAbort, { once: true });
		stream.end((error?: Error | null) => {
			signal.removeEventListener('abort', onAbort);
			if (error) reject(error); else if (signal.aborted) onAbort(); else resolve();
		});
	});
}

function superviseProcess(
	child: ExternalFfmpegVideoChildProcess,
	signal: AbortSignal,
	options: Readonly<{
		environment: Readonly<Record<string, string>>;
		limits: ExternalFfmpegVideoProcessLimits;
		error: (reason: string, message: string) => Error;
	}>,
): Promise<void> {
	let logBytes = 0;
	const supervision = superviseExternalFfmpegProcess({
		child,
		signal,
		environment: options.environment,
		maximumDurationMs: options.limits.duration,
		terminationGraceMs: options.limits.terminationGrace,
		killWaitMs: options.limits.killWait,
		timeout: () => options.error('timeout', 'External FFmpeg video exceeded its runtime limit.'),
		cancelled: () => options.error('cancelled', 'The external FFmpeg video operation was cancelled.'),
		terminated: (error) => { throw error; },
		error: () => { throw options.error('spawn-failed', 'The external FFmpeg video process failed.'); },
		close: (code, processSignal) => {
			if (processSignal !== null) {
				throw options.error('process-signalled', 'External FFmpeg video was terminated by a signal.');
			}
			if (code !== 0) {
				throw options.error('process-failed', `External FFmpeg video exited with code ${String(code)}.`);
			}
		},
	});
	const append = (chunk: unknown): void => {
		if (!supervision.acceptsOutput()) return;
		logBytes += chunkBytes(chunk).byteLength;
		if (logBytes > options.limits.log) {
			supervision.terminate(options.error(
				'log-limit', 'External FFmpeg exceeded its video log limit.',
			));
		}
	};
	child.stdout.on('data', append);
	child.stderr.on('data', append);
	return supervision.completion;
}

function writableAt(
	child: ExternalFfmpegVideoChildProcess,
	index: number,
	error: (reason: string, message: string) => Error,
): Writable {
	const stream = child.stdio[index] as Partial<Writable> | undefined;
	if (!stream || typeof stream.write !== 'function' || typeof stream.end !== 'function'
		|| typeof stream.destroy !== 'function') {
		throw error('spawn-failed', 'External FFmpeg did not expose its private input pipe.');
	}
	return stream as Writable;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? abortError('The desktop video operation was cancelled.');
}

function abortError(message: string): Error {
	return typeof DOMException === 'function'
		? new DOMException(message, 'AbortError')
		: Object.assign(new Error(message), { name: 'AbortError' });
}

function chunkBytes(chunk: unknown): Buffer {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.from(String(chunk));
}
