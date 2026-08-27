/* SPDX-License-Identifier: AGPL-3.0-only */

/** Admission-bound, shell-free RGBA sampling for the owned Index Video workflow. */

import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';

import { reviewOwnedFramePackPlanV1 } from
	'../src/common/editor/assistance/owned-video-highlight-validation-v1.ts';
import { classifyAssistanceVisualTagEmbeddingsV1 } from
	'../src/common/editor/assistance/visual-tag-classification-v1.ts';
import { createAssistanceVisualFramePackV2 } from
	'../src/common/editor/assistance/visual-frame-pack-v2.ts';
import {
	ASSISTANCE_VISUAL_FRAME_PACK_SET_MAXIMUM_PACKS,
} from '../src/common/editor/assistance/visual-frame-pack-set-v1.ts';
import type {
	AssistanceWorkflowOwnedFramePackMaterializationRequestV1,
	AssistanceWorkflowOwnedVisualTagsMaterializationRequestV1,
	AssistanceWorkflowOwnedVideoHighlightMaterializerV1,
} from './assistance-workflow-owned-video-highlight-stage-runtime.ts';
import {
	externalFfmpegExecutablePairMatches,
	isExternalFfmpegExecutablePairAdmission,
	type ExternalFfmpegExecutablePairAdmission,
} from './external-ffmpeg-executable-pair-admission.ts';
import type {
	ExternalFfmpegPreferenceService,
	ExternalFfmpegRuntimeAdmission,
} from './external-ffmpeg-preference-service.ts';
import { curatedExternalFfmpegVideoEnvironment } from './external-ffmpeg-video-process.ts';
import { shouldDetachProcessTree, terminateProcessTree } from './process-tree-termination.ts';
import { assistanceSourceMatchesIdentityV1 } from
	'./assistance-authenticated-source-snapshot.ts';

type Preferences = Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'>;

export interface AssistanceExternalFfmpegFrameDecodeRequestV1 {
	readonly executablePath: string;
	readonly sourcePath: string;
	readonly sourceFrames: readonly number[];
	readonly rasterWidth: number;
	readonly rasterHeight: number;
	readonly expectedByteLength: number;
	readonly signal: AbortSignal;
}

export interface AssistanceExternalFfmpegVideoMaterializerOptionsV1 {
	readonly preferences: Preferences;
	readonly digestExecutable?: (path: string) => Promise<string>;
	readonly decodeFrames?: (
		request: AssistanceExternalFfmpegFrameDecodeRequestV1,
	) => PromiseLike<Uint8Array | null> | Uint8Array | null;
}

interface DecodeChild {
	readonly pid?: number;
	readonly stdout: Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }>;
	readonly stderr: Readonly<{ on(event: 'data', listener: (chunk: unknown) => void): unknown }>;
	once(event: 'error', listener: (error: Error) => void): unknown;
	once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	kill(signal: NodeJS.Signals): boolean;
}

const REQUIRED_FILTERS = Object.freeze(['format', 'scale', 'select']);
const MAXIMUM_RASTER_DIMENSION = 512;
const MAXIMUM_FRAME_COUNT = 1_024;
const MAXIMUM_FILTER_BYTES = 32 * 1024;
const MAXIMUM_PACK_BYTES = 64 * 1024 * 1024;
const MAXIMUM_STDERR_BYTES = 8 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 5 * 60_000;
const TERMINATION_GRACE_MS = 500;
const KILL_WAIT_MS = 500;
const SHA256 = /^[a-f\d]{64}$/u;

