/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed renderer/main contract for one main-owned external-FFmpeg video session. */

import {
	admitVideoKeyframeEncoderWorkload,
	type VideoKeyframeEncoderWorkload,
} from '../src/common/editor/video-keyframe-encoder-admission.ts';
import { VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES } from '../src/common/editor/video-keyframe-audio-input.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	VIDEO_DELIVERY_QUALITY_TIERS,
	type VideoDeliveryQuality,
} from '../src/common/editor/video-delivery-quality.ts';

export type DesktopVideoCodecFormat = 'mp4' | 'webm';

export interface DesktopVideoCodecOperationPlan {
	readonly schemaVersion: 1;
	readonly format: DesktopVideoCodecFormat;
	readonly quality: VideoDeliveryQuality;
	readonly width: number;
	readonly height: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly durationFrames: number;
	readonly videoInputBytes: number;
	readonly audioInputBytes: number | null;
	readonly ringCapacityBytes: number;
	readonly audioRingCapacityBytes: number | null;
	readonly maximumOutputBytes: number;
}

export interface DesktopExternalFfmpegVideoFiles {
	/** Main-owned output path. It is never accepted from a renderer DTO. */
	readonly outputPath: string;
}

export interface DesktopExternalFfmpegVideoExecutionPlan {
	readonly workload: VideoKeyframeEncoderWorkload;
	readonly ffmpegArguments: readonly string[];
}

export interface DesktopExternalFfmpegVideoCapabilities {
	readonly schemaVersion: 1;
	readonly formats: Readonly<Record<DesktopVideoCodecFormat, Readonly<{
		readonly available: boolean;
		readonly provider: 'external-ffmpeg' | null;
		readonly reason: string | null;
	}>>>;
}

const PLAN_FIELDS = new Set([
	'schemaVersion', 'format', 'quality', 'width', 'height', 'frameRate', 'frameCount',
	'sampleRate', 'durationFrames', 'videoInputBytes', 'audioInputBytes',
	'ringCapacityBytes', 'audioRingCapacityBytes', 'maximumOutputBytes',
]);
const RATE_FIELDS = new Set(['num', 'den']);
const VIDEO_SENTINEL = '/desktop-video-input.rgba';
const AUDIO_SENTINEL = '/desktop-audio-input.wav';
const MP4_OUTPUT_SENTINEL = '/desktop-video-output.mp4';
const WEBM_OUTPUT_SENTINEL = '/desktop-video-output.webm';
export const DESKTOP_VIDEO_CODEC_MAXIMUM_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024;

