/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-process-only, resource-bounded execution for admitted external FFmpeg audio operations. */

import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { readBoundedRegularFile } from './bounded-regular-file.ts';
import { shouldDetachProcessTree, terminateProcessTree } from './process-tree-termination.ts';

export interface ExternalFfmpegAudioOperationFiles {
	readonly inputPath: string;
	readonly outputPath: string;
	readonly maximumOutputBytes: number;
}

export type ExternalFfmpegAudioOperationAdmission<Operation> =
	| Readonly<{ readonly status: 'admitted'; readonly operation: Operation }>
	| Readonly<{ readonly status: 'rejected' }>;

/**
 * A trusted main-process contract owns operation parsing and the complete FFmpeg argv template.
 * The runner supplies its private paths only after it has admitted and staged the byte input.
 */
export interface ExternalFfmpegAudioOperationContract<Operation> {
	admitOperation(value: unknown): ExternalFfmpegAudioOperationAdmission<Operation>;
	maximumOutputBytes?(operation: Operation): number | undefined;
	buildArguments(operation: Operation, files: ExternalFfmpegAudioOperationFiles): unknown;
	validateArguments(
		arguments_: readonly string[],
		operation: Operation,
		files: ExternalFfmpegAudioOperationFiles,
	): boolean;
}

export interface AdmittedExternalFfmpegExecutable {
	readonly executablePath: string;
	readonly ffmpegSha256: string;
}

export interface ExternalFfmpegAudioOperationRequest {
	readonly operation: unknown;
	readonly input: Uint8Array;
	readonly signal?: AbortSignal;
}

export type ExternalFfmpegAudioUnavailableReason =
	| 'busy'
	| 'cancelled'
	| 'cleanup-failed'
	| 'contract-rejected'
	| 'executable-unavailable'
	| 'identity-changed'
	| 'input-limit'
	| 'log-limit'
	| 'output-invalid'
	| 'output-limit'
	| 'output-missing'
	| 'process-failed'
	| 'process-signalled'
	| 'request-rejected'
	| 'scratch-failed'
	| 'spawn-failed'
	| 'timeout';

export type ExternalFfmpegAudioOperationResult =
	| Readonly<{
		readonly status: 'executed';
		readonly output: Uint8Array;
		readonly log: string;
	}>
	| Readonly<{
		readonly status: 'unavailable';
		readonly reason: ExternalFfmpegAudioUnavailableReason;
		readonly detail: string;
		readonly log: string;
		readonly exitCode?: number;
	}>;

