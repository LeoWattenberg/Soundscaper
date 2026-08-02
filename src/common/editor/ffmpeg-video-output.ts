/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	abortFfmpegOutputSink,
	assertFfmpegOutputReady,
	cleanupFfmpegOutputRuntime,
	streamFfmpegOutputFile,
	type FfmpegOutputFileSource,
	type FfmpegOutputSink,
	type FfmpegOutputStreamOptions,
} from './ffmpeg-output-stream.ts';
import { getVideoExportFormat } from './video-export.js';
import { buildVideoFfmpegArgs } from './video-ffmpeg.js';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface VideoExportDescriptor {
	readonly extension: string;
	readonly id: string;
	readonly mimeType: string;
}

interface VideoExportInput {
	readonly inputIndex: number;
	readonly kind: string;
	readonly mimeType?: unknown;
	readonly sourceId?: unknown;
}

interface VideoExportPlan extends Readonly<Record<string, unknown>> {
	readonly format?: unknown;
	readonly inputs?: unknown;
}

interface StagedVideoInput extends VideoExportInput {
	readonly fileName: string;
	readonly sourceId?: string;
}

interface PreparedVideoBlobs {
	readonly blobs: readonly Readonly<{ name: string; data: Blob }>[];
	readonly descriptor: VideoExportDescriptor;
	readonly inputs: readonly StagedVideoInput[];
}

interface FfmpegVideoSettings extends FfmpegOutputStreamOptions, Readonly<Record<string, unknown>> {}

export interface FfmpegVideoJobInstance extends FfmpegOutputFileSource {
	createDir(path: string): Awaitable<unknown>;
	mount(
		fileSystemType: unknown,
		options: Readonly<{ blobs: readonly Readonly<{ name: string; data: Blob }>[] }>,
		mountPoint: string,
	): Awaitable<unknown>;
	exec(
		args: readonly string[],
		timeout?: number,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<number>;
	readFile(
		path: string,
		encoding?: unknown,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<unknown>;
	deleteFile(path: string): Awaitable<unknown>;
	unmount(path: string): Awaitable<unknown>;
	deleteDir(path: string): Awaitable<unknown>;
}

interface FfmpegVideoJobRuntime {
	readonly run: <Value>(task: (instance: FfmpegVideoJobInstance) => Promise<Value>) => Promise<Value>;
	readonly workerFsType: () => unknown;
	readonly terminateRuntime: () => void;
	readonly isRuntimeTerminated: (instance: FfmpegVideoJobInstance) => boolean;
	readonly createEncodingError: (format: string, exitCode: number) => Error;
}

interface FfmpegVideoJobInput extends FfmpegVideoJobRuntime {
	readonly videoBlobsBySourceId: ReadonlyMap<string, Blob> | Readonly<Record<string, Blob>>;
	readonly audioMix: Blob | null;
	readonly plan: VideoExportPlan;
	readonly settings: FfmpegVideoSettings;
}

export interface FfmpegVideoBytesResult {
	readonly bytes: Uint8Array;
	readonly extension: string;
	readonly mimeType: string;
}

export interface FfmpegVideoSinkResult<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly chunkCount: number;
	readonly extension: string;
	readonly mimeType: string;
}

interface FfmpegVideoSinkJobInput<Output> extends FfmpegVideoJobInput {
	readonly sink: FfmpegOutputSink<Output>;
}

/** Preserve the legacy whole-byte video result while moving its worker job out of the runtime factory. */
export async function encodeFfmpegVideoBytes(
	options: FfmpegVideoJobInput,
): Promise<FfmpegVideoBytesResult> {
	const staged = prepareVideoBlobs(
		options.videoBlobsBySourceId,
		options.audioMix,
		options.plan,
	);
	const signal = options.settings.signal;
	if (signal?.aborted) throw abortError();
	return options.run(async (instance) => {
		if (signal?.aborted) throw abortError();
		const job = createJob(staged);
		let videoInputPaths = new Map<string, string>();
		let audioInputPath: string | null = null;
		let mounted = false;
		const onAbort = () => options.terminateRuntime();
		signal?.addEventListener('abort', onAbort, { once: true });
		try {
			if (staged.blobs.length) {
				await instance.createDir(job.mountPoint);
				await instance.mount(
					options.workerFsType(),
					{ blobs: staged.blobs },
					job.mountPoint,
				);
				mounted = true;
			}
			({ videoInputPaths, audioInputPath } = stagedInputPaths(staged.inputs, job.mountPoint));
			const args = buildVideoFfmpegArgs(
				options.plan,
				{ videoInputPaths, audioInputPath },
				job.output,
				options.settings,
			);
			const code = await instance.exec(args, -1, signalOptions(signal));
			if (code !== 0) throw options.createEncodingError(staged.descriptor.id, code);
			const data = await instance.readFile(job.output, undefined, signalOptions(signal));
			return {
				bytes: data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)),
				extension: `.${staged.descriptor.extension}`,
				mimeType: staged.descriptor.mimeType,
			};
		} finally {
			signal?.removeEventListener('abort', onAbort);
			await Promise.resolve(instance.deleteFile(job.output)).catch(() => undefined);
			if (mounted) {
				await Promise.resolve(instance.unmount(job.mountPoint)).catch(() => undefined);
				await Promise.resolve(instance.deleteDir(job.mountPoint)).catch(() => undefined);
			}
		}
	});
}

