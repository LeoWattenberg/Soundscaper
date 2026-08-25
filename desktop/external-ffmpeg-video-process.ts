/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shell-free FFmpeg child process and backpressured private-pipe primitives. */

import { spawn as nodeSpawn } from 'node:child_process';
import type { Writable } from 'node:stream';

import { shouldDetachProcessTree, terminateProcessTree } from './process-tree-termination.ts';

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
	const launch = options.spawn ?? defaultSpawn;
	let child: ExternalFfmpegVideoChildProcess;
	try {
		child = launch(options.executablePath, options.arguments, Object.freeze({
			cwd: options.scratchDirectory,
			env: childEnvironment(options.environment, options.scratchDirectory),
			shell: false,
			stdio: Object.freeze(options.hasAudio
				? ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
				: ['ignore', 'pipe', 'pipe', 'pipe']),
			windowsHide: true,
			detached: shouldDetachProcessTree(),
		}));
	} catch { throw options.error('spawn-failed', 'The external FFmpeg video process could not start.'); }
	return Object.freeze({
		child,
		videoInput: writableAt(child, 3, options.error),
		audioInput: options.hasAudio ? writableAt(child, 4, options.error) : null,
		completion: superviseProcess(child, options.signal, options),
	});
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

export function curatedExternalFfmpegVideoEnvironment(
	value: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const key of ['SystemRoot', 'WINDIR']) {
		const entry = value[key];
		if (typeof entry === 'string' && entry.length <= 32_768 && !entry.includes('\0')) result[key] = entry;
	}
	return Object.freeze(result);
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
	return new Promise((resolve, reject) => {
		let settled = false;
		let terminating: Error | null = null;
		let logBytes = 0;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const finish = (error?: unknown): void => {
			if (settled) return;
			settled = true;
			for (const timer of timers) clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			if (error) reject(error); else resolve();
		};
		const timer = (callback: () => void, delay: number): void => {
			const value = setTimeout(callback, delay);
			value.unref?.();
			timers.add(value);
		};
		const terminate = (error: Error): void => {
			if (settled || terminating) return;
			terminating = error;
			void terminateProcessTree(child, 'SIGTERM', { environment: options.environment });
			timer(() => {
				void terminateProcessTree(child, 'SIGKILL', { environment: options.environment });
				timer(() => finish(error), options.limits.killWait);
			}, options.limits.terminationGrace);
		};
		function onAbort(): void { terminate(options.error('cancelled', 'The external FFmpeg video operation was cancelled.')); }
		const append = (chunk: unknown): void => {
			if (settled || terminating) return;
			logBytes += chunkBytes(chunk).byteLength;
			if (logBytes > options.limits.log) terminate(options.error('log-limit', 'External FFmpeg exceeded its video log limit.'));
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		child.once('error', () => finish(terminating ?? options.error('spawn-failed', 'The external FFmpeg video process failed.')));
		child.once('close', (code, processSignal) => {
			if (terminating) { finish(terminating); return; }
			if (processSignal !== null) { finish(options.error('process-signalled', 'External FFmpeg video was terminated by a signal.')); return; }
			if (code !== 0) { finish(options.error('process-failed', `External FFmpeg video exited with code ${String(code)}.`)); return; }
			finish();
		});
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) onAbort();
		timer(() => terminate(options.error('timeout', 'External FFmpeg video exceeded its runtime limit.')), options.limits.duration);
	});
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

function childEnvironment(
	base: Readonly<Record<string, string>>,
	scratch: string,
): Readonly<Record<string, string>> {
	return Object.freeze({
		AV_LOG_FORCE_NOCOLOR: '1', HOME: scratch, LANG: 'C', LC_ALL: 'C', NO_COLOR: '1',
		...base, TEMP: scratch, TMP: scratch, TMPDIR: scratch, USERPROFILE: scratch,
	});
}

function defaultSpawn(
	executable: string,
	arguments_: readonly string[],
	options: ExternalFfmpegVideoLaunchOptions,
): ExternalFfmpegVideoChildProcess {
	return nodeSpawn(executable, [...arguments_], {
		cwd: options.cwd, env: { ...options.env }, shell: false,
		stdio: [...options.stdio] as never, windowsHide: true, detached: options.detached,
	}) as unknown as ExternalFfmpegVideoChildProcess;
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
