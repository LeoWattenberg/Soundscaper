/* SPDX-License-Identifier: AGPL-3.0-only */

/** Automatically verified, shell-free external-FFmpeg fast shot detector. */

import { spawn as nodeSpawn } from 'node:child_process';
import { dirname, isAbsolute, normalize } from 'node:path';

import {
	externalFfmpegExecutablePairMatches,
	isExternalFfmpegExecutablePairAdmission,
	type ExternalFfmpegExecutablePairAdmission,
} from './external-ffmpeg-executable-pair-admission.js';
import {
	createExternalFfmpegShotOutputParser,
	ExternalFfmpegShotOutputError,
	type ExternalFfmpegShotDetectionResult,
} from './external-ffmpeg-shot-detection-output.js';
import { curatedExternalFfmpegVideoEnvironment } from './external-ffmpeg-video-process.js';
import { shouldDetachProcessTree, terminateProcessTree } from './process-tree-termination.js';

export interface ExternalFfmpegShotChildProcess {
	readonly pid?: number;
	readonly stderr: Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }>;
	readonly stdio: readonly unknown[];
	once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
	once(
		event: 'close',
		listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
	): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

export interface ExternalFfmpegShotLaunchOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly shell: false;
	readonly stdio: readonly ['ignore', 'ignore', 'pipe', 'ignore', 'pipe'];
	readonly windowsHide: true;
	readonly detached: boolean;
}

export type ExternalFfmpegShotSpawn = (
	executablePath: string,
	arguments_: readonly string[],
	options: ExternalFfmpegShotLaunchOptions,
) => ExternalFfmpegShotChildProcess;

export interface ExternalFfmpegShotDetectorLimits {
	readonly durationMs: number;
	readonly stderrBytes: number;
	readonly metadataBytes: number;
	readonly terminationGraceMs: number;
	readonly killWaitMs: number;
}

export interface ExternalFfmpegShotDetectorOptions {
	readonly pair: ExternalFfmpegExecutablePairAdmission;
	/** Private directory containing every staged source passed to `detect`. */
	readonly workingDirectory: string;
	readonly digestExecutable: (path: string) => Promise<string>;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly spawn?: ExternalFfmpegShotSpawn;
	readonly limits?: Partial<ExternalFfmpegShotDetectorLimits>;
}

export interface ExternalFfmpegShotDetectorVerification {
	readonly schemaVersion: 1;
	readonly detector: 'ffmpeg-scdet';
	readonly executablePairClosureSha256: string;
	readonly canary: Readonly<{
		readonly sourceFrameCount: 4;
		readonly boundarySourceFrame: 2;
	}>;
}

export interface ExternalFfmpegShotDetectionRequest {
	/** One direct child of the factory's private working directory. */
	readonly sourcePath: string;
	readonly signal?: AbortSignal;
}

export interface ExternalFfmpegShotDetector {
	/** Run the fixed four-frame black-to-white scene-filter canary. */
	verify(options?: Readonly<{ readonly signal?: AbortSignal }>): Promise<ExternalFfmpegShotDetectorVerification>;
	/** Detect only after this exact factory instance has verified successfully. */
	detect(request: ExternalFfmpegShotDetectionRequest): Promise<ExternalFfmpegShotDetectionResult>;
}

export type ExternalFfmpegShotDetectorErrorReason =
	| 'busy'
	| 'cancelled'
	| 'canary-failed'
	| 'executable-unavailable'
	| 'identity-changed'
	| 'metadata-invalid'
	| 'metadata-limit'
	| 'process-failed'
	| 'process-signalled'
	| 'request-rejected'
	| 'spawn-failed'
	| 'stderr-limit'
	| 'timeout'
	| 'not-verified';

export class ExternalFfmpegShotDetectorError extends Error {
	constructor(readonly reason: ExternalFfmpegShotDetectorErrorReason, message: string) {
		super(message);
		this.name = 'ExternalFfmpegShotDetectorError';
	}
}

