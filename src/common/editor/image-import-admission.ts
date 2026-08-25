/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resource admission shared by every timeline-image decoder tier. */

const MIB = 1024 * 1024;
const RGBA_BYTES_PER_PIXEL = 4;

export const IMAGE_IMPORT_LIMITS = Object.freeze({
	maximumFilesPerGesture: 64,
	maximumGestureInputBytes: 512 * MIB,
	maximumFileInputBytes: 64 * MIB,
	maximumSidePixels: 8_192,
	maximumSdrPixelsPerFrame: 16_777_216,
	maximumHighPrecisionPixelsPerFrame: 8_388_608,
	maximumFramesPerFile: 4_096,
	maximumDecodedRgbaBytesPerFile: 512 * MIB,
	maximumCanonicalBodyBytesPerFile: 512 * MIB,
	maximumIccBytesPerFile: 4 * MIB,
	maximumMetadataBytesPerFile: 8 * MIB,
	maximumDurationMicrosecondsPerFile: 24 * 60 * 60 * 1_000_000,
	maximumDecodeMillisecondsPerFile: 60_000,
});

export const IMAGE_IMPORT_ADMISSION_ERROR_CODES = Object.freeze([
	'invalid-request',
	'file-count',
	'file-input-bytes',
	'gesture-input-bytes',
	'dimensions',
	'precision',
	'pixels-per-frame',
	'frame-count',
	'decoded-rgba-bytes',
	'icc-bytes',
	'metadata-bytes',
	'duration',
	'canonical-body-bytes',
] as const);

export type ImageImportAdmissionErrorCode =
	(typeof IMAGE_IMPORT_ADMISSION_ERROR_CODES)[number];

export class ImageImportAdmissionError extends Error {
	readonly code: ImageImportAdmissionErrorCode;

	constructor(code: ImageImportAdmissionErrorCode, message: string) {
		super(message);
		this.name = 'ImageImportAdmissionError';
		this.code = code;
	}
}

export interface ImageImportGestureRequest {
	readonly fileByteLengths: readonly number[];
}

export interface AdmittedImageImportGesture {
	readonly fileCount: number;
	readonly totalInputBytes: number;
}

export type ImageDecodePrecision = 'sdr' | 'high-precision';

export interface ImageDecodeWorkloadRequest {
	readonly sourceByteLength: number;
	readonly width: number;
	readonly height: number;
	readonly precision: ImageDecodePrecision;
	readonly frameCount: number;
	readonly durationMicroseconds: number;
	readonly iccBytes: number;
	readonly metadataBytes: number;
}

export interface AdmittedImageDecodeWorkload extends ImageDecodeWorkloadRequest {
	readonly pixelsPerFrame: number;
	readonly rgbaBytesPerFrame: number;
	readonly totalDecodedRgbaBytes: number;
	readonly decodeDeadlineMilliseconds: number;
}

const GESTURE_KEYS = new Set(['fileByteLengths']);
const DECODE_KEYS = new Set([
	'sourceByteLength', 'width', 'height', 'precision', 'frameCount',
	'durationMicroseconds', 'iccBytes', 'metadataBytes',
]);

/** Admit the complete selected image batch before reading or decoding a file. */
export function admitImageImportGesture(value: unknown): Readonly<AdmittedImageImportGesture> {
	const request = closedRecord(value, GESTURE_KEYS, 'image import gesture');
	const lengths = exactArray(dataProperty(request, 'fileByteLengths'), 'image import file byte lengths');
	if (lengths.length < 1 || lengths.length > IMAGE_IMPORT_LIMITS.maximumFilesPerGesture) {
		refuse('file-count', `An image import gesture requires 1 through ${String(IMAGE_IMPORT_LIMITS.maximumFilesPerGesture)} files.`);
	}
	let total = 0n;
	for (let index = 0; index < lengths.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(lengths, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			refuse('invalid-request', 'Image import file byte lengths must be dense data values.');
		}
		const byteLength = positiveSafeInteger(descriptor.value, 'file-input-bytes', 'Image input byte length');
		if (byteLength > IMAGE_IMPORT_LIMITS.maximumFileInputBytes) {
			refuse('file-input-bytes', 'An image input exceeds the 64 MiB per-file limit.');
		}
		total += BigInt(byteLength);
		if (total > BigInt(IMAGE_IMPORT_LIMITS.maximumGestureInputBytes)) {
			refuse('gesture-input-bytes', 'Image inputs exceed the 512 MiB per-gesture limit.');
		}
	}
	return Object.freeze({ fileCount: lengths.length, totalInputBytes: Number(total) });
}

/**
 * Admit probed, oriented canvas metadata before allocating decoder output.
 * The caller must classify any >8-bit, wide-gamut, ICC-transform, or PQ work
 * as `high-precision`, even though the persisted derivative is RGBA8.
 */
