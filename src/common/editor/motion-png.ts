/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CanvasKit } from 'canvaskit-wasm';
import { motionSurfaceToRgba8, type MotionSurface } from './motion-surface.ts';

/** Delivery encodes straight sRGB only after linear premultiplied compositing is complete. */
export function encodeMotionPng(kit: CanvasKit, surface: MotionSurface): Uint8Array {
	const bytes = motionSurfaceToRgba8(surface, 'srgb');
	const image = kit.MakeImage({ width: surface.width, height: surface.height, colorType: kit.ColorType.RGBA_8888,
		alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB }, bytes, surface.width * 4);
	if (!image) throw new Error('The motion PNG encoder could not create its delivery image.');
	try {
		const encoded = image.encodeToBytes(kit.ImageFormat.PNG, 100);
		if (!encoded) throw new Error('The motion PNG encoder produced no complete image.');
		return new Uint8Array(encoded);
	} finally { image.delete(); }
}
