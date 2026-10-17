/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';

export interface PixelSizeV1 { readonly width: number; readonly height: number }
const MAXIMUM_SIDE = 65_536;
const MAXIMUM_OUTPUT_PIXELS = 33_554_432;
const ROWS_PER_TASK = 16;
const SAMPLE_PROTOTYPES: readonly object[] = [Uint8Array.prototype, Uint8ClampedArray.prototype];
const cancelled = createAbortGuard('Pixel resize was cancelled.');
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

/** Preserve the established rounded fit convention, including tiny aspect ratios. */
export function fitPixelSizeV1(sourceWidth: number, sourceHeight: number, maximumWidth: number, maximumHeight: number): Readonly<PixelSizeV1> {
	for (const value of [sourceWidth, sourceHeight, maximumWidth, maximumHeight]) dimension(value);
	const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight);
	return Object.freeze({ width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) });
}

/** Existing synchronous Frame previews retain this deterministic sampling convention. */
export function resizeRgba8NearestV1(pixels: Uint8Array | Uint8ClampedArray, sourceWidth: number, sourceHeight: number,
	targetWidth: number, targetHeight: number, signal?: AbortSignal): Uint8Array<ArrayBuffer> {
	admit(pixels, sourceWidth, sourceHeight, targetWidth, targetHeight, signal);
	if (sourceWidth === targetWidth && sourceHeight === targetHeight) return new Uint8Array(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
	const output = new Uint8Array(targetWidth * targetHeight * 4);
	for (let y = 0; y < targetHeight; y += 1) {
		cancelled(signal); copyRows(pixels, output, sourceWidth, sourceHeight, targetWidth, targetHeight, y, y + 1);
	}
	return output;
}

/** Yield actual browser tasks so cancellation and other input can interrupt a batch. */
export async function resizeRgba8NearestAsyncV1(pixels: Uint8Array | Uint8ClampedArray, sourceWidth: number, sourceHeight: number,
	targetWidth: number, targetHeight: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	admit(pixels, sourceWidth, sourceHeight, targetWidth, targetHeight, signal);
	await task(signal);
	const output = new Uint8Array(targetWidth * targetHeight * 4);
	try {
		for (let y = 0; y < targetHeight; y += ROWS_PER_TASK) {
			cancelled(signal);
			copyRows(pixels, output, sourceWidth, sourceHeight, targetWidth, targetHeight, y, Math.min(targetHeight, y + ROWS_PER_TASK));
			if (y + ROWS_PER_TASK < targetHeight) await task(signal);
		}
		cancelled(signal); return output;
	} catch (error) { output.fill(0); throw error; }
}

function copyRows(pixels: Uint8Array | Uint8ClampedArray, output: Uint8Array, sourceWidth: number, sourceHeight: number,
	targetWidth: number, targetHeight: number, start: number, end: number): void {
	for (let y = start; y < end; y += 1) {
		const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / targetHeight));
		for (let x = 0; x < targetWidth; x += 1) {
			const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / targetWidth));
			const sourceOffset = (sourceY * sourceWidth + sourceX) * 4, targetOffset = (y * targetWidth + x) * 4;
			for (let channel = 0; channel < 4; channel += 1) output[targetOffset + channel] = pixels[sourceOffset + channel]!;
		}
	}
}

function admit(pixels: Uint8Array | Uint8ClampedArray, sourceWidth: number, sourceHeight: number,
	targetWidth: number, targetHeight: number, signal?: AbortSignal): void {
	for (const value of [sourceWidth, sourceHeight, targetWidth, targetHeight]) dimension(value);
	if (targetWidth * targetHeight > MAXIMUM_OUTPUT_PIXELS) throw new RangeError('Pixel resize output exceeds its pixel ceiling.');
	if (!ArrayBuffer.isView(pixels) || !SAMPLE_PROTOTYPES.includes(Object.getPrototypeOf(pixels) as object)
		|| ['buffer', 'length', 'byteLength', 'byteOffset'].some(key => Object.hasOwn(pixels, key))) {
		throw new TypeError('Pixel resize requires intrinsic RGBA8 samples without shadowed geometry.');
	}
	if (!(pixels.buffer instanceof ArrayBuffer) || (resizable && resizable.call(pixels.buffer) === true)) {
		throw new TypeError('Pixel resize requires a fixed ArrayBuffer.');
	}
	if (pixels.byteLength !== sourceWidth * sourceHeight * 4) throw new RangeError('Pixel resize source RGBA geometry disagrees.');
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Pixel resize requires a cancellation signal.');
	cancelled(signal);
}

function dimension(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_SIDE) throw new RangeError('Pixel resize dimension is outside its bounded domain.');
}

async function task(signal?: AbortSignal): Promise<void> {
	cancelled(signal); await new Promise<void>(resolve => { setTimeout(resolve, 0); }); cancelled(signal);
}