const SCENE_FILTER = "scdet=threshold=10,metadata=mode=print:file='pipe\\:4':direct=1,metadata=mode=select:key=lavfi.scd.time,showinfo";
const GUARDED_PREFIX = Object.freeze([
	'-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', '-xerror',
	'-protocol_whitelist', 'file,pipe,crypto,data',
]);
const CANARY_ARGUMENTS = Object.freeze([
	...GUARDED_PREFIX,
	'-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=2',
	'-f', 'lavfi', '-i', 'color=c=white:s=16x16:r=1:d=2',
	'-filter_complex', `[0:v:0][1:v:0]concat=n=2:v=1:a=0,${SCENE_FILTER}[shots]`,
	'-map', '[shots]', '-an', '-sn', '-dn', '-fps_mode', 'passthrough',
	'-f', 'null', '-',
]);
const OPTION_KEYS = new Set(['pair', 'workingDirectory', 'digestExecutable', 'environment', 'spawn', 'limits']);
const LIMIT_KEYS = new Set([
	'durationMs', 'stderrBytes', 'metadataBytes', 'terminationGraceMs', 'killWaitMs',
]);
const DEFAULT_LIMITS: ExternalFfmpegShotDetectorLimits = Object.freeze({
	durationMs: 5 * 60_000,
	stderrBytes: 64 * 1024 * 1024,
	metadataBytes: 384 * 1024 * 1024,
	terminationGraceMs: 500,
	killWaitMs: 500,
});
const MAXIMUM_LIMITS: ExternalFfmpegShotDetectorLimits = Object.freeze({
	durationMs: 15 * 60_000,
	stderrBytes: 128 * 1024 * 1024,
	metadataBytes: 512 * 1024 * 1024,
	terminationGraceMs: 5_000,
	killWaitMs: 5_000,
});

/** Create a detector bound to one admitted executable pair and one private staging directory. */
export function createExternalFfmpegShotDetector(
	options: ExternalFfmpegShotDetectorOptions,
): ExternalFfmpegShotDetector {
	validateFactoryOptions(options);
	const pair = Object.freeze({ ...options.pair });
	const workingDirectory = normalize(options.workingDirectory);
	const digestExecutable = options.digestExecutable;
	const launch = options.spawn ?? defaultSpawn;
	const environment = privateEnvironment(options.environment ?? process.env, workingDirectory);
	const limits = normalizeLimits(options.limits);
	let active = false;
	let verified = false;

	const assertIdentity = async (): Promise<void> => {
		let matches: boolean;
		try { matches = await externalFfmpegExecutablePairMatches(pair, digestExecutable); }
		catch {
			throw detectorError('executable-unavailable', 'The admitted FFmpeg/FFprobe pair is unavailable.');
		}
		if (!matches) throw detectorError('identity-changed', 'The admitted FFmpeg/FFprobe pair changed.');
	};
	const run = async (
		arguments_: readonly string[],
		signal: AbortSignal | undefined,
	): Promise<ExternalFfmpegShotDetectionResult> => await runShotProcess({
		executablePath: pair.executablePath, arguments_, workingDirectory,
		environment, limits, launch, signal,
	});

	return Object.freeze({
		async verify(request = {}): Promise<ExternalFfmpegShotDetectorVerification> {
			const signal = verificationSignal(request);
			if (active) throw detectorError('busy', 'External FFmpeg shot detection is already active.');
			throwIfAborted(signal);
			active = true;
			verified = false;
			try {
				await assertIdentity();
				const canary = await run(CANARY_ARGUMENTS, signal);
				assertCanary(canary);
				await assertIdentity();
				verified = true;
				return Object.freeze({
					schemaVersion: 1,
					detector: 'ffmpeg-scdet',
					executablePairClosureSha256: pair.executablePairClosureSha256,
					canary: Object.freeze({ sourceFrameCount: 4, boundarySourceFrame: 2 }),
				});
			} finally { active = false; }
		},
		async detect(request: ExternalFfmpegShotDetectionRequest): Promise<ExternalFfmpegShotDetectionResult> {
			const normalized = normalizeRequest(request, workingDirectory);
			if (!verified) throw detectorError('not-verified', 'External FFmpeg shot detection is not verified.');
			if (active) throw detectorError('busy', 'External FFmpeg shot detection is already active.');
			throwIfAborted(normalized.signal);
			active = true;
			try {
				await assertIdentity();
				const result = await run(detectionArguments(normalized.sourcePath), normalized.signal);
				await assertIdentity();
				return result;
			} catch (error) {
				if (error instanceof ExternalFfmpegShotDetectorError
					&& (error.reason === 'identity-changed' || error.reason === 'executable-unavailable')) {
					verified = false;
				}
				throw error;
			} finally { active = false; }
		},
	});
}

