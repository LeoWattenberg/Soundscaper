/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared shell-free launch and regular-file identity mechanics for external FFmpeg. */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';

import { terminateProcessTree } from './process-tree-termination.ts';

export interface ExternalFfmpegProcessSecurityLaunchOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly stdio: readonly string[];
	readonly detached: boolean;
}

export interface ExternalFfmpegRegularFileDigestOptions {
	readonly notRegularFile: () => Error;
}

export interface ExternalFfmpegSupervisedChildProcess<SpawnError = Error> {
	readonly pid?: number;
	once(event: 'error', listener: (error: SpawnError) => void): unknown;
	once(
		event: 'close',
		listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
	): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ExternalFfmpegProcessSupervision<Termination, Result> {
	readonly completion: Promise<Result>;
	/** True only while output may still be admitted by the caller's bounded parser. */
	acceptsOutput(): boolean;
	/** Begin the one owned TERM/grace/KILL/bounded-wait sequence. */
	terminate(reason: Termination): void;
}

export interface ExternalFfmpegProcessSupervisionOptions<SpawnError, Termination, Result> {
	readonly child: ExternalFfmpegSupervisedChildProcess<SpawnError>;
	readonly signal?: AbortSignal;
	readonly environment: Readonly<Record<string, string>>;
	readonly maximumDurationMs: number;
	readonly terminationGraceMs: number;
	readonly killWaitMs: number;
	/** Windows taskkill already force-terminates a tree, so callers may suppress a redundant retry. */
	readonly forceKillAfterGrace?: boolean;
	readonly timeout: () => Termination;
	readonly cancelled: () => Termination;
	readonly terminated: (reason: Termination) => Result;
	readonly error: (error: SpawnError) => Result;
	readonly close: (exitCode: number | null, signal: NodeJS.Signals | null) => Result;
}

/** Launch one reviewed executable without a shell or inherited stdio policy. */
export function spawnExternalFfmpegProcess(
	executablePath: string,
	arguments_: readonly string[],
	options: ExternalFfmpegProcessSecurityLaunchOptions,
): ChildProcess {
	return nodeSpawn(executablePath, [...arguments_], {
		cwd: options.cwd,
		env: { ...options.env },
		shell: false,
		stdio: [...options.stdio] as never,
		windowsHide: true,
		detached: options.detached,
	});
}

/** Own child terminal listeners, cancellation, runtime bounds, and TERM-to-KILL escalation. */
export function superviseExternalFfmpegProcess<SpawnError, Termination, Result>(
	options: ExternalFfmpegProcessSupervisionOptions<SpawnError, Termination, Result>,
): ExternalFfmpegProcessSupervision<Termination, Result> {
	let settled = false;
	let terminationStarted = false;
	let terminationReason!: Termination;
	let runtimeTimer: ReturnType<typeof setTimeout> | null = null;
	let graceTimer: ReturnType<typeof setTimeout> | null = null;
	let killTimer: ReturnType<typeof setTimeout> | null = null;
	let resolveCompletion!: (value: Result | PromiseLike<Result>) => void;
	let rejectCompletion!: (reason?: unknown) => void;
	const completion = new Promise<Result>((resolve, reject) => {
		resolveCompletion = resolve;
		rejectCompletion = reject;
	});
	const clear = (): void => {
		if (runtimeTimer !== null) { clearTimeout(runtimeTimer); runtimeTimer = null; }
		if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
		if (killTimer !== null) { clearTimeout(killTimer); killTimer = null; }
		options.signal?.removeEventListener('abort', onAbort);
	};
	const finish = (produce: () => Result): void => {
		if (settled) return;
		settled = true;
		clear();
		try { resolveCompletion(produce()); }
		catch (error) { rejectCompletion(error); }
	};
	const finishTermination = (): void => {
		if (terminationStarted) finish(() => options.terminated(terminationReason));
	};
	const terminate = (reason: Termination): void => {
		if (settled || terminationStarted) return;
		terminationStarted = true;
		terminationReason = reason;
		if (runtimeTimer !== null) { clearTimeout(runtimeTimer); runtimeTimer = null; }
		void terminateProcessTree(options.child, 'SIGTERM', { environment: options.environment });
		if (settled) return;
		graceTimer = setTimeout(() => {
			graceTimer = null;
			if (options.forceKillAfterGrace !== false) {
				void terminateProcessTree(options.child, 'SIGKILL', { environment: options.environment });
			}
			if (settled) return;
			killTimer = setTimeout(finishTermination, options.killWaitMs);
			killTimer.unref?.();
		}, options.terminationGraceMs);
		graceTimer.unref?.();
	};
	function onAbort(): void { terminate(options.cancelled()); }
	options.child.once('error', (error) => {
		if (terminationStarted) finishTermination();
		else finish(() => options.error(error));
	});
	options.child.once('close', (exitCode, signal) => {
		if (terminationStarted) finishTermination();
		else finish(() => options.close(exitCode, signal));
	});
	options.signal?.addEventListener('abort', onAbort, { once: true });
	if (options.signal?.aborted) onAbort();
	if (!terminationStarted) {
		runtimeTimer = setTimeout(() => { terminate(options.timeout()); }, options.maximumDurationMs);
		runtimeTimer.unref?.();
	}
	return Object.freeze({
		completion,
		acceptsOutput: () => !settled && !terminationStarted,
		terminate,
	});
}

/** Hash only a file descriptor whose opened target is a regular file. */
export async function sha256ExternalFfmpegRegularFile(
	path: string,
	options: ExternalFfmpegRegularFileDigestOptions,
): Promise<string> {
	const handle = await open(path, fsConstants.O_RDONLY);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw options.notRegularFile();
		const hash = createHash('sha256');
		const buffer = Buffer.alloc(64 * 1_024);
		let position = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		return hash.digest('hex');
	} finally {
		await handle.close();
	}
}