interface ChildReadable {
	on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

export interface ExternalFfmpegAudioChildProcess {
	readonly pid?: number;
	readonly stdout: ChildReadable;
	readonly stderr: ChildReadable;
	once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
	once(
		event: 'close',
		listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
	): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ExternalFfmpegAudioLaunchOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly shell: false;
	readonly stdio: readonly ['ignore', 'pipe', 'pipe'];
	readonly windowsHide: true;
	readonly detached: boolean;
}

export type ExternalFfmpegAudioSpawn = (
	executablePath: string,
	arguments_: readonly string[],
	options: ExternalFfmpegAudioLaunchOptions,
) => ExternalFfmpegAudioChildProcess;

export interface ExternalFfmpegAudioOperationRunnerOptions<Operation> {
	/** Fixed main-owned parent; callers of execute cannot select a filesystem path. */
	readonly scratchRoot: string;
	readonly contract: ExternalFfmpegAudioOperationContract<Operation>;
	readonly getAdmittedExecutable: () => Promise<AdmittedExternalFfmpegExecutable | null>;
	readonly digestExecutable?: (executablePath: string) => Promise<string>;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly maximumInputBytes?: number;
	readonly maximumOutputBytes?: number;
	readonly maximumLogBytes?: number;
	readonly maximumDurationMs?: number;
	readonly terminationGraceMs?: number;
	readonly killWaitMs?: number;
	readonly spawn?: ExternalFfmpegAudioSpawn;
}

export interface ExternalFfmpegAudioOperationRunner {
	execute(request: ExternalFfmpegAudioOperationRequest): Promise<ExternalFfmpegAudioOperationResult>;
}

interface Limits {
	readonly input: number;
	readonly output: number;
	readonly log: number;
	readonly duration: number;
	readonly terminationGrace: number;
	readonly killWait: number;
}

type ProcessResult =
	| Readonly<{ readonly status: 'succeeded'; readonly log: string }>
	| Extract<ExternalFfmpegAudioOperationResult, { status: 'unavailable' }>;

const SHA256 = /^[0-9a-f]{64}$/u;
const ARGUMENT_LIMIT = 128;
const ARGUMENT_BYTE_LIMIT = 4_096;
const HARD_BYTE_LIMIT = 2 * 1_024 * 1_024 * 1_024;
const HARD_DURATION_LIMIT_MS = 30 * 60 * 1_000;
const GUARDED_ARGUMENTS = Object.freeze([
	'-nostdin', '-hide_banner', '-nostats', '-loglevel', 'error', '-y',
	'-protocol_whitelist', 'file,crypto,data',
] as const);

const DETAILS: Readonly<Record<ExternalFfmpegAudioUnavailableReason, string>> = Object.freeze({
	busy: 'Another external FFmpeg audio operation is already active.',
	cancelled: 'The external FFmpeg audio operation was cancelled.',
	'cleanup-failed': 'The external FFmpeg scratch directory could not be removed.',
	'contract-rejected': 'The external FFmpeg operation contract rejected its generated arguments.',
	'executable-unavailable': 'No admitted external FFmpeg executable is available.',
	'identity-changed': 'The selected FFmpeg executable changed after it was admitted.',
	'input-limit': 'The external FFmpeg audio input exceeds its byte limit.',
	'log-limit': 'The external FFmpeg process exceeded its log limit.',
	'output-invalid': 'The external FFmpeg process produced an invalid output file.',
	'output-limit': 'The external FFmpeg audio output exceeds its byte limit.',
	'output-missing': 'The external FFmpeg process did not produce an output file.',
	'process-failed': 'The external FFmpeg process returned a nonzero exit code.',
	'process-signalled': 'The external FFmpeg process was terminated by a signal.',
	'request-rejected': 'The external FFmpeg audio operation request was rejected.',
	'scratch-failed': 'The external FFmpeg scratch files could not be prepared.',
	'spawn-failed': 'The external FFmpeg process could not be started.',
	timeout: 'The external FFmpeg audio operation exceeded its runtime limit.',
});

export function createExternalFfmpegAudioOperationRunner<Operation>(
	options: ExternalFfmpegAudioOperationRunnerOptions<Operation>,
): ExternalFfmpegAudioOperationRunner {
	validateOptions(options);
	const contract = options.contract;
	const limits = operationLimits(options);
	const getExecutable = options.getAdmittedExecutable;
	const digestExecutable = options.digestExecutable ?? sha256File;
	const launch = options.spawn ?? defaultSpawn;
	const environment = curatedBaseEnvironment(options.environment ?? process.env);
	let active = false;

	return Object.freeze({
		async execute(request: ExternalFfmpegAudioOperationRequest): Promise<ExternalFfmpegAudioOperationResult> {
			const requestReason = validateRequest(request, limits.input);
			if (requestReason !== null) return unavailable(requestReason);
			if (active) return unavailable('busy');
			let admission: ExternalFfmpegAudioOperationAdmission<Operation>;
			try { admission = contract.admitOperation(request.operation); }
			catch { return unavailable('request-rejected'); }
			if (!validAdmission(admission)) return unavailable('request-rejected');
			if (request.signal?.aborted) return unavailable('cancelled');

			active = true;
			try {
				return await executeActive({
					request, operation: admission.operation, contract, scratchRoot: options.scratchRoot,
					limits, getExecutable, digestExecutable, launch, environment,
				});
			} finally { active = false; }
		},
	});
}

async function executeActive<Operation>(options: Readonly<{
	request: ExternalFfmpegAudioOperationRequest;
	operation: Operation;
	contract: ExternalFfmpegAudioOperationContract<Operation>;
	scratchRoot: string;
	limits: Limits;
	getExecutable: () => Promise<AdmittedExternalFfmpegExecutable | null>;
	digestExecutable: (path: string) => Promise<string>;
	launch: ExternalFfmpegAudioSpawn;
	environment: Readonly<Record<string, string>>;
}>): Promise<ExternalFfmpegAudioOperationResult> {
	let maximumOutputBytes: number;
	try {
		maximumOutputBytes = options.contract.maximumOutputBytes?.(options.operation)
			?? options.limits.output;
		boundedInteger(maximumOutputBytes, 1, options.limits.output, 'operation output');
	} catch { return unavailable('contract-rejected'); }
	let scratchDirectory: string | null = null;
	let result: ExternalFfmpegAudioOperationResult;
	try {
		scratchDirectory = await prepareScratch(options.scratchRoot);
		const files: ExternalFfmpegAudioOperationFiles = Object.freeze({
			inputPath: join(scratchDirectory, 'input.media'),
			outputPath: join(scratchDirectory, 'output.media'),
			maximumOutputBytes,
		});
		await writeFile(files.inputPath, Buffer.from(options.request.input), { flag: 'wx', mode: 0o600 });
		result = await executeStaged({ ...options, files, scratchDirectory });
	} catch {
		result = unavailable('scratch-failed');
	} finally {
		if (scratchDirectory !== null) {
			try { await rm(scratchDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 }); }
			catch { result = unavailable('cleanup-failed'); }
		}
	}
	return result;
}

