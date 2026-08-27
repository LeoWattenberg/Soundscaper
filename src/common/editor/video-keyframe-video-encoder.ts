/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitVideoKeyframeAudioInput } from './video-keyframe-audio-input.ts';
import {
	admitVideoKeyframeEncoderWorkload,
	type VideoKeyframeEncoderFormat,
	type VideoKeyframeEncoderResult,
	type VideoKeyframeVideoEncoderTier,
} from './video-keyframe-encoder-stream.ts';
import type { VideoDeliveryQuality } from './video-delivery-quality.ts';
import { resolveVideoDeliveryFfmpegQuality } from './video-delivery-quality.ts';
import type {
	VideoKeyframeExportFrame,
	VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import {
	assertReady,
	createCryptographicJobToken,
	encoderWorkloadRequest,
	jobToken,
	manageProducer,
	normalizeDependencies,
	normalizeRequest,
	operationOptions,
	validateEditorFfmpeg,
	validateLease,
	videoInputExtension,
	type NormalizedRequest,
} from './video-keyframe-video-encoder-admission.ts';
import type {
	VideoKeyframeEncoderOperationLease,
	VideoKeyframeVideoEditorFfmpeg,
} from './video-keyframe-ffmpeg-operation.ts';
import type { VideoKeyframeWebCodecsEncode } from './video-keyframe-webcodecs-execution.ts';
import type {
	VideoKeyframeMediabunnyExecutionRequest,
	VideoKeyframeMediabunnyExecutionResult,
} from './video-keyframe-mediabunny-execution.ts';
import type { FfmpegOutputFileSource, FfmpegOutputSink } from './ffmpeg-output-stream.ts';
import {
	collectVideoKeyframeVideoOutput,
	streamVideoKeyframeVideoOutput,
} from './video-keyframe-video-output.ts';
import {
	runVideoKeyframeVideoOperation,
	type VideoKeyframeDeliveredOutput,
} from './video-keyframe-video-operation.ts';
import { manageVideoKeyframeOutputSink } from './video-keyframe-video-sink.ts';

export { VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES } from './video-keyframe-video-output.ts';
export type {
	VideoKeyframeEncoderOperationLease,
	VideoKeyframeEncoderOperationOptions,
	VideoKeyframeVideoEditorFfmpeg,
} from './video-keyframe-ffmpeg-operation.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface VideoKeyframeVideoRgbaProducer {
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
	produce(
		frame: VideoKeyframeExportFrame,
		target: Uint8Array<ArrayBuffer>,
		options: Readonly<{ signal: AbortSignal }>,
	): Awaitable<void>;
	dispose(): Awaitable<void>;
}

export interface VideoKeyframeVideoEncoderRequest {
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly producer: VideoKeyframeVideoRgbaProducer;
	readonly format: VideoKeyframeEncoderFormat;
	readonly quality?: VideoDeliveryQuality;
	/** Present when the delivery's capability probe chose the browser's encoder. */
	readonly webCodecs?: VideoKeyframeWebCodecsEncode;
	readonly audioMix?: Blob;
	readonly ringCapacityBytes?: number;
	readonly audioRingCapacityBytes?: number;
	readonly maximumAudioBytes?: number;
	readonly maximumWidth?: number;
	readonly maximumHeight?: number;
	readonly maximumFrameCount?: number;
	readonly maximumTotalRgbaBytes?: number;
	readonly maximumOutputBytes?: number;
	readonly maximumOutputChunkBytes?: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoKeyframeVideoEncoderResult {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly byteLength: number;
	/** Which encoder compressed the picture, reported rather than assumed. */
	readonly videoEncoder: VideoKeyframeVideoEncoderTier;
	readonly codec?: string;
	readonly format: VideoKeyframeEncoderFormat;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly frameCount: number;
	readonly rgbaChunkCount: number;
	readonly audioByteLength?: number;
	readonly audioChunkCount?: number;
	readonly outputChunkCount: number;
}

export interface VideoKeyframeVideoSinkEncoderResult<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly videoEncoder: VideoKeyframeVideoEncoderTier;
	readonly codec?: string;
	readonly format: VideoKeyframeEncoderFormat;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly frameCount: number;
	readonly rgbaChunkCount: number;
	readonly audioByteLength?: number;
	readonly audioChunkCount?: number;
	readonly outputChunkCount: number;
}

export interface VideoKeyframeVideoEncoderDependencies {
	createJobToken(): string;
	executeBrowserWebCodecs?(
		request: VideoKeyframeMediabunnyExecutionRequest,
	): Promise<VideoKeyframeMediabunnyExecutionResult>;
}

const DEFAULT_DEPENDENCIES: VideoKeyframeVideoEncoderDependencies = Object.freeze({
	createJobToken: createCryptographicJobToken,
	async executeBrowserWebCodecs(request: VideoKeyframeMediabunnyExecutionRequest) {
		const { executeVideoKeyframeMediabunnyEncoder } = await import(
			'./video-keyframe-mediabunny-execution.ts'
		);
		return executeVideoKeyframeMediabunnyEncoder(request);
	},
});