/** Stream one finalized FFmpeg video output through exact, bounded ranges into a caller-owned sink. */
export async function encodeFfmpegVideoToSink<Output>(
	options: FfmpegVideoSinkJobInput<Output>,
): Promise<FfmpegVideoSinkResult<Output>> {
	let streamOwnsFailure = false;
	const signal = options.settings.signal;
	try {
		const staged = prepareVideoBlobs(
			options.videoBlobsBySourceId,
			options.audioMix,
			options.plan,
		);
		assertFfmpegOutputReady(options.settings);
		const result = await options.run(async (instance) => {
			const job = createJob(staged);
			const cleanupSteps: Array<() => PromiseLike<unknown>> = [];
			let operationError: unknown;
			const onAbort = () => options.terminateRuntime();
			signal?.addEventListener('abort', onAbort, { once: true });
			try {
				assertFfmpegOutputReady(options.settings);
				if (staged.blobs.length) {
					await instance.createDir(job.mountPoint);
					cleanupSteps.push(() => Promise.resolve(instance.deleteDir(job.mountPoint)));
					await instance.mount(
						options.workerFsType(),
						{ blobs: staged.blobs },
						job.mountPoint,
					);
					cleanupSteps.unshift(() => Promise.resolve(instance.unmount(job.mountPoint)));
				}
				assertFfmpegOutputReady(options.settings);
				const { videoInputPaths, audioInputPath } = stagedInputPaths(staged.inputs, job.mountPoint);
				cleanupSteps.unshift(() => Promise.resolve(instance.deleteFile(job.output)));
				const args = buildVideoFfmpegArgs(
					options.plan,
					{ videoInputPaths, audioInputPath },
					job.output,
					options.settings,
				);
				const code = await instance.exec(args, -1, signalOptions(signal));
				assertFfmpegOutputReady(options.settings);
				if (code !== 0) throw options.createEncodingError(staged.descriptor.id, code);
				streamOwnsFailure = true;
				const streamed = await streamFfmpegOutputFile(instance, job.output, options.sink, {
					signal,
					assertCurrent: options.settings.assertCurrent,
					maximumChunkBytes: numberSetting(options.settings.maximumOutputChunkBytes),
				});
				streamOwnsFailure = false;
				return Object.freeze({
					...streamed,
					extension: `.${staged.descriptor.extension}`,
					mimeType: staged.descriptor.mimeType,
				});
			} catch (error) {
				operationError = error;
				throw error;
			} finally {
				signal?.removeEventListener('abort', onAbort);
				if (!options.isRuntimeTerminated(instance)) {
					await cleanupFfmpegOutputRuntime(
						cleanupSteps,
						options.terminateRuntime,
						operationError,
					);
				}
			}
		});
		assertFfmpegOutputReady(options.settings);
		return result;
	} catch (error) {
		if (streamOwnsFailure) throw error;
		const primary = signal?.aborted ? signal.reason ?? abortError() : error;
		throw await abortFfmpegOutputSink(options.sink, primary);
	}
}

