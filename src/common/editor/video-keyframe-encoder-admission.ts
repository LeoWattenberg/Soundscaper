/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import {
	AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE,
	AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE,
} from './project-v10-foundation-validation.ts';
import { VIDEO_CANVAS_MAXIMUM_EXTENT } from './video-canvas-fit.ts';
import {
	normalizeVideoDeliveryQuality,
	resolveVideoDeliveryFfmpegQuality,
	type VideoDeliveryFfmpegQuality,
	type VideoDeliveryQuality,
} from './video-delivery-quality.ts';

const RGBA_BYTES_PER_PIXEL = 4;
const DEFAULT_RING_CAPACITY_BYTES = 1024 * 1024;
const MINIMUM_RING_CAPACITY_BYTES = 4_096;
/** One RGBA frame must fit this, which is the real ceiling on a keyed canvas. */
export const VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES = 8 * 1024 * 1024;
const MAXIMUM_RING_CAPACITY_BYTES = VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES;
const MAXIMUM_PATH_CHARACTERS = 1_024;
const MAXIMUM_PATH_BYTES = 1_024;

/**
 * The extent ceiling, which is not what actually bounds a keyed encode.
 *
 * These were 1280x720 — the automatic canvas ceiling of the era, copied here —
 * and they refused a 720x1280 portrait frame that costs exactly the same memory
 * as the landscape one they admitted. The real bound is `MAXIMUM_RING_CAPACITY_BYTES`
 * below: one RGBA frame must fit 8 MiB, which caps a canvas at about 2.09
 * megapixels however its extents are arranged. These now state only what an
 * extent may be, and the frame-byte limit decides.
 */
export const VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH = VIDEO_CANVAS_MAXIMUM_EXTENT;
export const VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT = VIDEO_CANVAS_MAXIMUM_EXTENT;
export const VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE = 30;
export const VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT = 2_000_000;
export const VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES = 1024 ** 4;
export const VIDEO_KEYFRAME_ENCODER_MAXIMUM_AGGREGATE_RING_BYTES = 16 * 1024 * 1024;

export type VideoKeyframeEncoderFormat = 'mp4' | 'webm';

export interface VideoKeyframeEncoderWorkloadRequest {
	readonly frameSource: VideoKeyframeExportFrameSource;
	readonly format: VideoKeyframeEncoderFormat;
	/** The delivery tier; absent means the one every keyed export encoded at. */
	readonly quality?: VideoDeliveryQuality;
	/**
	 * Which encoder produced the video input. `ffmpeg` means raw RGBA frames
	 * for FFmpeg to compress; `webcodecs` means an already-encoded elementary
	 * stream that only needs a container. Absent means `ffmpeg`.
	 */
	readonly videoEncoder?: VideoKeyframeVideoEncoderTier;
	readonly inputPath: string;
	readonly audioInputPath?: string;
	readonly outputPath: string;
	readonly ringCapacityBytes?: number;
	readonly audioRingCapacityBytes?: number;
	readonly maximumWidth?: number;
	readonly maximumHeight?: number;
	readonly maximumFrameCount?: number;
	readonly maximumTotalRgbaBytes?: number;
}

export type VideoKeyframeVideoEncoderTier = 'ffmpeg' | 'webcodecs';

export interface VideoKeyframeEncoderWorkload {
	readonly videoEncoder: VideoKeyframeVideoEncoderTier;
	/** The elementary-stream container a WebCodecs input must be framed as. */
	readonly elementaryFormat: 'h264' | 'ivf';
	readonly width: number;
	readonly height: number;
	readonly frameRate: Readonly<{ num: number; den: number }>;
	readonly frameCount: number;
	readonly frameBytes: number;
	readonly totalRgbaBytes: number;
	readonly ringCapacityBytes: number;
	readonly chunksPerFrame: number;
	readonly format: VideoKeyframeEncoderFormat;
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly inputPath: string;
	readonly audioInputPath?: string;
	readonly outputPath: string;
	readonly audioRingCapacityBytes?: number;
	readonly aggregateRingCapacityBytes?: number;
	readonly ffmpegArguments: readonly string[];
}

interface VideoEncodingDescriptor {
	readonly extension: '.mp4' | '.webm';
	readonly mimeType: 'video/mp4' | 'video/webm';
	readonly audioFrameSamples: 960 | 1_024;
	/** How a pre-encoded stream for this container has to be framed. */
	readonly elementaryFormat: 'h264' | 'ivf';
	arguments(
		frameRate: string,
		audioPadSamples: number | null,
		quality: VideoDeliveryFfmpegQuality,
		videoEncoder: VideoKeyframeVideoEncoderTier,
	): readonly string[];
}

