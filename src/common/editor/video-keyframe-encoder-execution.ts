/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The RGBA half of keyed encoding: render a frame, write it, let FFmpeg
 * compress it. The concurrency and cleanup live in the shared execution
 * engine, which the WebCodecs tier drives the same way with encoded chunks in
 * place of raw frames.
 */

import type { VideoKeyframeAudioInputSource } from './video-keyframe-audio-input.ts';
import type { VideoKeyframeEncoderWorkload } from './video-keyframe-encoder-admission.ts';
import {
	assertVideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import {
	runVideoKeyframeExecution,
	type VideoKeyframeExecutionProductionContext,
} from './video-keyframe-execution-engine.ts';
import type {
	VideoKeyframeEncoderFfmpegPort,
	VideoKeyframeEncoderResult,
	VideoKeyframeFfmpegInputStream,
	VideoKeyframeRgbaFrameProducer,
} from './video-keyframe-encoder-stream.ts';

export { VideoKeyframeEncoderExitError } from './video-keyframe-execution-engine.ts';

export interface VideoKeyframeEncoderExecutionRequest {
	readonly ffmpeg: VideoKeyframeEncoderFfmpegPort;
	readonly videoStream: VideoKeyframeFfmpegInputStream;
	readonly audioStream?: VideoKeyframeFfmpegInputStream;
	readonly audioSource?: VideoKeyframeAudioInputSource;
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly producer: VideoKeyframeRgbaFrameProducer;
	readonly target: Uint8Array<ArrayBuffer>;
	readonly workload: VideoKeyframeEncoderWorkload;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

/** Execute FFmpeg while video frames and the optional WAV body fill separate bounded rings. */
export async function executeVideoKeyframeEncoder(
	request: VideoKeyframeEncoderExecutionRequest,
): Promise<VideoKeyframeEncoderResult> {
	const { frameSource, producer, target, workload, signal, assertCurrent } = request;
	const executed = await runVideoKeyframeExecution({
		ffmpeg: request.ffmpeg,
		videoStream: request.videoStream,
		...(request.audioStream ? { audioStream: request.audioStream } : {}),
		...(request.audioSource ? { audioSource: request.audioSource } : {}),
		...(workload.audioRingCapacityBytes === undefined
			? {}
			: { audioRingCapacityBytes: workload.audioRingCapacityBytes }),
		ffmpegArguments: workload.ffmpegArguments,
		expectedVideoBytes: workload.totalRgbaBytes,
		incompleteMessages: Object.freeze({
			video: 'FFmpeg execution completed before every admitted RGBA frame was written.',
			videoAndAudio: 'FFmpeg execution completed before every admitted video and audio byte was written.',
		}),
		produceVideo: (context) => writeRgbaFrames(context, {
			frameSource, producer, target, workload, signal, assertCurrent,
		}),
		...(signal ? { signal } : {}),
		...(assertCurrent ? { assertCurrent } : {}),
	});
	return Object.freeze({
		exitCode: 0 as const,
		videoEncoder: 'ffmpeg' as const,
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
	});
}

interface RgbaProduction {
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly producer: VideoKeyframeRgbaFrameProducer;
	readonly target: Uint8Array<ArrayBuffer>;
	readonly workload: VideoKeyframeEncoderWorkload;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

async function writeRgbaFrames(
	context: VideoKeyframeExecutionProductionContext,
	production: RgbaProduction,
): Promise<void> {
	const { frameSource, producer, target, workload, signal, assertCurrent } = production;
	const ready = () => assertEncodingReady(signal, context.signal, assertCurrent);
	for (let index = 0; index < workload.frameCount; index += 1) {
		ready();
		const frame: unknown = frameSource.frame(index);
		assertVideoKeyframeExportFrame(frameSource, frame);
		const expectedBuffer = target.buffer;
		const produced: unknown = await producer.produce(
			frame,
			target,
			signalOptions(context.signal) ?? {},
		);
		if (produced !== undefined) {
			throw new TypeError('Video keyframe RGBA producers must return void and cannot replace the target.');
		}
		if (target.buffer !== expectedBuffer || target.byteOffset !== 0
			|| target.byteLength !== workload.frameBytes
			|| expectedBuffer.byteLength !== workload.frameBytes) {
			throw new Error('The video keyframe producer did not retain the exact reusable RGBA allocation.');
		}
		ready();
		for (let offset = 0; offset < workload.frameBytes; offset += workload.ringCapacityBytes) {
			ready();
			const end = Math.min(workload.frameBytes, offset + workload.ringCapacityBytes);
			await context.stream.write(target.subarray(offset, end), signalOptions(context.signal));
			ready();
		}
	}
	ready();
	await context.stream.close();
	ready();
}

function assertEncodingReady(
	signal: AbortSignal | undefined,
	operationSignal: AbortSignal,
	assertCurrent: (() => void) | undefined,
): void {
	if (operationSignal.aborted) throw operationSignal.reason ?? abortError();
	if (signal?.aborted) throw signal.reason ?? abortError();
	assertCurrent?.();
}

function signalOptions(
	signal: AbortSignal | undefined,
): Readonly<{ signal?: AbortSignal }> | undefined {
	return signal ? { signal } : undefined;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
