/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface PixelFrameJpegOptionsV1 {
	readonly quality: number;
	readonly signal?: AbortSignal;
	readonly limits?: PixelFrameLimitsV1;
	readonly maximumOutputBytes?: number;
}

export const PIXEL_FRAME_JPEG_MAXIMUM_OUTPUT_BYTES_V1 = 256 * 1024 * 1024;
export const PIXEL_FRAME_JPEG_MAXIMUM_PIXEL_BYTES_V1 = 256 * 1024 * 1024;
const COPY_BYTES = 65_536;
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const BLOB_TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;

/** Native JPEG of opaque UNORM8 encoded sRGB, with explicit quality and no
 * implicit matte/profile conversion. Returned bytes are independently owned.
 * One owned pixel snapshot and one output buffer are bounded; native canvas,
 * codec and Blob internal memory and cross-engine byte identity are not promised.
 * Cancellation joins native encoding/materialization before wiping our workspace.
 * Borrowed source pixels must remain fixed until this operation settles. */
export async function encodePixelFrameJpegV1(value: unknown, optionsValue: unknown): Promise<Uint8Array<ArrayBuffer>> {
	const options = record(optionsValue, 'JPEG encoding options', ['quality', 'limits', 'signal', 'maximumOutputBytes'], ['quality']);
	const signal = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'JPEG encoding options') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check();
	const quality = field(options, 'quality', 'JPEG encoding options');
	if (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0 || quality > 1) throw new RangeError('JPEG quality requires a finite number from zero through one.');
	const maximum = Object.hasOwn(options, 'maximumOutputBytes') ? field(options, 'maximumOutputBytes', 'JPEG encoding options') : PIXEL_FRAME_JPEG_MAXIMUM_OUTPUT_BYTES_V1;
	if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum <= 0 || maximum > PIXEL_FRAME_JPEG_MAXIMUM_OUTPUT_BYTES_V1) throw new RangeError('JPEG output byte budget is outside the admitted range.');
	const input = record(value, 'JPEG source frame', ['descriptor', 'pixels']);
	const limits = Object.hasOwn(options, 'limits') ? field(options, 'limits', 'JPEG encoding options') : {};
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'JPEG source frame'), { limits });
	if (plan.byteLength > PIXEL_FRAME_JPEG_MAXIMUM_PIXEL_BYTES_V1 || plan.descriptor.width > 65_535 || plan.descriptor.height > 65_535) throw new RangeError('JPEG pixel workspace or dimensions exceed the admitted limit.');
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'JPEG source frame') }, limits);
	if (source.descriptor.sampleFormat !== 'unorm8') throw new RangeError('JPEG encoding requires UNORM8 rendered samples.');
	const pixels = new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, plan.byteLength);
	const current = () => {
		check();
		if (Number(Reflect.apply(BUFFER_SIZE, pixels.buffer, [])) === 0) throw new RangeError('JPEG source buffer was detached before completion.');
	};
	let canvas: OffscreenCanvas | HTMLCanvasElement | null = null, output: Uint8Array<ArrayBuffer> | null = null;
	let failure: { reason: unknown } | null = null, cleanupFailure: { reason: unknown } | null = null;
	const snapshot = new Uint8ClampedArray(plan.byteLength);
	try {
		for (let offset = 0; offset < pixels.length; offset += COPY_BYTES) {
			current(); const end = Math.min(offset + COPY_BYTES, pixels.length);
			for (let index = offset + 3; index < end; index += 4) if (pixels[index] !== 255) throw new RangeError('JPEG encoding requires opaque alpha until a matte policy is selected.');
			snapshot.set(pixels.subarray(offset, end), offset);
			if (end < pixels.length) { await yieldTask(); current(); }
		}
		canvas = createCanvas(plan.descriptor.width, plan.descriptor.height);
		const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
		if (!context || !('putImageData' in context)) throw new TypeError('Native JPEG canvas drawing is unavailable.');
		context.putImageData(new ImageData(snapshot, plan.descriptor.width, plan.descriptor.height, { colorSpace: 'srgb' }), 0, 0);
		current();
		let blob: Blob | null;
		try { blob = await encodeCanvas(canvas, quality); } catch (error) { current(); throw error; }
		current();
		if (blob === null || Reflect.apply(BLOB_TYPE, blob, []) !== 'image/jpeg') throw new TypeError('Native JPEG encoding did not return image/jpeg.');
		const size: unknown = Reflect.apply(BLOB_SIZE, blob, []);
		if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > maximum) throw new RangeError('Native JPEG output exceeds its admitted byte budget or is empty.');
		let buffer: unknown;
		try { buffer = await Reflect.apply(Blob.prototype.arrayBuffer, blob, []); } catch (error) { current(); throw error; }
		if (!(buffer instanceof ArrayBuffer) || buffer === source.pixels.buffer || buffer === snapshot.buffer || Reflect.apply(RESIZABLE, buffer, []) === true) throw new TypeError('JPEG output requires an independently owned fixed ArrayBuffer.');
		output = new Uint8Array(buffer); current();
		if (output.byteLength !== size) throw new RangeError('Native JPEG output byte length changed during materialization.');
		assertJpegGeometry(output, plan.descriptor.width, plan.descriptor.height);
		current();
	} catch (error) { failure = { reason: error }; }
	finally {
		snapshot.fill(0);
		if (canvas) {
			try { canvas.width = 0; canvas.height = 0; }
			catch (error) { cleanupFailure = { reason: error }; }
		}
	}
	if (failure || cleanupFailure) {
		output?.fill(0);
		if (failure && cleanupFailure && !Object.is(failure.reason, cleanupFailure.reason)) throw new AggregateError([failure.reason, cleanupFailure.reason], 'JPEG encoding and canvas cleanup failed.', { cause: failure.reason });
		throw failure ? failure.reason : cleanupFailure!.reason;
	}
	if (!output) throw new Error('Native JPEG encoding did not complete its output.');
	return output;
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
	if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
	if (typeof document === 'undefined') throw new TypeError('Native JPEG canvas encoding is unavailable.');
	const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}
