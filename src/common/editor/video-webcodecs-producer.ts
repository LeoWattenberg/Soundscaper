/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Driving a `VideoEncoder` from the offline RGBA frame source.
 *
 * This is the WebCodecs tier's producer. It renders the same frames the FFmpeg
 * path renders, hands each one to the browser's encoder, and emits the encoded
 * chunks either to the browser-native container muxer or, for development-only
 * legacy callers, to an elementary-stream writer. Nothing here decides what the
 * delivery is: the canvas, the rate, and the quality tier all come from the
 * plan, and this only asks the browser encoder to produce them.
 *
 * Three things it must not do. It must not let frames pile up in the encoder's
 * queue — one RGBA frame is megabytes, and an unbounded queue is the browser
 * tab falling over. It must not lose the exact rational rate: timestamps are
 * computed in microseconds from the rational directly, never from a decimal
 * frames-per-second. And it must not report success on a partial stream, so a
 * failed or aborted encode closes the encoder and throws rather than handing
 * back the chunks it happened to get.
 */

import { createVideoElementaryStreamWriter } from './video-elementary-stream.ts';

const MICROSECONDS_PER_SECOND = 1_000_000;

/** How many frames may sit in the encoder queue before the producer waits. */
export const VIDEO_WEBCODECS_MAXIMUM_QUEUE_DEPTH = 4;

/** How long one wait for encoder progress may last before it is re-checked. */
const ENCODER_TICK_MS = 4;

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface VideoWebCodecsEncodedChunk {
	readonly byteLength: number;
	readonly type: 'key' | 'delta';
	readonly timestamp: number;
	readonly duration?: number | null;
	copyTo(target: Uint8Array): void;
}

interface EncoderLike {
	readonly encodeQueueSize: number;
	readonly state: string;
	configure(config: Readonly<Record<string, unknown>>): void;
	encode(frame: unknown, options?: Readonly<{ keyFrame?: boolean }>): void;
	flush(): Promise<void>;
	close(): void;
	/** Fired as the encoder works through its queue, where implemented. */
	addEventListener?(type: string, listener: () => void, options?: unknown): void;
	removeEventListener?(type: string, listener: () => void, options?: unknown): void;
}

interface EncoderConstructor {
	new (callbacks: Readonly<{
		output: (chunk: VideoWebCodecsEncodedChunk, metadata?: EncodedVideoChunkMetadata) => void;
		error: (error: unknown) => void;
	}>): EncoderLike;
}

interface VideoFrameConstructor {
	new (data: Uint8Array, init: Readonly<Record<string, unknown>>): { close(): void };
}

interface FrameSourceLike {
	readonly frameCount: number;
	readonly canvas: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	}>;
	frame(index: number): unknown;
}

