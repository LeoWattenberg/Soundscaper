/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';

export const PIXEL_SAMPLE_FORMATS_V1 = Object.freeze(['unorm8', 'unorm16', 'float32'] as const);
export const PIXEL_COLOR_PRIMARIES_V1 = Object.freeze(['srgb', 'bt709', 'display-p3', 'bt2020'] as const);
export const PIXEL_COLOR_TRANSFERS_V1 = Object.freeze(['srgb', 'bt709', 'linear', 'pq', 'hlg'] as const);

export type PixelSampleFormatV1 = (typeof PIXEL_SAMPLE_FORMATS_V1)[number];
export type PixelColorPrimariesV1 = (typeof PIXEL_COLOR_PRIMARIES_V1)[number];
export type PixelColorTransferV1 = (typeof PIXEL_COLOR_TRANSFERS_V1)[number];

/**
 * Version 1 is tightly packed, top-left row-major RGBA with straight alpha.
 * UNORM samples span [0, 1]; float RGB may carry signed/HDR values and alpha
 * stays in [0, 1]. Color declarations describe samples, never an implicit
 * conversion. Declared profiles and profiles a renderer admits are separate.
 */
export interface PixelFrameDescriptorV1 {
	readonly schemaVersion: 1;
	readonly width: number;
	readonly height: number;
	readonly sampleFormat: PixelSampleFormatV1;
	readonly primaries: PixelColorPrimariesV1;
	readonly transfer: PixelColorTransferV1;
}

export interface PixelFrameLimitsV1 {
	readonly maximumSidePixels: number;
	readonly maximumPixels: number;
	readonly maximumBytes: number;
}

/** Interchange ceilings; decoder/renderer routes may impose tighter limits. */
export const PIXEL_FRAME_HARD_LIMITS_V1: Readonly<PixelFrameLimitsV1> = Object.freeze({
	maximumSidePixels: 65_536,
	maximumPixels: 67_108_864,
	maximumBytes: 1024 * 1024 * 1024,
});

export interface PixelFramePlanV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly pixelCount: number;
	readonly sampleCount: number;
	readonly rowByteLength: number;
	readonly byteLength: number;
}

export type PixelFrameV1 =
	| Readonly<{
		descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' }>;
		pixels: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
	}>
	| Readonly<{
		descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm16' }>;
		pixels: Uint16Array<ArrayBuffer>;
	}>
	| Readonly<{
		descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'float32' }>;
		pixels: Float32Array<ArrayBuffer>;
	}>;

const DESCRIPTOR_FIELDS = ['schemaVersion', 'width', 'height', 'sampleFormat', 'primaries', 'transfer'] as const;
const LIMIT_FIELDS = ['maximumSidePixels', 'maximumPixels', 'maximumBytes'] as const;
const BYTES_PER_SAMPLE: Readonly<Record<PixelSampleFormatV1, number>> = Object.freeze({
	unorm8: 1, unorm16: 2, float32: 4,
});
const PIXEL_BUFFER_PROTOTYPES: readonly object[] = [
	Uint8Array.prototype, Uint8ClampedArray.prototype, Uint16Array.prototype, Float32Array.prototype,
];

/** Read persisted metadata without consulting the currently admitted profiles. */
export function readPixelFrameDescriptorV1(value: unknown): Readonly<PixelFrameDescriptorV1> {
	const record = readClosedDomainRecord(value, 'pixel frame descriptor', DESCRIPTOR_FIELDS);
	const field = (name: string) => readClosedDomainField(record, name, 'pixel frame descriptor');
	if (field('schemaVersion') !== 1) throw new RangeError('Unsupported pixel frame descriptor schema version.');
	return Object.freeze({
		schemaVersion: 1,
		width: positiveInteger(field('width'), 'pixel frame width dimension'),
		height: positiveInteger(field('height'), 'pixel frame height dimension'),
		sampleFormat: pixelValue(field('sampleFormat'), PIXEL_SAMPLE_FORMATS_V1, 'sample format'),
		primaries: pixelValue(field('primaries'), PIXEL_COLOR_PRIMARIES_V1, 'color primaries'),
		transfer: pixelValue(field('transfer'), PIXEL_COLOR_TRANSFERS_V1, 'color transfer'),
	});
}

/** Prove bounded frame geometry before allocating, decoding, or reading pixels. */
export function planPixelFrameV1(value: unknown, limitsValue: unknown = {}): Readonly<PixelFramePlanV1> {
	const descriptor = readPixelFrameDescriptorV1(value);
	const limits = readLimits(limitsValue);
	if (descriptor.width > limits.maximumSidePixels || descriptor.height > limits.maximumSidePixels) {
		throw new RangeError('Pixel frame dimension exceeds the admitted limit.');
	}
	const pixelCount = BigInt(descriptor.width) * BigInt(descriptor.height);
	if (pixelCount > BigInt(limits.maximumPixels)) {
		throw new RangeError('Pixel frame pixel count exceeds the admitted limit.');
	}
	const sampleCount = pixelCount * 4n;
	const byteLength = sampleCount * BigInt(BYTES_PER_SAMPLE[descriptor.sampleFormat]);
	if (byteLength > BigInt(limits.maximumBytes)) {
		throw new RangeError('Pixel frame byte length exceeds the admitted limit.');
	}
	return Object.freeze({
		descriptor,
		pixelCount: Number(pixelCount),
		sampleCount: Number(sampleCount),
		rowByteLength: descriptor.width * 4 * BYTES_PER_SAMPLE[descriptor.sampleFormat],
		byteLength: Number(byteLength),
	});
}