function prepareVideoBlobs(
	videoBlobsBySourceId: ReadonlyMap<string, Blob> | Readonly<Record<string, Blob>>,
	audioMix: Blob | null,
	plan: VideoExportPlan,
): PreparedVideoBlobs {
	if (!plan || typeof plan !== 'object' || !Array.isArray(plan.inputs)) {
		throw new TypeError('Expected a video export plan.');
	}
	const descriptor = getVideoExportFormat(String(plan.format ?? '')) as VideoExportDescriptor;
	const inputs = [...plan.inputs as VideoExportInput[]]
		.sort((left, right) => left.inputIndex - right.inputIndex);
	const blobs: Array<Readonly<{ name: string; data: Blob }>> = [];
	const stagedInputs: StagedVideoInput[] = [];
	for (const input of inputs) {
		let blob: Blob;
		let fileName: string;
		if (input?.kind === 'video-source') {
			const sourceId = String(input.sourceId ?? '');
			blob = mappedBlob(videoBlobsBySourceId, sourceId);
			if (!(blob instanceof Blob)) {
				throw new TypeError(`Expected a video Blob for source ${sourceId}.`);
			}
			fileName = `video-${String(input.inputIndex).padStart(3, '0')}.${videoBlobExtension(
				String(input.mimeType || blob.type),
			)}`;
			stagedInputs.push({ inputIndex: input.inputIndex, kind: input.kind, sourceId, fileName });
		} else if (input?.kind === 'staged-audio-mix') {
			if (!(audioMix instanceof Blob)) throw new TypeError('Expected a staged audio mix Blob.');
			blob = audioMix;
			fileName = `audio-${String(input.inputIndex).padStart(3, '0')}.wav`;
			stagedInputs.push({ inputIndex: input.inputIndex, kind: input.kind, fileName });
		} else {
			throw new TypeError(`Unsupported video export input kind: ${input?.kind}.`);
		}
		blobs.push({ name: fileName, data: blob });
	}
	return Object.freeze({
		descriptor,
		blobs: Object.freeze(blobs),
		inputs: Object.freeze(stagedInputs),
	});
}

function createJob(staged: PreparedVideoBlobs): Readonly<{ mountPoint: string; output: string }> {
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return Object.freeze({
		mountPoint: `/editor-video-${stamp}`,
		output: `editor-video-${stamp}.${staged.descriptor.extension}`,
	});
}

function stagedInputPaths(
	inputs: readonly StagedVideoInput[],
	mountPoint: string,
): Readonly<{ videoInputPaths: Map<string, string>; audioInputPath: string | null }> {
	const videoInputPaths = new Map<string, string>();
	let audioInputPath: string | null = null;
	for (const input of inputs) {
		const path = `${mountPoint}/${input.fileName}`;
		if (input.kind === 'video-source') videoInputPaths.set(input.sourceId!, path);
		else audioInputPath = path;
	}
	return Object.freeze({ videoInputPaths, audioInputPath });
}

function mappedBlob(
	mapping: ReadonlyMap<string, Blob> | Readonly<Record<string, Blob>>,
	key: string,
): Blob {
	if (mapping instanceof Map) return mapping.get(key) as Blob;
	if (mapping && typeof mapping === 'object' && Object.prototype.hasOwnProperty.call(mapping, key)) {
		return (mapping as Readonly<Record<string, Blob>>)[key]!;
	}
	return undefined as unknown as Blob;
}

function videoBlobExtension(mimeType: string): string {
	const normalized = String(mimeType || '').toLowerCase().split(';', 1)[0]!.trim();
	if (normalized === 'video/webm') return 'webm';
	if (normalized === 'video/quicktime') return 'mov';
	if (normalized === 'video/x-m4v') return 'm4v';
	return 'mp4';
}

function numberSetting(value: unknown): number | undefined {
	return value === undefined ? undefined : Number(value);
}

function signalOptions(
	signal: AbortSignal | null | undefined,
): Readonly<{ signal?: AbortSignal }> | undefined {
	return signal ? { signal } : undefined;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted', 'AbortError')
		: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}
