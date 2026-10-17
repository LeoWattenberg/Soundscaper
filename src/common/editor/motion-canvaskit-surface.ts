/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Canvas, CanvasKit } from 'canvaskit-wasm';
import { createMotionSurface, motionSurfaceLength, type MotionSurface } from './motion-surface.ts';

export function rasterMotionCanvasKitSurface(kit: CanvasKit, width: number, height: number, draw: (canvas: Canvas) => void): MotionSurface {
	const memory = kit.Malloc(Float32Array, motionSurfaceLength(width, height));
	// This pinned build exposes no linear color-space factory. Identical SRGB tags on every
	// paint and surface prevent conversion; the unencoded float channel values remain linear.
	// Never draw decoded images here: their transfer function must be explicitly removed first.
	const surface = kit.MakeRasterDirectSurface({ width, height, colorType: kit.ColorType.RGBA_F32, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, memory, width * 16);
	if (!surface) { kit.Free(memory); throw new Error('CanvasKit could not allocate a floating-point motion surface.'); }
	try {
		const canvas = surface.getCanvas(); canvas.clear(kit.TRANSPARENT); draw(canvas); surface.flush();
		const output = createMotionSurface(width, height); output.pixels.set(memory.toTypedArray()); return output;
	} finally { surface.delete(); kit.Free(memory); }
}
