/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionMask } from './motion-composition.ts';
import type { MotionLocalRaster, MotionSourceOrigin } from './motion-local-raster.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import { createMotionSurface, motionSurfaceLength, validateMotionSurface } from './motion-surface.ts';

export type MotionEvaluatedMask = EvaluatedMotionState<MotionMask>;
export interface MotionMaskRasterTarget {
	readonly width: number; readonly height: number; readonly origin: MotionSourceOrigin;
	/** Caller-owned scratch, overwritten completely for each mask; no per-mask retained surfaces. */
	readonly coverage: Float32Array;
}
export interface MotionMaskRasterizer {
	/** Peak includes source, copied output, two coverage arrays, native scratch and readback. */
	estimateMaskWorkingBytes(width: number, height: number, masks: readonly MotionEvaluatedMask[]): number;
	rasterizeMask(mask: MotionEvaluatedMask, target: MotionMaskRasterTarget, signal?: AbortSignal): Promise<void>;
}

export function assertMotionMaskParameters(mask: MotionEvaluatedMask): void {
	if (!Number.isFinite(mask.opacity) || mask.opacity < 0 || mask.opacity > 1) throw new RangeError('Motion mask opacity must be between zero and one.');
	if (mask.feather.some((sigma) => !Number.isFinite(sigma) || sigma < 0 || sigma > 128)) throw new RangeError('Motion mask feather must be a Gaussian sigma between zero and 128 local pixels.');
	if (!Number.isFinite(mask.expansion) || Math.abs(mask.expansion) > 4096) throw new RangeError('Motion mask expansion must be between -4096 and 4096 local pixels.');
	if (!['add', 'subtract', 'intersect', 'difference'].includes(mask.operation)) throw new TypeError('Unknown motion mask operation.');
}

/** The padded window includes the Gaussian's five-sigma support outside source bounds. */
export function motionMaskRasterWindow(mask: MotionEvaluatedMask, width: number, height: number): Readonly<{ padding: number; width: number; height: number }> {
	assertMotionMaskParameters(mask); motionSurfaceLength(width, height);
	const padding = Math.ceil(5 * Math.max(...mask.feather) + Math.abs(mask.expansion) + 1);
	const window = { padding, width: width + padding * 2, height: height + padding * 2 };
	motionSurfaceLength(window.width, window.height); return window;
}

/** A bounded one-mask-at-a-time strategy, including native blur intermediates and JS readback. */
export function estimateMotionMaskWorkingBytes(width: number, height: number, masks: readonly MotionEvaluatedMask[]): number {
	const sourcePixels = motionSurfaceLength(width, height) / 4;
	let windowPixels = 0;
	for (const mask of masks) {
		const window = motionMaskRasterWindow(mask, width, height);
		windowPixels = Math.max(windowPixels, window.width * window.height);
	}
	return sourcePixels * 40 + windowPixels * 96;
}

/** Coverage is source-local. Opacity interpolates between the current and operated coverage. */
export async function applyMotionMasks(source: MotionLocalRaster, masks: readonly MotionEvaluatedMask[], rasterizer: MotionMaskRasterizer, signal?: AbortSignal): Promise<MotionLocalRaster> {
	signal?.throwIfAborted(); validateMotionSurface(source.surface);
	if (!masks.length) return source;
	for (const mask of masks) assertMotionMaskParameters(mask);
	const { width, height } = source.surface;
	const combined = new Float32Array(width * height);
	const coverage = new Float32Array(width * height);
	if (masks[0]!.operation === 'subtract' || masks[0]!.operation === 'intersect') combined.fill(1);
	for (const mask of masks) {
		signal?.throwIfAborted(); coverage.fill(NaN);
		await rasterizer.rasterizeMask(mask, { width, height, origin: source.origin, coverage }, signal);
		signal?.throwIfAborted();
		for (let i = 0; i < combined.length; i++) {
			const raw = coverage[i]!;
			if (!Number.isFinite(raw) || raw < 0 || raw > 1) throw new RangeError('Motion mask rasterizer supplied invalid or incomplete coverage.');
			const a = combined[i]!; const b = mask.inverted ? 1 - raw : raw;
			const operated = mask.operation === 'add' ? a + b - a * b : mask.operation === 'subtract' ? a * (1 - b)
				: mask.operation === 'intersect' ? a * b : a + b - 2 * a * b;
			combined[i] = Math.max(0, Math.min(1, a + mask.opacity * (operated - a)));
		}
		// Worker cancellation and queued UI input must be observable between masks.
		await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	}
	signal?.throwIfAborted();
	const output = createMotionSurface(width, height);
	for (let i = 0; i < combined.length; i++) for (let channel = 0; channel < 4; channel++) output.pixels[i * 4 + channel] = source.surface.pixels[i * 4 + channel]! * combined[i]!;
	return { surface: output, origin: source.origin };
}
