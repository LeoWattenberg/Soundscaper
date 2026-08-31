/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded execution verification for the exact external video command grammar. */

import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { assertFiniteVideoKeyframeContainer } from '../src/common/editor/video-keyframe-video-container.js';
import {
	createDesktopExternalFfmpegVideoCapabilities,
	createDesktopExternalFfmpegVideoWorkload,
	type DesktopExternalFfmpegVideoCapabilities,
	type DesktopVideoCodecFormat,
	type DesktopVideoCodecOperationPlan,
} from './desktop-video-codec-operation-contract.js';
import {
	externalFfmpegExecutablePairMatches,
	isExternalFfmpegExecutablePairAdmission,
	type ExternalFfmpegExecutablePairAdmission,
} from './external-ffmpeg-executable-pair-admission.js';
import type { ExternalFfmpegRuntimeAdmission } from './external-ffmpeg-preference-service.js';
import {
	inspectExternalFfmpegVideoCanaryOutput,
	type ExternalFfmpegVideoCanaryInspector,
} from './external-ffmpeg-video-canary-inspection.js';
import {
	closeExternalFfmpegVideoInput,
	curatedExternalFfmpegVideoEnvironment,
	guardExternalFfmpegVideoArguments,
	launchExternalFfmpegVideoProcess,
	writeExternalFfmpegVideoInput,
	type ExternalFfmpegVideoSpawn,
} from './external-ffmpeg-video-process.js';

export interface ExternalFfmpegVideoVerificationOptions {
	readonly scratchRoot: string;
	readonly admission: ExternalFfmpegRuntimeAdmission;
	readonly digestExecutable: (path: string) => Promise<string>;
	readonly spawn?: ExternalFfmpegVideoSpawn;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly maximumDurationMs?: number;
	readonly maximumLogBytes?: number;
	readonly terminationGraceMs?: number;
	readonly killWaitMs?: number;
	readonly signal?: AbortSignal;
	readonly inspectOutput?: ExternalFfmpegVideoCanaryInspector;
}

const FORMATS = Object.freeze(['mp4', 'webm'] as const);
const OUTPUT_LIMIT = 256 * 1024;
const VIDEO_BYTES = new Uint8Array(16 * 16 * 4);
const AUDIO_BYTES = float32SilenceWav();

export class ExternalFfmpegVideoVerificationIdentityError extends Error {
	constructor(readonly reason: 'executable-unavailable' | 'identity-changed') {
		super(reason === 'identity-changed'
			? 'The external FFmpeg executable identity changed during video verification.'
			: 'The external FFmpeg executable pair is unavailable for video verification.');
		this.name = 'ExternalFfmpegVideoVerificationIdentityError';
	}
}

/** Execute one tiny A/V delivery for every token-eligible format. */
export async function verifyExternalFfmpegVideoAdmission(
	options: ExternalFfmpegVideoVerificationOptions,
): Promise<DesktopExternalFfmpegVideoCapabilities> {
	validateOptions(options);
	throwIfAborted(options.signal);
	const tokenCapabilities = createDesktopExternalFfmpegVideoCapabilities(options.admission);
	const pair = executablePair(options.admission);
	const inspectOutput = options.inspectOutput ?? inspectExternalFfmpegVideoCanaryOutput;
	await assertIdentity(pair, options.digestExecutable);
	const formats: Record<DesktopVideoCodecFormat, DesktopExternalFfmpegVideoCapabilities['formats']['mp4']> = {
		mp4: tokenCapabilities.formats.mp4,
		webm: tokenCapabilities.formats.webm,
	};
	for (const format of FORMATS) {
		throwIfAborted(options.signal);
		if (!formats[format].available) continue;
		try { await verifyFormat(format, pair, options, inspectOutput); }
		catch (error) {
			if (error instanceof ExternalFfmpegVideoVerificationIdentityError) throw error;
			throwIfAborted(options.signal);
			formats[format] = Object.freeze({
				available: false, provider: null,
				reason: `The configured FFmpeg failed exact ${format === 'mp4' ? 'H264/AAC MP4' : 'VP9/Opus WebM'} execution verification. Manage or rescan it in Edit > Preferences > General.`,
			});
		}
		await assertIdentity(pair, options.digestExecutable);
	}
	throwIfAborted(options.signal);
	return Object.freeze({ schemaVersion: 1, formats: Object.freeze(formats) });
}