async function runShotProcess(options: Readonly<{
	readonly executablePath: string;
	readonly arguments_: readonly string[];
	readonly workingDirectory: string;
	readonly environment: Readonly<Record<string, string>>;
	readonly limits: ExternalFfmpegShotDetectorLimits;
	readonly launch: ExternalFfmpegShotSpawn;
	readonly signal: AbortSignal | undefined;
}>): Promise<ExternalFfmpegShotDetectionResult> {
	throwIfAborted(options.signal);
	const parser = createExternalFfmpegShotOutputParser({
		stderrBytes: options.limits.stderrBytes,
		metadataBytes: options.limits.metadataBytes,
	});
	let child: ExternalFfmpegShotChildProcess;
	try {
		child = options.launch(options.executablePath, options.arguments_, Object.freeze({
			cwd: options.workingDirectory,
			env: options.environment,
			shell: false,
			stdio: Object.freeze(['ignore', 'ignore', 'pipe', 'ignore', 'pipe'] as const),
			windowsHide: true,
			detached: shouldDetachProcessTree(),
		}));
	} catch { throw detectorError('spawn-failed', 'External FFmpeg shot detection could not start.'); }
	const metadata = readableAt(child, 4);
	return await new Promise((resolve, reject) => {
		let settled = false;
		let terminating: ExternalFfmpegShotDetectorError | null = null;
		let runtimeTimer: ReturnType<typeof setTimeout> | null = null;
		let graceTimer: ReturnType<typeof setTimeout> | null = null;
		let killTimer: ReturnType<typeof setTimeout> | null = null;
		const clear = (): void => {
			if (runtimeTimer !== null) { clearTimeout(runtimeTimer); runtimeTimer = null; }
			if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
			if (killTimer !== null) { clearTimeout(killTimer); killTimer = null; }
			options.signal?.removeEventListener('abort', onAbort);
		};
		const finish = (error?: unknown): void => {
			if (settled) return;
			settled = true;
			clear();
			if (error) reject(error); else {
				try { resolve(parser.finish()); }
				catch (parseError) { reject(outputError(parseError)); }
			}
		};
		const terminate = (error: ExternalFfmpegShotDetectorError): void => {
			if (settled || terminating !== null) return;
			terminating = error;
			if (runtimeTimer !== null) { clearTimeout(runtimeTimer); runtimeTimer = null; }
			void terminateProcessTree(child, 'SIGTERM', { environment: options.environment });
			graceTimer = setTimeout(() => {
				void terminateProcessTree(child, 'SIGKILL', { environment: options.environment });
				killTimer = setTimeout(() => finish(error), options.limits.killWaitMs);
				killTimer.unref?.();
			}, options.limits.terminationGraceMs);
			graceTimer.unref?.();
		};
		function onAbort(): void {
			terminate(detectorError('cancelled', 'External FFmpeg shot detection was cancelled.'));
		}
		const append = (kind: 'stderr' | 'metadata', chunk: unknown): void => {
			if (settled || terminating !== null) return;
			try {
				if (kind === 'stderr') parser.pushStderr(chunk); else parser.pushMetadata(chunk);
			} catch (error) { terminate(outputError(error)); }
		};
		child.stderr.on('data', (chunk) => { append('stderr', chunk); });
		metadata.on('data', (chunk) => { append('metadata', chunk); });
		child.once('error', () => {
			finish(terminating ?? detectorError('spawn-failed', 'External FFmpeg shot detection failed.'));
		});
		child.once('close', (exitCode, processSignal) => {
			if (terminating !== null) { finish(terminating); return; }
			if (processSignal !== null) {
				finish(detectorError('process-signalled', 'External FFmpeg shot detection was signalled.'));
				return;
			}
			if (!Number.isSafeInteger(exitCode) || exitCode !== 0) {
				finish(detectorError('process-failed', `External FFmpeg shot detection exited with code ${String(exitCode)}.`));
				return;
			}
			finish();
		});
		options.signal?.addEventListener('abort', onAbort, { once: true });
		if (options.signal?.aborted) onAbort();
		runtimeTimer = setTimeout(() => terminate(
			detectorError('timeout', 'External FFmpeg shot detection exceeded its runtime limit.'),
		), options.limits.durationMs);
		runtimeTimer.unref?.();
	});
}

function detectionArguments(sourcePath: string): readonly string[] {
	return Object.freeze([
		...GUARDED_PREFIX,
		'-noautorotate', '-i', sourcePath,
		'-map', '0:v:0', '-an', '-sn', '-dn', '-vf', SCENE_FILTER,
		'-fps_mode', 'passthrough', '-f', 'null', '-',
	]);
}

function assertCanary(result: ExternalFfmpegShotDetectionResult): void {
	const boundary = result.boundaries[0];
	if (result.sourceFrameCount !== 4 || result.boundaries.length !== 1
		|| boundary?.sourceFrame !== 2 || boundary.score < 0.1
		|| BigInt(boundary.presentationTick) !== BigInt(result.timescale) * 2n) {
		throw detectorError('canary-failed', 'External FFmpeg failed the functional scene-filter canary.');
	}
}

