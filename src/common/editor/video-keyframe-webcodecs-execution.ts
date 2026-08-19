/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The WebCodecs half of keyed encoding.
 *
 * Same plan, same frames, same container, same audio — the picture is simply
 * compressed by the browser's encoder instead of by FFmpeg, and what reaches
 * the ring is an elementary stream rather than raw RGBA. FFmpeg still runs, and
 * still writes the container, so a delivery produced here is the same kind of
 * file the FFmpeg tier produces rather than a second, parallel format.
 *
 * The frame and producer guarantees are the RGBA path's, enforced here rather
 * than assumed: a frame is authenticated against its source before it is drawn,
 * and a producer that returns something, or swaps the buffer out from under
 * the encoder, is refused. Two tiers that admitted different things would be
 * two products.
 */

import {
	assertVideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import type { VideoKeyframeAudioInputSource } from './video-keyframe-audio-input.ts';
import type { VideoKeyframeEncoderWorkload } from './video-keyframe-encoder-admission.ts';
import type {
	VideoKeyframeEncoderFfmpegPort,
	VideoKeyframeEncoderResult,
	VideoKeyframeFfmpegInputStream,
	VideoKeyframeRgbaFrameProducer,
} from './video-keyframe-encoder-stream.ts';
import {
	runVideoKeyframeExecution,
	type VideoKeyframeExecutionProductionContext,
} from './video-keyframe-execution-engine.ts';
import { produceVideoWebCodecsStream } from './video-webcodecs-producer.ts';

/** What the capability probe decided, carried down to the encoder that runs. */
export interface VideoKeyframeWebCodecsEncode {
	/** The full codec string `VideoEncoder.isConfigSupported` accepted. */
	readonly codec: string;
	readonly bitrate: number;
	readonly encoderClass: unknown;
	readonly videoFrameClass: unknown;
}

export interface VideoKeyframeWebCodecsExecutionRequest {
	readonly ffmpeg: VideoKeyframeEncoderFfmpegPort;
	readonly videoStream: VideoKeyframeFfmpegInputStream;
	readonly audioStream?: VideoKeyframeFfmpegInputStream;
	readonly audioSource?: VideoKeyframeAudioInputSource;
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly producer: VideoKeyframeRgbaFrameProducer;
	readonly workload: VideoKeyframeEncoderWorkload;
	readonly webCodecs: VideoKeyframeWebCodecsEncode;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

/** Encode with `VideoEncoder` while FFmpeg puts the plan's container on the result. */
export async function executeVideoKeyframeWebCodecsEncoder(
	request: VideoKeyframeWebCodecsExecutionRequest,
): Promise<VideoKeyframeEncoderResult> {
	const { workload, webCodecs } = request;
	if (workload.videoEncoder !== 'webcodecs') {
		throw new Error('A WebCodecs keyed encode requires a WebCodecs-admitted workload.');
	}
	const executed = await runVideoKeyframeExecution({
		ffmpeg: request.ffmpeg,
		videoStream: request.videoStream,
		...(request.audioStream ? { audioStream: request.audioStream } : {}),
		...(request.audioSource ? { audioSource: request.audioSource } : {}),
		...(workload.audioRingCapacityBytes === undefined
			? {}
			: { audioRingCapacityBytes: workload.audioRingCapacityBytes }),
		ffmpegArguments: workload.ffmpegArguments,
		// The encoder decides how large a compressed stream is, so completion
		// is the producer having finished rather than a byte total known ahead.
		expectedVideoBytes: null,
		incompleteMessages: Object.freeze({
			video: 'FFmpeg execution completed before the encoded video stream was complete.',
			videoAndAudio: 'FFmpeg execution completed before the encoded video and audio streams were complete.',
		}),
		produceVideo: (context) => writeEncodedStream(context, request),
		...(request.signal ? { signal: request.signal } : {}),
		...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
	});
	return Object.freeze({
		exitCode: 0 as const,
		videoEncoder: 'webcodecs' as const,
		frameCount: workload.frameCount,
		frameBytes: workload.frameBytes,
		totalRgbaBytes: workload.totalRgbaBytes,
		videoByteLength: executed.videoByteLength,
		chunkCount: executed.videoChunkCount,
		...(request.audioSource
			? { audioByteLength: executed.audioByteLength, audioChunkCount: executed.audioChunkCount }
			: {}),
		format: workload.format,
		extension: workload.extension,
		mimeType: workload.mimeType,
		inputPath: workload.inputPath,
		...(workload.audioInputPath ? { audioInputPath: workload.audioInputPath } : {}),
		outputPath: workload.outputPath,
		ffmpegArguments: workload.ffmpegArguments,
		codec: webCodecs.codec,
	});
}

async function writeEncodedStream(
	context: VideoKeyframeExecutionProductionContext,
	request: VideoKeyframeWebCodecsExecutionRequest,
): Promise<void> {
	const { workload, webCodecs, frameSource, producer } = request;
	await produceVideoWebCodecsStream({
		frameSource: authenticatedFrameSource(frameSource, workload),
		producer: guardedProducer(producer, workload),
		videoCodec: workload.elementaryFormat === 'ivf' ? 'vp9' : 'h264',
		codec: webCodecs.codec,
		bitrate: webCodecs.bitrate,
		encoderClass: webCodecs.encoderClass as never,
		videoFrameClass: webCodecs.videoFrameClass as never,
		// Split against the ring exactly as the RGBA tier splits a frame. An
		// encoded frame is normally far smaller than the ring, but a keyframe at
		// the high tier on the largest admissible canvas is not guaranteed to be:
		// the ring refuses a write past its capacity outright, which would fail a
		// delivery minutes into rendering rather than fall back to anything.
		write: (bytes) => writeThroughRing(context, workload, bytes),
		signal: context.signal,
		...(context.assertCurrent ? { assertCurrent: context.assertCurrent } : {}),
	});
	await context.stream.close();
}

/** Hand the ring at most its capacity at a time, in order. */
async function writeThroughRing(
	context: VideoKeyframeExecutionProductionContext,
	workload: VideoKeyframeEncoderWorkload,
	bytes: Uint8Array,
): Promise<void> {
	const capacity = workload.ringCapacityBytes;
	if (bytes.byteLength <= capacity) {
		await context.stream.write(bytes, { signal: context.signal });
		return;
	}
	for (let offset = 0; offset < bytes.byteLength; offset += capacity) {
		await context.stream.write(
			bytes.subarray(offset, Math.min(bytes.byteLength, offset + capacity)),
			{ signal: context.signal },
		);
	}
}

/** Frames are authenticated against their own source, exactly as the RGBA tier does. */
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
		async produce(
			frame: unknown,
			target: Uint8Array,
			options: Readonly<{ signal?: AbortSignal }>,
		): Promise<void> {
			const expectedBuffer = target.buffer;
			const produced: unknown = await producer.produce(
				frame as never,
				target as Uint8Array<ArrayBuffer>,
				options,
			);
			if (produced !== undefined) {
				throw new TypeError('Video keyframe RGBA producers must return void and cannot replace the target.');
			}
			if (target.buffer !== expectedBuffer || target.byteOffset !== 0
				|| target.byteLength !== workload.frameBytes
				|| expectedBuffer.byteLength !== workload.frameBytes) {
				throw new Error('The video keyframe producer did not retain the exact reusable RGBA allocation.');
			}
		},
	});
}
