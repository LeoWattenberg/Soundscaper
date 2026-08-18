/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Driving a `VideoEncoder` from the offline RGBA frame source.
 *
 * This is the WebCodecs tier's producer. It renders the same frames the FFmpeg
 * path renders, hands each one to the browser's encoder, and emits the encoded
 * chunks as an elementary stream for `video-remux-ffmpeg.ts` to put a container
 * on. Nothing here decides what the delivery is: the canvas, the rate, and the
 * quality tier all come from the plan, and this only asks a different encoder
 * to produce them.
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

type Awaitable<Value> = PromiseLike<Value> | Value;

interface EncodedChunkLike {
	readonly byteLength: number;
	copyTo(target: Uint8Array): void;
}

interface EncoderLike {
	readonly encodeQueueSize: number;
	readonly state: string;
	configure(config: Readonly<Record<string, unknown>>): void;
	encode(frame: unknown, options?: Readonly<{ keyFrame?: boolean }>): void;
	flush(): Promise<void>;
	close(): void;
}

interface EncoderConstructor {
	new (callbacks: Readonly<{
		output: (chunk: EncodedChunkLike, metadata?: unknown) => void;
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
	const { frameSource, producer, videoFrameClass } = request;
	const { width, height, frameRate } = frameSource.canvas;
	const writer = createVideoElementaryStreamWriter({
		videoCodec: request.videoCodec,
		width,
		height,
		frameRate,
		frameCount: frameSource.frameCount,
	});
	const pending: Uint8Array[] = [];
	let failure: unknown = null;
	const encoder = new request.encoderClass({
		output: (chunk) => {
			const bytes = new Uint8Array(chunk.byteLength);
			chunk.copyTo(bytes);
			pending.push(bytes);
		},
		error: (error) => { failure ??= error; },
	});
	let chunkCount = 0;
	let byteLength = 0;
	const drain = async () => {
		while (pending.length > 0) {
			const bytes = writer.frame(pending.shift()!, chunkCount);
			chunkCount += 1;
			byteLength += bytes.byteLength;
			await request.write(bytes);
		}
	};

	try {
		encoder.configure({
			codec: request.codec,
			width,
			height,
			framerate: frameRate.num / frameRate.den,
			bitrate: request.bitrate,
			...(request.videoCodec === 'h264' ? { avc: { format: 'annexb' } } : {}),
		});
		const header = writer.header();
		byteLength += header.byteLength;
		if (header.byteLength > 0) await request.write(header);

		const rgba = new Uint8Array(producer.byteLength);
		for (let index = 0; index < frameSource.frameCount; index += 1) {
			assertReady(request, failure);
			await producer.produce(frameSource.frame(index), rgba, signalOptions(request.signal));
			assertReady(request, failure);
			const videoFrame = new videoFrameClass(rgba, {
				format: 'RGBA',
				codedWidth: width,
				codedHeight: height,
				// Microseconds from the rational directly: a decimal rate would
				// drift a frame every few minutes at 30000/1001.
				timestamp: frameTimestamp(index, frameRate),
				duration: frameTimestamp(1, frameRate),
			});
			try {
				encoder.encode(videoFrame, { keyFrame: index === 0 });
			} finally {
				videoFrame.close();
			}
			await drain();
			while (encoder.encodeQueueSize > VIDEO_WEBCODECS_MAXIMUM_QUEUE_DEPTH) {
				assertReady(request, failure);
				await encoderTick();
				await drain();
			}
		}
		await encoder.flush();
		assertReady(request, failure);
		await drain();
		return Object.freeze({ frameCount: frameSource.frameCount, chunkCount, byteLength });
	} finally {
		if (encoder.state !== 'closed') encoder.close();
	}
}

/** Exact presentation time in microseconds for one frame index. */
export function frameTimestamp(
	index: number,
	frameRate: Readonly<{ num: number; den: number }>,
): number {
	return Math.round((index * MICROSECONDS_PER_SECOND * frameRate.den) / frameRate.num);
}

function assertReady(request: VideoWebCodecsProduceRequest, failure: unknown): void {
	if (failure) throw failure;
	if (request.signal?.aborted) throw abortError();
	request.assertCurrent?.();
}

function signalOptions(signal: AbortSignal | undefined) {
	return signal ? Object.freeze({ signal }) : Object.freeze({});
}

function encoderTick(): Promise<void> {
	return new Promise((resolve) => { queueMicrotask(() => { resolve(); }); });
}

function abortError(): Error {
	const error = new Error('The video export was cancelled.');
	error.name = 'AbortError';
	return error;
}
