/* SPDX-License-Identifier: AGPL-3.0-only */

const MIB = 1024 * 1024;
const RGBA_BYTES_PER_PIXEL = 4;
const MAXIMUM_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

export const VIDEO_PREVIEW_CAPTURE_MAXIMUM_WIDTH = 640;
export const VIDEO_PREVIEW_CAPTURE_MAXIMUM_HEIGHT = 360;
export const VIDEO_PREVIEW_CAPTURE_MAXIMUM_RGBA_BYTES =
	VIDEO_PREVIEW_CAPTURE_MAXIMUM_WIDTH
	* VIDEO_PREVIEW_CAPTURE_MAXIMUM_HEIGHT
	* RGBA_BYTES_PER_PIXEL;
export const VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES = 4 * MIB;
export const VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_WIDTH = 16_384;
export const VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_HEIGHT = 16_384;
export const VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_RGBA_BYTES = 256 * MIB;

export type VideoPreviewCaptureUsefulBinaryScope =
	| 'video-preview-capture-rgba-useful-binary'
	| 'video-preview-source-rgba-useful-binary';

export interface VideoPreviewCaptureSourceGeometry {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
}

export interface VideoPreviewCaptureAdmissionOptions {
	readonly maximumWidth?: number;
	readonly maximumHeight?: number;
	readonly maximumEncodedBytes?: number;
}

export interface VideoPreviewCaptureUsefulBinaryEstimate {
	readonly bytes: number;
	readonly certainty: 'exact';
	readonly scope: VideoPreviewCaptureUsefulBinaryScope;
}

export interface VideoPreviewCaptureAdmissionPlan {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly maximumWidth: number;
	readonly maximumHeight: number;
	readonly outputWidth: number;
	readonly outputHeight: number;
	readonly maximumEncodedBytes: number;
	readonly sourceRgbaUsefulBinary: Readonly<VideoPreviewCaptureUsefulBinaryEstimate>;
	readonly rgbaUsefulBinary: Readonly<VideoPreviewCaptureUsefulBinaryEstimate>;
	readonly browserHeapBytes: null;
	readonly processResidentSetBytes: null;
	readonly garbageCollectionHeadroomBytes: null;
}

export interface VideoPreviewEncodedByteAdmission {
	readonly byteLength: number;
	readonly maximumEncodedBytes: number;
}

/** A completed disposable preview encoding is too large to return or publish. */
export class VideoPreviewEncodedPayloadTooLargeError extends RangeError {
	readonly byteLength: number;
	readonly maximumEncodedBytes: number;

	constructor(byteLength: number, maximumEncodedBytes: number) {
		super(
			`The video preview encoded payload of ${byteLength} bytes exceeds `
			+ `the ${maximumEncodedBytes} byte maximum.`,
		);
		this.name = 'VideoPreviewEncodedPayloadTooLargeError';
		this.byteLength = byteLength;
		this.maximumEncodedBytes = maximumEncodedBytes;
	}
}

/** Source-frame geometry is too large to begin disposable preview decode-seeking. */
export class VideoPreviewSourceGeometryTooLargeError extends RangeError {
	readonly sourceWidth: number;
	readonly sourceHeight: number;

	constructor(sourceWidth: number, sourceHeight: number, reason: string) {
		super(`Video preview capture source ${sourceWidth}x${sourceHeight} ${reason}.`);
		this.name = 'VideoPreviewSourceGeometryTooLargeError';
		this.sourceWidth = sourceWidth;
		this.sourceHeight = sourceHeight;
	}
}

/**
 * Plans exact logical RGBA equivalents for one source frame and its disposable
 * destination canvas. This does not describe actual decoder/canvas/codec
 * allocations, browser heap, whole-process RSS, or garbage-collection headroom.
 */