export function admitImageDecodeWorkload(value: unknown): Readonly<AdmittedImageDecodeWorkload> {
	const request = closedRecord(value, DECODE_KEYS, 'image decode workload');
	const sourceByteLength = positiveSafeInteger(
		dataProperty(request, 'sourceByteLength'), 'file-input-bytes', 'Image input byte length',
	);
	if (sourceByteLength > IMAGE_IMPORT_LIMITS.maximumFileInputBytes) {
		refuse('file-input-bytes', 'An image input exceeds the 64 MiB per-file limit.');
	}
	const width = boundedPositiveInteger(
		dataProperty(request, 'width'), IMAGE_IMPORT_LIMITS.maximumSidePixels,
		'dimensions', 'Image width',
	);
	const height = boundedPositiveInteger(
		dataProperty(request, 'height'), IMAGE_IMPORT_LIMITS.maximumSidePixels,
		'dimensions', 'Image height',
	);
	const precisionValue = dataProperty(request, 'precision');
	if (precisionValue !== 'sdr' && precisionValue !== 'high-precision') {
		refuse('precision', 'Image decode precision must be sdr or high-precision.');
	}
	const precision: ImageDecodePrecision = precisionValue;
	const frameCount = boundedPositiveInteger(
		dataProperty(request, 'frameCount'), IMAGE_IMPORT_LIMITS.maximumFramesPerFile,
		'frame-count', 'Image frame count',
	);
	const durationMicroseconds = boundedPositiveInteger(
		dataProperty(request, 'durationMicroseconds'),
		IMAGE_IMPORT_LIMITS.maximumDurationMicrosecondsPerFile,
		'duration', 'Image duration',
	);
	const iccBytes = boundedNonNegativeInteger(
		dataProperty(request, 'iccBytes'), IMAGE_IMPORT_LIMITS.maximumIccBytesPerFile,
		'icc-bytes', 'Image ICC bytes',
	);
	const metadataBytes = boundedNonNegativeInteger(
		dataProperty(request, 'metadataBytes'), IMAGE_IMPORT_LIMITS.maximumMetadataBytesPerFile,
		'metadata-bytes', 'Image metadata bytes',
	);
	const pixels = BigInt(width) * BigInt(height);
	const maximumPixels = BigInt(precision === 'sdr'
		? IMAGE_IMPORT_LIMITS.maximumSdrPixelsPerFrame
		: IMAGE_IMPORT_LIMITS.maximumHighPrecisionPixelsPerFrame);
	if (pixels > maximumPixels) {
		refuse('pixels-per-frame', `Image ${precision} pixels exceed the per-frame limit.`);
	}
	const rgbaBytes = pixels * BigInt(RGBA_BYTES_PER_PIXEL);
	const totalRgbaBytes = rgbaBytes * BigInt(frameCount);
	if (totalRgbaBytes > BigInt(IMAGE_IMPORT_LIMITS.maximumDecodedRgbaBytesPerFile)) {
		refuse('decoded-rgba-bytes', 'Image decoded RGBA exceeds the 512 MiB per-file limit.');
	}
	return Object.freeze({
		sourceByteLength,
		width,
		height,
		precision,
		frameCount,
		durationMicroseconds,
		iccBytes,
		metadataBytes,
		pixelsPerFrame: Number(pixels),
		rgbaBytesPerFrame: Number(rgbaBytes),
		totalDecodedRgbaBytes: Number(totalRgbaBytes),
		decodeDeadlineMilliseconds: IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile,
	});
}

/** Recheck the exact compressed asset body before staging publication. */
export function admitImageCanonicalBody(value: unknown): Readonly<{ byteLength: number }> {
	const byteLength = positiveSafeInteger(value, 'canonical-body-bytes', 'Canonical image body byte length');
	if (byteLength > IMAGE_IMPORT_LIMITS.maximumCanonicalBodyBytesPerFile) {
		refuse('canonical-body-bytes', 'A canonical image body exceeds the 512 MiB per-file limit.');
	}
	return Object.freeze({ byteLength });
}

function closedRecord(
	value: unknown,
	allowedKeys: ReadonlySet<string>,
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		refuse('invalid-request', `A ${label} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		refuse('invalid-request', `A ${label} must be a plain object.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowedKeys.has(key)) {
			refuse('invalid-request', `Unknown ${label} field: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			refuse('invalid-request', `${label} fields must be enumerable data properties.`);
		}
	}
	return value as Record<string, unknown>;
}

function dataProperty(record: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		refuse('invalid-request', `Image admission requires data field ${key}.`);
	}
	return descriptor.value;
}

function exactArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		refuse('invalid-request', `${label} must be an array.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length') continue;
		if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)
			|| Number(key) >= value.length) {
			refuse('invalid-request', `${label} must contain indexed data values only.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			refuse('invalid-request', `${label} must contain ordinary data values.`);
		}
	}
	return value;
}

function positiveSafeInteger(
	value: unknown,
	code: ImageImportAdmissionErrorCode,
	label: string,
): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) refuse(code, `${label} must be a positive safe integer.`);
	return value as number;
}

function boundedPositiveInteger(
	value: unknown,
	maximum: number,
	code: ImageImportAdmissionErrorCode,
	label: string,
): number {
	const normalized = positiveSafeInteger(value, code, label);
	if (normalized > maximum) refuse(code, `${label} exceeds ${String(maximum)}.`);
	return normalized;
}

function boundedNonNegativeInteger(
	value: unknown,
	maximum: number,
	code: ImageImportAdmissionErrorCode,
	label: string,
): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
		refuse(code, `${label} must be a non-negative safe integer no greater than ${String(maximum)}.`);
	}
	return value as number;
}

function refuse(code: ImageImportAdmissionErrorCode, message: string): never {
	throw new ImageImportAdmissionError(code, message);
}
