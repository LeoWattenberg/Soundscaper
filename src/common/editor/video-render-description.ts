/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoClipComposition,
	type VideoClipComposition,
} from './video-clip-composition.ts';

/** Positive, integer dimensions after source rotation and pixel-aspect reconciliation. */
export interface VideoRenderDisplaySize {
	readonly width: number;
	readonly height: number;
}

/** Positive, integer dimensions of the canonical sequence/export canvas. */
export interface VideoRenderCanvas {
	readonly width: number;
	readonly height: number;
}

export interface VideoRenderDescriptionRequest {
	readonly composition: unknown;
	readonly sourceDisplaySize: VideoRenderDisplaySize;
	readonly canvas: VideoRenderCanvas;
	/** A renderer-neutral transition weight before authored clip opacity. */
	readonly opacityStart?: number;
	/** Defaults to opacityStart for a static interval. */
	readonly opacityEnd?: number;
}

export interface VideoRenderNormalizedCrop {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** A continuous, half-open aperture in displayed-source pixel coordinates. */
export interface VideoRenderSourcePixelCrop {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface VideoRenderCropDescription {
	/** The renderer-authoritative UV aperture; no adapter may round these edges. */
	readonly normalized: VideoRenderNormalizedCrop;
	/** The same half-open aperture expressed continuously in source display pixels. */
	readonly sourcePixels: VideoRenderSourcePixelCrop;
}

/**
 * A Canvas/WebGL-style 2D affine `[a, b, c, d, e, f]` mapping displayed-source
 * coordinates to canonical canvas coordinates:
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f`.
 */
export type VideoSourceDisplayToCanvasAffine = readonly [
	a: number,
	b: number,
	c: number,
	d: number,
	e: number,
	f: number,
];

export interface VideoRenderDescription {
	readonly crop: VideoRenderCropDescription;
	readonly sourceDisplayToCanvas: VideoSourceDisplayToCanvasAffine;
	readonly opacityStart: number;
	readonly opacityEnd: number;
	readonly blendMode: VideoClipComposition['blendMode'];
	readonly compositingOrder: number;
}

/**
 * Resolve the one renderer-neutral visual operation for a static clip interval.
 *
 * Source dimensions have already been oriented and pixel-aspect reconciled.
 * The full display aperture receives the legacy integer-rounded contain fit.
 * Crop remains a mask over that aperture and therefore never reflows it.
 * Flip and scale, followed by positive-clockwise rotation in y-down canvas
 * coordinates, operate about the authored anchor. Position is a neutral-biased
 * translation: `.5` leaves the rounded contain-fit anchor exactly where it is,
 * while one unit spans one canvas extent. Authored opacity multiplies, rather
 * than replaces, the transition weights supplied by the timeline.
 */
export function resolveVideoRenderDescription(
	request: VideoRenderDescriptionRequest,
): VideoRenderDescription {
	const input = requestRecord(request);
	const composition = normalizeVideoClipComposition(input.composition, 'video render composition');
	const sourceWidth = positiveInteger(input.sourceDisplaySize?.width, 'Video render source display width');
	const sourceHeight = positiveInteger(input.sourceDisplaySize?.height, 'Video render source display height');
	const canvasWidth = positiveInteger(input.canvas?.width, 'Video render canvas width');
	const canvasHeight = positiveInteger(input.canvas?.height, 'Video render canvas height');
	const transitionStart = unitInterval(input.opacityStart ?? 1, 'Video render opacityStart');
	const transitionEnd = unitInterval(input.opacityEnd ?? transitionStart, 'Video render opacityEnd');

	const containScale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
	const fittedWidth = Math.max(1, Math.round(sourceWidth * containScale));
	const fittedHeight = Math.max(1, Math.round(sourceHeight * containScale));
	const fittedX = Math.round((canvasWidth - fittedWidth) / 2);
	const fittedY = Math.round((canvasHeight - fittedHeight) / 2);
	const sourceToFitX = fittedWidth / sourceWidth;
	const sourceToFitY = fittedHeight / sourceHeight;
	const transform = composition.transform;
	const sourceAnchorX = transform.anchorX * sourceWidth;
	const sourceAnchorY = transform.anchorY * sourceHeight;
	const baseAnchorX = fittedX + transform.anchorX * fittedWidth;
	const baseAnchorY = fittedY + transform.anchorY * fittedHeight;
	const targetAnchorX = baseAnchorX + (transform.positionX - 0.5) * canvasWidth;
	const targetAnchorY = baseAnchorY + (transform.positionY - 0.5) * canvasHeight;
	const flipX = transform.flipHorizontal ? -1 : 1;
	const flipY = transform.flipVertical ? -1 : 1;
	const localScaleX = sourceToFitX * transform.scaleX * flipX;
	const localScaleY = sourceToFitY * transform.scaleY * flipY;
	const { cosine, sine } = rotationComponents(transform.rotationDegrees);
	// Canvas coordinates point down, so the conventional positive-angle matrix
	// already appears clockwise to a viewer.
	const a = canonicalCoefficient(cosine * localScaleX);
	const b = canonicalCoefficient(sine * localScaleX);
	const c = canonicalCoefficient(-sine * localScaleY);
	const d = canonicalCoefficient(cosine * localScaleY);
	const neutralGeometry = transform.positionX === 0.5
		&& transform.positionY === 0.5
		&& transform.scaleX === 1
		&& transform.scaleY === 1
		&& transform.rotationDegrees % 360 === 0
		&& !transform.flipHorizontal
		&& !transform.flipVertical;
	// Avoid cancellation residue in the compatibility-critical identity case.
	const e = neutralGeometry
		? fittedX
		: canonicalCoefficient(targetAnchorX - a * sourceAnchorX - c * sourceAnchorY);
	const f = neutralGeometry
		? fittedY
		: canonicalCoefficient(targetAnchorY - b * sourceAnchorX - d * sourceAnchorY);
	const crop = composition.crop;
	const normalizedCrop = Object.freeze({
		left: crop.left,
		top: crop.top,
		right: crop.right,
		bottom: crop.bottom,
	});
	const sourcePixelCrop = Object.freeze({
		x: canonicalCoefficient(crop.left * sourceWidth),
		y: canonicalCoefficient(crop.top * sourceHeight),
		width: canonicalCoefficient((1 - crop.left - crop.right) * sourceWidth),
		height: canonicalCoefficient((1 - crop.top - crop.bottom) * sourceHeight),
	});

	const sourceDisplayToCanvas: VideoSourceDisplayToCanvasAffine = Object.freeze([a, b, c, d, e, f] as const);
	return Object.freeze({
		crop: Object.freeze({
			normalized: normalizedCrop,
			sourcePixels: sourcePixelCrop,
		}),
		sourceDisplayToCanvas,
		opacityStart: canonicalCoefficient(composition.opacity * transitionStart),
		opacityEnd: canonicalCoefficient(composition.opacity * transitionEnd),
		blendMode: composition.blendMode,
		compositingOrder: composition.compositingOrder,
	});
}

function requestRecord(value: VideoRenderDescriptionRequest): VideoRenderDescriptionRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A video render description request must be an object.');
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function unitInterval(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${name} must be a finite number from 0 through 1.`);
	}
	return value;
}

/** Collapse negative zero, which has no stable JSON representation. */
function canonicalCoefficient(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}

function rotationComponents(degrees: number): Readonly<{ cosine: number; sine: number }> {
	const turn = ((degrees % 360) + 360) % 360;
	if (turn === 0) return { cosine: 1, sine: 0 };
	if (turn === 90) return { cosine: 0, sine: 1 };
	if (turn === 180) return { cosine: -1, sine: 0 };
	if (turn === 270) return { cosine: 0, sine: -1 };
	const angle = turn * Math.PI / 180;
	return {
		cosine: canonicalCoefficient(Math.cos(angle)),
		sine: canonicalCoefficient(Math.sin(angle)),
	};
}
