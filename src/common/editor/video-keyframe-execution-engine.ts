/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Running FFmpeg while something else fills its input rings.
 *
 * Two encoders drive this: the RGBA path, which writes raw frames and lets
 * FFmpeg compress them, and the WebCodecs path, which writes an already-encoded
 * elementary stream and lets FFmpeg only put a container on it. What they share
 * is the hard part — a producer and a subprocess running at once, either of
 * which can fail first, with rings, a lease, and an abort signal all needing to
 * be unwound exactly once and in the right order.
 *
 * That choreography lives here rather than in each encoder because cleanup that
 * differs between two delivery paths is precisely the class of defect no
 * golden-output comparison can see: both paths would still produce the right
 * bytes on the happy path and leak differently on the unhappy one.
 *
 * The one thing the two genuinely disagree about is how completion is known.
 * Raw frames have an exact expected byte total, so an FFmpeg that exits before
 * that many bytes were written consumed a truncated input. An encoded stream
 * has no such number — the encoder decides how large it is — so completion
 * there means the producer finished and closed its ring.
 */

import {
	writeVideoKeyframeAudioInput,
	type VideoKeyframeAudioInputSource,
} from './video-keyframe-audio-input.ts';
import type {
	VideoKeyframeEncoderFfmpegPort,
	VideoKeyframeFfmpegInputStream,
} from './video-keyframe-encoder-stream.ts';

export interface VideoKeyframeExecutionIncompleteMessages {
	/** Raised when FFmpeg finished before the video input was complete. */
	readonly video: string;
	/** Raised when a delivery carries audio and either input was incomplete. */
	readonly videoAndAudio: string;
}