/**
 * The video half of the command, which is the only part a tier decides.
 *
 * Everything else — mapping, metadata stripping, the audio encoder, the
 * container — is written once per format below and shared, so a WebCodecs
 * delivery and an FFmpeg delivery of the same plan differ in how the picture
 * was compressed and in nothing else. Audio in particular must not diverge:
 * it is the same staged mix at the same tier-derived bit rate either way.
 */
function videoArguments(
	videoEncoder: VideoKeyframeVideoEncoderTier,
	frameRate: string,
	encoded: readonly string[],
): readonly string[] {
	// The chunks arrive already compressed, and the input rate was declared
	// where the elementary stream was opened; a copy may state neither again.
	return videoEncoder === 'webcodecs'
		? ['-c:v', 'copy']
		: [...encoded, '-pix_fmt', 'yuv420p', '-r', frameRate];
}

const VIDEO_ENCODING_DESCRIPTORS: Readonly<Record<VideoKeyframeEncoderFormat, VideoEncodingDescriptor>> =
	Object.freeze({
		mp4: Object.freeze({
			extension: '.mp4' as const,
			mimeType: 'video/mp4' as const,
			audioFrameSamples: 1_024 as const,
			elementaryFormat: 'h264' as const,
			arguments: (
				frameRate: string, audioPadSamples: number | null, quality: VideoDeliveryFfmpegQuality,
				videoEncoder: VideoKeyframeVideoEncoderTier,
			) => Object.freeze([
				...(audioPadSamples === null ? [] : ['-filter:a', `apad=whole_len=${String(audioPadSamples)}`]),
				'-map', '0:v:0', ...(audioPadSamples === null ? [] : ['-map', '1:a:0']),
				'-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
				...videoArguments(videoEncoder, frameRate, [
					'-c:v', 'libx264', '-preset', String(quality.preset), '-crf', String(quality.crf),
				]),
				...(audioPadSamples === null
					? ['-an']
					: ['-c:a', 'aac', '-b:a', `${String(quality.audioBitRateKbps)}k`]),
				'-movflags', '+faststart', '-f', 'mp4',
			]),
		}),
		webm: Object.freeze({
			extension: '.webm' as const,
			mimeType: 'video/webm' as const,
			audioFrameSamples: 960 as const,
			elementaryFormat: 'ivf' as const,
			arguments: (
				frameRate: string, audioPadSamples: number | null, quality: VideoDeliveryFfmpegQuality,
				videoEncoder: VideoKeyframeVideoEncoderTier,
			) => Object.freeze([
				...(audioPadSamples === null ? [] : ['-filter:a', `apad=whole_len=${String(audioPadSamples)}`]),
				'-map', '0:v:0', ...(audioPadSamples === null ? [] : ['-map', '1:a:0']),
				'-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
				...videoArguments(videoEncoder, frameRate, [
					'-c:v', 'libvpx-vp9', '-crf', String(quality.crf), '-b:v', '0',
					'-deadline', String(quality.deadline), '-cpu-used', String(quality.cpuUsed),
				]),
				...(audioPadSamples === null
					? ['-an']
					: ['-c:a', 'libopus', '-b:a', `${String(quality.audioBitRateKbps)}k`]),
				'-f', 'webm',
			]),
		}),
	});

const WORKLOAD_FIELDS = new Set([
	'frameSource', 'format', 'quality', 'videoEncoder', 'inputPath', 'audioInputPath', 'outputPath',
	'ringCapacityBytes', 'audioRingCapacityBytes',
	'maximumWidth', 'maximumHeight', 'maximumFrameCount', 'maximumTotalRgbaBytes',
]);