async function executeStaged<Operation>(options: Readonly<{
	request: ExternalFfmpegAudioOperationRequest;
	operation: Operation;
	contract: ExternalFfmpegAudioOperationContract<Operation>;
	files: ExternalFfmpegAudioOperationFiles;
	scratchDirectory: string;
	limits: Limits;
	getExecutable: () => Promise<AdmittedExternalFfmpegExecutable | null>;
	digestExecutable: (path: string) => Promise<string>;
	launch: ExternalFfmpegAudioSpawn;
	environment: Readonly<Record<string, string>>;
}>): Promise<ExternalFfmpegAudioOperationResult> {
	if (options.request.signal?.aborted) return unavailable('cancelled');
	let operationArguments: readonly string[];
	try {
		const built = options.contract.buildArguments(options.operation, options.files);
		if (!validOperationArguments(built, options.files)
			|| !options.contract.validateArguments(built, options.operation, options.files)) {
			return unavailable('contract-rejected');
		}
		operationArguments = Object.freeze([...built]);
	} catch { return unavailable('contract-rejected'); }

	let executable: AdmittedExternalFfmpegExecutable | null;
	try { executable = await options.getExecutable(); }
	catch { return unavailable('executable-unavailable'); }
	if (!validExecutable(executable)) return unavailable('executable-unavailable');
	const executablePath = executable.executablePath;
	const admittedDigest = executable.ffmpegSha256;
	const arguments_ = guardedArguments(operationArguments, options.files);
	const environment = childEnvironment(options.environment, options.scratchDirectory);
	if (options.request.signal?.aborted) return unavailable('cancelled');
	let currentDigest: string;
	try { currentDigest = await options.digestExecutable(executablePath); }
	catch { return unavailable('executable-unavailable'); }
	if (!SHA256.test(currentDigest) || currentDigest !== admittedDigest) {
		return unavailable('identity-changed');
	}
	if (options.request.signal?.aborted) return unavailable('cancelled');

	const processResult = await runProcess({
		executablePath,
		arguments_, cwd: options.scratchDirectory,
		environment,
		limits: options.limits, signal: options.request.signal, launch: options.launch,
	});
	if (processResult.status === 'unavailable') return processResult;
	const output = await readBoundedRegularFile(options.files.outputPath, options.files.maximumOutputBytes);
	if (output.status === 'unavailable') return {
		...unavailable(output.reason === 'limit' ? 'output-limit'
			: output.reason === 'missing' ? 'output-missing' : 'output-invalid'),
		log: processResult.log,
	};
	return Object.freeze({ status: 'executed', output: output.bytes, log: processResult.log });
}