export function createExternalFfmpegAssistanceVideoMaterializer(
	options: AssistanceExternalFfmpegVideoMaterializerOptionsV1,
): AssistanceWorkflowOwnedVideoHighlightMaterializerV1 {
	validateOptions(options);
	const digestExecutable = options.digestExecutable ?? sha256File;
	const decodeFrames = options.decodeFrames ?? runDecode;
	return Object.freeze({
		async materializeFramePack(request: AssistanceWorkflowOwnedFramePackMaterializationRequestV1) {
			request.signal.throwIfAborted();
			const plan = reviewOwnedFramePackPlanV1(request.plan);
			const admission = options.preferences.admission();
			const inspected = inspectAdmission(admission);
			if (inspected === null || plan.frames.length < 1) return null;
			const raster = rasterGeometry(plan.width, plan.height);
			const frameBytes = safeProduct(raster.width, raster.height, 4);
			const maximumFramesByBytes = Math.floor((MAXIMUM_PACK_BYTES - 128) / (frameBytes + 16));
			const framesPerPack = Math.min(MAXIMUM_FRAME_COUNT, maximumFramesByBytes);
			if (framesPerPack < 1) return null;
			const batches = frameBatches(plan.frames, framesPerPack);
			if (batches.length < 1 || batches.length > ASSISTANCE_VISUAL_FRAME_PACK_SET_MAXIMUM_PACKS) {
				return null;
			}
			const aggregateBytes = batches.reduce((total, frames) => total + 128
				+ safeProduct(frameBytes + 16, frames.length), 0);
			if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > 512 * 1024 * 1024) return null;
			const sourcePath = admittedSourcePath(request.source.path);
			const sourceIdentity = Object.freeze({ byteLength: request.source.claim.byteLength,
				sha256: request.source.claim.sha256 });
			const identity = await matchesIdentity(inspected.pair, digestExecutable);
			request.signal.throwIfAborted();
			if (!identity) {
				await options.preferences.invalidateAdmission(inspected.admission, 'identity-changed');
				return null;
			}
			if (!await assistanceSourceMatchesIdentityV1(sourcePath, sourceIdentity, request.signal)) {
				return null;
			}
			const packs: Array<readonly Uint8Array[]> = [];
			for (const frames of batches) {
				request.signal.throwIfAborted();
				const expectedByteLength = safeProduct(frameBytes, frames.length);
				let rgba: Uint8Array | null;
				try {
					rgba = await decodeFrames(Object.freeze({
						executablePath: inspected.pair.executablePath, sourcePath,
						sourceFrames: Object.freeze(frames.map(({ sourceFrame }) => sourceFrame)),
						rasterWidth: raster.width, rasterHeight: raster.height,
						expectedByteLength, signal: request.signal,
					}));
				} catch (error) {
					request.signal.throwIfAborted();
					if (error instanceof DecodeError && error.reason === 'spawn') {
						await options.preferences.invalidateAdmission(
							inspected.admission, 'executable-unavailable',
						);
					}
					return null;
				}
				request.signal.throwIfAborted();
				if (!(rgba instanceof Uint8Array) || rgba.byteLength !== expectedByteLength
					|| options.preferences.admission() !== inspected.admission
					|| !await assistanceSourceMatchesIdentityV1(
						sourcePath, sourceIdentity, request.signal,
					)) return null;
				packs.push(createAssistanceVisualFramePackV2({ sourceWidth: plan.width,
					sourceHeight: plan.height, rasterWidth: raster.width, rasterHeight: raster.height,
					timescale: plan.timescale, frames: frames.map((frame, index) => Object.freeze({
						sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick,
						rgba: rgba!.slice(index * frameBytes, (index + 1) * frameBytes),
					})) }));
			}
			if (!await matchesIdentity(inspected.pair, digestExecutable)) {
				await options.preferences.invalidateAdmission(inspected.admission, 'identity-changed');
				return null;
			}
			return Object.freeze(packs);
		},
		resolveVisualTags(request: AssistanceWorkflowOwnedVisualTagsMaterializationRequestV1) {
			request.signal.throwIfAborted();
			const plan = reviewOwnedFramePackPlanV1(request.plan);
			const classified = classifyAssistanceVisualTagEmbeddingsV1(
				request.matrix, plan.frames.length,
			);
			return Object.freeze({ matrix: classified.matrix,
				tags: Object.freeze(plan.frames.map(({ resultId }, index) => Object.freeze({ resultId,
					tags: classified.tags[index]! }))) });
		},
	});
}

function frameBatches(
	frames: AssistanceWorkflowOwnedFramePackMaterializationRequestV1['plan']['frames'],
	maximumFrames: number,
): readonly (typeof frames)[] {
	const result: Array<typeof frames> = [];
	for (let offset = 0; offset < frames.length; offset += maximumFrames) {
		const batch = Object.freeze(frames.slice(offset, offset + maximumFrames));
		const expression = batch.map(({ sourceFrame }) =>
			`eq(n\\,${String(sourceFrame)})`).join('+');
		if (Buffer.byteLength(expression) > MAXIMUM_FILTER_BYTES) return Object.freeze([]);
		result.push(batch);
	}
	return Object.freeze(result);
}