/** Re-admit all scalar geometry through the keyframe grammar and fail closed on drift. */
export function normalizeDesktopVideoCodecOperationPlan(
	value: unknown,
): DesktopVideoCodecOperationPlan {
	const record = closedRecord(value, PLAN_FIELDS, 'Desktop video codec operation plan');
	if (data(record, 'schemaVersion') !== 1) {
		throw new TypeError('Desktop video codec operation plan schemaVersion is unsupported.');
	}
	const format = enumValue(data(record, 'format'), ['mp4', 'webm'], 'format');
	const quality = enumValue(
		data(record, 'quality'), VIDEO_DELIVERY_QUALITY_TIERS, 'quality',
	);
	const width = positiveInteger(data(record, 'width'), 'width');
	const height = positiveInteger(data(record, 'height'), 'height');
	const rate = closedRecord(data(record, 'frameRate'), RATE_FIELDS, 'Desktop video frame rate');
	const frameRate = Object.freeze({
		num: positiveInteger(data(rate, 'num'), 'frame rate numerator'),
		den: positiveInteger(data(rate, 'den'), 'frame rate denominator'),
	});
	const frameCount = positiveInteger(data(record, 'frameCount'), 'frame count');
	const sampleRate = positiveInteger(data(record, 'sampleRate'), 'sample rate');
	const durationFrames = positiveInteger(data(record, 'durationFrames'), 'duration frames');
	const videoInputBytes = positiveInteger(data(record, 'videoInputBytes'), 'video input bytes');
	const audioInputBytes = nullablePositiveInteger(data(record, 'audioInputBytes'), 'audio input bytes');
	if (audioInputBytes !== null && audioInputBytes > VIDEO_KEYFRAME_AUDIO_MAXIMUM_BYTES) {
		throw new RangeError('Desktop video audio input exceeds its hard byte limit.');
	}
	const ringCapacityBytes = positiveInteger(data(record, 'ringCapacityBytes'), 'ring capacity');
	const audioRingCapacityBytes = nullablePositiveInteger(
		data(record, 'audioRingCapacityBytes'), 'audio ring capacity',
	);
	if ((audioInputBytes === null) !== (audioRingCapacityBytes === null)) {
		throw new TypeError('Desktop video audio bytes and ring capacity must be present together.');
	}
	const maximumOutputBytes = boundedInteger(
		data(record, 'maximumOutputBytes'), 1, DESKTOP_VIDEO_CODEC_MAXIMUM_OUTPUT_BYTES,
		'maximum output bytes',
	);
	const admitted = admittedWorkload({
		format, quality, width, height, frameRate, frameCount, sampleRate, durationFrames,
		videoInputBytes, audioInputBytes, ringCapacityBytes, audioRingCapacityBytes,
		maximumOutputBytes,
	});
	if (admitted.width !== width || admitted.height !== height
		|| admitted.frameRate.num !== frameRate.num || admitted.frameRate.den !== frameRate.den
		|| admitted.frameCount !== frameCount) {
		throw new RangeError('Desktop video plan geometry is not in exact admitted form.');
	}
	if (admitted.totalRgbaBytes !== videoInputBytes) {
		throw new RangeError('Desktop video plan has an invalid derived video input byte count.');
	}
	return Object.freeze({
		schemaVersion: 1, format, quality, width, height, frameRate, frameCount,
		sampleRate, durationFrames, videoInputBytes, audioInputBytes, ringCapacityBytes,
		audioRingCapacityBytes, maximumOutputBytes,
	});
}

/** Build the command from the shared admission grammar, then bind main-owned endpoints. */
export function createDesktopExternalFfmpegVideoWorkload(
	value: unknown,
	files: DesktopExternalFfmpegVideoFiles,
): DesktopExternalFfmpegVideoExecutionPlan {
	const plan = normalizeDesktopVideoCodecOperationPlan(value);
	if (!files || typeof files !== 'object' || Array.isArray(files)
		|| Reflect.ownKeys(files).length !== 1 || typeof files.outputPath !== 'string'
		|| files.outputPath.length < 1 || files.outputPath.length > 4_096
		|| files.outputPath.includes('\0')) {
		throw new TypeError('Desktop video output file authority is invalid.');
	}
	const workload = admittedWorkload(plan);
	const outputSentinel = outputPath(plan.format);
	const ffmpegArguments = Object.freeze(workload.ffmpegArguments.map((argument) => (
		argument === VIDEO_SENTINEL ? 'pipe:3'
			: argument === AUDIO_SENTINEL ? 'pipe:4'
				: argument === outputSentinel ? files.outputPath : argument
	)));
	if (ffmpegArguments.filter((argument) => argument === 'pipe:3').length !== 1
		|| ffmpegArguments.filter((argument) => argument === 'pipe:4').length
			!== (plan.audioInputBytes === null ? 0 : 1)
		|| ffmpegArguments.filter((argument) => argument === files.outputPath).length !== 1
		|| ffmpegArguments.at(-1) !== files.outputPath) {
		throw new Error('Desktop video FFmpeg endpoint binding did not preserve the admitted plan.');
	}
	return Object.freeze({ workload, ffmpegArguments });
}