/** Purely admit exact logical work and construct one finite video-only or A/V command. */
export function admitVideoKeyframeEncoderWorkload(
	requestValue: VideoKeyframeEncoderWorkloadRequest,
): VideoKeyframeEncoderWorkload {
	const request = closedRecord(requestValue, WORKLOAD_FIELDS, 'video keyframe encoder workload');
	const sourceValue = dataProperty(
		request, 'frameSource', 'video keyframe encoder workload',
	);
	assertVideoKeyframeExportFrameSource(sourceValue);
	const source = validateFrameSource(sourceValue);
	const maximumWidth = lowerMaximum(
		request, 'maximumWidth', VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
	);
	const maximumHeight = lowerMaximum(
		request, 'maximumHeight', VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	);
	const maximumFrameCount = lowerMaximum(
		request, 'maximumFrameCount', VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	);
	const maximumTotalRgbaBytes = lowerMaximum(
		request, 'maximumTotalRgbaBytes', VIDEO_KEYFRAME_ENCODER_MAXIMUM_TOTAL_RGBA_BYTES,
	);
	const width = boundedPositiveInteger(
		source.canvas.width, maximumWidth, 'Video keyframe encoder width',
	);
	const height = boundedPositiveInteger(
		source.canvas.height, maximumHeight, 'Video keyframe encoder height',
	);
	if (width % 2 !== 0 || height % 2 !== 0) {
		throw new RangeError('Video keyframe encoder yuv420p canvas dimensions must be even.');
	}
	const frameCount = boundedPositiveInteger(
		source.frameCount, maximumFrameCount, 'Video keyframe encoder frame count',
	);
	const frameBytesBig = BigInt(width) * BigInt(height) * BigInt(RGBA_BYTES_PER_PIXEL);
	if (frameBytesBig > BigInt(MAXIMUM_RING_CAPACITY_BYTES)) {
		throw new RangeError('Video keyframe encoder frame bytes exceed the 8 MiB stream hard limit.');
	}
	const frameBytes = Number(frameBytesBig);
	const totalRgbaBytesBig = frameBytesBig * BigInt(frameCount);
	if (totalRgbaBytesBig > BigInt(maximumTotalRgbaBytes)) {
		throw new RangeError(
			`Video keyframe encoder logical RGBA work exceeds its configured maximum of ${String(maximumTotalRgbaBytes)} bytes.`,
		);
	}
	const format = videoFormat(dataProperty(request, 'format', 'video keyframe encoder workload'));
	const descriptor = VIDEO_ENCODING_DESCRIPTORS[format];
	const videoEncoder = videoEncoderTier(optionalDataProperty(
		request, 'videoEncoder', 'ffmpeg', 'video keyframe encoder workload',
	));
	// The tier the plan stated, read here rather than baked into the descriptor,
	// so this path and the composed-graph path spell the same tier the same way.
	const quality = resolveVideoDeliveryFfmpegQuality(format, normalizeVideoDeliveryQuality(
		optionalDataProperty(request, 'quality', undefined, 'video keyframe encoder workload'),
		'Video keyframe encoder quality',
	));
	const inputPath = canonicalPath(
		dataProperty(request, 'inputPath', 'video keyframe encoder workload'), 'input path',
	);
	const outputPath = canonicalPath(
		dataProperty(request, 'outputPath', 'video keyframe encoder workload'), 'output path',
	);
	if (inputPath === outputPath) throw new TypeError('Video keyframe encoder input and output paths must differ.');
	const hasAudio = Object.hasOwn(request, 'audioInputPath');
	const audioInputPath = hasAudio
		? canonicalPath(
			dataProperty(request, 'audioInputPath', 'video keyframe encoder workload'),
			'audio input path',
		)
		: undefined;
	if (audioInputPath === inputPath || audioInputPath === outputPath) {
		throw new TypeError('Video keyframe encoder video, audio, and output input paths must differ.');
	}
	if (!hasAudio && Object.hasOwn(request, 'audioRingCapacityBytes')) {
		throw new TypeError('Video keyframe encoder audioRingCapacityBytes requires audioInputPath.');
	}
	if (!outputPath.endsWith(descriptor.extension)) {
		throw new TypeError(`Video keyframe encoder ${format} output path must end with ${descriptor.extension}.`);
	}
	const ringCapacityBytes = boundedInteger(
		optionalDataProperty(
			request, 'ringCapacityBytes', DEFAULT_RING_CAPACITY_BYTES,
			'video keyframe encoder workload',
		),
		MINIMUM_RING_CAPACITY_BYTES,
		MAXIMUM_RING_CAPACITY_BYTES,
		'Video keyframe encoder ringCapacityBytes',
	);
	const audioRingCapacityBytes = hasAudio
		? boundedInteger(
			optionalDataProperty(
				request, 'audioRingCapacityBytes', DEFAULT_RING_CAPACITY_BYTES,
				'video keyframe encoder workload',
			),
			MINIMUM_RING_CAPACITY_BYTES,
			MAXIMUM_RING_CAPACITY_BYTES,
			'Video keyframe encoder audioRingCapacityBytes',
		)
		: undefined;
	const aggregateRingCapacityBytes = ringCapacityBytes + (audioRingCapacityBytes ?? 0);
	if (aggregateRingCapacityBytes > VIDEO_KEYFRAME_ENCODER_MAXIMUM_AGGREGATE_RING_BYTES) {
		throw new RangeError(
			`Video keyframe encoder aggregate ring capacity cannot exceed ${String(VIDEO_KEYFRAME_ENCODER_MAXIMUM_AGGREGATE_RING_BYTES)} bytes.`,
		);
	}
	const frameRate = source.canvas.frameRate;
	if (hasAudio) {
		if (source.sampleRate < AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE
			|| source.sampleRate > AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE) {
			throw new RangeError(
				`Video keyframe A/V sample rate must be ${String(AUDIO_EDITOR_PROJECT_MINIMUM_SAMPLE_RATE)} through ${String(AUDIO_EDITOR_PROJECT_MAXIMUM_SAMPLE_RATE)}.`,
			);
		}
		const rateNum = BigInt(frameRate.num);
		const rateDen = BigInt(frameRate.den);
		if (rateNum < rateDen
			|| rateNum > BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE) * rateDen) {
			throw new RangeError(
				`Video keyframe A/V frame rate must be 1 through ${String(VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE)} frames per second.`,
			);
		}
	}
	const frameRateToken = `${String(frameRate.num)}/${String(frameRate.den)}`;
	const durationToken = ffmpegDuration(
		BigInt(frameCount) * BigInt(frameRate.den), BigInt(frameRate.num),
	);
	const requestedAudioSamples = BigInt(source.endFrame - source.startFrame);
	const audioFrameSamples = BigInt(descriptor.audioFrameSamples);
	const audioPadSamples = hasAudio ? maximumBigInt(
		ceilDivide(
			BigInt(frameCount) * BigInt(source.sampleRate) * BigInt(frameRate.den),
			BigInt(frameRate.num),
		),
		ceilDivide(requestedAudioSamples, audioFrameSamples) * audioFrameSamples,
	) : null;
	if (audioPadSamples !== null && audioPadSamples > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Video keyframe encoder padded audio samples exceed the safe integer limit.');
	}
	if (audioPadSamples !== null && audioPadSamples - requestedAudioSamples
		> BigInt(source.sampleRate + descriptor.audioFrameSamples)) {
		throw new RangeError('Video keyframe encoder padded audio exceeds its bounded CFR and codec tail.');
	}
	const ffmpegArguments = Object.freeze([
		'-nostdin', '-y',
		// An elementary stream carries no geometry and, for H.264, no timing
		// either, so the rate is declared on the input as the exact rational
		// rather than left for the demuxer to infer.
		...(videoEncoder === 'webcodecs'
			? ['-f', descriptor.elementaryFormat, '-r', frameRateToken]
			: [
				'-f', 'rawvideo', '-pixel_format', 'rgba',
				'-video_size', `${String(width)}x${String(height)}`,
				'-framerate', frameRateToken,
			]),
		'-i', inputPath,
		...(audioInputPath ? ['-i', audioInputPath] : []),
		...(hasAudio ? [] : ['-frames:v', String(frameCount)]),
		...descriptor.arguments(
			frameRateToken, audioPadSamples === null ? null : Number(audioPadSamples), quality,
			videoEncoder,
		),
		...(hasAudio ? ['-t', durationToken] : []),
		outputPath,
	]);
	return Object.freeze({
		videoEncoder,
		elementaryFormat: descriptor.elementaryFormat,
		width,
		height,
		frameRate,
		frameCount,
		frameBytes,
		totalRgbaBytes: Number(totalRgbaBytesBig),
		ringCapacityBytes,
		chunksPerFrame: Math.ceil(frameBytes / ringCapacityBytes),
		format,
		extension: descriptor.extension,
		mimeType: descriptor.mimeType,
		inputPath,
		...(audioInputPath ? {
			audioInputPath,
			audioRingCapacityBytes,
			aggregateRingCapacityBytes,
		} : {}),
		outputPath,
		ffmpegArguments,
	});
}

