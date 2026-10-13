/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionLayerBase } from './motion-composition.ts';
import type { MotionColor } from './motion-property.ts';
import type { MotionMatrix4 } from './motion-transform.ts';
import { decodeVideoChannel, encodeVideoChannel } from './video-color-transfer.ts';

export type MotionBlendMode = MotionLayerBase['blendMode'];
export interface MotionSurface {
	readonly width: number; readonly height: number; readonly pixels: Float32Array;
	readonly colorSpace: 'linear-rec709-d65'; readonly alphaMode: 'premultiplied';
}
export const MOTION_MAXIMUM_SURFACE_PIXELS = 16_777_216;

export function motionSurfaceLength(width: number, height: number): number {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MOTION_MAXIMUM_SURFACE_PIXELS) {
		throw new RangeError('Motion surface dimensions exceed the positive 16-megapixel working-surface budget.');
	}
	return width * height * 4;
}
/** Authored colors are unassociated, linear Rec.709; all working surfaces are premultiplied. */
export function createMotionSurface(width: number, height: number, color: MotionColor = [0, 0, 0, 0]): MotionSurface {
	const pixels = new Float32Array(motionSurfaceLength(width, height));
	if (color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new RangeError('Invalid motion surface background.');
	if (color[3] !== 0) for (let i = 0; i < pixels.length; i += 4) {
		pixels[i] = color[0] * color[3]; pixels[i + 1] = color[1] * color[3]; pixels[i + 2] = color[2] * color[3]; pixels[i + 3] = color[3];
	}
	return Object.freeze({ width, height, pixels, colorSpace: 'linear-rec709-d65', alphaMode: 'premultiplied' });
}
export function validateMotionSurface(surface: MotionSurface): void {
	if (surface.colorSpace !== 'linear-rec709-d65' || surface.alphaMode !== 'premultiplied' || !(surface.pixels instanceof Float32Array)
		|| surface.pixels.length !== motionSurfaceLength(surface.width, surface.height)) throw new TypeError('Invalid motion working-surface contract.');
	for (let i = 0; i < surface.pixels.length; i += 4) {
		const alpha = surface.pixels[i + 3]!;
		if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RangeError('Invalid motion pixel alpha.');
		for (let c = 0; c < 3; c++) if (!Number.isFinite(surface.pixels[i + c]) || surface.pixels[i + c]! < 0 || surface.pixels[i + c]! > alpha + 1e-6) throw new RangeError('Invalid premultiplied SDR motion pixel.');
	}
}
export function motionBlendChannel(backdrop: number, source: number, mode: MotionBlendMode): number {
	switch (mode) {
		case 'normal': return source;
		case 'multiply': return backdrop * source;
		case 'screen': return backdrop + source - backdrop * source;
		case 'overlay': return backdrop <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
		case 'add': return Math.min(1, backdrop + source);
		case 'darken': return Math.min(backdrop, source);
		case 'lighten': return Math.max(backdrop, source);
		case 'difference': return Math.abs(backdrop - source);
		case 'exclusion': return backdrop + source - 2 * backdrop * source;
	}
}
/** Source-over coverage with separable blending of unassociated colors. Mutates only destination pixels. */
export function compositeMotionSurfaces(destination: MotionSurface, source: MotionSurface, mode: MotionBlendMode, opacity: number): void {
	if (destination.width !== source.width || destination.height !== source.height || !Number.isFinite(opacity)) throw new RangeError('Motion composite dimensions/opacity are invalid.');
	const weight = Math.max(0, Math.min(1, opacity));
	for (let i = 0; i < destination.pixels.length; i += 4) {
		const ab = destination.pixels[i + 3]!; const as = source.pixels[i + 3]! * weight;
		for (let channel = 0; channel < 3; channel++) {
			const cb = destination.pixels[i + channel]!; const cs = source.pixels[i + channel]! * weight;
			destination.pixels[i + channel] = (1 - as) * cb + (1 - ab) * cs + as * ab * motionBlendChannel(ab === 0 ? 0 : cb / ab, as === 0 ? 0 : cs / as, mode);
		}
		destination.pixels[i + 3] = as + ab * (1 - as);
	}
}
export function decodeMotionChannel(value: number, space: 'srgb' | 'rec709'): number {
	return decodeVideoChannel(value, space);
}
export function encodeMotionChannel(value: number, space: 'srgb' | 'rec709'): number {
	return encodeVideoChannel(value, space);
}
/** Encoding occurs after unpremultiplication; zero-alpha colors are canonical zero. */
export function motionSurfaceToRgba8(surface: MotionSurface, space: 'srgb' | 'rec709'): Uint8ClampedArray {
	validateMotionSurface(surface);
	const encoded = new Uint8ClampedArray(surface.pixels.length);
	for (let i = 0; i < encoded.length; i += 4) {
		const alpha = surface.pixels[i + 3]!;
		for (let c = 0; c < 3; c++) encoded[i + c] = alpha === 0 ? 0 : Math.round(255 * encodeMotionChannel(Math.min(1, surface.pixels[i + c]! / alpha), space));
		encoded[i + 3] = Math.round(alpha * 255);
	}
	return encoded;
}
export function motionSurfaceFromRgba8(width: number, height: number, encoded: Uint8Array | Uint8ClampedArray, space: 'srgb' | 'rec709'): MotionSurface {
	const surface = createMotionSurface(width, height);
	if (encoded.length !== surface.pixels.length) throw new RangeError('Motion encoded image byte length does not match dimensions.');
	for (let i = 0; i < encoded.length; i += 4) {
		const alpha = encoded[i + 3]! / 255;
		for (let c = 0; c < 3; c++) surface.pixels[i + c] = decodeMotionChannel(encoded[i + c]! / 255, space) * alpha;
		surface.pixels[i + 3] = alpha;
	}
	return surface;
}
export function assertMotion2DMatrix(matrix: MotionMatrix4): void {
	if ([2, 3, 6, 7, 8, 9, 11, 14].some((index) => Math.abs(matrix[index]!) > 1e-10) || Math.abs(matrix[10] - 1) > 1e-10 || Math.abs(matrix[15] - 1) > 1e-10) {
		throw new Error('Unsupported 3D motion transform; a camera-capable renderer is required.');
	}
}
/** Bilinear resampling uses pixel centers and transparent outside coverage in premultiplied linear light. */
export function transformMotionSurface(source: MotionSurface, width: number, height: number, matrix: MotionMatrix4): MotionSurface {
	assertMotion2DMatrix(matrix);
	const output = createMotionSurface(width, height);
	const [a, b, , , c, d] = matrix; const tx = matrix[12]; const ty = matrix[13];
	const determinant = a * d - b * c;
	if (Math.abs(determinant) < 1e-12) return output;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const sx = (d * (x + 0.5 - tx) - c * (y + 0.5 - ty)) / determinant - 0.5;
		const sy = (-b * (x + 0.5 - tx) + a * (y + 0.5 - ty)) / determinant - 0.5;
		const ix = Math.floor(sx); const iy = Math.floor(sy); const fx = sx - ix; const fy = sy - iy;
		let red = 0; let green = 0; let blue = 0; let alpha = 0;
		for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
			if (ix + dx < 0 || ix + dx >= source.width || iy + dy < 0 || iy + dy >= source.height) continue;
			const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
			const i = ((iy + dy) * source.width + ix + dx) * 4;
			red += source.pixels[i]! * weight; green += source.pixels[i + 1]! * weight; blue += source.pixels[i + 2]! * weight; alpha += source.pixels[i + 3]! * weight;
		}
		const i = (y * width + x) * 4;
		output.pixels[i] = red; output.pixels[i + 1] = green; output.pixels[i + 2] = blue; output.pixels[i + 3] = Math.min(1, alpha);
	}
	return output;
}
