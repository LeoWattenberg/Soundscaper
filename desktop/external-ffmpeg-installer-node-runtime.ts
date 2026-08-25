/* SPDX-License-Identifier: AGPL-3.0-only */

/** Node child-process adapter for the closed external FFmpeg installer broker. */

import { spawn as nodeSpawn } from 'node:child_process';
import { posix, win32 } from 'node:path';

import { shouldDetachProcessTree, terminateProcessTree } from './process-tree-termination.ts';

import type {
	ExternalFfmpegInstallRunner,
	ExternalFfmpegInstallRunnerRequest,
	ExternalFfmpegInstallRunnerResult,
} from './external-ffmpeg-installer.ts';

interface InstallerReadable {
	on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

export interface ExternalFfmpegInstallerChildProcess {
	readonly pid?: number;
	stdout: InstallerReadable;
	stderr: InstallerReadable;
	once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
	once(
		event: 'close',
		listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
	): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ExternalFfmpegInstallerSpawnOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly shell: false;
	readonly stdio: readonly ['ignore', 'pipe', 'pipe'];
	readonly windowsHide: true;
	readonly detached: boolean;
}

export type ExternalFfmpegInstallerSpawn = (
	executable: string,
	argv: readonly string[],
	options: ExternalFfmpegInstallerSpawnOptions,
) => ExternalFfmpegInstallerChildProcess;

export interface ExternalFfmpegInstallerNodeRunnerOptions {
	readonly spawn?: ExternalFfmpegInstallerSpawn;
	/** Maximum wait after SIGKILL for a close event before returning the termination outcome. */
	readonly terminationWaitMs?: number;
}

type Termination = Readonly<{
	readonly status: 'cancelled' | 'failed';
	readonly detail: string;
}>;

const DEFAULT_TERMINATION_WAIT_MS = 1_000;

export function createExternalFfmpegInstallerNodeRunner(
	options: ExternalFfmpegInstallerNodeRunnerOptions = {},
): ExternalFfmpegInstallRunner {
	const launch = options.spawn ?? defaultSpawn;
	if (typeof launch !== 'function') {
		throw new TypeError('The external FFmpeg installer spawn adapter must be a function.');
	}
	const terminationWaitMs = boundedInteger(
		options.terminationWaitMs ?? DEFAULT_TERMINATION_WAIT_MS, 1, 5_000,
		'external FFmpeg installer termination wait',
	);
	const runner: ExternalFfmpegInstallRunner = (request) => {
		validateRequest(request);
		if (request.options.signal.aborted) {
			return Promise.resolve(cancelled(abortDetail(request.options.signal), '', ''));
		}
		return runChild(request, launch, terminationWaitMs);
	};
	return Object.freeze(runner);
}

function runChild(
	request: ExternalFfmpegInstallRunnerRequest,
	launch: ExternalFfmpegInstallerSpawn,
	terminationWaitMs: number,
): Promise<ExternalFfmpegInstallRunnerResult> {
	return new Promise((resolve) => {
		let child: ExternalFfmpegInstallerChildProcess;
		try {
			child = launch(request.executable, request.argv, spawnOptions(request));
		} catch (error) {
			resolve(launchFailure(error));
			return;
		}

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let outputBytes = 0;
		let settled = false;
		let termination: Termination | null = null;
		let timeout: ReturnType<typeof setTimeout> | null = null;
		let terminationWait: ReturnType<typeof setTimeout> | null = null;
		const signal = request.options.signal;

		const output = (): Readonly<{ readonly stdout: string; readonly stderr: string }> => (
			boundedTextOutput(stdoutChunks, stderrChunks, request.options.maximumOutputBytes)
		);
		const cleanUp = (): void => {
			if (timeout !== null) clearTimeout(timeout);
			if (terminationWait !== null) clearTimeout(terminationWait);
			signal.removeEventListener('abort', onAbort);
		};
		const finish = (result: ExternalFfmpegInstallRunnerResult): void => {
			if (settled) return;
			settled = true;
			cleanUp();
			resolve(Object.freeze(result));
		};
		const finishTermination = (): void => {
			if (termination === null) return;
			const captured = output();
			finish(termination.status === 'cancelled'
				? cancelled(termination.detail, captured.stdout, captured.stderr)
				: failed(termination.detail, captured.stdout, captured.stderr));
		};
		const terminate = (next: Termination): void => {
			if (settled || termination !== null) return;
			termination = next;
			if (timeout !== null) clearTimeout(timeout);
			void terminateProcessTree(child, 'SIGKILL', { environment: request.options.env });
			if (!settled) terminationWait = setTimeout(finishTermination, terminationWaitMs);
		};
		function onAbort(): void {
			terminate(Object.freeze({ status: 'cancelled', detail: abortDetail(signal) }));
		}
		const append = (destination: Buffer[], chunk: unknown): void => {
			if (settled || termination !== null) return;
			const bytes = chunkBytes(chunk);
			const remaining = request.options.maximumOutputBytes - outputBytes;
			if (remaining > 0) {
				const admitted = Math.min(remaining, bytes.byteLength);
				destination.push(Buffer.from(bytes.subarray(0, admitted)));
				outputBytes += admitted;
			}
			if (bytes.byteLength > remaining) terminate(Object.freeze({
				status: 'failed', detail: 'The package-manager process exceeded its output limit.',
			}));
		};

		child.stdout.on('data', (chunk) => { append(stdoutChunks, chunk); });
		child.stderr.on('data', (chunk) => { append(stderrChunks, chunk); });
		child.once('error', (error) => {
			if (termination !== null) finishTermination();
			else {
				const captured = output();
				finish(launchFailure(error, captured.stdout, captured.stderr));
			}
		});
		child.once('close', (exitCode, processSignal) => {
			if (termination !== null) {
				finishTermination();
				return;
			}
			const captured = output();
			if ((exitCode !== null && !Number.isSafeInteger(exitCode))
				|| (processSignal !== null && typeof processSignal !== 'string')
				|| (exitCode === null && processSignal === null)) {
				finish(failed(
					'The package-manager process returned an invalid exit status.',
					captured.stdout,
					captured.stderr,
				));
				return;
			}
			finish(Object.freeze({
				status: 'exited', exitCode, signal: processSignal,
				stdout: captured.stdout, stderr: captured.stderr,
			}));
		});
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) onAbort();
		if (!settled && termination === null) timeout = setTimeout(() => {
			terminate(Object.freeze({
				status: 'failed', detail: 'The package-manager process timed out.',
			}));
		}, request.options.timeoutMs);
	});
}

