/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertVideoKeyframeAudioInputSource,
	type VideoKeyframeAudioInputSource,
} from './video-keyframe-audio-input.ts';
import type { VideoKeyframeEncoderWorkload } from './video-keyframe-encoder-admission.ts';
import {
	assertVideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import type { VideoKeyframeRgbaFrameProducer } from './video-keyframe-encoder-stream.ts';
import type { VideoKeyframeWebCodecsEncode } from './video-keyframe-webcodecs-execution.ts';
import type {
	VideoMediabunnyMuxer,
	VideoMediabunnyMuxRequest,
} from './video-mediabunny-muxer.ts';
import {
	produceVideoWebCodecsChunks,
	type VideoWebCodecsChunkProduceRequest,
} from './video-webcodecs-producer.ts';

const PCM_SAMPLE_BYTES = Float32Array.BYTES_PER_ELEMENT;
const WAV_HEADER_BYTES = 12;
const MAXIMUM_WAV_CHUNKS = 64;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024;

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface VideoKeyframeMediabunnyExecutionRequest {
	readonly workload: VideoKeyframeEncoderWorkload;
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly producer: VideoKeyframeRgbaFrameProducer;
	readonly webCodecs: VideoKeyframeWebCodecsEncode;
	readonly audioSource?: VideoKeyframeAudioInputSource;
	/** The product quality plan's audio bitrate, in bits per second. */
	readonly audioBitrate?: number;
	readonly maximumOutputBytes?: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoKeyframeMediabunnyExecutionResult {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly byteLength: number;
	readonly videoEncoder: 'webcodecs';
	readonly codec: string;
	readonly frameCount: number;
	readonly frameBytes: number;
	readonly totalRgbaBytes: number;
	readonly videoByteLength: number;
	readonly chunkCount: number;
	readonly audioByteLength?: number;
	readonly audioChunkCount?: number;
	readonly format: 'mp4' | 'webm';
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly decoderConfigObserved: boolean;
}

export interface VideoKeyframeMediabunnyExecutionDependencies {
	createMuxer(request: VideoMediabunnyMuxRequest): Awaitable<VideoMediabunnyMuxer>;
	produceVideo(request: VideoWebCodecsChunkProduceRequest): Awaitable<Readonly<{
		frameCount: number;
		chunkCount: number;
		byteLength: number;
	}>>;
}

const DEFAULT_DEPENDENCIES: VideoKeyframeMediabunnyExecutionDependencies = Object.freeze({
	async createMuxer(request: VideoMediabunnyMuxRequest) {
		const { createVideoMediabunnyMuxer } = await import('./video-mediabunny-muxer.ts');
		return createVideoMediabunnyMuxer(request);
	},
	produceVideo: produceVideoWebCodecsChunks,
});

/** Render, WebCodecs-encode, audio-encode, and mux one complete browser-native delivery. */
export async function executeVideoKeyframeMediabunnyEncoder(
	request: VideoKeyframeMediabunnyExecutionRequest,
	dependencies: VideoKeyframeMediabunnyExecutionDependencies = DEFAULT_DEPENDENCIES,
): Promise<VideoKeyframeMediabunnyExecutionResult> {
	const { workload, frameSource, producer, webCodecs } = request;
	if (workload.videoEncoder !== 'webcodecs') {
		throw new Error('Mediabunny execution requires a WebCodecs-admitted workload.');
	}
	if (workload.frameCount !== frameSource.frameCount
		|| workload.width !== frameSource.canvas.width
		|| workload.height !== frameSource.canvas.height) {
		throw new Error('Mediabunny execution geometry disagrees with its admitted frame source.');
	}
	const audio = audioRequest(request);
	const maximumOutputBytes = boundedOutputBytes(request.maximumOutputBytes);
	// The managed renderer requires an operation signal even when the caller did
	// not supply cancellation. FFmpeg's execution engine used to provide this
	// generation signal; the native branch owns the equivalent scope itself.
	const operationController = new AbortController();
	let muxer: VideoMediabunnyMuxer | null = null;
	let cancellation: Promise<void> | null = null;
	const cancelMuxer = (): Promise<void> => {
		const activeMuxer = muxer;
		if (!activeMuxer) return Promise.resolve();
		cancellation ??= Promise.resolve().then(() => activeMuxer.cancel());
		return cancellation;
	};
	const relayAbort = (): void => {
		if (!operationController.signal.aborted) operationController.abort(request.signal?.reason);
		void cancelMuxer().catch(() => undefined);
	};
	if (request.signal?.aborted) relayAbort();
	else request.signal?.addEventListener('abort', relayAbort, { once: true });
	const operationSignal = operationController.signal;
	let activeTasks: readonly Promise<unknown>[] = [];
	let encodedVideoBytes = 0;
	try {
		assertReady(request);
		muxer = await dependencies.createMuxer({
			format: workload.format,
			videoCodec: workload.format === 'mp4' ? 'h264' : 'vp9',
			width: workload.width,
			height: workload.height,
			frameRate: workload.frameRate,
			frameCount: workload.frameCount,
			...(audio ? { audio } : {}),
		});
		assertReady(request);
		const activeMuxer = muxer;
		await awaitWithAbort(activeMuxer.start(), operationSignal);
		const videoTask = Promise.resolve(dependencies.produceVideo({
				frameSource: authenticatedFrameSource(frameSource, workload),
				producer: guardedProducer(producer, workload),
				videoCodec: workload.format === 'mp4' ? 'h264' : 'vp9',
				codec: webCodecs.codec,
				bitrate: webCodecs.bitrate,
				encoderClass: webCodecs.encoderClass as never,
				videoFrameClass: webCodecs.videoFrameClass as never,
				h264Format: 'avc',
				async writeChunk(chunk, metadata) {
					if (!Number.isSafeInteger(chunk.byteLength) || chunk.byteLength < 1) {
						throw new TypeError('Browser-native video produced an invalid encoded chunk length.');
					}
					if (chunk.byteLength > maximumOutputBytes - encodedVideoBytes) {
						throw new RangeError('The browser-native video output exceeds its requested byte bound.');
					}
					encodedVideoBytes += chunk.byteLength;
					await awaitWithAbort(activeMuxer.addVideoChunk(chunk, metadata), operationSignal);
				},
				signal: operationSignal,
				...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
			}));
		const audioTask = audio
			? writeAudio(request.audioSource!, activeMuxer, workload, {
				signal: operationSignal,
				...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
			})
			: Promise.resolve(null);
		activeTasks = [videoTask, audioTask];
		const [video] = await Promise.all([videoTask, audioTask]);
		assertReady(request);
		const muxed = await awaitWithAbort(activeMuxer.finalize(), operationSignal);
		assertReady(request);
		if (video.frameCount !== workload.frameCount
			|| video.chunkCount !== muxed.videoChunkCount
			|| video.byteLength !== muxed.videoByteLength) {
			throw new Error('Mediabunny video accounting disagrees with the WebCodecs producer.');
		}
		if (muxed.bytes.byteLength > maximumOutputBytes) {
			muxed.bytes.fill(0);
			throw new RangeError('The browser-native video output exceeds its requested byte bound.');
		}
		return Object.freeze({
			bytes: muxed.bytes,
			byteLength: muxed.bytes.byteLength,
			videoEncoder: 'webcodecs' as const,
			codec: webCodecs.codec,
			frameCount: workload.frameCount,
			frameBytes: workload.frameBytes,
			totalRgbaBytes: workload.totalRgbaBytes,
			videoByteLength: muxed.videoByteLength,
			chunkCount: muxed.videoChunkCount,
			...(request.audioSource ? {
				audioByteLength: request.audioSource.byteLength,
				audioChunkCount: muxed.audioChunkCount,
			} : {}),
			format: workload.format,
			extension: workload.extension,
			mimeType: workload.mimeType,
			decoderConfigObserved: muxed.decoderConfigObserved,
		});
	} catch (error) {
		if (!operationController.signal.aborted) operationController.abort(error);
		let cancellationFailure: unknown;
		try { await cancelMuxer(); } catch (cancelError) { cancellationFailure = cancelError; }
		await Promise.allSettled(activeTasks);
		if (cancellationFailure !== undefined) {
			throw new AggregateError([error, cancellationFailure], 'Video muxing and cancellation failed.');
		}
		throw error;
	} finally {
		request.signal?.removeEventListener('abort', relayAbort);
	}
}

function audioRequest(
	request: VideoKeyframeMediabunnyExecutionRequest,
): NonNullable<VideoMediabunnyMuxRequest['audio']> | null {
	if (!request.audioSource) {
		if (request.audioBitrate !== undefined || request.workload.audioInputPath !== undefined) {
			throw new TypeError('Mediabunny audio configuration requires an authenticated audio source.');
		}
		return null;
	}
	assertVideoKeyframeAudioInputSource(request.audioSource);
	if (request.workload.audioInputPath === undefined) {
		throw new TypeError('Mediabunny audio requires an audio-admitted workload.');
	}
	if (request.audioSource.sampleRate !== request.frameSource.sampleRate) {
		throw new RangeError('Mediabunny audio sample rate must match the exact export project.');
	}
	return Object.freeze({
		codec: request.workload.format === 'mp4' ? 'aac' : 'opus',
		sampleRate: request.audioSource.sampleRate,
		channelCount: request.audioSource.channelCount,
		bitrate: positiveInteger(request.audioBitrate, 'audio bitrate'),
	});
}

async function writeAudio(
	source: VideoKeyframeAudioInputSource,
	muxer: VideoMediabunnyMuxer,
	workload: VideoKeyframeEncoderWorkload,
	request: Pick<VideoKeyframeMediabunnyExecutionRequest, 'signal' | 'assertCurrent'>,
): Promise<void> {
	const data = await locateWavData(source, request);
	const codecFrames = workload.format === 'mp4' ? 1_024 : 960;
	const targetFrames = maximumSafeInteger(
		source.frameCount,
		ceilRationalFrames(workload.frameCount, source.sampleRate, workload.frameRate),
	);
	let frameOffset = 0;
	while (frameOffset < targetFrames) {
		assertReady(request);
		const frameCount = Math.min(codecFrames, targetFrames - frameOffset);
		const sourceFrames = Math.min(frameCount, Math.max(0, source.frameCount - frameOffset));
		const bytes = new Uint8Array(frameCount * source.channelCount * PCM_SAMPLE_BYTES);
		if (sourceFrames > 0) {
			const sourceBytes = sourceFrames * source.channelCount * PCM_SAMPLE_BYTES;
			const part = await source.read(
				data.offset + frameOffset * source.channelCount * PCM_SAMPLE_BYTES,
				sourceBytes,
				request.signal ? { signal: request.signal } : {},
			);
			if (part.byteLength !== sourceBytes) throw new Error('Canonical WAV audio returned a short PCM slice.');
			bytes.set(part);
		}
		await awaitWithAbort(muxer.addAudioPcm({
			data: bytes,
			frameCount,
			timestamp: frameOffset / source.sampleRate,
		}), request.signal);
		frameOffset += frameCount;
	}
}

async function locateWavData(
	source: VideoKeyframeAudioInputSource,
	request: Pick<VideoKeyframeMediabunnyExecutionRequest, 'signal' | 'assertCurrent'>,
): Promise<Readonly<{ offset: number; byteLength: number }>> {
	const header = await readExact(source, 0, WAV_HEADER_BYTES, request);
	if (ascii(header, 0, 4) !== 'RIFF' || ascii(header, 8, 4) !== 'WAVE') invalidWav();
	let offset = WAV_HEADER_BYTES;
	for (let count = 0; count < MAXIMUM_WAV_CHUNKS && offset < source.byteLength; count += 1) {
		const chunk = await readExact(source, offset, 8, request);
		const id = ascii(chunk, 0, 4);
		const byteLength = new DataView(chunk.buffer, chunk.byteOffset + 4, 4).getUint32(0, true);
		const dataOffset = offset + 8;
		if (byteLength > source.byteLength - dataOffset) invalidWav();
		if (id === 'data') {
			const expected = source.frameCount * source.channelCount * PCM_SAMPLE_BYTES;
			if (byteLength !== expected) invalidWav();
			return Object.freeze({ offset: dataOffset, byteLength });
		}
		offset = dataOffset + byteLength + (byteLength & 1);
	}
	return invalidWav();
}

async function readExact(
	source: VideoKeyframeAudioInputSource,
	offset: number,
	byteLength: number,
	request: Pick<VideoKeyframeMediabunnyExecutionRequest, 'signal' | 'assertCurrent'>,
): Promise<Uint8Array<ArrayBuffer>> {
	assertReady(request);
	if (byteLength < 1 || offset < 0 || offset + byteLength > source.byteLength) invalidWav();
	const bytes = await source.read(offset, byteLength, request.signal ? { signal: request.signal } : {});
	assertReady(request);
	if (bytes.byteLength !== byteLength) invalidWav();
	return bytes;
}

function authenticatedFrameSource(
	frameSource: VideoKeyframeExportFrameSource,
	workload: VideoKeyframeEncoderWorkload,
) {
	return Object.freeze({
		frameCount: workload.frameCount,
		canvas: Object.freeze({
			width: workload.width,
			height: workload.height,
			frameRate: workload.frameRate,
		}),
		frame(index: number): unknown {
			const frame: unknown = frameSource.frame(index);
			assertVideoKeyframeExportFrame(frameSource, frame);
			return frame;
		},
	});
}

function guardedProducer(
	producer: VideoKeyframeRgbaFrameProducer,
	workload: VideoKeyframeEncoderWorkload,
) {
	return Object.freeze({
		byteLength: workload.frameBytes,
		async produce(frame: unknown, target: Uint8Array, options: Readonly<{ signal?: AbortSignal }>) {
			const expectedBuffer = target.buffer;
			const produced: unknown = await producer.produce(frame as never, target as never, options);
			if (produced !== undefined) {
				throw new TypeError('Video keyframe RGBA producers must return void.');
			}
			if (target.buffer !== expectedBuffer || target.byteOffset !== 0
				|| target.byteLength !== workload.frameBytes
				|| expectedBuffer.byteLength !== workload.frameBytes) {
				throw new Error('The video keyframe producer did not retain its exact RGBA allocation.');
			}
		},
	});
}

function ceilRationalFrames(
	videoFrames: number,
	sampleRate: number,
	frameRate: Readonly<{ num: number; den: number }>,
): number {
	const numerator = BigInt(videoFrames) * BigInt(sampleRate) * BigInt(frameRate.den);
	const result = (numerator + BigInt(frameRate.num) - 1n) / BigInt(frameRate.num);
	if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Mediabunny audio padding is too large.');
	return Number(result);
}

function maximumSafeInteger(left: number, right: number): number {
	const result = Math.max(left, right);
	if (!Number.isSafeInteger(result)) throw new RangeError('Mediabunny audio frame count is unsafe.');
	return result;
}

function boundedOutputBytes(value: number | undefined): number {
	const bytes = value ?? DEFAULT_MAXIMUM_OUTPUT_BYTES;
	if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > DEFAULT_MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError('Mediabunny maximum output bytes are outside the browser bound.');
	}
	return bytes;
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`Mediabunny ${label} must be a positive integer.`);
	}
	return value;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let value = '';
	for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]!);
	return value;
}

function invalidWav(): never {
	throw new TypeError('Mediabunny audio requires the admitted canonical float32 WAV.');
}

function awaitWithAbort<Value>(operation: PromiseLike<Value>, signal?: AbortSignal): Promise<Value> {
	if (!signal) return Promise.resolve(operation);
	if (signal.aborted) return Promise.reject(abortReason(signal));
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(abortReason(signal)));
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		void Promise.resolve(operation).then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

function assertReady(
	request: Pick<VideoKeyframeMediabunnyExecutionRequest, 'signal' | 'assertCurrent'>,
): void {
	if (request.signal?.aborted) throw request.signal.reason ?? abortError();
	request.assertCurrent?.();
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? abortError();
}
