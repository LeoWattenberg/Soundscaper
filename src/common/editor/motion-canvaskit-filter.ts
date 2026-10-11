/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CanvasKit, ImageFilter } from 'canvaskit-wasm';
import { rasterMotionCanvasKitSurface } from './motion-canvaskit-surface.ts';
import type { MotionSurface } from './motion-surface.ts';

/** Image, paint and target carry identical tags; input channels remain unencoded linear floats. */
export function filterMotionCanvasKitSurface(kit: CanvasKit, source: MotionSurface, options: Readonly<{
	width: number; height: number; x: number; y: number; filter: ImageFilter;
}>): MotionSurface {
	const image = kit.MakeImage({ width: source.width, height: source.height, colorType: kit.ColorType.RGBA_F32,
		alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength), source.width * 16);
	if (!image) throw new Error('CanvasKit could not retain the floating-point effect input.');
	const brush = new kit.Paint();
	try {
		brush.setImageFilter(options.filter);
		return rasterMotionCanvasKitSurface(kit, options.width, options.height, (canvas) => canvas.drawImage(image, options.x, options.y, brush));
	} finally { brush.delete(); image.delete(); }
}

export function blurMotionCanvasKitSurface(kit: CanvasKit, source: MotionSurface, sigma: number, options: Readonly<{ width: number; height: number; x: number; y: number }>): MotionSurface {
	const blur = kit.ImageFilter.MakeBlur(sigma, sigma, kit.TileMode.Decal, null);
	if (!blur) throw new Error('CanvasKit Gaussian filtering is unavailable.');
	try { return filterMotionCanvasKitSurface(kit, source, { ...options, filter: blur }); } finally { blur.delete(); }
}