function inspectAdmission(admission: ExternalFfmpegRuntimeAdmission | null): Readonly<{
	admission: ExternalFfmpegRuntimeAdmission;
	pair: ExternalFfmpegExecutablePairAdmission;
}> | null {
	if (admission === null || admission.version !== admission.identity?.version
		|| !SHA256.test(admission.capabilityGeneration)
		|| !hasCapabilities(admission.capabilities)) return null;
	const pair = Object.freeze({ executablePath: admission.executablePath,
		ffmpegSha256: admission.identity.ffmpegSha256,
		ffprobePath: admission.identity.ffprobePath,
		ffprobeSha256: admission.identity.ffprobeSha256,
		executablePairClosureSha256: admission.identity.executablePairClosureSha256 });
	return isExternalFfmpegExecutablePairAdmission(pair)
		? Object.freeze({ admission, pair }) : null;
}

function hasCapabilities(value: ExternalFfmpegRuntimeAdmission['capabilities']): boolean {
	return Array.isArray(value?.muxers) && value.muxers.includes('rawvideo')
		&& Array.isArray(value.filters)
		&& REQUIRED_FILTERS.every((filter) => value.filters.includes(filter));
}

async function matchesIdentity(
	pair: ExternalFfmpegExecutablePairAdmission,
	digestExecutable: (path: string) => Promise<string>,
): Promise<boolean> {
	try { return await externalFfmpegExecutablePairMatches(pair, digestExecutable); }
	catch { return false; }
}

function rasterGeometry(width: number, height: number): Readonly<{ width: number; height: number }> {
	const scale = Math.min(1, MAXIMUM_RASTER_DIMENSION / Math.max(width, height));
	return Object.freeze({ width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale)) });
}

function admittedSourcePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4_096
		|| value.includes('\0')) throw new TypeError('Frame sampling requires one staged absolute source path.');
	const result = normalize(value);
	if (result === dirname(result)) throw new TypeError('Frame sampling requires one staged source file.');
	return result;
}

async function runDecode(request: AssistanceExternalFfmpegFrameDecodeRequestV1): Promise<Uint8Array> {
	const expression = request.sourceFrames.map((sourceFrame) => `eq(n\\,${String(sourceFrame)})`).join('+');
	if (expression.length < 1 || Buffer.byteLength(expression) > MAXIMUM_FILTER_BYTES) {
		throw new DecodeError('output', 'The exact frame-selection expression exceeds its bound.');
	}
	const filter = `select=${expression},scale=${String(request.rasterWidth)}:${
		String(request.rasterHeight)}:flags=bilinear,format=rgba`;
	const arguments_ = Object.freeze([
		'-nostdin', '-hide_banner', '-nostats', '-loglevel', 'error', '-xerror',
		'-protocol_whitelist', 'file,pipe,crypto,data', '-threads', '1', '-filter_threads', '1',
		'-i', request.sourcePath, '-map', '0:v:0', '-vf', filter, '-an', '-sn', '-dn',
		'-fps_mode', 'passthrough', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
	]);
	let child: DecodeChild;
	try {
		child = nodeSpawn(request.executablePath, arguments_, {
			cwd: dirname(request.sourcePath), shell: false, windowsHide: true,
			detached: shouldDetachProcessTree(), stdio: ['ignore', 'pipe', 'pipe'],
			env: privateEnvironment(dirname(request.sourcePath)),
		}) as unknown as DecodeChild;
	} catch { throw new DecodeError('spawn', 'External FFmpeg frame sampling could not start.'); }
	return await collectDecode(child, request);
}