/**
 * Validate a borrowed transient buffer without allocating or converting it.
 * The caller owns its writable pixels and must not mutate them during a render.
 * Transfer across a worker must finish before the receiver reads this contract.
 */
export function readPixelFrameV1(value: unknown, limitsValue: unknown = {}): PixelFrameV1 {
	const record = readClosedDomainRecord(value, 'pixel frame', ['descriptor', 'pixels']);
	const plan = planPixelFrameV1(readClosedDomainField(record, 'descriptor', 'pixel frame'), limitsValue);
	const pixels = readClosedDomainField(record, 'pixels', 'pixel frame');
	const format = plan.descriptor.sampleFormat;
	if (!ArrayBuffer.isView(pixels)) throw new TypeError('Pixel frame buffer does not match its declared sample format.');
	for (const field of ['buffer', 'length', 'byteLength', 'byteOffset']) {
		if (Object.hasOwn(pixels, field)) throw new TypeError('Pixel frame buffer may not shadow its intrinsic geometry.');
	}
	if (format === 'unorm8' && (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
		validateBuffer(pixels, plan);
		return Object.freeze({ descriptor: Object.freeze({ ...plan.descriptor, sampleFormat: format }), pixels });
	}
	if (format === 'unorm16' && pixels instanceof Uint16Array) {
		validateBuffer(pixels, plan);
		return Object.freeze({ descriptor: Object.freeze({ ...plan.descriptor, sampleFormat: format }), pixels });
	}
	if (format === 'float32' && pixels instanceof Float32Array) {
		validateBuffer(pixels, plan);
		for (let index = 0; index < pixels.length; index += 1) {
			const sample = pixels[index];
			if (!Number.isFinite(sample)) throw new RangeError('Pixel frame float samples must be finite.');
			if (index % 4 === 3 && (sample < 0 || sample > 1)) {
				throw new RangeError('Pixel frame straight alpha must be between zero and one.');
			}
		}
		return Object.freeze({ descriptor: Object.freeze({ ...plan.descriptor, sampleFormat: format }), pixels });
	}
	throw new TypeError('Pixel frame buffer does not match its declared sample format.');
}

function validateBuffer(
	pixels: Uint8Array | Uint8ClampedArray,
	plan: PixelFramePlanV1,
): asserts pixels is Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
function validateBuffer(pixels: Uint16Array, plan: PixelFramePlanV1): asserts pixels is Uint16Array<ArrayBuffer>;
function validateBuffer(pixels: Float32Array, plan: PixelFramePlanV1): asserts pixels is Float32Array<ArrayBuffer>;
function validateBuffer(
	pixels: Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array,
	plan: PixelFramePlanV1,
): asserts pixels is Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | Uint16Array<ArrayBuffer> | Float32Array<ArrayBuffer> {
	const prototype = Object.getPrototypeOf(pixels) as unknown;
	if (!PIXEL_BUFFER_PROTOTYPES.includes(prototype as object)) {
		throw new TypeError('Pixel frame buffer requires an intrinsic sample format.');
	}
	const buffer = pixels.buffer;
	const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
	if (!(buffer instanceof ArrayBuffer) || (resizable && resizable.call(buffer) === true)) {
		throw new TypeError('Pixel frame pixels require a fixed ArrayBuffer.');
	}
	if (pixels.length !== plan.sampleCount || pixels.byteLength !== plan.byteLength) {
		throw new RangeError('Pixel frame sample count does not match its contiguous RGBA geometry.');
	}
}

function readLimits(value: unknown): Readonly<PixelFrameLimitsV1> {
	const record = readClosedDomainRecord(value, 'pixel frame limits', LIMIT_FIELDS, []);
	const limits = { ...PIXEL_FRAME_HARD_LIMITS_V1 };
	for (const field of LIMIT_FIELDS) {
		if (!Object.hasOwn(record, field)) continue;
		const limit = positiveInteger(readClosedDomainField(record, field, 'pixel frame limits'), `pixel frame ${field} limit`);
		if (limit > PIXEL_FRAME_HARD_LIMITS_V1[field]) throw new RangeError('Pixel frame limit exceeds the hard interchange ceiling.');
		limits[field] = limit;
	}
	return Object.freeze(limits);
}

function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} requires a positive safe integer.`);
	}
	return value;
}

function pixelValue<T extends string>(value: unknown, values: readonly T[], name: string): T {
	if (typeof value !== 'string' || !values.includes(value as T)) {
		throw new RangeError(`Unsupported pixel frame ${name}.`);
	}
	return value as T;
}
