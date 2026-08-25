/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact ffprobe track attestation for a completed external-video canary. */

import { spawn as nodeSpawn } from 'node:child_process';
import { dirname, isAbsolute, normalize } from 'node:path';

import type { DesktopVideoCodecFormat } from './desktop-video-codec-operation-contract.js';
import type {
	ExternalFfmpegProcessRequest,
	ExternalFfmpegProcessResult,
	ExternalFfmpegProcessRunner,
} from './external-ffmpeg-probe.js';
import {
	curatedExternalFfmpegVideoEnvironment,
	type ExternalFfmpegVideoChildProcess,
	type ExternalFfmpegVideoLaunchOptions,
	type ExternalFfmpegVideoSpawn,
} from './external-ffmpeg-video-process.js';
import { shouldDetachProcessTree, terminateProcessTree } from './process-tree-termination.js';

export interface ExternalFfmpegVideoCanaryInspectionRequest {
	readonly format: DesktopVideoCodecFormat;
	readonly ffprobePath: string;
	readonly outputPath: string;
	readonly workingDirectory: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly runner?: ExternalFfmpegProcessRunner;
	readonly signal?: AbortSignal;
	readonly spawn?: ExternalFfmpegVideoSpawn;
	readonly terminationGraceMs?: number;
	readonly killWaitMs?: number;
}

export type ExternalFfmpegVideoCanaryInspector = (
	request: ExternalFfmpegVideoCanaryInspectionRequest,
) => Promise<void>;

const INSPECTION_TIMEOUT_MS = 5_000;
const INSPECTION_OUTPUT_LIMIT_BYTES = 64 * 1024;
const EXPECTED_CODECS: Readonly<Record<DesktopVideoCodecFormat, Readonly<{
	readonly video: string;
	readonly audio: string;
}>>> = Object.freeze({
	mp4: Object.freeze({ video: 'h264', audio: 'aac' }),
	webm: Object.freeze({ video: 'vp9', audio: 'opus' }),
});

/** Require the exact delivery tracks produced by the admitted FFmpeg pair. */
export async function inspectExternalFfmpegVideoCanaryOutput(
	options: ExternalFfmpegVideoCanaryInspectionRequest,
): Promise<void> {
	validateOptions(options);
	const runner = options.runner ?? createCanaryProbeRunner(options);
	const request: ExternalFfmpegProcessRequest = Object.freeze({
		executablePath: options.ffprobePath,
		arguments: Object.freeze([
			'-v', 'error',
			'-protocol_whitelist', 'file',
			'-show_entries',
			'stream=index,codec_type,codec_name,width,height,pix_fmt,sample_rate,channels',
			'-of', 'json',
			'-i', options.outputPath,
		]),
		shell: false,
		standardInput: 'ignore',
		maximumDurationMs: INSPECTION_TIMEOUT_MS,
		maximumOutputBytes: INSPECTION_OUTPUT_LIMIT_BYTES,
	});
	let result: ExternalFfmpegProcessResult;
	try { result = await runner.run(request); }
	catch { throw inspectionError('External FFprobe canary inspection failed.'); }
	const output = successfulOutput(result);
	const streams = parseStreams(output);
	assertExactCodecTuple(streams, options.format);
}

function createCanaryProbeRunner(
	options: ExternalFfmpegVideoCanaryInspectionRequest,
): ExternalFfmpegProcessRunner {
	const environment = privateEnvironment(
		options.environment ?? process.env,
		options.workingDirectory,
	);
	const signal = options.signal ?? new AbortController().signal;
	const launch = options.spawn ?? defaultSpawn;
	const terminationGraceMs = boundedWait(options.terminationGraceMs, 500);
	const killWaitMs = boundedWait(options.killWaitMs, 500);
	return Object.freeze({
		run: async (request: ExternalFfmpegProcessRequest): Promise<ExternalFfmpegProcessResult> => await runProbe({
			request, workingDirectory: options.workingDirectory,
			environment, signal, launch, terminationGraceMs, killWaitMs,
		}),
	});
}