async function collectDecode(
	child: DecodeChild,
	request: AssistanceExternalFfmpegFrameDecodeRequestV1,
): Promise<Uint8Array> {
	return await new Promise((resolve, reject) => {
		let settled = false;
		let terminating: unknown = null;
		let outputBytes = 0;
		let stderrBytes = 0;
		const chunks: Uint8Array[] = [];
		const finish = (error?: unknown): void => {
			if (settled) return;
			settled = true; clearTimeout(timeout); clearTimeout(grace); clearTimeout(killWait);
			request.signal.removeEventListener('abort', onAbort);
			if (error) reject(error); else {
				const output = new Uint8Array(outputBytes); let offset = 0;
				for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
				resolve(output);
			}
		};
		const terminate = (error: unknown): void => {
			if (settled || terminating !== null) return;
			terminating = error;
			void terminateProcessTree(child, 'SIGTERM', {
				environment: curatedExternalFfmpegVideoEnvironment(process.env),
			});
			grace = setTimeout(() => {
				void terminateProcessTree(child, 'SIGKILL', {
					environment: curatedExternalFfmpegVideoEnvironment(process.env),
				});
				killWait = setTimeout(() => finish(error), KILL_WAIT_MS); killWait.unref?.();
			}, TERMINATION_GRACE_MS); grace.unref?.();
		};
		function onAbort(): void { terminate(request.signal.reason
			?? new DOMException('Frame sampling was cancelled.', 'AbortError')); }
		child.stdout.on('data', (value) => {
			if (terminating !== null) return;
			try {
				const chunk = bytes(value); outputBytes += chunk.byteLength;
				if (outputBytes > request.expectedByteLength) {
					terminate(new DecodeError('output',
						'External FFmpeg exceeded exact RGBA output authority.'));
				} else chunks.push(chunk.slice());
			} catch (error) { terminate(error); }
		});
		child.stderr.on('data', (value) => {
			try {
				stderrBytes += bytes(value).byteLength;
				if (stderrBytes > MAXIMUM_STDERR_BYTES) {
					terminate(new DecodeError('process',
						'External FFmpeg exceeded its diagnostic bound.'));
				}
			} catch (error) { terminate(error); }
		});
		child.once('error', () => finish(terminating
			?? new DecodeError('spawn', 'External FFmpeg frame sampling failed.')));
		child.once('close', (code, signal) => {
			if (terminating !== null) { finish(terminating); return; }
			if (code !== 0 || signal !== null || outputBytes !== request.expectedByteLength) {
				finish(new DecodeError('process', 'External FFmpeg returned incomplete RGBA frames.'));
			} else finish();
		});
		request.signal.addEventListener('abort', onAbort, { once: true });
		let grace: ReturnType<typeof setTimeout> | undefined;
		let killWait: ReturnType<typeof setTimeout> | undefined;
		const timeout = setTimeout(() => terminate(new DecodeError('process',
			'External FFmpeg frame sampling timed out.')), PROCESS_TIMEOUT_MS);
		timeout.unref?.();
		if (request.signal.aborted) onAbort();
	});
}

function privateEnvironment(directory: string): Readonly<Record<string, string>> {
	return { ...curatedExternalFfmpegVideoEnvironment(process.env), AV_LOG_FORCE_NOCOLOR: '1',
		HOME: directory, LANG: 'C', LC_ALL: 'C', NO_COLOR: '1', TEMP: directory,
		TMP: directory, TMPDIR: directory, USERPROFILE: directory };
}

function bytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	throw new DecodeError('process', 'External FFmpeg returned a malformed byte stream.');
}

async function sha256File(path: string): Promise<string> {
	const handle = await open(path, 'r');
	const hash = createHash('sha256');
	try {
		const buffer = new Uint8Array(1024 * 1024); let position = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
		}
		return hash.digest('hex');
	} finally { await handle.close(); }
}

function safeProduct(...values: number[]): number {
	const result = values.reduce((product, value) => product * value, 1);
	if (!Number.isSafeInteger(result) || result < 1) throw new RangeError('RGBA geometry overflowed.');
	return result;
}

function validateOptions(value: AssistanceExternalFfmpegVideoMaterializerOptionsV1): void {
	if (!value?.preferences || typeof value.preferences.admission !== 'function'
		|| typeof value.preferences.invalidateAdmission !== 'function'
		|| value.digestExecutable !== undefined && typeof value.digestExecutable !== 'function'
		|| value.decodeFrames !== undefined && typeof value.decodeFrames !== 'function') {
		throw new TypeError('External FFmpeg assistance materializer options are invalid.');
	}
}

class DecodeError extends Error {
	constructor(readonly reason: 'spawn' | 'process' | 'output', message: string) { super(message); }
}
