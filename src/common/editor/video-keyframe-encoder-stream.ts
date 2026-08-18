/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitVideoKeyframeEncoderWorkload,
	type VideoKeyframeEncoderWorkload,
	type VideoKeyframeEncoderWorkloadRequest,
} from './video-keyframe-encoder-admission.ts';
import {
	assertVideoKeyframeAudioInputSource,
	type VideoKeyframeAudioInputSource,
} from './video-keyframe-audio-input.ts';
import {
	assertVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import { executeVideoKeyframeEncoder } from './video-keyframe-encoder-execution.ts';

export { VideoKeyframeEncoderExitError } from './video-keyframe-encoder-execution.ts';

export {
	admitVideoKeyframeEncoderWorkload,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_AGGREGATE_RING_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
} from './video-keyframe-encoder-admission.ts';
export type {
	VideoKeyframeEncoderFormat,
	VideoKeyframeEncoderWorkload,
	VideoKeyframeEncoderWorkloadRequest,
} from './video-keyframe-encoder-admission.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface VideoKeyframeRgbaFrameProducer {
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
	/** Must settle promptly when the supplied signal aborts. */
	produce(
		frame: VideoKeyframeExportFrame,
		target: Uint8Array<ArrayBuffer>,
		options: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<void>;
	dispose(): Awaitable<void>;
}

export interface VideoKeyframeFfmpegInputStream {
	readonly path: string;
	readonly capacityBytes: number;
	write(data: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	close(): Promise<void>;
	abort(reason?: unknown): void;
	dispose(): Promise<void>;
}

/**
 * A raw FFmpeg instance whose editor-runtime operation lease is owned by the
 * caller for the complete invocation. This module does not acquire or extend
 * the editor FFmpeg queue/idle lease itself.
 */
export interface VideoKeyframeEncoderFfmpegPort {
	createInputStream(
		path: string,
		capacityBytes?: number,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<VideoKeyframeFfmpegInputStream>;
	exec(
		arguments_: readonly string[],
		timeout?: number,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<number>;
	/** Terminate the leased runtime so a broken exec cannot retain the job. */
	terminateExecution(reason?: unknown): void;
}

export interface VideoKeyframeEncoderRequest extends VideoKeyframeEncoderWorkloadRequest {
	readonly producer: VideoKeyframeRgbaFrameProducer;
	readonly audioSource?: VideoKeyframeAudioInputSource;
	readonly ffmpeg: VideoKeyframeEncoderFfmpegPort;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoKeyframeEncoderResult {
	readonly exitCode: 0;
	readonly frameCount: number;
	readonly frameBytes: number;
	readonly totalRgbaBytes: number;
	readonly chunkCount: number;
	readonly audioByteLength?: number;
	readonly audioChunkCount?: number;
	readonly format: VideoKeyframeEncoderWorkload['format'];
	readonly extension: VideoKeyframeEncoderWorkload['extension'];
	readonly mimeType: VideoKeyframeEncoderWorkload['mimeType'];
	readonly inputPath: string;
	readonly audioInputPath?: string;
	readonly outputPath: string;
	readonly ffmpegArguments: readonly string[];
}

/**
 * Render and feed one frame at a time while FFmpeg consumes the bounded ring.
 * The producer and input stream are always disposed after a valid invocation.
 * Output stat/range validation and MEMFS deletion belong to the later delivery wrapper.
 */
export async function encodeVideoKeyframeFrames(
	requestValue: VideoKeyframeEncoderRequest,
): Promise<VideoKeyframeEncoderResult> {
	const request = closedRecord(requestValue, ENCODER_FIELDS, 'video keyframe encoder request');
	const workload = admitVideoKeyframeEncoderWorkload(
		workloadRequest(request),
	);
	const frameSource = dataProperty(
		request, 'frameSource', 'video keyframe encoder request',
	) as VideoKeyframeExportFrameSource;
	assertVideoKeyframeExportFrameSource(frameSource);
	const producer = validateProducer(
		dataProperty(request, 'producer', 'video keyframe encoder request'),
		workload,
	);
	let ffmpeg: VideoKeyframeEncoderFfmpegPort | null = null;
	let signal: AbortSignal | undefined;
	let assertCurrent: (() => void) | undefined;
	let target: Uint8Array<ArrayBuffer> | null = null;
	let returnedVideoStream: unknown = null;
	let videoStream: VideoKeyframeFfmpegInputStream | null = null;
	let returnedAudioStream: unknown = null;
	let audioStream: VideoKeyframeFfmpegInputStream | null = null;
	let result: VideoKeyframeEncoderResult | null = null;
	let primary: unknown;
	let hasPrimary = false;
	const cleanupFailures: unknown[] = [];
	try {
		ffmpeg = validateFfmpeg(
			dataProperty(request, 'ffmpeg', 'video keyframe encoder request'),
		);
		signal = optionalSignal(request, 'signal', 'video keyframe encoder request');
		assertCurrent = optionalFunction(request, 'assertCurrent', 'video keyframe encoder request');
		const audioSource = Object.hasOwn(request, 'audioSource')
			? dataProperty(request, 'audioSource', 'video keyframe encoder request')
			: undefined;
		if ((workload.audioInputPath === undefined) !== (audioSource === undefined)) {
			throw new TypeError(
				'Video keyframe encoder audioSource and audioInputPath must either both be present or both be absent.',
			);
		}
		if (audioSource !== undefined) {
			assertVideoKeyframeAudioInputSource(audioSource);
			if (audioSource.sampleRate !== frameSource.sampleRate) {
				throw new RangeError(
					'Video keyframe audio source sample rate must match the exact frame source.',
				);
			}
			if (audioSource.frameCount !== frameSource.endFrame - frameSource.startFrame) {
				throw new RangeError(
					'Video keyframe audio source frame count must match the exact export range.',
				);
			}
		}
		assertReady(signal, assertCurrent);
		target = new Uint8Array(workload.frameBytes);
		returnedVideoStream = await ffmpeg.createInputStream(
			workload.inputPath,
			workload.ringCapacityBytes,
			signalOptions(signal),
		);
		videoStream = validateInputStream(
			returnedVideoStream, workload.inputPath, workload.ringCapacityBytes, 'video',
		);
		if (workload.audioInputPath && workload.audioRingCapacityBytes) {
			returnedAudioStream = await ffmpeg.createInputStream(
				workload.audioInputPath,
				workload.audioRingCapacityBytes,
				signalOptions(signal),
			);
			audioStream = validateInputStream(
				returnedAudioStream,
				workload.audioInputPath,
				workload.audioRingCapacityBytes,
				'audio',
			);
		}
		assertReady(signal, assertCurrent);
		result = await executeVideoKeyframeEncoder({
			ffmpeg,
			videoStream,
			...(audioStream ? { audioStream } : {}),
			...(audioSource ? { audioSource } : {}),
			frameSource,
			producer,
			target,
			workload,
			...(signal ? { signal } : {}),
			...(assertCurrent ? { assertCurrent } : {}),
		});
	} catch (error) {
		primary = error;
		hasPrimary = true;
		abortInputStreamCandidate(videoStream ?? returnedVideoStream, error, cleanupFailures);
		abortInputStreamCandidate(audioStream ?? returnedAudioStream, error, cleanupFailures);
	} finally {
		target = null;
		let allStreamsCleaned = true;
		for (const cleanupTarget of [
			videoStream ?? returnedVideoStream,
			audioStream ?? returnedAudioStream,
		]) {
			if (cleanupTarget !== null) {
				allStreamsCleaned = await disposeInputStreamCandidate(
					cleanupTarget, cleanupFailures,
				) && allStreamsCleaned;
			}
		}
		if (!allStreamsCleaned && ffmpeg !== null) {
			await cleanupStep(
				() => ffmpeg?.terminateExecution(hasPrimary ? primary : cleanupFailures[0]),
				cleanupFailures,
			);
		}
		await cleanupStep(() => producer.dispose(), cleanupFailures);
	}
	if (hasPrimary) {
		if (cleanupFailures.length === 0) throw primary;
		throw new AggregateError(
			[primary, ...cleanupFailures],
			'Video keyframe encoding and runtime cleanup did not both complete successfully.',
		);
	}
	if (cleanupFailures.length === 1) throw cleanupFailures[0];
	if (cleanupFailures.length > 1) {
		throw new AggregateError(
			cleanupFailures,
			'Video keyframe encoder cleanup did not complete successfully.',
		);
	}
	if (!result) throw new Error('Video keyframe encoder produced no exact result.');
	assertReady(signal, assertCurrent);
	return result;
}

const ENCODER_FIELDS = new Set([
	'frameSource', 'format', 'quality', 'inputPath', 'audioInputPath', 'outputPath', 'ringCapacityBytes',
	'audioRingCapacityBytes', 'audioSource',
	'maximumWidth', 'maximumHeight', 'maximumFrameCount', 'maximumTotalRgbaBytes',
	'producer', 'ffmpeg', 'signal', 'assertCurrent',
]);
const WORKLOAD_OPTION_FIELDS = [
	'quality', 'ringCapacityBytes', 'audioInputPath', 'audioRingCapacityBytes',
	'maximumWidth', 'maximumHeight', 'maximumFrameCount', 'maximumTotalRgbaBytes',
] as const;

function workloadRequest(
	request: Readonly<Record<string, unknown>>,
): VideoKeyframeEncoderWorkloadRequest {
	const result: Record<string, unknown> = {
		frameSource: dataProperty(request, 'frameSource', 'video keyframe encoder request'),
		format: dataProperty(request, 'format', 'video keyframe encoder request'),
		inputPath: dataProperty(request, 'inputPath', 'video keyframe encoder request'),
		outputPath: dataProperty(request, 'outputPath', 'video keyframe encoder request'),
	};
	for (const key of WORKLOAD_OPTION_FIELDS) {
		if (Object.hasOwn(request, key)) {
			result[key] = dataProperty(request, key, 'video keyframe encoder request');
		}
	}
	return result as unknown as VideoKeyframeEncoderWorkloadRequest;
}

function validateProducer(
	value: unknown,
	workload: VideoKeyframeEncoderWorkload,
): VideoKeyframeRgbaFrameProducer {
	const producer = closedRecord(
		value, new Set(['width', 'height', 'byteLength', 'produce', 'dispose']),
		'video keyframe RGBA producer',
	);
	if (dataProperty(producer, 'width', 'video keyframe RGBA producer') !== workload.width
		|| dataProperty(producer, 'height', 'video keyframe RGBA producer') !== workload.height) {
		throw new RangeError('Video keyframe producer geometry must match the admitted canvas.');
	}
	if (dataProperty(producer, 'byteLength', 'video keyframe RGBA producer') !== workload.frameBytes) {
		throw new RangeError('Video keyframe producer byteLength must match the exact frame byte length.');
	}
	requireFunction(producer, 'produce', 'video keyframe RGBA producer');
	requireFunction(producer, 'dispose', 'video keyframe RGBA producer');
	return producer as unknown as VideoKeyframeRgbaFrameProducer;
}

function validateFfmpeg(value: unknown): VideoKeyframeEncoderFfmpegPort {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError('Video keyframe encoder FFmpeg port must be an object.');
	}
	requireFunction(value, 'createInputStream', 'video keyframe encoder FFmpeg port');
	requireFunction(value, 'exec', 'video keyframe encoder FFmpeg port');
	requireFunction(value, 'terminateExecution', 'video keyframe encoder FFmpeg port');
	return value as VideoKeyframeEncoderFfmpegPort;
}

function validateInputStream(
	value: unknown,
	path: string,
	capacityBytes: number,
	kind: 'audio' | 'video',
): VideoKeyframeFfmpegInputStream {
	const stream = closedRecord(
		value, new Set(['path', 'capacityBytes', 'write', 'close', 'abort', 'dispose']),
		`FFmpeg video keyframe ${kind} input stream`,
	);
	if (dataProperty(stream, 'path', `FFmpeg video keyframe ${kind} input stream`) !== path
		|| dataProperty(stream, 'capacityBytes', `FFmpeg video keyframe ${kind} input stream`) !== capacityBytes) {
		throw new Error(`FFmpeg video keyframe ${kind} input stream does not match its admitted reservation.`);
	}
	for (const key of ['write', 'close', 'abort', 'dispose']) {
		requireFunction(stream, key, `FFmpeg video keyframe ${kind} input stream`);
	}
	return stream as unknown as VideoKeyframeFfmpegInputStream;
}

function assertReady(signal: AbortSignal | undefined, assertCurrent: (() => void) | undefined): void {
	if (signal?.aborted) throw signal.reason ?? abortError();
	assertCurrent?.();
}

async function cleanupStep(
	step: () => Awaitable<unknown> | undefined,
	failures: unknown[],
): Promise<void> {
	try { await step(); } catch (error) { failures.push(error); }
}

function abortInputStreamCandidate(value: unknown, reason: unknown, failures: unknown[]): void {
	const abort = candidateMethod(value, 'abort');
	if (abort === null) return;
	try { Reflect.apply(abort, value, [reason]); } catch (error) { failures.push(error); }
}

async function disposeInputStreamCandidate(value: unknown, failures: unknown[]): Promise<boolean> {
	const dispose = candidateMethod(value, 'dispose');
	if (dispose === null) return false;
	const failuresBefore = failures.length;
	await cleanupStep(() => Reflect.apply(dispose, value, []), failures);
	return failures.length === failuresBefore;
}

function candidateMethod(value: unknown, key: string): ((...args: unknown[]) => unknown) | null {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') return null;
	return descriptor.value as (...args: unknown[]) => unknown;
}

function optionalSignal(record: object, key: string, name: string): AbortSignal | undefined {
	const value = optionalDataProperty(record, key, undefined, name);
	if (value === undefined) return undefined;
	if (typeof AbortSignal !== 'function' || !(value instanceof AbortSignal)) {
		throw new TypeError(`${name}.${key} must be an AbortSignal.`);
	}
	return value;
}

function optionalFunction(record: object, key: string, name: string): (() => void) | undefined {
	const value = optionalDataProperty(record, key, undefined, name);
	if (value !== undefined && typeof value !== 'function') {
		throw new TypeError(`${name}.${key} must be a function.`);
	}
	return value as (() => void) | undefined;
}

function signalOptions(signal: AbortSignal | undefined): Readonly<{ signal?: AbortSignal }> | undefined {
	return signal ? { signal } : undefined;
}

function closedRecord(
	value: unknown,
	allowed: ReadonlySet<string>,
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} has an unsupported field.`);
		}
		dataProperty(value, key, name);
	}
	return value as Readonly<Record<string, unknown>>;
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

function optionalDataProperty(value: object, key: string, fallback: unknown, name: string): unknown {
	return Object.hasOwn(value, key) ? dataProperty(value, key, name) : fallback;
}

function requireFunction(value: object, key: string, name: string): void {
	if (typeof dataProperty(value, key, name) !== 'function') {
		throw new TypeError(`${name}.${key} must be a function.`);
	}
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
