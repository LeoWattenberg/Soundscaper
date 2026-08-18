/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How a source is placed into a delivery canvas.
 *
 * One implementation, called by both sides on purpose. The render description
 * computes a placement and the FFmpeg adapter **recomputes it** to recover the
 * clip's authored transform by dividing the delivery fit back out; if the two
 * ever disagreed the adapter would attribute the delivery's own scaling to the
 * clip and refuse it as an out-of-range authored scale. Two copies of this
 * arithmetic is therefore not a duplication smell, it is a defect waiting for
 * the first delivery that is not `contain`.
 *
 * `contain` is what the product has always done — the source is scaled down
 * until it fits and centred, and the canvas background shows through the bars.
 * It stays the default, and its numbers are unchanged.
 */

/**
 * The largest extent a stated delivery canvas may claim.
 *
 * A stated canvas is not capped by the automatic ceiling — that is the point of
 * stating one — but it is still an allocation, so it answers to a bound no
 * encoder this product ships exceeds rather than to no bound at all. Paths with
 * a tighter real bound state that separately: the keyframe encoder's 8 MiB
 * per-frame limit decides long before an extent here does.
 */
export const VIDEO_CANVAS_MAXIMUM_EXTENT = 16_384;

export const VIDEO_CANVAS_FIT_MODES = Object.freeze(['contain', 'cover', 'stretch'] as const);
export type VideoCanvasFit = typeof VIDEO_CANVAS_FIT_MODES[number];

const FIT_MODES: ReadonlySet<string> = new Set(VIDEO_CANVAS_FIT_MODES);

export function isVideoCanvasFit(value: unknown): value is VideoCanvasFit {
	return typeof value === 'string' && FIT_MODES.has(value);
}

export interface VideoCanvasPlacement {
	/** The fitted extent of the source, which `cover` lets exceed the canvas. */
	readonly fittedWidth: number;
	readonly fittedHeight: number;
	/** Top-left of the fitted source in canvas pixels; negative under `cover`. */
	readonly fittedX: number;
	readonly fittedY: number;
}

/**
 * Place a source of the given display size into a canvas.
 *
 * - `contain` fits the whole source inside the canvas, leaving background bars.
 * - `cover` fills the canvas and lets the overflow fall outside it, which is the
 *   crop a 16:9 master needs to become a 9:16 delivery without black bars.
 * - `stretch` fills it exactly and does not preserve the source's aspect.
 *
 * The rounding is the rounding that shipped: extents round to the nearest pixel
 * and the offset centres what is left, so a `contain` placement returns exactly
 * the numbers it returned before this function existed.
 */
export function resolveVideoCanvasPlacement(
	fit: VideoCanvasFit,
	canvasWidth: number,
	canvasHeight: number,
	sourceWidth: number,
	sourceHeight: number,
): VideoCanvasPlacement {
	if (!isVideoCanvasFit(fit)) throw new RangeError(`Unsupported video canvas fit: ${String(fit)}.`);
	for (const [value, name] of [
		[canvasWidth, 'canvas width'], [canvasHeight, 'canvas height'],
		[sourceWidth, 'source width'], [sourceHeight, 'source height'],
	] as const) {
		if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Video canvas ${name} must be positive.`);
	}
	const widthRatio = canvasWidth / sourceWidth;
	const heightRatio = canvasHeight / sourceHeight;
	const scaleX = fit === 'stretch' ? widthRatio : fit === 'cover'
		? Math.max(widthRatio, heightRatio)
		: Math.min(widthRatio, heightRatio);
	const scaleY = fit === 'stretch' ? heightRatio : scaleX;
	const fittedWidth = Math.max(1, Math.round(sourceWidth * scaleX));
	const fittedHeight = Math.max(1, Math.round(sourceHeight * scaleY));
	return Object.freeze({
		fittedWidth,
		fittedHeight,
		fittedX: Math.round((canvasWidth - fittedWidth) / 2),
		fittedY: Math.round((canvasHeight - fittedHeight) / 2),
	});
}