async function runProbe(options: Readonly<{
	readonly request: ExternalFfmpegProcessRequest;
	readonly workingDirectory: string;
	readonly environment: Readonly<Record<string, string>>;
	readonly signal: AbortSignal;
	readonly launch: ExternalFfmpegVideoSpawn;
	readonly terminationGraceMs: number;
	readonly killWaitMs: number;
}>): Promise<ExternalFfmpegProcessResult> {
	if (options.signal.aborted) return unavailable('launch-failed');
	let child: ExternalFfmpegVideoChildProcess;
	try {
		child = options.launch(options.request.executablePath, options.request.arguments, Object.freeze({
			cwd: options.workingDirectory, env: options.environment, shell: false,
			stdio: Object.freeze(['ignore', 'pipe', 'pipe']), windowsHide: true,
			detached: shouldDetachProcessTree(),
		}) satisfies ExternalFfmpegVideoLaunchOptions);
	} catch (error) { return launchFailure(error); }
	return await new Promise((resolve) => {
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let settled = false;
		let terminating: 'timeout' | 'output-limit' | 'launch-failed' | null = null;
		let runtimeTimer: ReturnType<typeof setTimeout> | null = null;
		let graceTimer: ReturnType<typeof setTimeout> | null = null;
		let killTimer: ReturnType<typeof setTimeout> | null = null;
		const cleanUp = (): void => {
			if (runtimeTimer !== null) clearTimeout(runtimeTimer);
			if (graceTimer !== null) clearTimeout(graceTimer);
			if (killTimer !== null) clearTimeout(killTimer);
			options.signal.removeEventListener('abort', onAbort);
		};
		const finish = (result: ExternalFfmpegProcessResult): void => {
			if (settled) return;
			settled = true;
			cleanUp();
			resolve(Object.freeze(result));
		};
		const finishTermination = (): void => {
			if (terminating !== null) finish(unavailable(terminating));
		};
		const terminate = (reason: 'timeout' | 'output-limit' | 'launch-failed'): void => {
			if (settled || terminating !== null) return;
			terminating = reason;
			if (runtimeTimer !== null) clearTimeout(runtimeTimer);
			void terminateProcessTree(child, 'SIGTERM', { environment: options.environment });
			graceTimer = setTimeout(() => {
				void terminateProcessTree(child, 'SIGKILL', { environment: options.environment });
				killTimer = setTimeout(finishTermination, options.killWaitMs);
				killTimer.unref?.();
			}, options.terminationGraceMs);
			graceTimer.unref?.();
		};
		function onAbort(): void { terminate('launch-failed'); }
		const append = (destination: Buffer[], chunk: unknown): void => {
			if (settled || terminating !== null) return;
			const bytes = chunkBytes(chunk);
			const remaining = options.request.maximumOutputBytes - outputBytes;
			if (remaining > 0) {
				const admitted = Math.min(remaining, bytes.byteLength);
				destination.push(Buffer.from(bytes.subarray(0, admitted)));
				outputBytes += admitted;
			}
			if (bytes.byteLength > remaining) terminate('output-limit');
		};
		child.stdout.on('data', (chunk) => { append(stdout, chunk); });
		child.stderr.on('data', (chunk) => { append(stderr, chunk); });
		child.once('error', (error) => {
			if (terminating !== null) finishTermination(); else finish(launchFailure(error));
		});
		child.once('close', (exitCode, processSignal) => {
			if (terminating !== null) { finishTermination(); return; }
			if (processSignal !== null || !Number.isSafeInteger(exitCode) || exitCode === null || exitCode < 0) {
				finish(unavailable('launch-failed'));
				return;
			}
			finish(Object.freeze({
				status: 'exited', exitCode,
				stdout: Buffer.concat(stdout).toString('utf8'),
				stderr: Buffer.concat(stderr).toString('utf8'),
			}));
		});
		options.signal.addEventListener('abort', onAbort, { once: true });
		if (options.signal.aborted) onAbort();
		runtimeTimer = setTimeout(() => terminate('timeout'), options.request.maximumDurationMs);
		runtimeTimer.unref?.();
	});
}

function successfulOutput(result: ExternalFfmpegProcessResult): string {
	if (!result || typeof result !== 'object' || result.status === 'unavailable') {
		throw inspectionError('External FFprobe canary inspection failed or was unavailable.');
	}
	if (result.status !== 'exited' || !Number.isSafeInteger(result.exitCode)
		|| result.exitCode < 0 || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
		throw inspectionError('External FFprobe returned malformed command evidence.');
	}
	if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)
		> INSPECTION_OUTPUT_LIMIT_BYTES) {
		throw inspectionError('External FFprobe exceeded its bounded output limit.');
	}
	if (result.exitCode !== 0) {
		throw inspectionError(`External FFprobe canary command exited with code ${String(result.exitCode)}.`);
	}
	return result.stdout;
}

interface InspectedStream {
	readonly index: number;
	readonly codecType: string;
	readonly codecName: string;
	readonly width: number | null;
	readonly height: number | null;
	readonly pixelFormat: string | null;
	readonly sampleRate: number | null;
	readonly channels: number | null;
}