async function prepareScratch(root: string): Promise<string> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(join(root, 'audio-operation-'));
	try {
		await chmod(directory, 0o700);
		return directory;
	} catch (error) {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}

async function runProcess(options: Readonly<{
	executablePath: string;
	arguments_: readonly string[];
	cwd: string;
	environment: Readonly<Record<string, string>>;
	limits: Limits;
	signal: AbortSignal | undefined;
	launch: ExternalFfmpegAudioSpawn;
}>): Promise<ProcessResult> {
	return new Promise((resolve) => {
		let child: ExternalFfmpegAudioChildProcess;
		try {
				child = options.launch(options.executablePath, options.arguments_, Object.freeze({
					cwd: options.cwd, env: options.environment, shell: false,
					stdio: Object.freeze(['ignore', 'pipe', 'pipe'] as const), windowsHide: true,
					detached: shouldDetachProcessTree(),
			}));
		} catch (error) { resolve(spawnFailure(error)); return; }

		const chunks: Buffer[] = [];
		let logBytes = 0;
		let settled = false;
		let terminating: ExternalFfmpegAudioUnavailableReason | null = null;
		let runtimeTimer: ReturnType<typeof setTimeout> | null = null;
		let graceTimer: ReturnType<typeof setTimeout> | null = null;
		let killTimer: ReturnType<typeof setTimeout> | null = null;
		let windowsTreeTerminationStarted = false;
		const log = (): string => Buffer.concat(chunks).toString('utf8');
		const clearTimers = (): void => {
			if (runtimeTimer !== null) clearTimeout(runtimeTimer);
			if (graceTimer !== null) clearTimeout(graceTimer);
			if (killTimer !== null) clearTimeout(killTimer);
			options.signal?.removeEventListener('abort', onAbort);
		};
		const finish = (result: ProcessResult): void => {
			if (settled) return;
			settled = true;
			clearTimers();
			resolve(Object.freeze(result));
		};
		const finishTermination = (): void => {
			if (terminating !== null) finish(unavailable(terminating, log()));
		};
		const terminate = (reason: ExternalFfmpegAudioUnavailableReason): void => {
			if (settled || terminating !== null) return;
			terminating = reason;
			if (runtimeTimer !== null) clearTimeout(runtimeTimer);
			windowsTreeTerminationStarted = true;
			void terminateProcessTree(child, 'SIGTERM', { environment: options.environment });
			if (settled) return;
			graceTimer = setTimeout(() => {
				if (shouldDetachProcessTree() || !windowsTreeTerminationStarted) {
					void terminateProcessTree(child, 'SIGKILL', { environment: options.environment });
				}
				if (settled) return;
				killTimer = setTimeout(finishTermination, options.limits.killWait);
				killTimer.unref?.();
			}, options.limits.terminationGrace);
			graceTimer.unref?.();
		};
		function onAbort(): void { terminate('cancelled'); }
		const append = (chunk: unknown): void => {
			if (settled || terminating !== null) return;
			const bytes = chunkBytes(chunk);
			const remaining = options.limits.log - logBytes;
			if (remaining > 0) {
				const admitted = Math.min(remaining, bytes.byteLength);
				chunks.push(Buffer.from(bytes.subarray(0, admitted)));
				logBytes += admitted;
			}
			if (bytes.byteLength > remaining) terminate('log-limit');
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		child.once('error', (error) => {
			if (terminating !== null) finishTermination();
			else finish(spawnFailure(error, log()));
		});
		child.once('close', (exitCode, processSignal) => {
			if (terminating !== null) { finishTermination(); return; }
			if (processSignal !== null) { finish(unavailable('process-signalled', log())); return; }
			if (!Number.isSafeInteger(exitCode) || exitCode === null || exitCode < 0) {
				finish(unavailable('spawn-failed', log())); return;
			}
			if (exitCode !== 0) {
				finish(Object.freeze({ ...unavailable('process-failed', log()), exitCode })); return;
			}
			finish(Object.freeze({ status: 'succeeded', log: log() }));
		});
		options.signal?.addEventListener('abort', onAbort, { once: true });
		if (options.signal?.aborted) onAbort();
		if (!settled && terminating === null) {
			runtimeTimer = setTimeout(() => { terminate('timeout'); }, options.limits.duration);
			runtimeTimer.unref?.();
		}
	});
}

function guardedArguments(
	operationArguments: readonly string[],
	files: ExternalFfmpegAudioOperationFiles,
): readonly string[] {
	return Object.freeze([
		...GUARDED_ARGUMENTS,
		...operationArguments.slice(0, -1),
		'-fs', String(files.maximumOutputBytes), files.outputPath,
	]);
}

function validOperationArguments(
	value: unknown,
	files: ExternalFfmpegAudioOperationFiles,
): value is readonly string[] {
	return Array.isArray(value) && value.length >= 2 && value.length <= ARGUMENT_LIMIT
		&& value.at(-1) === files.outputPath
		&& value.filter((entry) => entry === files.inputPath).length === 1
		&& value.filter((entry) => entry === files.outputPath).length === 1
		&& value.every((entry) => typeof entry === 'string' && entry.length > 0
			&& Buffer.byteLength(entry) <= ARGUMENT_BYTE_LIMIT && !entry.includes('\0'));
}

function validateRequest(
	request: ExternalFfmpegAudioOperationRequest,
	maximumInputBytes: number,
): 'input-limit' | 'request-rejected' | null {
	if (!request || typeof request !== 'object' || Array.isArray(request)
		|| !plainObject(request)
		|| Reflect.ownKeys(request).some((key) => typeof key !== 'string'
			|| key !== 'operation' && key !== 'input' && key !== 'signal')
		|| !Object.prototype.hasOwnProperty.call(request, 'operation')
		|| !(request.input instanceof Uint8Array)
		|| request.signal !== undefined && !(request.signal instanceof AbortSignal)) {
		return 'request-rejected';
	}
	return request.input.byteLength > maximumInputBytes ? 'input-limit' : null;
}

function validAdmission<Operation>(
	value: ExternalFfmpegAudioOperationAdmission<Operation>,
): value is Extract<ExternalFfmpegAudioOperationAdmission<Operation>, { status: 'admitted' }> {
	return Boolean(value && typeof value === 'object' && value.status === 'admitted'
		&& Object.prototype.hasOwnProperty.call(value, 'operation'));
}

function validExecutable(value: AdmittedExternalFfmpegExecutable | null): value is AdmittedExternalFfmpegExecutable {
	return Boolean(value && typeof value === 'object'
		&& typeof value.executablePath === 'string' && isAbsolute(value.executablePath)
		&& value.executablePath.length <= ARGUMENT_BYTE_LIMIT && !value.executablePath.includes('\0')
		&& typeof value.ffmpegSha256 === 'string' && SHA256.test(value.ffmpegSha256));
}

function validateOptions<Operation>(options: ExternalFfmpegAudioOperationRunnerOptions<Operation>): void {
	if (!options || typeof options !== 'object' || typeof options.scratchRoot !== 'string'
		|| !isAbsolute(options.scratchRoot) || options.scratchRoot.length > ARGUMENT_BYTE_LIMIT
		|| options.scratchRoot.includes('\0') || !options.contract
		|| typeof options.contract.admitOperation !== 'function'
		|| options.contract.maximumOutputBytes !== undefined
			&& typeof options.contract.maximumOutputBytes !== 'function'
		|| typeof options.contract.buildArguments !== 'function'
		|| typeof options.contract.validateArguments !== 'function'
		|| typeof options.getAdmittedExecutable !== 'function'
		|| options.digestExecutable !== undefined && typeof options.digestExecutable !== 'function'
		|| options.spawn !== undefined && typeof options.spawn !== 'function') {
		throw new TypeError('The external FFmpeg audio operation runner options are invalid.');
	}
	operationLimits(options);
}

function operationLimits<Operation>(options: ExternalFfmpegAudioOperationRunnerOptions<Operation>): Limits {
	return Object.freeze({
		input: boundedInteger(options.maximumInputBytes ?? 512 * 1_024 * 1_024, 1, HARD_BYTE_LIMIT, 'input'),
		output: boundedInteger(options.maximumOutputBytes ?? 512 * 1_024 * 1_024, 1, HARD_BYTE_LIMIT, 'output'),
		log: boundedInteger(options.maximumLogBytes ?? 64 * 1_024, 1, 1_024 * 1_024, 'log'),
		duration: boundedInteger(options.maximumDurationMs ?? 5 * 60 * 1_000, 1, HARD_DURATION_LIMIT_MS, 'runtime'),
		terminationGrace: boundedInteger(options.terminationGraceMs ?? 1_000, 1, 5_000, 'termination grace'),
		killWait: boundedInteger(options.killWaitMs ?? 1_000, 1, 5_000, 'kill wait'),
	});
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`The external FFmpeg audio ${label} limit is invalid.`);
	}
	return value;
}

