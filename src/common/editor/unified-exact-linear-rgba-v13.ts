/* SPDX-License-Identifier: AGPL-3.0-only */

/** Linear Rec.709/D65 premultiplied working buffers for exact V13 picture composition. */

import {
	encodeManagedSdrLinearPixelV1,
	type VideoColorOutputSpaceV1,
} from './video-color-management-v27.ts';
import type { VideoClipCompositionBlendMode } from './video-clip-composition.ts';
import {
	videoPreviewRenderGeometry,
	type VideoPreviewRenderGeometry,
} from './video-preview-render-description.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from './unified-exact-render-finishing-consumers-v13.ts';

export interface UnifiedExactLinearPremultipliedFrameV13 {
	readonly width: number;
	readonly height: number;
	readonly pixels: Float64Array<ArrayBuffer>;
}

export type UnifiedExactLinearBlendModeV13 = VideoClipCompositionBlendMode | 'add';

export interface UnifiedExactLinearCompositionEntryV13 {
	readonly frame: UnifiedExactLinearPremultipliedFrameV13;
	readonly blendMode: UnifiedExactLinearBlendModeV13;
}

export function createUnifiedExactLinearPremultipliedFrameV13(
	widthValue: number,
	heightValue: number,
	background: readonly [number, number, number, number] = [0, 0, 0, 0],
): UnifiedExactLinearPremultipliedFrameV13 {
	const width = dimension(widthValue, 'linear frame width');
	const height = dimension(heightValue, 'linear frame height');
	const rgba = tuple(background, 'linear frame background');
	const pixels = new Float64Array(width * height * 4);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset] = rgba[0] * rgba[3];
		pixels[offset + 1] = rgba[1] * rgba[3];
		pixels[offset + 2] = rgba[2] * rgba[3];
		pixels[offset + 3] = rgba[3];
	}
	return Object.freeze({ width, height, pixels });
}

/** Place one straight-alpha linear source with deterministic affine bilinear sampling. */
export function placeUnifiedExactLinearRgbaFrameV13(request: Readonly<{
	readonly frame: UnifiedExactRenderRgbaFrameV13;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly outputWidth: number;
	readonly outputHeight: number;
	readonly renderDescription: unknown;
	readonly intervalProgress?: number;
	readonly opacity?: number;
	readonly mask?: Uint8Array<ArrayBuffer>;
}>): UnifiedExactLinearPremultipliedFrameV13 {
	const source = rgbaFrame(request?.frame, 'linear placed source');
	const displayWidth = dimension(request?.displayWidth, 'linear source display width');
	const displayHeight = dimension(request?.displayHeight, 'linear source display height');
	const outputWidth = dimension(request?.outputWidth, 'linear output width');
	const outputHeight = dimension(request?.outputHeight, 'linear output height');
	const geometry = videoPreviewRenderGeometry(request?.renderDescription, {
		canvasWidth: outputWidth, canvasHeight: outputHeight,
		intervalProgress: unit(request?.intervalProgress ?? 0, 'linear interval progress'),
		sourceDisplayWidth: displayWidth, sourceDisplayHeight: displayHeight,
	});
	const opacity = geometry.opacity * unit(request?.opacity ?? 1, 'linear presentation opacity');
	const mask = request?.mask;
	if (mask !== undefined && (!(mask instanceof Uint8Array)
		|| mask.byteLength !== outputWidth * outputHeight)) {
		throw new RangeError('A linear placement mask must match the output geometry.');
	}
	const output = createUnifiedExactLinearPremultipliedFrameV13(outputWidth, outputHeight);
	place(source, output, geometry, displayWidth, displayHeight, opacity, mask);
	return output;
}

/** Add premultiplied transition entries; their canonical weights are already in alpha. */
export function addUnifiedExactLinearDissolveV13(
	targetValue: UnifiedExactLinearPremultipliedFrameV13,
	sourceValue: UnifiedExactLinearPremultipliedFrameV13,
): void {
	const target = premultipliedFrame(targetValue, 'linear dissolve target');
	const source = premultipliedFrame(sourceValue, 'linear dissolve source');
	assertSameGeometry(target, source, 'linear dissolve');
	for (let offset = 0; offset < target.pixels.length; offset += 4) {
		for (let channel = 0; channel < 4; channel += 1) {
			target.pixels[offset + channel] = clamp(
				target.pixels[offset + channel]! + source.pixels[offset + channel]!,
			);
		}
	}
}

/** Accumulate canonical transition weights only within one shared blend authority. */
export function addUnifiedExactLinearDissolveEntryV13(
	entries: UnifiedExactLinearCompositionEntryV13[],
	frame: UnifiedExactLinearPremultipliedFrameV13,
	blendMode: UnifiedExactLinearBlendModeV13,
): void {
	const current = entries.find((entry) => entry.blendMode === blendMode);
	if (current) addUnifiedExactLinearDissolveV13(current.frame, frame);
	else entries.push(Object.freeze({ frame, blendMode }));
}