function defaultSpawn(
	executable: string,
	argv: readonly string[],
	options: ExternalFfmpegInstallerSpawnOptions,
): ExternalFfmpegInstallerChildProcess {
	return nodeSpawn(executable, [...argv], {
		cwd: options.cwd,
		env: { ...options.env },
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
			detached: shouldDetachProcessTree(),
	}) as unknown as ExternalFfmpegInstallerChildProcess;
}

function spawnOptions(
	request: ExternalFfmpegInstallRunnerRequest,
): ExternalFfmpegInstallerSpawnOptions {
	return Object.freeze({
		cwd: request.options.cwd,
		env: Object.freeze({ ...request.options.env }),
		shell: false,
		stdio: Object.freeze(['ignore', 'pipe', 'pipe'] as const),
		windowsHide: true,
		detached: shouldDetachProcessTree(),
	});
}

function validateRequest(request: ExternalFfmpegInstallRunnerRequest): void {
	const options = request?.options;
	if (!request || typeof request !== 'object'
		|| typeof request.executable !== 'string' || request.executable.length < 1
		|| request.executable.length > 4_096 || request.executable.includes('\0')
		|| !isAbsolutePath(request.executable)
		|| !Array.isArray(request.argv) || request.argv.length < 1 || request.argv.length > 64
		|| request.argv.some((entry) => typeof entry !== 'string' || entry.length > 4_096 || entry.includes('\0'))
		|| !options || typeof options !== 'object'
		|| !isAbsolutePath(options.cwd) || !validEnvironment(options.env)
		|| options.shell !== false || options.stdin !== 'ignore'
		|| options.stdout !== 'capture' || options.stderr !== 'capture'
		|| !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 10
		|| options.timeoutMs > 30 * 60 * 1_000
		|| !Number.isSafeInteger(options.maximumOutputBytes) || options.maximumOutputBytes < 1_024
		|| options.maximumOutputBytes > 1_024 * 1_024
		|| !(options.signal instanceof AbortSignal)) {
		throw new TypeError('The external FFmpeg installer runner request is invalid.');
	}
}

