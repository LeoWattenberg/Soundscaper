/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
} from './video-keyframe-encoder-admission.ts';
import { NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM } from './native-media-image-sequence.ts';
import { nativeRgbaFramePackV1ByteLength } from './native-rgba-frame-pack-v1-contract.ts';
import {
	nativeMediaV14EncodeDispatch,
	type NativeMediaV14EncodeProfileId,
} from './native-media-v14-native-dispatch.ts';

interface UnifiedOutputAdmission {
	readonly version: 9 | 10 | 11 | 12 | 13 | 14 | 15;
	readonly deliveryProfile?: NativeMediaV14EncodeProfileId;
	readonly format: Readonly<{ readonly container: 'mp4' | 'webm' | 'mov' | 'mxf' | 'matroska' | 'image2' }>;
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

const LEGACY_TUPLES = Object.freeze({
	mp4: Object.freeze({ container: 'mp4', video: 'h264', videoEncoder: 'libx264', pixelFormat: 'yuv420p', audioEncoder: null, imageSequence: false }),
	webm: Object.freeze({ container: 'webm', video: 'vp9', videoEncoder: 'libvpx-vp9', pixelFormat: 'yuv420p', audioEncoder: null, imageSequence: false }),
});

/** Close every generation over one reproducible delivery tuple and work domain. */
export function assertUnifiedExactRenderOutputAdmission(value: UnifiedOutputAdmission): void {
	const descriptor = value.version === 14 || value.version === 15
		? professionalDescriptor(value.deliveryProfile)
		: LEGACY_TUPLES[value.format.container as keyof typeof LEGACY_TUPLES];
	if (!descriptor || descriptor.container !== value.format.container) {
		throw new RangeError(`Unified V${String(value.version)} container ${value.format.container} is unavailable.`);
	}
	const codecs = value.codecs;
	const audioMatches = value.output.includeAudio
		? descriptor.audioEncoder !== null
			&& codecs.audio === descriptor.audioEncoder && codecs.audioEncoder === descriptor.audioEncoder
		: codecs.audio === null && codecs.audioEncoder === null;
	if (codecs.video !== descriptor.video || codecs.videoEncoder !== descriptor.videoEncoder
		|| !audioMatches || codecs.pixelFormat !== descriptor.pixelFormat
		|| value.output.canvas.pixelFormat !== descriptor.pixelFormat) {
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
	const workExceedsBound = value.version === 14 || value.version === 15
		? (() => {
			try {
				nativeRgbaFramePackV1ByteLength({ width, height, frameCount: value.output.frameCount });
				return false;
			} catch { return true; }
		})()
		: frameBytes * BigInt(value.output.frameCount)
			> BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES);
	if (value.output.frameCount > VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT || workExceedsBound) {
		throw new RangeError('Unified render output exceeds the bounded encoder work domain.');
	}
	const rate = value.output.frameRate;
	const rateInvalid = descriptor.imageSequence === true
		? rate.num > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM
			|| rate.den > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM
		: BigInt(rate.num) < BigInt(rate.den)
			|| BigInt(rate.num) > BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE)
				* BigInt(rate.den);
	if (rateInvalid) {
		throw new RangeError(descriptor.imageSequence === true
			? 'Unified image-sequence output rate escapes its exact rational-term domain.'
			: 'Unified render output rate escapes its exact 1 through 30 fps domain.');
	}
}

function professionalDescriptor(profileId: NativeMediaV14EncodeProfileId | undefined) {
	if (profileId === undefined) return null;
	const row = nativeMediaV14EncodeDispatch(profileId);
	return Object.freeze({
		container: row.muxer,
		video: profileId === 'encode-mp4-h264' ? 'h264'
			: profileId.startsWith('encode-hevc-') ? 'hevc'
				: profileId === 'encode-webm-vp9' ? 'vp9'
					: profileId.startsWith('encode-mov-prores-') ? 'prores'
						: profileId === 'encode-mxf-dnxhr-hqx' ? 'dnxhr'
							: profileId === 'encode-matroska-ffv1' ? 'ffv1'
								: row.encoder,
		videoEncoder: row.encoder, pixelFormat: row.pixelFormat, audioEncoder: row.audioEncoder,
		imageSequence: row.imageSequence,
	});
}
