/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitVideoKeyframeAudioInput,
	VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES,
} from './video-keyframe-audio-input.ts';
import {
	admitVideoKeyframeEncoderWorkload,
	type VideoKeyframeEncoderFormat,
	type VideoKeyframeEncoderResult,
	type VideoKeyframeEncoderWorkloadRequest,
	type VideoKeyframeRgbaFrameProducer,
} from './video-keyframe-encoder-stream.ts';
import {
	assertVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import type {
	VideoKeyframeEncoderOperationLease,
	VideoKeyframeEncoderOperationOptions,
	VideoKeyframeVideoEditorFfmpeg,
} from './video-keyframe-ffmpeg-operation.ts';
import type { FfmpegOutputSink } from './ffmpeg-output-stream.ts';
import {
	collectVideoKeyframeVideoOutput,
	streamVideoKeyframeVideoOutput,
	VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES,
} from './video-keyframe-video-output.ts';
import {
	runVideoKeyframeVideoOperation,
	type VideoKeyframeDeliveredOutput,
} from './video-keyframe-video-operation.ts';
import { manageVideoKeyframeOutputSink } from './video-keyframe-video-sink.ts';

export { VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES } from './video-keyframe-video-output.ts';
export type {
	VideoKeyframeEncoderOperationLease,
	VideoKeyframeEncoderOperationOptions,
	VideoKeyframeVideoEditorFfmpeg,
} from './video-keyframe-ffmpeg-operation.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface VideoKeyframeVideoRgbaProducer {
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
	produce(
		frame: VideoKeyframeExportFrame,
		target: Uint8Array<ArrayBuffer>,
		options: Readonly<{ signal: AbortSignal }>,
	): Awaitable<void>;
	dispose(): Awaitable<void>;
}

export interface VideoKeyframeVideoEncoderRequest {
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly producer: VideoKeyframeVideoRgbaProducer;
	readonly format: VideoKeyframeEncoderFormat;
	readonly audioMix?: Blob;
	readonly ringCapacityBytes?: number;
	readonly audioRingCapacityBytes?: number;
	readonly maximumAudioBytes?: number;
	readonly maximumWidth?: number;
	readonly maximumHeight?: number;
	readonly maximumFrameCount?: number;
	readonly maximumTotalRgbaBytes?: number;
	readonly maximumOutputBytes?: number;
	readonly maximumOutputChunkBytes?: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoKeyframeVideoEncoderResult {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly byteLength: number;
	readonly format: VideoKeyframeEncoderFormat;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly frameCount: number;
	readonly rgbaChunkCount: number;
	readonly audioByteLength?: number;
	readonly audioChunkCount?: number;
	readonly outputChunkCount: number;
}

export interface VideoKeyframeVideoSinkEncoderResult<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly format: VideoKeyframeEncoderFormat;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly frameCount: number;
	readonly rgbaChunkCount: number;
	readonly audioByteLength?: number;
	readonly audioChunkCount?: number;
	readonly outputChunkCount: number;
}

export interface VideoKeyframeVideoEncoderDependencies {
	createJobToken(): string;
}

const REQUEST_FIELDS = new Set([
	'frameSource', 'producer', 'format', 'audioMix', 'ringCapacityBytes',
	'audioRingCapacityBytes', 'maximumAudioBytes',
	'maximumWidth', 'maximumHeight', 'maximumFrameCount', 'maximumTotalRgbaBytes',
	'maximumOutputBytes', 'maximumOutputChunkBytes', 'signal', 'assertCurrent',
]);
const WORKLOAD_OPTION_FIELDS = [
	'ringCapacityBytes', 'audioRingCapacityBytes', 'maximumWidth', 'maximumHeight',
	'maximumFrameCount', 'maximumTotalRgbaBytes',
] as const;
const DEFAULT_DEPENDENCIES: VideoKeyframeVideoEncoderDependencies = Object.freeze({
	createJobToken: createCryptographicJobToken,
});