/** Retain an independently composited source in its authored sequence order. */
export function addUnifiedExactLinearCompositionEntryV13(
	entries: UnifiedExactLinearCompositionEntryV13[],
	frame: UnifiedExactLinearPremultipliedFrameV13,
	blendMode: UnifiedExactLinearBlendModeV13,
): void {
	entries.push(Object.freeze({ frame, blendMode }));
}

/** Flatten one track for an authored adjustment-layer operation. */
export function flattenUnifiedExactLinearCompositionV13(
	width: number,
	height: number,
	entries: readonly UnifiedExactLinearCompositionEntryV13[],
): UnifiedExactLinearPremultipliedFrameV13 {
	const output = createUnifiedExactLinearPremultipliedFrameV13(width, height);
	for (const { frame, blendMode } of entries) {
		compositeUnifiedExactLinearFrameV13(output, frame, blendMode);
	}
	return output;
}

/** Blend a complete premultiplied layer into its backdrop in the linear working space. */
export function compositeUnifiedExactLinearFrameV13(
	targetValue: UnifiedExactLinearPremultipliedFrameV13,
	sourceValue: UnifiedExactLinearPremultipliedFrameV13,
	blendMode: UnifiedExactLinearBlendModeV13,
): void {
	const target = premultipliedFrame(targetValue, 'linear composite target');
	const source = premultipliedFrame(sourceValue, 'linear composite source');
	assertSameGeometry(target, source, 'linear composite');
	for (let offset = 0; offset < target.pixels.length; offset += 4) {
		const targetAlpha = clamp(target.pixels[offset + 3]!);
		const sourceAlpha = clamp(source.pixels[offset + 3]!);
		const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
		for (let channel = 0; channel < 3; channel += 1) {
			const backdrop = targetAlpha > 1e-12 ? target.pixels[offset + channel]! / targetAlpha : 0;
			const foreground = sourceAlpha > 1e-12 ? source.pixels[offset + channel]! / sourceAlpha : 0;
			const blended = blend(backdrop, foreground, blendMode);
			target.pixels[offset + channel] = clamp(
				(1 - sourceAlpha) * target.pixels[offset + channel]!
				+ sourceAlpha * ((1 - targetAlpha) * foreground + targetAlpha * blended),
			);
		}
		target.pixels[offset + 3] = outputAlpha;
	}
}

/** Return straight linear eight-bit pixels for another exact finishing stage. */
export function straightUnifiedExactLinearFrameV13(
	value: UnifiedExactLinearPremultipliedFrameV13,
): UnifiedExactRenderRgbaFrameV13 {
	const frame = premultipliedFrame(value, 'linear straight frame');
	const pixels = new Uint8Array(frame.pixels.length);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		const alpha = clamp(frame.pixels[offset + 3]!);
		for (let channel = 0; channel < 3; channel += 1) {
			pixels[offset + channel] = Math.round(clamp(
				alpha > 1e-12 ? frame.pixels[offset + channel]! / alpha : 0,
			) * 255);
		}
		pixels[offset + 3] = Math.round(alpha * 255);
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

/** Unassociate and encode each final working pixel exactly once. */
export function encodeUnifiedExactLinearFrameV13(
	value: UnifiedExactLinearPremultipliedFrameV13,
	outputSpace: VideoColorOutputSpaceV1,
	target?: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
	const frame = premultipliedFrame(value, 'linear encoded frame');
	const pixels = target ?? new Uint8Array(frame.pixels.length);
	if (!(pixels instanceof Uint8Array) || pixels.byteLength !== frame.pixels.length) {
		throw new RangeError('A linear encoded target must match its frame geometry.');
	}
	for (let offset = 0; offset < pixels.length; offset += 4) {
		const alpha = clamp(frame.pixels[offset + 3]!);
		const encoded = encodeManagedSdrLinearPixelV1([
			alpha > 1e-12 ? frame.pixels[offset]! / alpha : 0,
			alpha > 1e-12 ? frame.pixels[offset + 1]! / alpha : 0,
			alpha > 1e-12 ? frame.pixels[offset + 2]! / alpha : 0,
			alpha,
		], outputSpace);
		for (let channel = 0; channel < 4; channel += 1) {
			pixels[offset + channel] = Math.round(encoded[channel]! * 255);
		}
	}
	return pixels;
}

function place(
	source: UnifiedExactRenderRgbaFrameV13,
	target: UnifiedExactLinearPremultipliedFrameV13,
	geometry: VideoPreviewRenderGeometry,
	displayWidth: number,
	displayHeight: number,
	opacity: number,
	mask?: Uint8Array,
): void {
	const [a, b, c, d, e, f] = geometry.sourceDisplayToCanvas;
	const determinant = a * d - b * c;
	if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15) {
		throw new RangeError('The linear placement transform is singular.');
	}
	const crop = geometry.sourcePixels;
	for (let y = 0; y < target.height; y += 1) for (let x = 0; x < target.width; x += 1) {
		const dx = x + 0.5 - e;
		const dy = y + 0.5 - f;
		const sourceX = (d * dx - c * dy) / determinant;
		const sourceY = (-b * dx + a * dy) / determinant;
		if (sourceX < crop.x || sourceY < crop.y
			|| sourceX >= crop.x + crop.width || sourceY >= crop.y + crop.height) continue;
		const rgba = sample(source,
			sourceX * source.width / displayWidth - 0.5,
			sourceY * source.height / displayHeight - 0.5);
		const pixel = y * target.width + x;
		const alpha = rgba[3] * opacity * (mask === undefined ? 1 : mask[pixel]! / 255);
		const offset = pixel * 4;
		target.pixels[offset] = rgba[0] * alpha;
		target.pixels[offset + 1] = rgba[1] * alpha;
		target.pixels[offset + 2] = rgba[2] * alpha;
		target.pixels[offset + 3] = alpha;
	}
}