async function verifyFormat(
	format: DesktopVideoCodecFormat,
	pair: ExternalFfmpegExecutablePairAdmission,
	options: ExternalFfmpegVideoVerificationOptions,
	inspectOutput: ExternalFfmpegVideoCanaryInspector,
): Promise<void> {
	await mkdir(options.scratchRoot, { recursive: true, mode: 0o700 });
	const scratchDirectory = await mkdtemp(join(options.scratchRoot, `video-${format}-verification-`));
	const controller = new AbortController();
	const onAbort = (): void => controller.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		await chmod(scratchDirectory, 0o700);
		throwIfAborted(options.signal);
		const outputPath = join(scratchDirectory, `canary.${format}`);
		const plan = canaryPlan(format);
		const execution = createDesktopExternalFfmpegVideoWorkload(plan, { outputPath });
		const process = launchExternalFfmpegVideoProcess({
			executablePath: pair.executablePath,
			arguments: guardExternalFfmpegVideoArguments(execution.ffmpegArguments, OUTPUT_LIMIT),
			scratchDirectory,
			hasAudio: true,
			signal: controller.signal,
			environment: curatedExternalFfmpegVideoEnvironment(options.environment ?? processEnvironment()),
			limits: Object.freeze({
				duration: bounded(options.maximumDurationMs, 15_000, 30_000, 'duration'),
				log: bounded(options.maximumLogBytes, 64 * 1024, 256 * 1024, 'log'),
				terminationGrace: bounded(options.terminationGraceMs, 500, 2_000, 'termination grace'),
				killWait: bounded(options.killWaitMs, 500, 2_000, 'kill wait'),
			}),
			...(options.spawn ? { spawn: options.spawn } : {}),
			error: verificationError,
		});
		try {
			await Promise.all([
				writeAndClose(process.videoInput, VIDEO_BYTES, controller.signal),
				writeAndClose(process.audioInput!, AUDIO_BYTES, controller.signal),
				process.completion,
			]);
		} catch (error) {
			controller.abort(error);
			await process.completion.catch(() => undefined);
			throw error;
		}
		const metadata = await stat(outputPath);
		if (!metadata.isFile() || metadata.size < 1 || metadata.size > OUTPUT_LIMIT) {
			throw verificationError('output-limit', 'External FFmpeg produced an invalid canary output.');
		}
		const bytes = await readFile(outputPath);
		if (bytes.byteLength !== metadata.size) {
			throw verificationError('output-drift', 'External FFmpeg canary output changed during validation.');
		}
		assertFiniteVideoKeyframeContainer(bytes, format);
		throwIfAborted(options.signal);
		await inspectOutput(Object.freeze({
			format,
			ffprobePath: pair.ffprobePath,
			outputPath,
			workingDirectory: scratchDirectory,
			environment: options.environment ?? processEnvironment(),
			signal: controller.signal,
			...(options.terminationGraceMs === undefined
				? {} : { terminationGraceMs: options.terminationGraceMs }),
			...(options.killWaitMs === undefined ? {} : { killWaitMs: options.killWaitMs }),
		}));
		throwIfAborted(options.signal);
	} finally {
		options.signal?.removeEventListener('abort', onAbort);
		await rm(scratchDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
	}
}

async function writeAndClose(
	stream: import('node:stream').Writable,
	bytes: Uint8Array,
	signal: AbortSignal,
): Promise<void> {
	await writeExternalFfmpegVideoInput(stream, bytes, signal);
	await closeExternalFfmpegVideoInput(stream, signal);
}

function canaryPlan(format: DesktopVideoCodecFormat): DesktopVideoCodecOperationPlan {
	return Object.freeze({
		schemaVersion: 1, format, quality: 'balanced', width: 16, height: 16,
		frameRate: Object.freeze({ num: 1, den: 1 }), frameCount: 1,
		sampleRate: 48_000, durationFrames: 48_000,
		videoInputBytes: VIDEO_BYTES.byteLength, audioInputBytes: AUDIO_BYTES.byteLength,
		ringCapacityBytes: 4_096, audioRingCapacityBytes: 4_096,
		maximumOutputBytes: OUTPUT_LIMIT,
	});
}

function executablePair(admission: ExternalFfmpegRuntimeAdmission): ExternalFfmpegExecutablePairAdmission {
	const pair = Object.freeze({
		executablePath: admission.executablePath,
		ffmpegSha256: admission.identity.ffmpegSha256,
		ffprobePath: admission.identity.ffprobePath,
		ffprobeSha256: admission.identity.ffprobeSha256,
		executablePairClosureSha256: admission.identity.executablePairClosureSha256,
	});
	if (!isExternalFfmpegExecutablePairAdmission(pair)) {
		throw new ExternalFfmpegVideoVerificationIdentityError('executable-unavailable');
	}
	return pair;
}

async function assertIdentity(
	pair: ExternalFfmpegExecutablePairAdmission,
	digest: (path: string) => Promise<string>,
): Promise<void> {
	let matches: boolean;
	try { matches = await externalFfmpegExecutablePairMatches(pair, digest); }
	catch { throw new ExternalFfmpegVideoVerificationIdentityError('executable-unavailable'); }
	if (!matches) throw new ExternalFfmpegVideoVerificationIdentityError('identity-changed');
}

function float32SilenceWav(): Uint8Array {
	const bytes = new Uint8Array(52);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, 'RIFF'); view.setUint32(4, 44, true); writeAscii(bytes, 8, 'WAVE');
	writeAscii(bytes, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 3, true);
	view.setUint16(22, 2, true); view.setUint32(24, 48_000, true); view.setUint32(28, 384_000, true);
	view.setUint16(32, 8, true); view.setUint16(34, 32, true);
	writeAscii(bytes, 36, 'data'); view.setUint32(40, 8, true);
	view.setFloat32(44, 0, true); view.setFloat32(48, 0, true);
	return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function bounded(value: number | undefined, fallback: number, maximum: number, label: string): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
		throw new RangeError(`External FFmpeg video verification ${label} is invalid.`);
	}
	return result;
}

function verificationError(reason: string, message: string): Error {
	return Object.assign(new Error(message), { name: 'ExternalFfmpegVideoVerificationError', reason });
}

function processEnvironment(): Readonly<Record<string, string | undefined>> {
	return process.env;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Video verification was aborted.', 'AbortError');
}

function validateOptions(options: ExternalFfmpegVideoVerificationOptions): void {
	if (!options || typeof options !== 'object' || typeof options.scratchRoot !== 'string'
		|| !isAbsolute(options.scratchRoot) || options.scratchRoot.length > 4_096
		|| options.scratchRoot.includes('\0') || !options.admission
		|| typeof options.digestExecutable !== 'function'
		|| options.spawn !== undefined && typeof options.spawn !== 'function'
		|| options.inspectOutput !== undefined && typeof options.inspectOutput !== 'function'
		|| options.signal !== undefined && !(options.signal instanceof AbortSignal)
		|| options.environment !== undefined && (!options.environment
			|| typeof options.environment !== 'object')) {
		throw new TypeError('External FFmpeg video verification options are invalid.');
	}
}