export function planVideoPreviewCapture(
	source: VideoPreviewCaptureSourceGeometry,
	options: VideoPreviewCaptureAdmissionOptions = {},
): Readonly<VideoPreviewCaptureAdmissionPlan> {
	const sourceWidth = positiveSafeInteger(
		source?.sourceWidth,
		'Video preview capture source width',
	);
	const sourceHeight = positiveSafeInteger(
		source?.sourceHeight,
		'Video preview capture source height',
	);
	if (sourceWidth > VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_WIDTH) {
		throw new VideoPreviewSourceGeometryTooLargeError(
			sourceWidth,
			sourceHeight,
			'exceeds the maximum width',
		);
	}
	if (sourceHeight > VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_HEIGHT) {
		throw new VideoPreviewSourceGeometryTooLargeError(
			sourceWidth,
			sourceHeight,
			'exceeds the maximum height',
		);
	}
	const sourceRgbaBytes = safeByteNumber(
		BigInt(sourceWidth) * BigInt(sourceHeight) * BigInt(RGBA_BYTES_PER_PIXEL),
		'Video preview capture source RGBA useful-binary bytes',
	);
	if (sourceRgbaBytes > VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_RGBA_BYTES) {
		throw new VideoPreviewSourceGeometryTooLargeError(
			sourceWidth,
			sourceHeight,
			'exceeds the source RGBA useful-binary hard limit',
		);
	}
	const sourceRgbaUsefulBinary = Object.freeze({
		bytes: sourceRgbaBytes,
		certainty: 'exact' as const,
		scope: 'video-preview-source-rgba-useful-binary' as const,
	});
	const maximumWidth = normalizeDimensionMaximum(
		options.maximumWidth,
		VIDEO_PREVIEW_CAPTURE_MAXIMUM_WIDTH,
		'width',
	);
	const maximumHeight = normalizeDimensionMaximum(
		options.maximumHeight,
		VIDEO_PREVIEW_CAPTURE_MAXIMUM_HEIGHT,
		'height',
	);
	const maximumEncodedBytes = normalizeEncodedMaximum(options.maximumEncodedBytes);
	const { outputWidth, outputHeight } = scaledDimensions(
		sourceWidth,
		sourceHeight,
		maximumWidth,
		maximumHeight,
	);
	const rgbaBytesValue = BigInt(outputWidth)
		* BigInt(outputHeight)
		* BigInt(RGBA_BYTES_PER_PIXEL);
	const rgbaBytes = safeByteNumber(rgbaBytesValue, 'Video preview capture RGBA useful-binary bytes');
	if (rgbaBytes > VIDEO_PREVIEW_CAPTURE_MAXIMUM_RGBA_BYTES) {
		throw new RangeError('Video preview capture RGBA useful-binary bytes exceed the hard limit.');
	}
	const rgbaUsefulBinary = Object.freeze({
		bytes: rgbaBytes,
		certainty: 'exact' as const,
		scope: 'video-preview-capture-rgba-useful-binary' as const,
	});

	return Object.freeze({
		sourceWidth,
		sourceHeight,
		maximumWidth,
		maximumHeight,
		outputWidth,
		outputHeight,
		maximumEncodedBytes,
		sourceRgbaUsefulBinary,
		rgbaUsefulBinary,
		browserHeapBytes: null,
		processResidentSetBytes: null,
		garbageCollectionHeadroomBytes: null,
	});
}

/** Admit the exact encoded preview Blob size against a lower-only ceiling. */
export function assertVideoPreviewEncodedBytes(
	byteLength: number,
	maximumEncodedBytes?: number,
): Readonly<VideoPreviewEncodedByteAdmission> {
	const normalizedByteLength = nonNegativeSafeInteger(
		byteLength,
		'Video preview encoded byte length',
	);
	const normalizedMaximum = normalizeEncodedMaximum(maximumEncodedBytes);
	if (normalizedByteLength > normalizedMaximum) {
		throw new VideoPreviewEncodedPayloadTooLargeError(normalizedByteLength, normalizedMaximum);
	}
	return Object.freeze({
		byteLength: normalizedByteLength,
		maximumEncodedBytes: normalizedMaximum,
	});
}

function scaledDimensions(
	sourceWidth: number,
	sourceHeight: number,
	maximumWidth: number,
	maximumHeight: number,
): Readonly<{ readonly outputWidth: number; readonly outputHeight: number }> {
	let outputWidth: number;
	let outputHeight: number;
	if (sourceWidth <= maximumWidth && sourceHeight <= maximumHeight) {
		outputWidth = Math.max(2, sourceWidth);
		outputHeight = Math.max(2, sourceHeight);
	} else {
		const widthScaleNumerator = BigInt(maximumWidth) * BigInt(sourceHeight);
		const heightScaleNumerator = BigInt(maximumHeight) * BigInt(sourceWidth);
		if (widthScaleNumerator <= heightScaleNumerator) {
			outputWidth = maximumWidth;
			outputHeight = Math.max(2, roundPositiveRatio(
				BigInt(sourceHeight) * BigInt(maximumWidth),
				BigInt(sourceWidth),
			));
		} else {
			outputWidth = Math.max(2, roundPositiveRatio(
				BigInt(sourceWidth) * BigInt(maximumHeight),
				BigInt(sourceHeight),
			));
			outputHeight = maximumHeight;
		}
	}
	if (outputWidth > maximumWidth || outputHeight > maximumHeight) {
		throw new RangeError('Video preview capture output dimensions exceed their normalized maxima.');
	}
	return Object.freeze({ outputWidth, outputHeight });
}

function roundPositiveRatio(numerator: bigint, denominator: bigint): number {
	const rounded = (numerator * 2n + denominator) / (denominator * 2n);
	if (rounded < 0n || rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('Video preview capture scaled geometry exceeds the supported safe integer range.');
	}
	return Number(rounded);
}

function normalizeDimensionMaximum(
	value: number | undefined,
	hardMaximum: number,
	name: string,
): number {
	const normalized = value === undefined ? hardMaximum : value;
	if (!Number.isSafeInteger(normalized) || normalized < 2 || normalized > hardMaximum) {
		throw new RangeError(
			`Video preview capture maximum ${name} must be a safe integer between 2 and ${hardMaximum}.`,
		);
	}
	return normalized;
}

function normalizeEncodedMaximum(value: number | undefined): number {
	const normalized = value === undefined ? VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES : value;
	if (!Number.isSafeInteger(normalized)
		|| normalized < 0
		|| normalized > VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES) {
		throw new RangeError(
			'Video preview capture maximum encoded bytes must be a non-negative safe integer '
			+ `no greater than ${VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES}.`,
		);
	}
	return normalized;
}

function positiveSafeInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${field} must be a positive safe integer.`);
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${field} must be a non-negative safe integer.`);
	}
	return value;
}

function safeByteNumber(value: bigint, field: string): number {
	if (value < 0n || value > MAXIMUM_SAFE_BYTES) {
		throw new RangeError(`${field} exceeds the supported safe integer range.`);
	}
	return Number(value);
}