/** Encode one authenticated exact-frame source without exposing MEMFS path authority. */
export async function encodeVideoKeyframeVideo(
	editorFfmpegValue: VideoKeyframeVideoEditorFfmpeg,
	requestValue: VideoKeyframeVideoEncoderRequest,
	dependenciesValue: VideoKeyframeVideoEncoderDependencies = DEFAULT_DEPENDENCIES,
): Promise<VideoKeyframeVideoEncoderResult> {
	const result = await encodeManaged(
		editorFfmpegValue,
		requestValue,
		dependenciesValue,
		(request) => Object.freeze({
			async deliver(lease: VideoKeyframeEncoderOperationLease, path: string) {
				const output = await collectVideoKeyframeVideoOutput({
					source: lease,
					path,
					format: request.format,
					maximumBytes: request.maximumOutputBytes,
					maximumChunkBytes: request.maximumOutputChunkBytes,
					signal: request.signal,
					assertCurrent: request.assertCurrent,
				});
				return Object.freeze({
					output: output.bytes,
					byteLength: output.byteLength,
					chunkCount: output.chunkCount,
				});
			},
			discard(output: Uint8Array<ArrayBuffer>) { output.fill(0); },
		}),
	);
	return Object.freeze({
		bytes: result.delivered.output,
		...resultMetadata(result.encoded, result.delivered),
	});
}

/** Deliver directly through bounded ranges before the generation-scoped lease is released. */
export async function encodeVideoKeyframeVideoToSink<Output>(
	editorFfmpegValue: VideoKeyframeVideoEditorFfmpeg,
	requestValue: VideoKeyframeVideoEncoderRequest,
	sinkValue: FfmpegOutputSink<Output>,
	dependenciesValue: VideoKeyframeVideoEncoderDependencies = DEFAULT_DEPENDENCIES,
): Promise<VideoKeyframeVideoSinkEncoderResult<Output>> {
	const managedSink = manageVideoKeyframeOutputSink(sinkValue);
	try {
		const result = await encodeManaged(
			editorFfmpegValue,
			requestValue,
			dependenciesValue,
			(request) => Object.freeze({
				async deliver(lease: VideoKeyframeEncoderOperationLease, path: string) {
					return streamVideoKeyframeVideoOutput({
						source: lease,
						path,
						format: request.format,
						maximumBytes: request.maximumOutputBytes,
						maximumChunkBytes: request.maximumOutputChunkBytes,
						signal: request.signal,
						assertCurrent: request.assertCurrent,
					}, managedSink.value);
				},
			}),
		);
		return Object.freeze({
			output: result.delivered.output,
			...resultMetadata(result.encoded, result.delivered),
		});
	} catch (error) {
		throw await managedSink.abort(error);
	}
}

interface DeliveryStrategy<Output> {
	deliver(
		lease: VideoKeyframeEncoderOperationLease,
		path: string,
	): Promise<VideoKeyframeDeliveredOutput<Output>>;
	discard?(output: Output): void;
}

