/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	writeVideoKeyframeAudioInput,
	type VideoKeyframeAudioInputSource,
} from './video-keyframe-audio-input.ts';
import type { VideoKeyframeEncoderWorkload } from './video-keyframe-encoder-admission.ts';
import {
	assertVideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import type {
	VideoKeyframeEncoderFfmpegPort,
	VideoKeyframeEncoderResult,
	VideoKeyframeFfmpegInputStream,
	VideoKeyframeRgbaFrameProducer,
} from './video-keyframe-encoder-stream.ts';

export class VideoKeyframeEncoderExitError extends Error {
	readonly exitCode: number;

	constructor(exitCode: number) {
		super(`FFmpeg keyframe video encoding exited with code ${String(exitCode)}.`);
		this.name = 'VideoKeyframeEncoderExitError';
		this.exitCode = exitCode;
	}
}

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
	const {
		ffmpeg, videoStream, audioStream, audioSource, frameSource, producer,
		target, workload, signal, assertCurrent,
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
		if (writtenVideoBytes !== workload.totalRgbaBytes
			|| (audioSource && audioByteLength !== audioSource.byteLength)) {
			const error = new Error(
				audioSource
					? 'FFmpeg execution completed before every admitted video and audio byte was written.'
					: 'FFmpeg execution completed before every admitted RGBA frame was written.',
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
	const videoProduction = (async (): Promise<void> => {
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
				await videoStream.write(chunk, signalOptions(operationAbort.signal));
				videoChunkCount += 1;
				writtenVideoBytes += chunk.byteLength;
				assertEncodingReady(signal, operationAbort.signal, assertCurrent);
			}
		}
		assertEncodingReady(signal, operationAbort.signal, assertCurrent);
		await videoStream.close();
		assertEncodingReady(signal, operationAbort.signal, assertCurrent);
	})().catch((error: unknown) => { fail(error); });
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
			workload.audioRingCapacityBytes!,
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
			frameCount: workload.frameCount,
			frameBytes: workload.frameBytes,
			totalRgbaBytes: workload.totalRgbaBytes,
			chunkCount: videoChunkCount,
			...(audioSource ? { audioByteLength, audioChunkCount } : {}),
			format: workload.format,
			extension: workload.extension,
			mimeType: workload.mimeType,
			inputPath: workload.inputPath,
			...(workload.audioInputPath ? { audioInputPath: workload.audioInputPath } : {}),
			outputPath: workload.outputPath,
			ffmpegArguments: workload.ffmpegArguments,
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

function assertEncodingReady(
	signal: AbortSignal | undefined,
	operationSignal: AbortSignal,
	assertCurrent: (() => void) | undefined,
): void {
	if (operationSignal.aborted) throw operationSignal.reason ?? abortError();
	assertReady(signal, assertCurrent);
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