function normalizeRequest(
	value: ExternalFfmpegShotDetectionRequest,
	workingDirectory: string,
): ExternalFfmpegShotDetectionRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !exactKeys(value, value.signal === undefined ? ['sourcePath'] : ['signal', 'sourcePath'])
		|| typeof value.sourcePath !== 'string' || !isAbsolute(value.sourcePath)
		|| value.sourcePath.length > 4_096 || value.sourcePath.includes('\0')
		|| value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
		throw detectorError('request-rejected', 'The external FFmpeg shot request is invalid.');
	}
	const sourcePath = normalize(value.sourcePath);
	if (sourcePath === workingDirectory || dirname(sourcePath) !== workingDirectory) {
		throw detectorError('request-rejected', 'The external FFmpeg shot source is outside private staging.');
	}
	return Object.freeze({ sourcePath, ...(value.signal ? { signal: value.signal } : {}) });
}

function verificationSignal(value: Readonly<{ readonly signal?: AbortSignal }>): AbortSignal | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !exactKeys(value, value.signal === undefined ? [] : ['signal'])
		|| value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
		throw detectorError('request-rejected', 'The external FFmpeg shot verification request is invalid.');
	}
	return value.signal;
}

function normalizeLimits(value: Partial<ExternalFfmpegShotDetectorLimits> | undefined): ExternalFfmpegShotDetectorLimits {
	if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).some((key) => !LIMIT_KEYS.has(key)))) {
		throw new TypeError('External FFmpeg shot detector limits are invalid.');
	}
	const result = Object.fromEntries((Object.keys(DEFAULT_LIMITS) as Array<keyof ExternalFfmpegShotDetectorLimits>)
		.map((key) => [key, bounded(value?.[key] ?? DEFAULT_LIMITS[key], MAXIMUM_LIMITS[key], key)])) as unknown;
	return Object.freeze(result as ExternalFfmpegShotDetectorLimits);
}

function validateFactoryOptions(options: ExternalFfmpegShotDetectorOptions): void {
	if (!options || typeof options !== 'object' || Array.isArray(options)
		|| Object.keys(options).some((key) => !OPTION_KEYS.has(key))
		|| !isExternalFfmpegExecutablePairAdmission(options.pair)
		|| typeof options.workingDirectory !== 'string' || !isAbsolute(options.workingDirectory)
		|| options.workingDirectory.length > 4_096 || options.workingDirectory.includes('\0')
		|| typeof options.digestExecutable !== 'function'
		|| options.spawn !== undefined && typeof options.spawn !== 'function'
		|| options.environment !== undefined && (!options.environment
			|| typeof options.environment !== 'object' || Array.isArray(options.environment))) {
		throw new TypeError('External FFmpeg shot detector options are invalid.');
	}
	void normalizeLimits(options.limits);
}

function privateEnvironment(
	value: Readonly<Record<string, string | undefined>>,
	workingDirectory: string,
): Readonly<Record<string, string>> {
	return Object.freeze({
		AV_LOG_FORCE_NOCOLOR: '1', HOME: workingDirectory, LANG: 'C', LC_ALL: 'C', NO_COLOR: '1',
		...curatedExternalFfmpegVideoEnvironment(value),
		TEMP: workingDirectory, TMP: workingDirectory, TMPDIR: workingDirectory,
		USERPROFILE: workingDirectory,
	});
}

function readableAt(
	child: ExternalFfmpegShotChildProcess,
	index: number,
): Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }> {
	const stream = child.stdio[index] as Partial<{
		on(event: 'data', listener: (chunk: unknown) => void): unknown;
	}> | undefined;
	if (!stream || typeof stream.on !== 'function') {
		void terminateProcessTree(child, 'SIGKILL');
		throw detectorError('spawn-failed', 'External FFmpeg did not expose its bounded metadata pipe.');
	}
	return stream as Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }>;
}

function defaultSpawn(
	executablePath: string,
	arguments_: readonly string[],
	options: ExternalFfmpegShotLaunchOptions,
): ExternalFfmpegShotChildProcess {
	return nodeSpawn(executablePath, [...arguments_], {
		cwd: options.cwd, env: { ...options.env }, shell: false,
		stdio: [...options.stdio] as never, windowsHide: true, detached: options.detached,
	}) as unknown as ExternalFfmpegShotChildProcess;
}

function outputError(error: unknown): ExternalFfmpegShotDetectorError {
	if (error instanceof ExternalFfmpegShotDetectorError) return error;
	if (error instanceof ExternalFfmpegShotOutputError) {
		return detectorError(error.reason, error.message);
	}
	return detectorError('metadata-invalid', 'External FFmpeg emitted invalid shot metadata.');
}

function detectorError(
	reason: ExternalFfmpegShotDetectorErrorReason,
	message: string,
): ExternalFfmpegShotDetectorError {
	return new ExternalFfmpegShotDetectorError(reason, message);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw detectorError('cancelled', 'External FFmpeg shot detection was cancelled.');
}

function exactKeys(value: object, keys: readonly string[]): boolean {
	return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function bounded(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`External FFmpeg shot detector ${label} is invalid.`);
	}
	return Number(value);
}