async function encodeManaged<Output>(
	editorFfmpegValue: VideoKeyframeVideoEditorFfmpeg,
	requestValue: VideoKeyframeVideoEncoderRequest,
	dependenciesValue: VideoKeyframeVideoEncoderDependencies,
	createDelivery: (request: NormalizedRequest) => DeliveryStrategy<Output>,
) {
	const editorFfmpeg = validateEditorFfmpeg(editorFfmpegValue);
	const request = normalizeRequest(requestValue);
	const dependencies = normalizeDependencies(dependenciesValue);
	const delivery = createDelivery(request);
	const managedProducer = manageProducer(request.producer, request.frameSource);
	let result: Awaited<ReturnType<typeof runVideoKeyframeVideoOperation<Output>>> | null = null;
	let primary: unknown;
	let hasPrimary = false;
	try {
		assertReady(request.signal, request.assertCurrent);
		const audioSource = request.audioMix
			? await admitVideoKeyframeAudioInput(request.audioMix, {
				maximumBytes: request.maximumAudioBytes,
				...(request.signal ? { signal: request.signal } : {}),
				...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
			})
			: undefined;
		if (audioSource) {
			if (audioSource.sampleRate !== request.frameSource.sampleRate) {
				throw new RangeError(
					'Video keyframe float32 WAV sample rate must match the exact export project sample rate.',
				);
			}
			if (audioSource.frameCount
				!== request.frameSource.endFrame - request.frameSource.startFrame) {
				throw new RangeError(
					'Video keyframe float32 WAV frame count must match the exact export range.',
				);
			}
		}
		assertReady(request.signal, request.assertCurrent);
		const token = jobToken(dependencies.createJobToken());
		const paths = Object.freeze({
			input: `/framescaper-keyframes-${token}.rgba`,
			...(audioSource ? { audio: `/framescaper-keyframes-${token}.wav` } : {}),
			output: `/framescaper-keyframes-${token}.${request.format}`,
		});
		const workloadRequest = encoderWorkloadRequest(request, paths);
		admitVideoKeyframeEncoderWorkload(workloadRequest);
		result = await editorFfmpeg.runVideoKeyframeEncoderOperation(
			(leaseValue) => {
				const lease = validateLease(leaseValue);
				return runVideoKeyframeVideoOperation({
					lease,
					workload: workloadRequest,
					producer: managedProducer.value,
					...(audioSource ? { audioSource } : {}),
					outputPath: paths.output,
					format: request.format,
					...(request.signal ? { signal: request.signal } : {}),
					...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
					deliver: delivery.deliver,
					...(delivery.discard ? { discard: delivery.discard } : {}),
				});
			},
			operationOptions(request),
		);
	} catch (error) {
		primary = error;
		hasPrimary = true;
	}
	if (!managedProducer.disposed()) {
		try { await managedProducer.value.dispose(); } catch (error) {
			if (result && delivery.discard) {
				try { delivery.discard(result.delivered.output); } catch (discardError) {
					error = new AggregateError([error, discardError], 'Producer and output cleanup failed.');
				}
			}
			if (hasPrimary) {
				throw new AggregateError(
					[primary, error],
					'Video keyframe encoding and producer cleanup did not both complete successfully.',
				);
			}
			throw error;
		}
	}
	if (hasPrimary) throw primary;
	if (!result) throw new Error('Video keyframe encoding produced no exact result.');
	return result;
}

function resultMetadata<Output>(
	encoded: VideoKeyframeEncoderResult,
	delivered: VideoKeyframeDeliveredOutput<Output>,
) {
	return Object.freeze({
		byteLength: delivered.byteLength,
		format: encoded.format,
		extension: encoded.extension,
		mimeType: encoded.mimeType,
		frameCount: encoded.frameCount,
		rgbaChunkCount: encoded.chunkCount,
		...(encoded.audioByteLength === undefined ? {} : {
			audioByteLength: encoded.audioByteLength,
			audioChunkCount: encoded.audioChunkCount,
		}),
		outputChunkCount: delivered.chunkCount,
	});
}

interface NormalizedRequest extends VideoKeyframeVideoEncoderRequest {
	readonly maximumAudioBytes: number;
	readonly maximumOutputBytes: number;
	readonly maximumOutputChunkBytes: number;
}

