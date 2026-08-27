/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Admitting one keyed video encode request before a lease is taken.
 *
 * Everything here is refusal: closed records, exact geometry against the
 * canvas, own-data-property method extraction from the FFmpeg owner and its
 * lease. It sits apart from the encoder itself because that module owns
 * lifetimes — producer disposal, MEMFS deletion, aggregate cleanup — and mixing
 * the two made a single file where neither concern could be read on its own.
 */

import type {
	VideoKeyframeEncoderWorkload,
	VideoKeyframeEncoderWorkloadRequest,
	VideoKeyframeRgbaFrameProducer,
} from './video-keyframe-encoder-stream.ts';
import { normalizeVideoDeliveryQuality } from './video-delivery-quality.ts';
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
import { VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES } from './video-keyframe-audio-input.ts';
import { VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES } from './video-keyframe-video-output.ts';
import type {
	VideoKeyframeVideoEncoderDependencies,
	VideoKeyframeVideoEncoderRequest,
	VideoKeyframeVideoRgbaProducer,
} from './video-keyframe-video-encoder.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

const REQUEST_FIELDS = new Set([
	'frameSource', 'producer', 'format', 'quality', 'webCodecs', 'audioMix', 'ringCapacityBytes',
	'audioRingCapacityBytes', 'maximumAudioBytes',
	'maximumWidth', 'maximumHeight', 'maximumFrameCount', 'maximumTotalRgbaBytes',
	'maximumOutputBytes', 'maximumOutputChunkBytes', 'signal', 'assertCurrent',
]);
const WORKLOAD_OPTION_FIELDS = [
	'ringCapacityBytes', 'audioRingCapacityBytes', 'maximumWidth', 'maximumHeight',
	'maximumFrameCount', 'maximumTotalRgbaBytes',
] as const;

export interface NormalizedRequest extends VideoKeyframeVideoEncoderRequest {
	readonly maximumAudioBytes: number;
	readonly maximumOutputBytes: number;
	readonly maximumOutputChunkBytes: number;
}

export function normalizeRequest(value: VideoKeyframeVideoEncoderRequest): NormalizedRequest {
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
	const webCodecs = Object.hasOwn(record, 'webCodecs')
		? data(record, 'webCodecs', 'video keyframe video encoder request')
		: undefined;
	const result: Record<string, unknown> = {
		frameSource,
		producer,
		format,
		...(webCodecs === undefined ? {} : { webCodecs }),
		quality: normalizeVideoDeliveryQuality(
			optional(record, 'quality', undefined),
			'video keyframe video encoder request.quality',
		),
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

/** `.rgba` when FFmpeg compresses, the elementary container when the browser does. */
export function videoInputExtension(request: NormalizedRequest): string {
	if (!request.webCodecs) return 'rgba';
	return request.format === 'webm' ? 'ivf' : 'h264';
}

export function encoderWorkloadRequest(
	request: NormalizedRequest,
	paths: Readonly<{ input: string; audio?: string; output: string }>,
) {
	const result: Record<string, unknown> = {
		frameSource: request.frameSource,
		format: request.format,
		quality: request.quality,
		inputPath: paths.input,
		...(paths.audio ? { audioInputPath: paths.audio } : {}),
		outputPath: paths.output,
	};
	for (const key of WORKLOAD_OPTION_FIELDS) {
		if (request[key] !== undefined) result[key] = request[key];
	}
	return Object.freeze(result) as unknown as VideoKeyframeEncoderWorkloadRequest;
}

export function manageProducer(
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

export function validateEditorFfmpeg(value: unknown): VideoKeyframeVideoEditorFfmpeg {
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

export function validateLease(value: VideoKeyframeEncoderOperationLease): VideoKeyframeEncoderOperationLease {
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

export function normalizeDependencies(
	value: VideoKeyframeVideoEncoderDependencies,
): VideoKeyframeVideoEncoderDependencies {
	const record = closedRecord(
		value, new Set(['createJobToken', 'executeBrowserWebCodecs']),
		'video keyframe video encoder dependencies',
	);
	const createJobToken = requiredFunction(
		record, 'createJobToken', 'video keyframe video encoder dependencies',
	);
	const executeBrowserWebCodecs = Object.hasOwn(record, 'executeBrowserWebCodecs')
		? requiredFunction(
			record, 'executeBrowserWebCodecs', 'video keyframe video encoder dependencies',
		) as VideoKeyframeVideoEncoderDependencies['executeBrowserWebCodecs']
		: undefined;
	return Object.freeze({
		createJobToken() { return Reflect.apply(createJobToken, value, []) as string; },
		...(executeBrowserWebCodecs ? {
			executeBrowserWebCodecs(request: Parameters<NonNullable<
				VideoKeyframeVideoEncoderDependencies['executeBrowserWebCodecs']
			>>[0]) {
				return Reflect.apply(executeBrowserWebCodecs, value, [request]) as ReturnType<NonNullable<
					VideoKeyframeVideoEncoderDependencies['executeBrowserWebCodecs']
				>>;
			},
		} : {}),
	});
}

export function operationOptions(
	request: NormalizedRequest,
	workload: VideoKeyframeEncoderWorkload,
	audioInputBytes: number | null,
): VideoKeyframeEncoderOperationOptions {
	return Object.freeze({
		...(request.signal ? { signal: request.signal } : {}),
		...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
		...(workload.videoEncoder !== 'ffmpeg' ? {} : {
			desktopExternalFfmpeg: Object.freeze({
				plan: Object.freeze({
					schemaVersion: 1 as const,
					format: workload.format,
					quality: request.quality!,
					width: workload.width,
					height: workload.height,
					frameRate: workload.frameRate,
					frameCount: workload.frameCount,
					sampleRate: request.frameSource.sampleRate,
					durationFrames: request.frameSource.endFrame - request.frameSource.startFrame,
					videoInputBytes: workload.totalRgbaBytes,
					audioInputBytes,
					ringCapacityBytes: workload.ringCapacityBytes,
					audioRingCapacityBytes: workload.audioRingCapacityBytes ?? null,
					maximumOutputBytes: request.maximumOutputBytes,
				}),
				videoInputPath: workload.inputPath,
				...(workload.audioInputPath ? { audioInputPath: workload.audioInputPath } : {}),
				outputPath: workload.outputPath,
				ffmpegArguments: workload.ffmpegArguments,
			}),
		}),
	});
}

export function jobToken(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
		throw new TypeError('Video keyframe job tokens must be 128-bit lowercase hexadecimal strings.');
	}
	return value;
}

export function createCryptographicJobToken(): string {
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

export function assertReady(signal: AbortSignal | undefined, assertCurrent: (() => void) | undefined): void {
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
