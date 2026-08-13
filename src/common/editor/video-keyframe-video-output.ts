/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertBrowserExportOutputSize,
	BROWSER_EXPORT_BLOB_MAXIMUM_BYTES,
} from './browser-export-output.ts';
import {
	FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES,
	streamFfmpegOutputFile,
	type FfmpegOutputFileSource,
	type FfmpegOutputSink,
} from './ffmpeg-output-stream.ts';
import type { VideoKeyframeEncoderFormat } from './video-keyframe-encoder-admission.ts';
import { assertFiniteVideoKeyframeContainer } from './video-keyframe-video-container.ts';
import {
	assertFiniteVideoKeyframeContainerFile,
	sinkForVideoKeyframeContainerEvidence,
	sourceForVideoKeyframeContainerEvidence,
} from './video-keyframe-video-container-stream.ts';
import { manageVideoKeyframeOutputSink } from './video-keyframe-video-sink.ts';

export const VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES = BROWSER_EXPORT_BLOB_MAXIMUM_BYTES;

export interface VideoKeyframeVideoOutputRequest {
	readonly source: FfmpegOutputFileSource;
	readonly path: string;
	readonly format: VideoKeyframeEncoderFormat;
	readonly maximumBytes?: number;
	readonly maximumChunkBytes?: number;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

export interface VideoKeyframeVideoOutput {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly byteLength: number;
	readonly chunkCount: number;
}

export interface VideoKeyframeVideoSinkOutput<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly chunkCount: number;
}

/** Copy one admitted MEMFS file through exact bounded ranges into an owned allocation. */
export async function collectVideoKeyframeVideoOutput(
	requestValue: VideoKeyframeVideoOutputRequest,
): Promise<VideoKeyframeVideoOutput> {
	const request = normalizeRequest(requestValue);
	const maximumBytes = normalizeMaximumBytes(request.maximumBytes);
	const maximumChunkBytes = normalizeMaximumChunkBytes(request.maximumChunkBytes);
	const sink = createOutputSink(request.format, maximumBytes);
	const result = await streamFfmpegOutputFile(request.source, request.path, sink, {
		maximumChunkBytes,
		signal: request.signal,
		assertCurrent: request.assertCurrent,
	});
	return Object.freeze({
		bytes: result.output,
		byteLength: result.byteLength,
		chunkCount: result.chunkCount,
	});
}

/** Stream one admitted MEMFS video into a caller-owned sink without a file-sized allocation. */
export async function streamVideoKeyframeVideoOutput<Output>(
	requestValue: VideoKeyframeVideoOutputRequest,
	sink: FfmpegOutputSink<Output>,
): Promise<VideoKeyframeVideoSinkOutput<Output>> {
	const request = normalizeRequest(requestValue);
	const maximumBytes = normalizeMaximumBytes(request.maximumBytes);
	const maximumChunkBytes = normalizeMaximumChunkBytes(request.maximumChunkBytes);
	const managedSink = manageVideoKeyframeOutputSink(sink);
	const evidence = await assertFiniteVideoKeyframeContainerFile(
		request.source,
		request.path,
		request.format,
		{
			maximumBytes,
			...(request.signal ? { signal: request.signal } : {}),
			...(request.assertCurrent ? { assertCurrent: request.assertCurrent } : {}),
		},
	);
	return streamFfmpegOutputFile(
		sourceForVideoKeyframeContainerEvidence(request.source, request.path, evidence),
		request.path,
		sinkForVideoKeyframeContainerEvidence(managedSink.value, evidence),
		{
			maximumChunkBytes,
			signal: request.signal,
			assertCurrent: request.assertCurrent,
		},
	);
}

function normalizeRequest(value: VideoKeyframeVideoOutputRequest): VideoKeyframeVideoOutputRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Video keyframe output request must be a plain object.');
	}
	const allowed = new Set([
		'source', 'path', 'format', 'maximumBytes', 'maximumChunkBytes', 'signal', 'assertCurrent',
	]);
	const admitted: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError('Video keyframe output request has an unsupported field.');
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Video keyframe output request.${key} must be an enumerable own data property.`);
		}
		admitted[key] = descriptor.value;
	}
	if (admitted.format !== 'mp4' && admitted.format !== 'webm') {
		throw new TypeError('Video keyframe output request format must be mp4 or webm.');
	}
	if (typeof admitted.path !== 'string') {
		throw new TypeError('Video keyframe output request path must be a string.');
	}
	if (admitted.signal !== undefined
		&& (typeof AbortSignal !== 'function' || !(admitted.signal instanceof AbortSignal))) {
		throw new TypeError('Video keyframe output request signal must be an AbortSignal.');
	}
	if (admitted.assertCurrent !== undefined && typeof admitted.assertCurrent !== 'function') {
		throw new TypeError('Video keyframe output request assertCurrent must be a function.');
	}
	return Object.freeze(admitted) as unknown as VideoKeyframeVideoOutputRequest;
}

function createOutputSink(
	format: VideoKeyframeEncoderFormat,
	maximumBytes: number,
): FfmpegOutputSink<Uint8Array<ArrayBuffer>> {
	let allocation: Uint8Array<ArrayBuffer> | null = null;
	let offset = 0;
	return Object.freeze({
		async open(exactByteLength: number): Promise<void> {
			assertBrowserExportOutputSize(
				exactByteLength, 'Video keyframe export', maximumBytes,
			);
			if (exactByteLength === 0) {
				throw new RangeError('Video keyframe export output must be non-empty.');
			}
			allocation = new Uint8Array(exactByteLength);
		},
		async write(chunk: Uint8Array): Promise<void> {
			if (!allocation || offset + chunk.byteLength > allocation.byteLength) {
				throw new Error('Video keyframe export ranges exceed their admitted output allocation.');
			}
			allocation.set(chunk, offset);
			offset += chunk.byteLength;
		},
		async close(): Promise<Uint8Array<ArrayBuffer>> {
			if (!allocation || offset !== allocation.byteLength) {
				throw new Error('Video keyframe export ranges did not fill their admitted output allocation.');
			}
			assertFiniteVideoKeyframeContainer(allocation, format);
			const output = allocation;
			allocation = null;
			return output;
		},
		async abort(): Promise<void> {
			allocation?.fill(0);
			allocation = null;
		},
	});
}

function normalizeMaximumBytes(value: number | undefined): number {
	const maximum = value ?? VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES;
	if (!Number.isSafeInteger(maximum) || maximum <= 0
		|| maximum > VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError(
			`Video keyframe export maximumOutputBytes must be a positive safe integer no greater than ${String(VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES)}.`,
		);
	}
	return maximum;
}

function normalizeMaximumChunkBytes(value: number | undefined): number {
	const maximum = value ?? FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES;
	if (!Number.isSafeInteger(maximum) || maximum <= 0
		|| maximum > FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES) {
		throw new RangeError(
			`Video keyframe export maximumOutputChunkBytes must be a positive safe integer no greater than ${String(FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES)}.`,
		);
	}
	return maximum;
}