function validEnvironment(value: Readonly<Record<string, string>>): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length > 64) return false;
	return Object.entries(value).every(([key, entry]) => (
		/^[A-Za-z_][A-Za-z\d_]*$/u.test(key) && typeof entry === 'string'
		&& entry.length <= 32_768 && !entry.includes('\0')
	));
}

function launchFailure(
	error: unknown,
	stdout = '',
	stderr = '',
): ExternalFfmpegInstallRunnerResult {
	const code = errorCode(error);
	const detail = code === 'ENOENT'
		? 'ENOENT: The package-manager executable was not found.'
		: code === 'EACCES' || code === 'EPERM'
			? `${code}: The package-manager executable is not executable.`
			: `${code === '' ? 'LAUNCH' : code}: The package-manager process could not be started.`;
	return failed(detail, stdout, stderr);
}

function errorCode(error: unknown): string {
	if (!error || typeof error !== 'object' || !('code' in error)) return '';
	const code = String(error.code);
	return /^[A-Z][A-Z\d_]{0,31}$/u.test(code) ? code : '';
}

function chunkBytes(chunk: unknown): Buffer {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	return Buffer.from(String(chunk));
}

function boundedTextOutput(
	stdoutChunks: readonly Buffer[],
	stderrChunks: readonly Buffer[],
	maximumBytes: number,
): Readonly<{ readonly stdout: string; readonly stderr: string }> {
	const stdout = Buffer.concat(stdoutChunks).toString('utf8');
	const stderr = Buffer.concat(stderrChunks).toString('utf8');
	const admittedStdout = truncateUtf8(stdout, maximumBytes);
	const remaining = Math.max(0, maximumBytes - Buffer.byteLength(admittedStdout));
	return Object.freeze({ stdout: admittedStdout, stderr: truncateUtf8(stderr, remaining) });
}

function truncateUtf8(value: string, maximumBytes: number): string {
	if (Buffer.byteLength(value) <= maximumBytes) return value;
	let result = Buffer.from(value).subarray(0, maximumBytes).toString('utf8');
	while (Buffer.byteLength(result) > maximumBytes) result = [...result].slice(0, -1).join('');
	return result;
}

function abortDetail(signal: AbortSignal): string {
	if (signal.reason instanceof Error && signal.reason.message !== '') return signal.reason.message;
	return 'The package-manager process was cancelled.';
}

function cancelled(detail: string, stdout: string, stderr: string): ExternalFfmpegInstallRunnerResult {
	return Object.freeze({ status: 'cancelled', detail, stdout, stderr });
}

function failed(detail: string, stdout: string, stderr: string): ExternalFfmpegInstallRunnerResult {
	return Object.freeze({ status: 'failed', detail, stdout, stderr });
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`The ${label} is outside its closed bound.`);
	}
	return value;
}

function isAbsolutePath(value: string): boolean {
	return typeof value === 'string' && value.length <= 4_096 && !value.includes('\0')
		&& (posix.isAbsolute(value) || win32.isAbsolute(value));
}