function normalizeRequest(value: VideoKeyframeVideoEncoderRequest): NormalizedRequest {
	const record = closedRecord(value, REQUEST_FIELDS, 'video keyframe video encoder request');
	const frameSource = data(record, 'frameSource', 'video keyframe video encoder request');
	assertVideoKeyframeExportFrameSource(frameSource);
	const producer = data(record, 'producer', 'video keyframe video encoder request');
	const format = data(record, 'format', 'video keyframe video encoder request');
	if (format !== 'mp4' && format !== 'webm') {
		throw new RangeError('Video keyframe video encoder format must be mp4 or webm.');
	}
	const maximumOutputBytes = boundedMaximum(
		optional(record, 'maximumOutputBytes', VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES),
		VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES,
		'maximumOutputBytes',
	);
	const maximumOutputChunkBytes = boundedMaximum(
		optional(record, 'maximumOutputChunkBytes', 1024 * 1024),
		1024 * 1024,
		'maximumOutputChunkBytes',
	);
	const audioMix = Object.hasOwn(record, 'audioMix')
		? data(record, 'audioMix', 'video keyframe video encoder request')
		: undefined;
	if (audioMix !== undefined && (typeof Blob !== 'function' || !(audioMix instanceof Blob))) {
		throw new TypeError('video keyframe video encoder request.audioMix must be a Blob.');
	}
	if (audioMix === undefined && (
		Object.hasOwn(record, 'audioRingCapacityBytes')
		|| Object.hasOwn(record, 'maximumAudioBytes')
	)) {
		throw new TypeError(
			'video keyframe video encoder audio options require audioMix.',
		);
	}
	const maximumAudioBytes = boundedMaximum(
		optional(record, 'maximumAudioBytes', VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES),
		VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES,
		'maximumAudioBytes',
	);
	const signal = optionalSignal(record, 'signal');
	const assertCurrent = optionalFunction(record, 'assertCurrent');
	const result: Record<string, unknown> = {
		frameSource,
		producer,
		format,
		...(audioMix ? { audioMix } : {}),
		maximumAudioBytes,
		maximumOutputBytes,
		maximumOutputChunkBytes,
		...(signal ? { signal } : {}),
		...(assertCurrent ? { assertCurrent } : {}),
	};
	for (const key of WORKLOAD_OPTION_FIELDS) {
		if (Object.hasOwn(record, key)) result[key] = data(record, key, 'video keyframe video encoder request');
	}
	return Object.freeze(result) as unknown as NormalizedRequest;
}

function encoderWorkloadRequest(
	request: NormalizedRequest,
	paths: Readonly<{ input: string; audio?: string; output: string }>,
) {
	const result: Record<string, unknown> = {
		frameSource: request.frameSource,
		format: request.format,
		inputPath: paths.input,
		...(paths.audio ? { audioInputPath: paths.audio } : {}),
		outputPath: paths.output,
	};
	for (const key of WORKLOAD_OPTION_FIELDS) {
		if (request[key] !== undefined) result[key] = request[key];
	}
	return Object.freeze(result) as unknown as VideoKeyframeEncoderWorkloadRequest;
}

function manageProducer(
	value: VideoKeyframeVideoRgbaProducer,
	frameSource: VideoKeyframeExportFrameSource,
) {
	const record = closedRecord(
		value, new Set(['width', 'height', 'byteLength', 'produce', 'dispose']),
		'video keyframe video producer',
	);
	const width = data(record, 'width', 'video keyframe video producer');
	const height = data(record, 'height', 'video keyframe video producer');
	const byteLength = data(record, 'byteLength', 'video keyframe video producer');
	if (width !== frameSource.canvas.width || height !== frameSource.canvas.height
		|| byteLength !== frameSource.canvas.width * frameSource.canvas.height * 4) {
		throw new RangeError('Video keyframe video producer geometry must match the exact export canvas.');
	}
	const produce = requiredFunction(
		record, 'produce', 'video keyframe video producer',
	) as unknown as VideoKeyframeVideoRgbaProducer['produce'];
	const dispose = requiredFunction(
		record, 'dispose', 'video keyframe video producer',
	) as unknown as VideoKeyframeVideoRgbaProducer['dispose'];
	let disposePromise: Promise<void> | null = null;
	let disposed = false;
	const managed: VideoKeyframeRgbaFrameProducer = Object.freeze({
		width: width as number,
		height: height as number,
		byteLength: byteLength as number,
		produce(
			frame: VideoKeyframeExportFrame,
			target: Uint8Array<ArrayBuffer>,
			options: Readonly<{ signal?: AbortSignal }>,
		): Awaitable<void> {
			if (!options.signal) throw new Error('Video keyframe producer requires its operation signal.');
			return produce.call(value, frame, target, { signal: options.signal });
		},
		dispose() {
			if (disposed) return Promise.resolve();
			if (!disposePromise) disposePromise = Promise.resolve()
				.then(() => dispose.call(value))
				.then(
					() => { disposed = true; disposePromise = null; },
					(error: unknown) => { disposePromise = null; throw error; },
				);
			return disposePromise;
		},
	});
	return Object.freeze({ value: managed, disposed: () => disposed });
}