function parseStreams(output: string): readonly InspectedStream[] {
	let parsed: unknown;
	try { parsed = JSON.parse(output) as unknown; }
	catch { throw inspectionError('External FFprobe returned malformed JSON.'); }
	const streamsValue = dataProperty(parsed, 'streams', 'FFprobe result');
	if (!Array.isArray(streamsValue)) {
		throw inspectionError('External FFprobe result has no stream array.');
	}
	const indices = new Set<number>();
	return streamsValue.map((value, position) => {
		const label = `FFprobe stream ${String(position)}`;
		const index = dataProperty(value, 'index', label);
		const codecType = dataProperty(value, 'codec_type', label);
		const codecName = dataProperty(value, 'codec_name', label);
		if (!Number.isSafeInteger(index) || (index as number) < 0
			|| typeof codecType !== 'string' || !/^[a-z0-9_]{1,64}$/u.test(codecType)
			|| typeof codecName !== 'string' || !/^[a-z0-9_]{1,64}$/u.test(codecName)) {
			throw inspectionError(`${label} is malformed.`);
		}
		if (indices.has(index as number)) throw inspectionError('External FFprobe returned duplicate stream indices.');
		indices.add(index as number);
		let width: number | null = null;
		let height: number | null = null;
		let pixelFormat: string | null = null;
		let sampleRate: number | null = null;
		let channels: number | null = null;
		if (codecType === 'video') {
			width = positiveInteger(dataProperty(value, 'width', label), `${label} width`);
			height = positiveInteger(dataProperty(value, 'height', label), `${label} height`);
			pixelFormat = token(dataProperty(value, 'pix_fmt', label), `${label} pixel format`);
		} else if (codecType === 'audio') {
			const rate = dataProperty(value, 'sample_rate', label);
			if (typeof rate !== 'string' || !/^[1-9][0-9]{0,8}$/u.test(rate)) {
				throw inspectionError(`${label} sample rate is malformed.`);
			}
			sampleRate = Number(rate);
			channels = positiveInteger(dataProperty(value, 'channels', label), `${label} channels`);
		}
		return Object.freeze({
			index: index as number, codecType, codecName,
			width, height, pixelFormat, sampleRate, channels,
		});
	});
}

function assertExactCodecTuple(
	streams: readonly InspectedStream[],
	format: DesktopVideoCodecFormat,
): void {
	if (streams.length !== 2) {
		throw inspectionError('External FFprobe does not contain exactly two canary streams.');
	}
	const expected = EXPECTED_CODECS[format];
	const video = streams.filter((stream) => stream.codecType === 'video');
	const audio = streams.filter((stream) => stream.codecType === 'audio');
	const indices = streams.map((stream) => stream.index).sort((left, right) => left - right);
	if (indices[0] !== 0 || indices[1] !== 1
		|| video.length !== 1 || audio.length !== 1
		|| video[0]?.codecName !== expected.video
		|| video[0]?.width !== 16 || video[0]?.height !== 16 || video[0]?.pixelFormat !== 'yuv420p'
		|| audio[0]?.codecName !== expected.audio
		|| audio[0]?.sampleRate !== 48_000 || audio[0]?.channels !== 2) {
		throw inspectionError('External FFprobe reported the wrong exact codec tuple.');
	}
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1) {
		throw inspectionError(`${label} is malformed.`);
	}
	return value as number;
}

function token(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-z0-9_]{1,64}$/u.test(value)) {
		throw inspectionError(`${label} is malformed.`);
	}
	return value;
}

function dataProperty(value: unknown, name: string, label: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw inspectionError(`${label} is malformed.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, name);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw inspectionError(`${label} is missing ${name}.`);
	}
	return descriptor.value;
}

function validateOptions(options: ExternalFfmpegVideoCanaryInspectionRequest): void {
	if (!options || typeof options !== 'object'
		|| options.format !== 'mp4' && options.format !== 'webm'
		|| !validAbsolutePath(options.ffprobePath)
		|| !validAbsolutePath(options.outputPath)
		|| !validAbsolutePath(options.workingDirectory)
		|| dirname(normalize(options.outputPath)) !== normalize(options.workingDirectory)
		|| options.runner !== undefined && (!options.runner || typeof options.runner.run !== 'function')
		|| options.signal !== undefined && !(options.signal instanceof AbortSignal)
		|| options.spawn !== undefined && typeof options.spawn !== 'function'
		|| options.environment !== undefined && (!options.environment
			|| typeof options.environment !== 'object' || Array.isArray(options.environment))
		|| options.terminationGraceMs !== undefined && !validWait(options.terminationGraceMs)
		|| options.killWaitMs !== undefined && !validWait(options.killWaitMs)) {
		throw new TypeError('External FFprobe canary inspection requires a private working directory and output path.');
	}
}

function validAbsolutePath(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 4_096
		&& !value.includes('\0') && isAbsolute(value);
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

function boundedWait(value: number | undefined, fallback: number): number {
	return value === undefined ? fallback : value;
}

function validWait(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_000;
}

function chunkBytes(chunk: unknown): Buffer {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.from(String(chunk));
}

function unavailable(
	reason: 'timeout' | 'output-limit' | 'launch-failed',
): ExternalFfmpegProcessResult {
	return Object.freeze({ status: 'unavailable', reason });
}

function launchFailure(error: unknown): ExternalFfmpegProcessResult {
	const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
	if (code === 'ENOENT') return Object.freeze({ status: 'unavailable', reason: 'not-found' });
	if (code === 'EACCES' || code === 'EPERM') {
		return Object.freeze({ status: 'unavailable', reason: 'not-executable' });
	}
	return unavailable('launch-failed');
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

function inspectionError(message: string): Error {
	return Object.assign(new Error(message), { name: 'ExternalFfmpegVideoCanaryInspectionError' });
}