function validateFrameSource(value: unknown): VideoKeyframeExportFrameSource {
	const source = closedRecord(value, new Set([
		'frameCount', 'startFrame', 'endFrame', 'sampleRate', 'canvas', 'frame',
	]), 'video keyframe export frame source');
	positiveSafeInteger(
		dataProperty(source, 'frameCount', 'video keyframe export frame source'),
		'frameSource.frameCount',
	);
	const start = nonNegativeSafeInteger(
		dataProperty(source, 'startFrame', 'video keyframe export frame source'),
		'frameSource.startFrame',
	);
	const end = positiveSafeInteger(
		dataProperty(source, 'endFrame', 'video keyframe export frame source'),
		'frameSource.endFrame',
	);
	if (end <= start) throw new RangeError('frameSource.endFrame must exceed frameSource.startFrame.');
	positiveSafeInteger(
		dataProperty(source, 'sampleRate', 'video keyframe export frame source'),
		'frameSource.sampleRate',
	);
	requireFunction(source, 'frame', 'video keyframe export frame source');
	const canvas = closedRecord(
		dataProperty(source, 'canvas', 'video keyframe export frame source'),
		new Set(['width', 'height', 'frameRate', 'fit']),
		'video keyframe export canvas',
	);
	positiveSafeInteger(
		dataProperty(canvas, 'width', 'video keyframe export canvas'), 'frameSource.canvas.width',
	);
	positiveSafeInteger(
		dataProperty(canvas, 'height', 'video keyframe export canvas'), 'frameSource.canvas.height',
	);
	const rate = closedRecord(
		dataProperty(canvas, 'frameRate', 'video keyframe export canvas'),
		new Set(['num', 'den']),
		'video keyframe export frame rate',
	);
	const num = positiveSafeInteger(
		dataProperty(rate, 'num', 'video keyframe export frame rate'),
		'frameSource.canvas.frameRate.num',
	);
	const den = positiveSafeInteger(
		dataProperty(rate, 'den', 'video keyframe export frame rate'),
		'frameSource.canvas.frameRate.den',
	);
	if (greatestCommonDivisor(num, den) !== 1) {
		throw new RangeError('frameSource.canvas.frameRate must be reduced.');
	}
	return source as unknown as VideoKeyframeExportFrameSource;
}