/** Encode one authenticated exact-frame source without exposing MEMFS path authority. */
export async function encodeVideoKeyframeVideo(
	editorFfmpegValue: VideoKeyframeVideoEditorFfmpeg,
	requestValue: VideoKeyframeVideoEncoderRequest,
	dependenciesValue: VideoKeyframeVideoEncoderDependencies = DEFAULT_DEPENDENCIES,
): Promise<VideoKeyframeVideoEncoderResult> {
	const result = await encodeManaged(
		editorFfmpegValue,
		requestValue,
		dependenciesValue,
		(request) => Object.freeze({
			async deliver(lease: VideoKeyframeEncoderOperationLease, path: string) {
				const output = await collectVideoKeyframeVideoOutput({
					source: lease,
					path,
					format: request.format,
					maximumBytes: request.maximumOutputBytes,
					maximumChunkBytes: request.maximumOutputChunkBytes,
					signal: request.signal,
					assertCurrent: request.assertCurrent,
				});
				return Object.freeze({
					output: output.bytes,
					byteLength: output.byteLength,
					chunkCount: output.chunkCount,
				});
			},
			deliverNative(bytes: Uint8Array<ArrayBuffer>, path: string) {
				return collectVideoKeyframeVideoOutput({
					source: nativeOutputSource(bytes),
					path,
					format: request.format,
					maximumBytes: request.maximumOutputBytes,
					maximumChunkBytes: request.maximumOutputChunkBytes,
					signal: request.signal,
					assertCurrent: request.assertCurrent,
				}).then((output) => Object.freeze({
					output: output.bytes,
					byteLength: output.byteLength,
					chunkCount: output.chunkCount,
				}));
			},
			discard(output: Uint8Array<ArrayBuffer>) { output.fill(0); },
		}),
	);
	return Object.freeze({
		bytes: result.delivered.output,
		...resultMetadata(result.encoded, result.delivered),
	});
}

/** Deliver directly through bounded ranges before the generation-scoped lease is released. */
export async function encodeVideoKeyframeVideoToSink<Output>(
	editorFfmpegValue: VideoKeyframeVideoEditorFfmpeg,
	requestValue: VideoKeyframeVideoEncoderRequest,
	sinkValue: FfmpegOutputSink<Output>,
	dependenciesValue: VideoKeyframeVideoEncoderDependencies = DEFAULT_DEPENDENCIES,
): Promise<VideoKeyframeVideoSinkEncoderResult<Output>> {
	const managedSink = manageVideoKeyframeOutputSink(sinkValue);
	try {
		const result = await encodeManaged(
			editorFfmpegValue,
			requestValue,
			dependenciesValue,
			(request) => Object.freeze({
				async deliver(lease: VideoKeyframeEncoderOperationLease, path: string) {
					return streamVideoKeyframeVideoOutput({
						source: lease,
						path,
						format: request.format,
						maximumBytes: request.maximumOutputBytes,
						maximumChunkBytes: request.maximumOutputChunkBytes,
						signal: request.signal,
						assertCurrent: request.assertCurrent,
					}, managedSink.value);
				},
				deliverNative(bytes: Uint8Array<ArrayBuffer>, path: string) {
					return streamVideoKeyframeVideoOutput({
						source: nativeOutputSource(bytes),
						path,
						format: request.format,
						maximumBytes: request.maximumOutputBytes,
						maximumChunkBytes: request.maximumOutputChunkBytes,
						signal: request.signal,
						assertCurrent: request.assertCurrent,
					}, managedSink.value);
				},
			}),
		);
		return Object.freeze({
			output: result.delivered.output,
			...resultMetadata(result.encoded, result.delivered),
		});
	} catch (error) {
		throw await managedSink.abort(error);
	}
}

interface DeliveryStrategy<Output> {
	deliver(
		lease: VideoKeyframeEncoderOperationLease,
		path: string,
	): Promise<VideoKeyframeDeliveredOutput<Output>>;
	deliverNative(
		bytes: Uint8Array<ArrayBuffer>,
		path: string,
	): Promise<VideoKeyframeDeliveredOutput<Output>>;
	discard?(output: Output): void;
}

