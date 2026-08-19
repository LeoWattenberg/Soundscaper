/* SPDX-License-Identifier: AGPL-3.0-only */

import { FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES } from '../ffmpeg-output-stream.ts';
import { admitVideoKeyframeAudioInput } from '../video-keyframe-audio-input.ts';
import {
	admitVideoKeyframeEncoderWorkload,
	type VideoKeyframeEncoderFormat,
	type VideoKeyframeEncoderWorkloadRequest,
} from '../video-keyframe-encoder-stream.ts';
import type { VideoKeyframeExportFrameSource } from '../video-keyframe-export-frame-source.ts';
import {
	VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES,
	type VideoKeyframeVideoEncoderRequest,
} from '../video-keyframe-video-encoder.ts';
import type { VideoDeliveryQuality } from '../video-delivery-quality.ts';
import type { VideoKeyframeOfflineRgbaRenderer } from './video-keyframe-offline-rgba-renderer.ts';

/**
 * What the delivery's capability probe decided, without the browser globals.
 *
 * The decision is made once, where the delivery is decided and reported, and
 * this layer supplies the encoder classes — so the report and the encoder that
 * runs cannot describe different things.
 */
export interface VideoKeyframeOfflineWebCodecsDecision {
	readonly codec: string;
	readonly bitrate: number;
}

export interface VideoKeyframeOfflineEncoderOptions {
	readonly format: VideoKeyframeEncoderFormat;
	readonly quality: VideoDeliveryQuality;
	readonly webCodecs?: VideoKeyframeOfflineWebCodecsDecision;
	readonly audioMix?: Blob;
	readonly encoderOptions: Readonly<Record<string, number>>;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

export function createVideoKeyframeOfflineEncoderRequest(
	request: VideoKeyframeOfflineEncoderOptions,
	frameSource: VideoKeyframeExportFrameSource,
	renderer: VideoKeyframeOfflineRgbaRenderer,
): VideoKeyframeVideoEncoderRequest {
	return Object.freeze({
		frameSource,
		producer: renderer,
		format: request.format,
		quality: request.quality,
		...(request.webCodecs ? { webCodecs: webCodecsEncode(request.webCodecs) } : {}),
		...(request.audioMix ? { audioMix: request.audioMix } : {}),
		...request.encoderOptions,
		signal: request.signal,
		assertCurrent: request.assertCurrent,
	});
}

/** Complete pure and float-WAV admission before digest, decoder, canvas, or GL work. */
export async function preflightVideoKeyframeOfflineEncoder(
	request: VideoKeyframeOfflineEncoderOptions,
	frameSource: VideoKeyframeExportFrameSource,
): Promise<void> {
	const workload: Record<string, unknown> = {
		frameSource,
		format: request.format,
		quality: request.quality,
		...(request.webCodecs ? { videoEncoder: 'webcodecs' as const } : {}),
		inputPath: '/framescaper-keyframes-preflight.rgba',
		...(request.audioMix ? { audioInputPath: '/framescaper-keyframes-preflight.wav' } : {}),
		outputPath: `/framescaper-keyframes-preflight.${request.format}`,
	};
	for (const key of [
		'ringCapacityBytes', 'audioRingCapacityBytes', 'maximumWidth', 'maximumHeight',
		'maximumFrameCount', 'maximumTotalRgbaBytes',
	] as const) {
		if (request.encoderOptions[key] !== undefined) workload[key] = request.encoderOptions[key];
	}
	admitVideoKeyframeEncoderWorkload(workload as unknown as VideoKeyframeEncoderWorkloadRequest);
	preflightOutputMaximum(
		request.encoderOptions.maximumOutputBytes,
		VIDEO_KEYFRAME_VIDEO_MAXIMUM_OUTPUT_BYTES,
		'maximumOutputBytes',
	);
	preflightOutputMaximum(
		request.encoderOptions.maximumOutputChunkBytes,
		FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES,
		'maximumOutputChunkBytes',
	);
	if (!request.audioMix) return;
	const audio = await admitVideoKeyframeAudioInput(request.audioMix, {
		...(request.encoderOptions.maximumAudioBytes === undefined
			? {} : { maximumBytes: request.encoderOptions.maximumAudioBytes }),
		signal: request.signal,
		assertCurrent: request.assertCurrent,
	});
	if (audio.sampleRate !== frameSource.sampleRate) {
		throw new RangeError(
			'Offline video float32 WAV sample rate must match the exact export project sample rate.',
		);
	}
	if (audio.frameCount !== frameSource.endFrame - frameSource.startFrame) {
		throw new RangeError(
			'Offline video float32 WAV frame count must match the exact export range.',
		);
	}
}

/**
 * The browser globals, resolved where the encode happens.
 *
 * A decision reached this far only because the probe found these, so their
 * absence is a broken environment rather than an unqualified browser — and a
 * clear failure is better than silently encoding on the other tier while the
 * delivery report says this one ran.
 */
function webCodecsEncode(decision: VideoKeyframeOfflineWebCodecsDecision) {
	const encoderClass = (globalThis as Record<string, unknown>).VideoEncoder;
	const videoFrameClass = (globalThis as Record<string, unknown>).VideoFrame;
	if (typeof encoderClass !== 'function' || typeof videoFrameClass !== 'function') {
		throw new Error('This browser no longer exposes the WebCodecs encoder this delivery was planned for.');
	}
	return Object.freeze({
		codec: decision.codec,
		bitrate: decision.bitrate,
		encoderClass,
		videoFrameClass,
	});
}

function preflightOutputMaximum(value: number | undefined, maximum: number, name: string): void {
	if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > maximum)) {
		throw new RangeError(
			`Offline video export ${name} must be a positive safe integer no greater than ${String(maximum)}.`,
		);
	}
}
