/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CanvasKit, Paint, Shader } from 'canvaskit-wasm';
import type { MotionFill } from './motion-fill.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import type { MotionColor } from './motion-property.ts';

export function withMotionCanvasKitPaint(kit: CanvasKit, fill: EvaluatedMotionState<MotionFill>, draw: (paint: Paint) => void): void {
	const brush = new kit.Paint(); let shader: Shader | null = null;
	try {
		brush.setAntiAlias(true);
		if (isColor(fill)) brush.setColor(kit.Color4f(...fill), kit.ColorSpace.SRGB);
		else {
			const offsets = fill.stops.map((stop) => stop.offset);
			if (offsets.some((offset) => !Number.isFinite(offset) || offset < 0 || offset > 1)) throw new RangeError('Motion gradient stop is outside the normalized range.');
			if (offsets.some((offset, index) => index > 0 && offset < offsets[index - 1]!)) throw new RangeError('Motion gradient stops changed order; correct their animation.');
			const colors = fill.stops.map((stop) => kit.Color4f(...stop.color));
			if (fill.kind === 'linear-gradient') {
				if (Math.hypot(fill.end[0] - fill.start[0], fill.end[1] - fill.start[1]) < 1e-10) throw new RangeError('Motion linear gradient endpoints must differ.');
				shader = kit.Shader.MakeLinearGradient([...fill.start], [...fill.end], colors, offsets, kit.TileMode.Clamp, undefined, 1, kit.ColorSpace.SRGB);
			} else {
				if (!Number.isFinite(fill.radius) || fill.radius <= 0 || fill.radius > 32768) throw new RangeError('Motion radial gradient radius is outside the rendering range.');
				shader = kit.Shader.MakeRadialGradient([...fill.center], fill.radius, colors, offsets, kit.TileMode.Clamp, undefined, 1, kit.ColorSpace.SRGB);
			}
			brush.setShader(shader);
		}
		draw(brush);
	} finally { brush.delete(); shader?.delete(); }
}

function isColor(fill: EvaluatedMotionState<MotionFill>): fill is MotionColor { return Array.isArray(fill); }