/** Generic FFmpeg readiness is intentionally insufficient: each delivery tuple is exact. */
export function createDesktopExternalFfmpegVideoCapabilities(value: unknown): DesktopExternalFfmpegVideoCapabilities {
	const capabilities = recordOrNull(value)?.capabilities;
	const encoders = tokenSet(recordOrNull(capabilities)?.encoders);
	const decoders = tokenSet(recordOrNull(capabilities)?.decoders);
	const muxers = tokenSet(recordOrNull(capabilities)?.muxers);
	const demuxers = tokenSet(recordOrNull(capabilities)?.demuxers);
	const filters = tokenSet(recordOrNull(capabilities)?.filters);
	const configured = value !== null && value !== undefined;
	const capability = (
		format: DesktopVideoCodecFormat,
		requiredEncoders: readonly string[],
		requiredMuxer: string,
	) => {
		const available = requiredEncoders.every((encoder) => encoders.has(encoder))
			&& ['rawvideo', 'pcm_f32le'].every((decoder) => decoders.has(decoder))
			&& muxers.has(requiredMuxer)
			&& ['rawvideo', 'wav'].every((demuxer) => demuxers.has(demuxer))
			&& filters.has('apad');
		return Object.freeze(available
			? { available: true, provider: 'external-ffmpeg' as const, reason: null }
			: {
				available: false, provider: null, reason: configured
					? `The configured FFmpeg does not expose the exact ${format === 'mp4' ? 'H264/AAC MP4' : 'VP9/Opus WebM'} encoder and muxer set.`
					: `Desktop ${format === 'mp4' ? 'MP4' : 'WebM'} export needs a compatible external FFmpeg. Manage it in Edit > Preferences > General.`,
			});
	};
	return Object.freeze({
		schemaVersion: 1,
		formats: Object.freeze({
			mp4: capability('mp4', ['libx264', 'aac'], 'mp4'),
			webm: capability('webm', ['libvpx-vp9', 'libopus'], 'webm'),
		}),
	});
}

function admittedWorkload(plan: Omit<DesktopVideoCodecOperationPlan, 'schemaVersion'>): VideoKeyframeEncoderWorkload {
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: plan.sampleRate,
		startFrame: 0,
		endFrame: plan.durationFrames,
		canvas: Object.freeze({
			width: plan.width,
			height: plan.height,
			frameRate: plan.frameRate,
			fit: 'contain',
			backgroundColor: '#000000',
		}),
	});
	return admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: plan.format,
		quality: plan.quality,
		videoEncoder: 'ffmpeg',
		inputPath: VIDEO_SENTINEL,
		...(plan.audioInputBytes === null ? {} : {
			audioInputPath: AUDIO_SENTINEL,
			audioRingCapacityBytes: plan.audioRingCapacityBytes!,
		}),
		outputPath: outputPath(plan.format),
		ringCapacityBytes: plan.ringCapacityBytes,
	});
}

function outputPath(format: DesktopVideoCodecFormat): string {
	return format === 'mp4' ? MP4_OUTPUT_SENTINEL : WEBM_OUTPUT_SENTINEL;
}

function closedRecord(value: unknown, fields: ReadonlySet<string>, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !fields.has(key)) throw new TypeError(`${name} has an unsupported field.`);
		data(value as object, key);
	}
	return value as Record<string, unknown>;
}

function data(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Desktop video contract field ${key} must be an own data property.`);
	}
	return descriptor.value;
}

function positiveInteger(value: unknown, label: string): number {
	return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, label);
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
	return value === null ? null : positiveInteger(value, label);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)
		|| value < minimum || value > maximum) {
		throw new RangeError(`Desktop video ${label} is invalid.`);
	}
	return value;
}

function enumValue<Value extends string>(
	value: unknown,
	values: readonly Value[],
	label: string,
): Value {
	if (typeof value !== 'string' || !values.includes(value as Value)) {
		throw new RangeError(`Desktop video ${label} is unsupported.`);
	}
	return value as Value;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : null;
}

function tokenSet(value: unknown): ReadonlySet<string> {
	return new Set(Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);
}