async function encodeManaged<Output>(
	editorFfmpegValue: VideoKeyframeVideoEditorFfmpeg,
	requestValue: VideoKeyframeVideoEncoderRequest,
	dependenciesValue: VideoKeyframeVideoEncoderDependencies,
	createDelivery: (request: NormalizedRequest) => DeliveryStrategy<Output>,
) {
	const request = normalizeRequest(requestValue);
	const dependencies = normalizeDependencies(dependenciesValue);
	const editorFfmpeg = request.webCodecs ? null : validateEditorFfmpeg(editorFfmpegValue);
	const delivery = createDelivery(request);
	const managedProducer = manageProducer(request.producer, request.frameSource);
	let result: Readonly<{
		encoded: VideoKeyframeEncoderResult | VideoKeyframeMediabunnyExecutionResult;
		delivered: VideoKeyframeDeliveredOutput<Output>;
	}> | null = null;
	let primary: unknown;
	let hasPrimary = false;
	try {
		assertReady(request.signal, request.assertCurrent);
		const audioSource = request.audioMix
			? await admitVideoKeyframeAudioInput(request.audioMix, {
				maximumBytes: request.maximumAudioBytes,
				...(request.signal ? { signal: request.signal } : {}),
				...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
			})
			: undefined;
		if (audioSource) {
			if (audioSource.sampleRate !== request.frameSource.sampleRate) {
				throw new RangeError(
					'Video keyframe float32 WAV sample rate must match the exact export project sample rate.',
				);
			}
			if (audioSource.frameCount
				!== request.frameSource.endFrame - request.frameSource.startFrame) {
				throw new RangeError(
					'Video keyframe float32 WAV frame count must match the exact export range.',
				);
			}
		}
		assertReady(request.signal, request.assertCurrent);
		const token = jobToken(dependencies.createJobToken());
		const paths = Object.freeze({
			// Named for what actually flows through it: raw frames on one tier,
			// an elementary stream on the other.
			input: `/framescaper-keyframes-${token}.${videoInputExtension(request)}`,
			...(audioSource ? { audio: `/framescaper-keyframes-${token}.wav` } : {}),
			output: `/framescaper-keyframes-${token}.${request.format}`,
		});
		const workloadRequest = encoderWorkloadRequest(request, paths);
		// Admitted here as the tier it will actually run as, so a workload the
		// lower encoder would refuse is refused before a lease is taken.
		const admittedWorkload = admitVideoKeyframeEncoderWorkload(request.webCodecs
			? { ...workloadRequest, videoEncoder: 'webcodecs' }
			: workloadRequest);
		if (request.webCodecs) {
			const execute = dependencies.executeBrowserWebCodecs ?? DEFAULT_DEPENDENCIES.executeBrowserWebCodecs!;
			const audioBitrate = audioSource
				? resolveVideoDeliveryFfmpegQuality(request.format, request.quality).audioBitRateKbps * 1_000
				: undefined;
			const encoded = await execute({
				workload: admittedWorkload,
				frameSource: request.frameSource,
				producer: managedProducer.value,
				webCodecs: request.webCodecs,
				...(audioSource ? { audioSource, audioBitrate } : {}),
				maximumOutputBytes: request.maximumOutputBytes,
				...(request.signal ? { signal: request.signal } : {}),
				...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
			});
			let delivered: VideoKeyframeDeliveredOutput<Output>;
			try {
				delivered = await delivery.deliverNative(encoded.bytes, paths.output);
			} finally {
				encoded.bytes.fill(0);
			}
			result = Object.freeze({ encoded, delivered });
		} else {
			result = await editorFfmpeg!.runVideoKeyframeEncoderOperation(
				(leaseValue) => {
					const lease = validateLease(leaseValue);
					return runVideoKeyframeVideoOperation({
						lease,
						workload: workloadRequest,
						producer: managedProducer.value,
						...(audioSource ? { audioSource } : {}),
						outputPath: paths.output,
						format: request.format,
						...(request.signal ? { signal: request.signal } : {}),
						...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
						deliver: delivery.deliver,
						...(delivery.discard ? { discard: delivery.discard } : {}),
					});
				},
				operationOptions(request, admittedWorkload, audioSource?.byteLength ?? null),
			);
		}
	} catch (error) {
		primary = error;
		hasPrimary = true;
	}
	if (!managedProducer.disposed()) {
		try { await managedProducer.value.dispose(); } catch (error) {
			if (result && delivery.discard) {
				try { delivery.discard(result.delivered.output); } catch (discardError) {
					error = new AggregateError([error, discardError], 'Producer and output cleanup failed.');
				}
			}
			if (hasPrimary) {
				throw new AggregateError(
					[primary, error],
					'Video keyframe encoding and producer cleanup did not both complete successfully.',
				);
			}
			throw error;
		}
	}
	if (hasPrimary) throw primary;
	if (!result) throw new Error('Video keyframe encoding produced no exact result.');
	return result;
}

function nativeOutputSource(bytes: Uint8Array<ArrayBuffer>): FfmpegOutputFileSource {
	return Object.freeze({
		async statFile() { return Object.freeze({ size: bytes.byteLength }); },
		async readFileRange(_path: string, offset: number, maximumBytes: number) {
			return bytes.slice(offset, offset + maximumBytes);
		},
	});
}

function resultMetadata<Output>(
	encoded: VideoKeyframeEncoderResult | VideoKeyframeMediabunnyExecutionResult,
	delivered: VideoKeyframeDeliveredOutput<Output>,
) {
	return Object.freeze({
		byteLength: delivered.byteLength,
		videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		format: encoded.format,
		extension: encoded.extension,
		mimeType: encoded.mimeType,
		frameCount: encoded.frameCount,
		rgbaChunkCount: encoded.chunkCount,
		...(encoded.audioByteLength === undefined ? {} : {
			audioByteLength: encoded.audioByteLength,
			audioChunkCount: encoded.audioChunkCount,
		}),
		outputChunkCount: delivered.chunkCount,
	});
}
