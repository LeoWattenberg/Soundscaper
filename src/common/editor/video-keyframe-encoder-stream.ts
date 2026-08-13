/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitVideoKeyframeEncoderWorkload,
	type VideoKeyframeEncoderWorkload,
	type VideoKeyframeEncoderWorkloadRequest,
} from './video-keyframe-encoder-admission.ts';
import {
	assertVideoKeyframeExportFrame,
	assertVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';

export {
	admitVideoKeyframeEncoderWorkload,
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
	readonly format: VideoKeyframeEncoderWorkload['format'];
	readonly extension: VideoKeyframeEncoderWorkload['extension'];
	readonly mimeType: VideoKeyframeEncoderWorkload['mimeType'];
	readonly inputPath: string;
	readonly outputPath: string;
	readonly ffmpegArguments: readonly string[];
}

export class VideoKeyframeEncoderExitError extends Error {
	readonly exitCode: number;

	constructor(exitCode: number) {
		super(`FFmpeg keyframe video encoding exited with code ${String(exitCode)}.`);
		this.name = 'VideoKeyframeEncoderExitError';
		this.exitCode = exitCode;
	}
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
	let returnedStream: unknown = null;
	let stream: VideoKeyframeFfmpegInputStream | null = null;
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
		assertReady(signal, assertCurrent);
		target = new Uint8Array(workload.frameBytes);
		returnedStream = await ffmpeg.createInputStream(
			workload.inputPath,
			workload.ringCapacityBytes,
			signalOptions(signal),
		);
		stream = validateInputStream(returnedStream, workload);
		assertReady(signal, assertCurrent);
		result = await executeAndProduce(
			ffmpeg, stream, frameSource, producer, target, workload, signal, assertCurrent,
		);
	} catch (error) {
		primary = error;
		hasPrimary = true;
		abortInputStreamCandidate(stream ?? returnedStream, error, cleanupFailures);
	} finally {
		target = null;
		const cleanupTarget = stream ?? returnedStream;
		if (cleanupTarget !== null) {
			const streamCleaned = await disposeInputStreamCandidate(cleanupTarget, cleanupFailures);
			if (!streamCleaned && ffmpeg !== null) {
				await cleanupStep(
					() => ffmpeg?.terminateExecution(hasPrimary ? primary : cleanupFailures[0]),
					cleanupFailures,
				);
			}
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

async function executeAndProduce(
	ffmpeg: VideoKeyframeEncoderFfmpegPort,
	stream: VideoKeyframeFfmpegInputStream,
	frameSource: VideoKeyframeExportFrameSource,
	producer: VideoKeyframeRgbaFrameProducer,
	target: Uint8Array<ArrayBuffer>,
	workload: VideoKeyframeEncoderWorkload,
	signal: AbortSignal | undefined,
	assertCurrent: (() => void) | undefined,
): Promise<VideoKeyframeEncoderResult> {
	let firstFailure: unknown;
	let hasFailure = false;
	const cleanupFailures: unknown[] = [];
	let streamAborted = false;
	let executionStarted = false;
	let executionTerminated = false;
	let writtenBytes = 0;
	let chunkCount = 0;
	const operationAbort = new AbortController();
	let notifyFailure: ((outcome: OperationOutcome) => void) | null = null;
	const failureOutcome = new Promise<OperationOutcome>((resolve) => { notifyFailure = resolve; });
	const fail = (error: unknown): void => {
		if (!hasFailure) {
			firstFailure = error;
			hasFailure = true;
			notifyFailure?.({ kind: 'failure' });
		}
		if (!operationAbort.signal.aborted) operationAbort.abort(error);
		if (!streamAborted) {
			streamAborted = true;
			try { stream.abort(error); } catch (abortFailure) { cleanupFailures.push(abortFailure); }
		}
		if (executionStarted && !executionTerminated) {
			executionTerminated = true;
			try { ffmpeg.terminateExecution(error); } catch (terminationFailure) {
				cleanupFailures.push(terminationFailure);
			}
		}
	};
	const onAbort = (): void => fail(signal?.reason ?? abortError());
	signal?.addEventListener('abort', onAbort, { once: true });
	if (signal?.aborted) onAbort();
	if (hasFailure) {
		signal?.removeEventListener('abort', onAbort);
		throw operationFailure(firstFailure, cleanupFailures);
	}
	let execution: Promise<number>;
	executionStarted = true;
	try {
		execution = Promise.resolve(ffmpeg.exec(
			workload.ffmpegArguments,
			-1,
			signalOptions(operationAbort.signal),
		));
	} catch (error) {
		fail(error);
		execution = Promise.reject(error);
	}
	const observedExecution: Promise<OperationOutcome> = execution.then((codeValue) => {
		const code = exactExitCode(codeValue);
		if (writtenBytes !== workload.totalRgbaBytes) {
			const error = new Error(
				'FFmpeg execution completed before every admitted RGBA frame was written.',
			);
			fail(error);
			throw error;
		}
		if (code !== 0) {
			const error = new VideoKeyframeEncoderExitError(code);
			fail(error);
			throw error;
		}
		return { kind: 'execution', code } as const;
	}, (error: unknown) => {
		fail(error);
		throw error;
	}).catch(() => ({ kind: 'failure' } as const));
	const production: Promise<OperationOutcome> = (async () => {
		for (let index = 0; index < workload.frameCount; index += 1) {
			assertEncodingReady(signal, operationAbort.signal, assertCurrent);
			const frame: unknown = frameSource.frame(index);
			assertVideoKeyframeExportFrame(frameSource, frame);
			const expectedBuffer = target.buffer;
			const produced: unknown = await producer.produce(
				frame,
				target,
				signalOptions(operationAbort.signal) ?? {},
			);
			if (produced !== undefined) {
				throw new TypeError('Video keyframe RGBA producers must return void and cannot replace the target.');
			}
			if (target.buffer !== expectedBuffer || target.byteOffset !== 0
				|| target.byteLength !== workload.frameBytes
				|| expectedBuffer.byteLength !== workload.frameBytes) {
				throw new Error('The video keyframe producer did not retain the exact reusable RGBA allocation.');
			}
			assertEncodingReady(signal, operationAbort.signal, assertCurrent);
			for (let offset = 0; offset < workload.frameBytes; offset += workload.ringCapacityBytes) {
				assertEncodingReady(signal, operationAbort.signal, assertCurrent);
				const end = Math.min(workload.frameBytes, offset + workload.ringCapacityBytes);
				const chunk = target.subarray(offset, end);
				await stream.write(chunk, signalOptions(operationAbort.signal));
				chunkCount += 1;
				writtenBytes += chunk.byteLength;
				assertEncodingReady(signal, operationAbort.signal, assertCurrent);
			}
		}
		assertEncodingReady(signal, operationAbort.signal, assertCurrent);
		await stream.close();
		assertEncodingReady(signal, operationAbort.signal, assertCurrent);
		return { kind: 'production' } as const;
	})().catch((error: unknown) => {
		fail(error);
		return { kind: 'failure' } as const;
	});
	try {
		const first = await Promise.race([production, observedExecution, failureOutcome]);
		if (first.kind === 'failure') {
			await production;
			throw operationFailure(firstFailure, cleanupFailures);
		}
		if (first.kind === 'execution') {
			const finalProduction = await Promise.race([production, failureOutcome]);
			if (finalProduction.kind !== 'production' || hasFailure) {
				throw operationFailure(firstFailure, cleanupFailures);
			}
		} else {
			const finalExecution = await Promise.race([observedExecution, failureOutcome]);
			if (finalExecution.kind !== 'execution' || hasFailure) {
				throw operationFailure(firstFailure, cleanupFailures);
			}
		}
		assertReady(signal, assertCurrent);
		return Object.freeze({
			exitCode: 0 as const,
			frameCount: workload.frameCount,
			frameBytes: workload.frameBytes,
			totalRgbaBytes: workload.totalRgbaBytes,
			chunkCount,
			format: workload.format,
			extension: workload.extension,
			mimeType: workload.mimeType,
			inputPath: workload.inputPath,
			outputPath: workload.outputPath,
			ffmpegArguments: workload.ffmpegArguments,
		});
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
}

const ENCODER_FIELDS = new Set([
	'frameSource', 'format', 'inputPath', 'outputPath', 'ringCapacityBytes',
	'maximumWidth', 'maximumHeight', 'maximumFrameCount', 'maximumTotalRgbaBytes',
	'producer', 'ffmpeg', 'signal', 'assertCurrent',
]);
const WORKLOAD_OPTION_FIELDS = [
	'ringCapacityBytes', 'maximumWidth', 'maximumHeight',
	'maximumFrameCount', 'maximumTotalRgbaBytes',
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

type OperationOutcome =
	| Readonly<{ readonly kind: 'production' }>
	| Readonly<{ readonly kind: 'execution'; readonly code: 0 }>
	| Readonly<{ readonly kind: 'failure' }>;

function operationFailure(primary: unknown, cleanupFailures: readonly unknown[]): unknown {
	if (cleanupFailures.length === 0) return primary;
	return new AggregateError(
		[primary, ...cleanupFailures],
		'Video keyframe encoder operation and execution termination did not both succeed.',
	);
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
	workload: VideoKeyframeEncoderWorkload,
): VideoKeyframeFfmpegInputStream {
	const stream = closedRecord(
		value, new Set(['path', 'capacityBytes', 'write', 'close', 'abort', 'dispose']),
		'FFmpeg video keyframe input stream',
	);
	if (dataProperty(stream, 'path', 'FFmpeg video keyframe input stream') !== workload.inputPath
		|| dataProperty(stream, 'capacityBytes', 'FFmpeg video keyframe input stream') !== workload.ringCapacityBytes) {
		throw new Error('FFmpeg video keyframe input stream does not match its admitted reservation.');
	}
	for (const key of ['write', 'close', 'abort', 'dispose']) {
		requireFunction(stream, key, 'FFmpeg video keyframe input stream');
	}
	return stream as unknown as VideoKeyframeFfmpegInputStream;
}

function exactExitCode(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throw new TypeError('FFmpeg keyframe video encoding returned an invalid exit code.');
	}
	return value;
}

function assertReady(signal: AbortSignal | undefined, assertCurrent: (() => void) | undefined): void {
	if (signal?.aborted) throw signal.reason ?? abortError();
	assertCurrent?.();
}

function assertEncodingReady(
	signal: AbortSignal | undefined,
	operationSignal: AbortSignal,
	assertCurrent: (() => void) | undefined,
): void {
	if (operationSignal.aborted) throw operationSignal.reason ?? abortError();
	assertReady(signal, assertCurrent);
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