function encodeCanvas(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Blob | null> {
	if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality });
	return new Promise(resolve => { canvas.toBlob(resolve, 'image/jpeg', quality); });
}

/** Header/geometry admission, not a replacement for a JPEG decoder. Native
 * baseline or progressive streams require one 8-bit frame and a scan; entropy
 * data remains codec-owned and is not interpreted as marker/header records. */
function assertJpegGeometry(bytes: Uint8Array, width: number, height: number): void {
	const refuse = () => { throw new RangeError('Native JPEG markers or frame dimensions are invalid.'); };
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) refuse();
	let cursor = 2, found = false;
	while (cursor < bytes.length - 2) {
		if (bytes[cursor++] !== 0xff) refuse();
		while (bytes[cursor] === 0xff) cursor++;
		const marker = bytes[cursor++];
		if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) refuse();
		if (marker === 1) continue;
		const length = (bytes[cursor]! << 8) | bytes[cursor + 1]!;
		if (length < 2 || cursor + length > bytes.length - 2) refuse();
		if (marker !== undefined && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			const components = bytes[cursor + 7]!;
			if (![0xc0, 0xc1, 0xc2].includes(marker) || found || bytes[cursor + 2] !== 8 || ![1, 3].includes(components)
				|| length !== 8 + components * 3 || ((bytes[cursor + 3]! << 8) | bytes[cursor + 4]!) !== height
				|| ((bytes[cursor + 5]! << 8) | bytes[cursor + 6]!) !== width) refuse();
			found = true;
		}
		if (marker === 0xda) {
			const components = bytes[cursor + 2]!;
			if (!found || ![1, 2, 3].includes(components) || length !== 6 + components * 2 || cursor + length >= bytes.length - 2) refuse();
			return;
		}
		cursor += length;
	}
	refuse();
}
function yieldTask(): Promise<void> { return new Promise(resolve => { setTimeout(resolve, 0); }); }
