/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CanvasKit } from 'canvaskit-wasm';
import { motionCanvasKitPath } from './motion-canvaskit-path.ts';
import { rasterMotionCanvasKitSurface } from './motion-canvaskit-surface.ts';
import { estimateMotionMaskWorkingBytes, motionMaskRasterWindow, type MotionEvaluatedMask, type MotionMaskRasterTarget } from './motion-mask-rendering.ts';
import { assertMotionWorkingBudget, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';

/** Closed filled coverage, round expansion/contraction, then an anisotropic local Gaussian. */
export function rasterMotionCanvasKitMask(kit: CanvasKit, mask: MotionEvaluatedMask, target: MotionMaskRasterTarget, signal?: AbortSignal): void {
	signal?.throwIfAborted();
	const window = motionMaskRasterWindow(mask, target.width, target.height);
	assertMotionWorkingBudget(estimateMotionMaskWorkingBytes(target.width, target.height, [mask]), MOTION_DEFAULT_WORKING_BYTES);
	if (target.coverage.length !== target.width * target.height) throw new RangeError('Motion mask coverage dimensions disagree.');
	const path = motionCanvasKitPath(kit, { ...mask.path, closed: true });
	const brush = new kit.Paint(); const layerBrush = new kit.Paint();
	const blur = mask.feather.some((sigma) => sigma > 0) ? kit.ImageFilter.MakeBlur(...mask.feather, kit.TileMode.Decal, null) : null;
	try {
		if (mask.feather.some((sigma) => sigma > 0) && !blur) throw new Error('CanvasKit Gaussian mask feathering is unavailable.');
		brush.setAntiAlias(true); brush.setColor(kit.WHITE, kit.ColorSpace.SRGB);
		if (blur) layerBrush.setImageFilter(blur);
		const surface = rasterMotionCanvasKitSurface(kit, window.width, window.height, (canvas) => {
			canvas.saveLayer(layerBrush);
			canvas.translate(window.padding - target.origin[0], window.padding - target.origin[1]);
			canvas.drawPath(path, brush);
			if (mask.expansion !== 0) {
				brush.setStyle(kit.PaintStyle.Stroke); brush.setStrokeWidth(2 * Math.abs(mask.expansion));
				brush.setStrokeCap(kit.StrokeCap.Round); brush.setStrokeJoin(kit.StrokeJoin.Round);
				if (mask.expansion < 0) brush.setBlendMode(kit.BlendMode.DstOut);
				canvas.drawPath(path, brush);
			}
			canvas.restore();
		});
		signal?.throwIfAborted();
		for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
			target.coverage[y * target.width + x] = Math.max(0, Math.min(1, surface.pixels[((y + window.padding) * window.width + x + window.padding) * 4 + 3]!));
		}
	} finally { blur?.delete(); layerBrush.delete(); brush.delete(); path.delete(); }
}