interface RgbaProducerLike {
	readonly byteLength: number;
	produce(
		frame: unknown,
		target: Uint8Array,
		options: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<void>;
}

export interface VideoWebCodecsProduceRequest {
	readonly frameSource: FrameSourceLike;
	readonly producer: RgbaProducerLike;
	/** `h264` or `vp9`: what the elementary stream has to be framed as. */
	readonly videoCodec: string;
	/** The full codec string the capability probe accepted. */
	readonly codec: string;
	readonly bitrate: number;
	readonly encoderClass: EncoderConstructor;
	readonly videoFrameClass: VideoFrameConstructor;
	/** Receives elementary-stream bytes in order; never called after a failure. */
	readonly write: (bytes: Uint8Array) => Awaitable<void>;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoWebCodecsProduceResult {
	readonly frameCount: number;
	readonly chunkCount: number;
	readonly byteLength: number;
}

export interface VideoWebCodecsChunkProduceRequest
	extends Omit<VideoWebCodecsProduceRequest, 'write'> {
	/** MP4 consumes length-prefixed AVC; the legacy elementary-stream path consumes Annex-B. */
	readonly h264Format?: 'annexb' | 'avc';
	/** Receives each browser chunk with the exact metadata emitted beside it. */
	readonly writeChunk: (
		chunk: VideoWebCodecsEncodedChunk,
		metadata?: EncodedVideoChunkMetadata,
	) => Awaitable<void>;
}

export interface VideoWebCodecsEncoderConfigurationRequest {
	readonly videoCodec: string;
	/** Preserve the full codec string accepted during admission. */
	readonly codec: string;
	readonly canvas: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	}>;
	/** Preserve the exact delivery bitrate selected before admission. */
	readonly bitrate: number;
	readonly h264Format?: 'annexb' | 'avc';
}

/** The single exact `VideoEncoderConfig` shape used by admission and execution. */
export function createVideoWebCodecsEncoderConfiguration(
	request: VideoWebCodecsEncoderConfigurationRequest,
): Readonly<Record<string, unknown>> {
	const width = positiveInteger(request.canvas?.width, 'canvas width');
	const height = positiveInteger(request.canvas?.height, 'canvas height');
	const num = positiveInteger(request.canvas?.frameRate?.num, 'canvas frame rate numerator');
	const den = positiveInteger(request.canvas?.frameRate?.den, 'canvas frame rate denominator');
	return Object.freeze({
		codec: request.codec,
		width,
		height,
		framerate: num / den,
		bitrate: positiveInteger(request.bitrate, 'bitrate'),
		...(request.videoCodec === 'h264'
			? { avc: Object.freeze({ format: request.h264Format ?? 'annexb' }) }
			: {}),
	});
}

/**
 * Encode every frame of the source, writing an elementary stream as it goes.
 *
 * The first frame is asked for as a keyframe so the stream can be decoded from
 * its own start; after that the encoder decides, because a delivery is watched
 * from the beginning and a forced-keyframe cadence is a per-encoder tuning
 * decision this tier has no plan field for.
 */
export async function produceVideoWebCodecsStream(
	request: VideoWebCodecsProduceRequest,
): Promise<VideoWebCodecsProduceResult> {
	const { frameSource } = request;
	const { width, height, frameRate } = frameSource.canvas;
	const writer = createVideoElementaryStreamWriter({
		videoCodec: request.videoCodec,
		width,
		height,
		frameRate,
		frameCount: frameSource.frameCount,
	});
	let byteLength = 0;
	const header = writer.header();
	byteLength += header.byteLength;
	if (header.byteLength > 0) await request.write(header);
	let chunkIndex = 0;
	const encoded = await produceVideoWebCodecsChunks({
		...request,
		h264Format: 'annexb',
		async writeChunk(chunk) {
			const payload = new Uint8Array(chunk.byteLength);
			chunk.copyTo(payload);
			const bytes = writer.frame(payload, chunkIndex);
			chunkIndex += 1;
			byteLength += bytes.byteLength;
			await request.write(bytes);
		},
	});
	return Object.freeze({ ...encoded, byteLength });
}

/** Encode every exact frame while preserving WebCodecs chunk timing and decoder metadata. */
export async function produceVideoWebCodecsChunks(
	request: VideoWebCodecsChunkProduceRequest,
): Promise<VideoWebCodecsProduceResult> {
	const { frameSource, producer, videoFrameClass } = request;
	const { width, height, frameRate } = frameSource.canvas;
	const pending: {
		chunk: VideoWebCodecsEncodedChunk;
		metadata?: EncodedVideoChunkMetadata;
	}[] = [];
	let failure: unknown = null;
	const encoder = new request.encoderClass({
		output: (chunk, metadata) => {
			pending.push({ chunk, ...(metadata === undefined ? {} : { metadata }) });
		},
		error: (error) => { failure ??= error; },
	});
	const closeEncoder = (): void => {
		if (encoder.state === 'closed') return;
		try { encoder.close(); } catch { /* The active encode or abort failure remains primary. */ }
	};
	const onAbort = (): void => closeEncoder();
	request.signal?.addEventListener('abort', onAbort, { once: true });
	let chunkCount = 0;
	let byteLength = 0;
	const drain = async () => {
		while (pending.length > 0) {
			const next = pending.shift()!;
			chunkCount += 1;
			byteLength += next.chunk.byteLength;
			await request.writeChunk(next.chunk, next.metadata);
		}
	};

	try {
		encoder.configure(createVideoWebCodecsEncoderConfiguration({
			videoCodec: request.videoCodec,
			codec: request.codec,
			canvas: { width, height, frameRate },
			bitrate: request.bitrate,
			...(request.h264Format ? { h264Format: request.h264Format } : {}),
		}));
		const rgba = new Uint8Array(producer.byteLength);
		for (let index = 0; index < frameSource.frameCount; index += 1) {
			assertReady(request, failure);
			await producer.produce(frameSource.frame(index), rgba, signalOptions(request.signal));
			assertReady(request, failure);
			const videoFrame = new videoFrameClass(rgba, {
				format: 'RGBA',
				codedWidth: width,
				codedHeight: height,
				timestamp: frameTimestamp(index, frameRate),
				duration: frameTimestamp(index + 1, frameRate) - frameTimestamp(index, frameRate),
			});
			try {
				encoder.encode(videoFrame, { keyFrame: index === 0 });
			} finally {
				videoFrame.close();
			}
			await drain();
			while (encoder.encodeQueueSize > VIDEO_WEBCODECS_MAXIMUM_QUEUE_DEPTH) {
				assertReady(request, failure);
				await encoderTick(encoder);
				await drain();
			}
		}
		await awaitWithAbort(encoder.flush(), request.signal);
		assertReady(request, failure);
		await drain();
		return Object.freeze({ frameCount: frameSource.frameCount, chunkCount, byteLength });
	} finally {
		request.signal?.removeEventListener('abort', onAbort);
		closeEncoder();
	}
}

/** Exact presentation time in microseconds for one frame index. */
export function frameTimestamp(
	index: number,
	frameRate: Readonly<{ num: number; den: number }>,
): number {
	return Math.round((index * MICROSECONDS_PER_SECOND * frameRate.den) / frameRate.num);
}

function assertReady(
	request: Readonly<{ signal?: AbortSignal; assertCurrent?: () => void }>,
	failure: unknown,
): void {
	if (failure) throw failure;
	if (request.signal?.aborted) throw abortError();
	request.assertCurrent?.();
}

function signalOptions(signal: AbortSignal | undefined) {
	return signal ? Object.freeze({ signal }) : Object.freeze({});
}

function awaitWithAbort<Value>(operation: PromiseLike<Value>, signal?: AbortSignal): Promise<Value> {
	if (!signal) return Promise.resolve(operation);
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(abortError()));
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

/**
 * Wait for the encoder to make progress, yielding the thread while we do.
 *
 * This must not be a microtask. An encoder does its work in tasks, and its
 * output callbacks arrive as tasks; a loop that only ever awaits microtasks
 * never lets the queue drain, so waiting for it to shrink freezes the page
 * outright rather than merely spinning. That is exactly what happened before
 * the browser evidence ran, and no unit test could see it, because a
 * synchronous fake encoder never fills its queue in the first place.
 *
 * The `dequeue` event is the precise signal where a browser implements it; the
 * timer is both the fallback for those that do not and the bound that keeps a
 * queue which never drains from waiting forever on an event.
 */
function encoderTick(encoder: EncoderLike): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			encoder.removeEventListener?.('dequeue', finish);
			resolve();
		};
		const timer = setTimeout(finish, ENCODER_TICK_MS);
		encoder.addEventListener?.('dequeue', finish);
	});
}

function abortError(): Error {
	const error = new Error('The video export was cancelled.');
	error.name = 'AbortError';
	return error;
}

function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`Video WebCodecs ${name} must be a positive safe integer.`);
	}
	return value;
}