function curatedBaseEnvironment(
	value: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const key of ['SystemRoot', 'WINDIR']) {
		const entry = value[key];
		if (typeof entry === 'string' && entry.length <= 32_768 && !entry.includes('\0')) result[key] = entry;
	}
	return Object.freeze(result);
}

function childEnvironment(
	base: Readonly<Record<string, string>>,
	scratchDirectory: string,
): Readonly<Record<string, string>> {
	return Object.freeze({
		AV_LOG_FORCE_NOCOLOR: '1', HOME: scratchDirectory, LANG: 'C', LC_ALL: 'C', NO_COLOR: '1',
		...base, TEMP: scratchDirectory, TMP: scratchDirectory, TMPDIR: scratchDirectory,
		USERPROFILE: scratchDirectory,
	});
}

function defaultSpawn(
	executablePath: string,
	arguments_: readonly string[],
	options: ExternalFfmpegAudioLaunchOptions,
): ExternalFfmpegAudioChildProcess {
	return nodeSpawn(executablePath, [...arguments_], {
		cwd: options.cwd, env: { ...options.env }, shell: false,
		stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
		detached: options.detached,
	}) as unknown as ExternalFfmpegAudioChildProcess;
}

async function sha256File(path: string): Promise<string> {
	// Homebrew's public executable is normally a symlink into its versioned Cellar.
	const handle = await open(path, fsConstants.O_RDONLY);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error('The selected external FFmpeg is not a regular file.');
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
	} finally { await handle.close(); }
}

function spawnFailure(error: unknown, log = ''): ProcessResult {
	const code = errorCode(error);
	return unavailable(code === 'ENOENT' || code === 'EACCES' || code === 'EPERM'
		? 'executable-unavailable' : 'spawn-failed', log);
}

function errorCode(error: unknown): string {
	if (!error || typeof error !== 'object' || !('code' in error)) return '';
	const code = String(error.code);
	return /^[A-Z][A-Z\d_]{0,31}$/u.test(code) ? code : '';
}

function unavailable(
	reason: ExternalFfmpegAudioUnavailableReason,
	log = '',
): Extract<ExternalFfmpegAudioOperationResult, { status: 'unavailable' }> {
	return Object.freeze({ status: 'unavailable', reason, detail: DETAILS[reason], log });
}

function chunkBytes(chunk: unknown): Buffer {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.from(String(chunk));
}

function plainObject(value: object): boolean {
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}