export interface VideoKeyframeExecutionProductionContext {
	/** The tracked ring: every write through it is counted for completion. */
	readonly stream: VideoKeyframeFfmpegInputStream;
	/** Aborted as soon as either side fails, so a producer settles promptly. */
	readonly signal: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoKeyframeExecutionRequest {
	readonly ffmpeg: VideoKeyframeEncoderFfmpegPort;
	readonly videoStream: VideoKeyframeFfmpegInputStream;
	readonly audioStream?: VideoKeyframeFfmpegInputStream;
	readonly audioSource?: VideoKeyframeAudioInputSource;
	readonly audioRingCapacityBytes?: number;
	readonly ffmpegArguments: readonly string[];
	/** Must write the complete video input and close the stream. */
	produceVideo(context: VideoKeyframeExecutionProductionContext): Promise<void>;
	/** Exact expected total, or null when the encoder decides the size. */
	readonly expectedVideoBytes: number | null;
	readonly incompleteMessages: VideoKeyframeExecutionIncompleteMessages;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoKeyframeExecutionResult {
	readonly exitCode: 0;
	readonly videoByteLength: number;
	readonly videoChunkCount: number;
	readonly audioByteLength: number;
	readonly audioChunkCount: number;
}

export class VideoKeyframeEncoderExitError extends Error {
	readonly exitCode: number;

	constructor(exitCode: number) {
		super(`FFmpeg keyframe video encoding exited with code ${String(exitCode)}.`);
		this.name = 'VideoKeyframeEncoderExitError';
		this.exitCode = exitCode;
	}
}

/** Execute FFmpeg while the video and optional audio rings are filled concurrently. */
export async function runVideoKeyframeExecution(
	request: VideoKeyframeExecutionRequest,
): Promise<VideoKeyframeExecutionResult> {
	const {
		ffmpeg, videoStream, audioStream, audioSource, signal, assertCurrent,
	} = request;
	if ((audioStream === undefined) !== (audioSource === undefined)) {
		throw new Error('Video keyframe encoder audio stream and source ownership must match.');
	}
	let firstFailure: unknown;
	let hasFailure = false;
	const cleanupFailures: unknown[] = [];
	let streamsAborted = false;
	let executionStarted = false;
	let executionTerminated = false;
	let writtenVideoBytes = 0;
	let videoChunkCount = 0;
	let videoProductionComplete = false;
	let audioByteLength = 0;
	let audioChunkCount = 0;
	const operationAbort = new AbortController();
	let notifyFailure: ((outcome: OperationOutcome) => void) | null = null;
	const failureOutcome = new Promise<OperationOutcome>((resolve) => { notifyFailure = resolve; });
	const streams = audioStream ? [videoStream, audioStream] : [videoStream];
	const fail = (error: unknown): void => {
		if (!hasFailure) {
			firstFailure = error;
			hasFailure = true;
			notifyFailure?.({ kind: 'failure' });
		}
		if (!operationAbort.signal.aborted) operationAbort.abort(error);
		if (!streamsAborted) {
			streamsAborted = true;
			for (const stream of streams) {
				try { stream.abort(error); } catch (abortFailure) { cleanupFailures.push(abortFailure); }
			}
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
			request.ffmpegArguments,
			-1,
			signalOptions(operationAbort.signal),
		));
	} catch (error) {
		fail(error);
		execution = Promise.reject(error);
	}
	const videoIncomplete = (): boolean => (
		request.expectedVideoBytes === null
			? !videoProductionComplete
			: writtenVideoBytes !== request.expectedVideoBytes
	);
	const observedExecution: Promise<OperationOutcome> = execution.then((codeValue) => {
		const code = exactExitCode(codeValue);
		// The exit code first, because a subprocess that refused the job ends
		// while the ring is still being filled: checking completeness first
		// reported every real encoder failure as a truncated input and threw the
		// number that identifies it away. A short stream under a clean exit is
		// still the producer's fault and still says so.
		if (code !== 0) {
			const error = new VideoKeyframeEncoderExitError(code);
			fail(error);
			throw error;
		}
		if (videoIncomplete() || (audioSource && audioByteLength !== audioSource.byteLength)) {
			const error = new Error(
				audioSource
					? request.incompleteMessages.videoAndAudio
					: request.incompleteMessages.video,
			);
			fail(error);
			throw error;
		}
		return { kind: 'execution', code } as const;
	}, (error: unknown) => {
		fail(error);
		throw error;
	}).catch(() => ({ kind: 'failure' } as const));
	const trackedVideoStream: VideoKeyframeFfmpegInputStream = Object.freeze({
		path: videoStream.path,
		capacityBytes: videoStream.capacityBytes,
		async write(data: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>) {
			await videoStream.write(data, options);
			videoChunkCount += 1;
			writtenVideoBytes += data.byteLength;
		},
		close() {
			// Marked before the underlying close, because closing publishes EOF
			// and FFmpeg can return between the two. A later failure is still
			// caught: the race requires production to have succeeded as well.
			videoProductionComplete = true;
			return videoStream.close();
		},
		abort(reason?: unknown) { videoStream.abort(reason); },
		dispose() { return videoStream.dispose(); },
	});
	const videoProduction = request.produceVideo(Object.freeze({
		stream: trackedVideoStream,
		signal: operationAbort.signal,
		...(assertCurrent ? { assertCurrent } : {}),
	})).catch((error: unknown) => { fail(error); });
	const trackedAudioStream: VideoKeyframeFfmpegInputStream | undefined = audioStream
		? Object.freeze({
			path: audioStream.path,
			capacityBytes: audioStream.capacityBytes,
			async write(data: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>) {
				await audioStream.write(data, options);
				audioByteLength += data.byteLength;
			},
			close() { return audioStream.close(); },
			abort(reason?: unknown) { audioStream.abort(reason); },
			dispose() { return audioStream.dispose(); },
		})
		: undefined;
	const audioProduction = audioSource && trackedAudioStream
		? writeVideoKeyframeAudioInput(
			audioSource,
			trackedAudioStream,
			request.audioRingCapacityBytes!,
			{
				signal: operationAbort.signal,
				...(assertCurrent ? { assertCurrent } : {}),
			},
		).then((result) => {
			if (audioByteLength !== result.byteLength) {
				throw new Error('Video keyframe audio stream accounting did not match its exact WAV body.');
			}
			audioChunkCount = result.chunkCount;
		}, (error: unknown) => { fail(error); })
		: Promise.resolve();
	const production: Promise<OperationOutcome> = Promise.all([
		videoProduction,
		audioProduction,
	]).then(() => hasFailure
		? { kind: 'failure' } as const
		: { kind: 'production' } as const);
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
			videoByteLength: writtenVideoBytes,
			videoChunkCount,
			audioByteLength,
			audioChunkCount,
		});
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
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
