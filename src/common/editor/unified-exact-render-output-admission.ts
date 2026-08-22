/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
} from './video-keyframe-encoder-admission.ts';

interface UnifiedOutputAdmission {
	readonly version: 9 | 10 | 11 | 12;
	readonly format: Readonly<{ readonly container: 'mp4' | 'webm' }>;
	readonly codecs: Readonly<{
		readonly video: string;
		readonly videoEncoder: string;
		readonly audio: string | null;
		readonly audioEncoder: string | null;
		readonly pixelFormat: string;
	}>;
	readonly output: Readonly<{
		readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly frameCount: number;
		readonly canvas: Readonly<{ readonly width: number; readonly height: number; readonly pixelFormat: string }>;
		readonly includeAudio: boolean;
	}>;
}

const CLOSED_TUPLES = Object.freeze({
	9: tuples(),
	10: tuples(),
	11: tuples(),
	12: tuples(),
});

/** Close every generation over one reproducible delivery tuple and work domain. */
export function assertUnifiedExactRenderOutputAdmission(value: UnifiedOutputAdmission): void {
	const descriptor = CLOSED_TUPLES[value.version][value.format.container];
	const codecs = value.codecs;
	if (codecs.video !== descriptor.video || codecs.videoEncoder !== descriptor.videoEncoder
		|| codecs.audio !== null || codecs.audioEncoder !== null
		|| codecs.pixelFormat !== descriptor.pixelFormat
		|| value.output.canvas.pixelFormat !== descriptor.pixelFormat
		|| value.output.includeAudio) {
		throw new RangeError(`Unified V${String(value.version)} codec tuple does not match its exact ${value.format.container} format.`);
	}
	const { width, height } = value.output.canvas;
	if (width % 2 !== 0 || height % 2 !== 0
		|| width > VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH
		|| height > VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT) {
		throw new RangeError('Unified render canvas escapes its exact even encoder geometry.');
	}
	const frameBytes = BigInt(width) * BigInt(height) * 4n;
	if (frameBytes > BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES)) {
		throw new RangeError('Unified render canvas exceeds the bounded RGBA frame work domain.');
	}
	if (value.output.frameCount > VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT
		|| frameBytes * BigInt(value.output.frameCount)
			> BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES)) {
		throw new RangeError('Unified render output exceeds the bounded encoder work domain.');
	}
	const rate = value.output.frameRate;
	if (BigInt(rate.num) < BigInt(rate.den)
		|| BigInt(rate.num) > BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE) * BigInt(rate.den)) {
		throw new RangeError('Unified render output rate escapes its exact 1 through 30 fps domain.');
	}
}

function tuples() {
	return Object.freeze({
		mp4: Object.freeze({ video: 'h264', videoEncoder: 'libx264', pixelFormat: 'yuv420p' }),
		webm: Object.freeze({ video: 'vp9', videoEncoder: 'libvpx-vp9', pixelFormat: 'yuv420p' }),
	});
}