function sample(
	frame: UnifiedExactRenderRgbaFrameV13,
	xValue: number,
	yValue: number,
): readonly [number, number, number, number] {
	const x = Math.max(0, Math.min(frame.width - 1, xValue));
	const y = Math.max(0, Math.min(frame.height - 1, yValue));
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(frame.width - 1, x0 + 1);
	const y1 = Math.min(frame.height - 1, y0 + 1);
	const mixX = x - x0;
	const mixY = y - y0;
	const result = [0, 0, 0, 0];
	for (let channel = 0; channel < 4; channel += 1) {
		const at = (px: number, py: number) => frame.pixels[(py * frame.width + px) * 4 + channel]! / 255;
		const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * mixX;
		const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * mixX;
		result[channel] = top + (bottom - top) * mixY;
	}
	return result as unknown as readonly [number, number, number, number];
}

function blend(backdrop: number, source: number, mode: UnifiedExactLinearBlendModeV13): number {
	if (mode === 'add') return Math.min(1, backdrop + source);
	if (mode === 'multiply') return backdrop * source;
	if (mode === 'screen') return backdrop + source - backdrop * source;
	if (mode === 'overlay') return backdrop <= 0.5 ? 2 * backdrop * source
		: 1 - 2 * (1 - backdrop) * (1 - source);
	if (mode === 'darken') return Math.min(backdrop, source);
	if (mode === 'lighten') return Math.max(backdrop, source);
	if (mode === 'difference') return Math.abs(backdrop - source);
	if (mode === 'exclusion') return backdrop + source - 2 * backdrop * source;
	return source;
}

function rgbaFrame(value: unknown, name: string): UnifiedExactRenderRgbaFrameV13 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an RGBA frame.`);
	const frame = value as Partial<UnifiedExactRenderRgbaFrameV13>;
	const width = dimension(frame.width, `${name} width`);
	const height = dimension(frame.height, `${name} height`);
	if (!(frame.pixels instanceof Uint8Array) || frame.pixels.byteLength !== width * height * 4) {
		throw new RangeError(`${name} has invalid RGBA geometry.`);
	}
	return frame as UnifiedExactRenderRgbaFrameV13;
}

function premultipliedFrame(
	value: unknown,
	name: string,
): UnifiedExactLinearPremultipliedFrameV13 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be a working frame.`);
	const frame = value as Partial<UnifiedExactLinearPremultipliedFrameV13>;
	const width = dimension(frame.width, `${name} width`);
	const height = dimension(frame.height, `${name} height`);
	if (!(frame.pixels instanceof Float64Array) || frame.pixels.byteLength !== width * height * 32) {
		throw new RangeError(`${name} has invalid premultiplied geometry.`);
	}
	return frame as UnifiedExactLinearPremultipliedFrameV13;
}

function assertSameGeometry(
	left: UnifiedExactLinearPremultipliedFrameV13,
	right: UnifiedExactLinearPremultipliedFrameV13,
	name: string,
): void {
	if (left.width !== right.width || left.height !== right.height) {
		throw new RangeError(`${name} frame geometry changed.`);
	}
}

function tuple(value: readonly number[], name: string): readonly [number, number, number, number] {
	if (!Array.isArray(value) || value.length !== 4) throw new TypeError(`${name} must have four channels.`);
	return value.map((channel, index) => unit(
		channel, `${name}[${String(index)}]`,
	)) as [number, number, number, number];
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded integer.`);
	}
	return Number(value);
}

function unit(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${name} must be between zero and one.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