function validateEditorFfmpeg(value: VideoKeyframeVideoEditorFfmpeg): VideoKeyframeVideoEditorFfmpeg {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError('Video keyframe encoding requires an editor FFmpeg operation owner.');
	}
	const run = requiredOwnDataFunction(
		value, 'runVideoKeyframeEncoderOperation', 'Video keyframe encoding editor FFmpeg',
	);
	return Object.freeze({
		runVideoKeyframeEncoderOperation(...arguments_: unknown[]) {
			return Reflect.apply(run, value, arguments_);
		},
	}) as VideoKeyframeVideoEditorFfmpeg;
}

function validateLease(value: VideoKeyframeEncoderOperationLease): VideoKeyframeEncoderOperationLease {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Video keyframe encoding requires an active FFmpeg operation lease.');
	}
	const admitted: Record<string, (...arguments_: unknown[]) => unknown> = {};
	for (const key of [
		'createInputStream', 'exec', 'terminateExecution', 'statFile',
		'readFileRange', 'deleteFile', 'isExecutionTerminated',
	]) {
		const method = requiredOwnDataFunction(value, key, 'Video keyframe FFmpeg operation lease');
		admitted[key] = (...arguments_: unknown[]) => Reflect.apply(method, value, arguments_);
	}
	return Object.freeze(admitted) as unknown as VideoKeyframeEncoderOperationLease;
}

function normalizeDependencies(
	value: VideoKeyframeVideoEncoderDependencies,
): VideoKeyframeVideoEncoderDependencies {
	const record = closedRecord(
		value, new Set(['createJobToken']), 'video keyframe video encoder dependencies',
	);
	const createJobToken = requiredFunction(
		record, 'createJobToken', 'video keyframe video encoder dependencies',
	);
	return Object.freeze({
		createJobToken() { return Reflect.apply(createJobToken, value, []) as string; },
	});
}

function operationOptions(request: NormalizedRequest): VideoKeyframeEncoderOperationOptions {
	return Object.freeze({
		...(request.signal ? { signal: request.signal } : {}),
		...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
	});
}

function jobToken(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
		throw new TypeError('Video keyframe job tokens must be 128-bit lowercase hexadecimal strings.');
	}
	return value;
}

function createCryptographicJobToken(): string {
	if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
		throw new Error('Video keyframe encoding requires a cryptographic random source.');
	}
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function boundedMaximum(value: unknown, hardMaximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)
		|| value <= 0 || value > hardMaximum) {
		throw new RangeError(
			`Video keyframe video encoder ${name} must be positive and cannot exceed ${String(hardMaximum)}.`,
		);
	}
	return value;
}

function assertReady(signal: AbortSignal | undefined, assertCurrent: (() => void) | undefined): void {
	if (signal?.aborted) throw signal.reason ?? abortError();
	assertCurrent?.();
}

function optionalSignal(record: object, key: string): AbortSignal | undefined {
	const value = optional(record, key, undefined);
	if (value === undefined) return undefined;
	if (typeof AbortSignal !== 'function' || !(value instanceof AbortSignal)) {
		throw new TypeError(`video keyframe video encoder request.${key} must be an AbortSignal.`);
	}
	return value;
}

function optionalFunction(record: object, key: string): (() => void) | undefined {
	const value = optional(record, key, undefined);
	if (value !== undefined && typeof value !== 'function') {
		throw new TypeError(`video keyframe video encoder request.${key} must be a function.`);
	}
	return value as (() => void) | undefined;
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
		data(value, key, name);
	}
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

function optional(value: object, key: string, fallback: unknown): unknown {
	return Object.hasOwn(value, key) ? data(value, key, 'video keyframe video encoder request') : fallback;
}

function requiredFunction(value: object, key: string, name: string): (...args: never[]) => unknown {
	const member = data(value, key, name);
	if (typeof member !== 'function') throw new TypeError(`${name}.${key} must be a function.`);
	return member as (...args: never[]) => unknown;
}

function requiredOwnDataFunction(
	value: object,
	key: string,
	name: string,
): (...arguments_: never[]) => unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
		throw new TypeError(`${name}.${key} must be an own data property function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
