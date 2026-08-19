/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeAudioInputSource } from './video-keyframe-audio-input.ts';
import {
	encodeVideoKeyframeFrames,
	type VideoKeyframeEncoderFormat,
	type VideoKeyframeEncoderResult,
	type VideoKeyframeEncoderWorkloadRequest,
	type VideoKeyframeRgbaFrameProducer,
} from './video-keyframe-encoder-stream.ts';
import type { VideoKeyframeEncoderOperationLease } from './video-keyframe-ffmpeg-operation.ts';
import type { VideoKeyframeWebCodecsEncode } from './video-keyframe-webcodecs-execution.ts';

export interface VideoKeyframeDeliveredOutput<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly chunkCount: number;
}

export interface VideoKeyframeVideoOperationRequest<Output> {
	readonly lease: VideoKeyframeEncoderOperationLease;
	readonly workload: VideoKeyframeEncoderWorkloadRequest;
	readonly producer: VideoKeyframeRgbaFrameProducer;
	/** Present when the browser's encoder, not FFmpeg, compresses the picture. */
	readonly webCodecs?: VideoKeyframeWebCodecsEncode;
	readonly audioSource?: VideoKeyframeAudioInputSource;
	readonly outputPath: string;
	readonly format: VideoKeyframeEncoderFormat;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	deliver(
		lease: VideoKeyframeEncoderOperationLease,
		path: string,
		options: Readonly<{
			format: VideoKeyframeEncoderFormat;
			signal?: AbortSignal;
			assertCurrent?: () => void;
		}>,
	): Promise<VideoKeyframeDeliveredOutput<Output>>;
	discard?(output: Output): void;
}

export interface VideoKeyframeVideoOperationResult<Output> {
	readonly encoded: VideoKeyframeEncoderResult;
	readonly delivered: VideoKeyframeDeliveredOutput<Output>;
}

/** Encode and deliver one finalized output before deleting it inside the same lease. */
export async function runVideoKeyframeVideoOperation<Output>(
	request: VideoKeyframeVideoOperationRequest<Output>,
): Promise<VideoKeyframeVideoOperationResult<Output>> {
	const lease = request.lease;
	let encoded: VideoKeyframeEncoderResult | null = null;
	let delivered: VideoKeyframeDeliveredOutput<Output> | null = null;
	let primary: unknown;
	let hasPrimary = false;
	const cleanupFailures: unknown[] = [];
	try {
		encoded = await encodeVideoKeyframeFrames({
			...request.workload,
			producer: request.producer,
			...(request.webCodecs ? { webCodecs: request.webCodecs } : {}),
			...(request.audioSource ? { audioSource: request.audioSource } : {}),
			ffmpeg: lease,
			...(request.signal ? { signal: request.signal } : {}),
			...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
		});
		delivered = await request.deliver(lease, request.outputPath, Object.freeze({
			format: request.format,
			...(request.signal ? { signal: request.signal } : {}),
			...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
		}));
	} catch (error) {
		primary = error;
		hasPrimary = true;
	}
	if (!lease.isExecutionTerminated()) {
		try { await lease.deleteFile(request.outputPath); } catch (error) {
			cleanupFailures.push(error);
			try { lease.terminateExecution(error); } catch (terminationError) {
				cleanupFailures.push(terminationError);
			}
		}
	}
	if (!hasPrimary && cleanupFailures.length === 0) {
		try { assertReady(request.signal, request.assertCurrent); } catch (error) {
			primary = error;
			hasPrimary = true;
		}
	}
	if (hasPrimary || cleanupFailures.length > 0) {
		if (delivered && request.discard) {
			try { request.discard(delivered.output); } catch (error) { cleanupFailures.push(error); }
		}
		if (hasPrimary && cleanupFailures.length === 0) throw primary;
		if (!hasPrimary && cleanupFailures.length === 1) throw cleanupFailures[0];
		throw new AggregateError(
			hasPrimary ? [primary, ...cleanupFailures] : cleanupFailures,
			'Video keyframe encoding and MEMFS cleanup did not both complete successfully.',
		);
	}
	if (!encoded || !delivered) {
		throw new Error('Video keyframe encoding produced no delivered output.');
	}
	return Object.freeze({ encoded, delivered });
}

function assertReady(signal: AbortSignal | undefined, assertCurrent: (() => void) | undefined): void {
	if (signal?.aborted) throw signal.reason ?? abortError();
	assertCurrent?.();
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