function videoFormat(value: unknown): VideoKeyframeEncoderFormat {
	if (value !== 'mp4' && value !== 'webm') {
		throw new RangeError('Video keyframe encoder format must be mp4 or webm.');
	}
	return value;
}

function videoEncoderTier(value: unknown): VideoKeyframeVideoEncoderTier {
	if (value !== 'ffmpeg' && value !== 'webcodecs') {
		throw new RangeError('Video keyframe encoder videoEncoder must be ffmpeg or webcodecs.');
	}
	return value;
}

function lowerMaximum(request: object, key: string, hardMaximum: number): number {
	const value = optionalDataProperty(request, key, hardMaximum, 'video keyframe encoder workload');
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > hardMaximum) {
		throw new RangeError(`Video keyframe encoder ${key} must be positive and cannot exceed ${String(hardMaximum)}.`);
	}
	return value;
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	const result = positiveSafeInteger(value, name);
	if (result > maximum) throw new RangeError(`${name} must be 1 through ${String(maximum)}.`);
	return result;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be ${String(minimum)} through ${String(maximum)}.`);
	}
	return value;
}

function canonicalPath(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length > MAXIMUM_PATH_CHARACTERS
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_PATH_BYTES
		|| value.endsWith('/') || !/^\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)
		|| value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) {
		throw new TypeError(`Video keyframe encoder ${label} must be a canonical absolute path.`);
	}
	return value;
}

function closedRecord(
	value: unknown,
	allowed: ReadonlySet<string>,
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} has an unsupported field.`);
		}
		dataProperty(value, key, name);
	}
	return value as Readonly<Record<string, unknown>>;
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

function optionalDataProperty(value: object, key: string, fallback: unknown, name: string): unknown {
	return Object.hasOwn(value, key) ? dataProperty(value, key, name) : fallback;
}

function requireFunction(value: object, key: string, name: string): void {
	if (typeof dataProperty(value, key, name) !== 'function') {
		throw new TypeError(`${name}.${key} must be a function.`);
	}
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = nonNegativeSafeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = left;
	let b = right;
	while (b !== 0) [a, b] = [b, a % b];
	return a;
}

function ffmpegDuration(numerator: bigint, denominator: bigint): string {
	const nanosecondsPerSecond = 1_000_000_000n;
	const seconds = numerator / denominator;
	const remainder = numerator % denominator;
	const nanoseconds = (remainder * nanosecondsPerSecond + denominator - 1n) / denominator;
	if (nanoseconds === nanosecondsPerSecond) return `${String(seconds + 1n)}.000000000`;
	return `${String(seconds)}.${String(nanoseconds).padStart(9, '0')}`;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}

function maximumBigInt(left: bigint, right: bigint): bigint {
	return left > right ? left : right;
}
