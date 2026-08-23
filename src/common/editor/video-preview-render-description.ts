/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	VIDEO_CLIP_COMPOSITION_BLEND_MODES,
	type VideoClipCompositionBlendMode,
} from './video-clip-composition.ts';
import type { VideoRenderDescription } from './video-render-description.ts';

const DESCRIPTION_FIELDS = Object.freeze([
	'crop', 'sourceDisplayToCanvas', 'opacityStart', 'opacityEnd', 'blendMode', 'compositingOrder',
]);
const CROP_FIELDS = Object.freeze(['normalized', 'sourcePixels']);
const NORMALIZED_CROP_FIELDS = Object.freeze(['left', 'top', 'right', 'bottom']);
const SOURCE_PIXEL_CROP_FIELDS = Object.freeze(['x', 'y', 'width', 'height']);
const BLEND_MODES: ReadonlySet<string> = new Set(VIDEO_CLIP_COMPOSITION_BLEND_MODES);

export interface VideoPreviewRenderGeometryOptions {
	readonly canvasWidth: number;
	readonly canvasHeight: number;
	readonly intervalProgress?: number;
	readonly sourceDisplayWidth?: number;
	readonly sourceDisplayHeight?: number;
}

export interface VideoPreviewRenderGeometry {
	readonly sourceDisplayToCanvas: VideoRenderDescription['sourceDisplayToCanvas'];
	readonly sourceUv: Readonly<{ x: number; y: number; width: number; height: number }>;
	readonly sourcePixels: Readonly<{ x: number; y: number; width: number; height: number }>;
	readonly opacity: number;
	readonly blendMode: VideoClipCompositionBlendMode;
	readonly compositingOrder: number;
}

/** Snapshot the renderer-neutral contract for WebGL without reading persisted clip state. */
export function videoPreviewRenderGeometry(
	value: unknown,
	options: VideoPreviewRenderGeometryOptions,
): VideoPreviewRenderGeometry {
	positiveInteger(options?.canvasWidth, 'canvasWidth');
	positiveInteger(options?.canvasHeight, 'canvasHeight');
	const progress = unitNumber(options?.intervalProgress ?? 0, 'intervalProgress');
	const description = readClosedDomainRecord(value, 'video preview render description', DESCRIPTION_FIELDS);
	const crop = readClosedDomainRecord(
		readClosedDomainField(description, 'crop', 'video preview render description'),
		'video preview render description.crop',
		CROP_FIELDS,
	);
	const normalized = readClosedDomainRecord(
		readClosedDomainField(crop, 'normalized', 'video preview render description.crop'),
		'video preview render description.crop.normalized',
		NORMALIZED_CROP_FIELDS,
	);
	const sourcePixels = readClosedDomainRecord(
		readClosedDomainField(crop, 'sourcePixels', 'video preview render description.crop'),
		'video preview render description.crop.sourcePixels',
		SOURCE_PIXEL_CROP_FIELDS,
	);
	const left = unitNumber(readClosedDomainField(normalized, 'left', 'video preview crop'), 'crop.left');
	const top = unitNumber(readClosedDomainField(normalized, 'top', 'video preview crop'), 'crop.top');
	const right = unitNumber(readClosedDomainField(normalized, 'right', 'video preview crop'), 'crop.right');
	const bottom = unitNumber(readClosedDomainField(normalized, 'bottom', 'video preview crop'), 'crop.bottom');
	if (left + right >= 1 || top + bottom >= 1) {
		throw new RangeError('The video preview crop must retain a positive aperture.');
	}
	const sourcePixelCrop = validateSourcePixelCrop(sourcePixels, {
		left, top, right, bottom,
	}, options);
	const matrix = readClosedDomainArray(
		readClosedDomainField(description, 'sourceDisplayToCanvas', 'video preview render description'),
		'video preview sourceDisplayToCanvas',
		6,
		6,
	).map((number, index) => finiteNumber(number, `sourceDisplayToCanvas[${String(index)}]`));
	const opacityStart = unitNumber(
		readClosedDomainField(description, 'opacityStart', 'video preview render description'),
		'opacityStart',
	);
	const opacityEnd = unitNumber(
		readClosedDomainField(description, 'opacityEnd', 'video preview render description'),
		'opacityEnd',
	);
	const blendMode = readClosedDomainField(
		description, 'blendMode', 'video preview render description',
	);
	if (typeof blendMode !== 'string' || !BLEND_MODES.has(blendMode)) {
		throw new RangeError('The video preview blend mode is unsupported.');
	}
	const compositingOrder = readClosedDomainField(
		description, 'compositingOrder', 'video preview render description',
	);
	if (!Number.isSafeInteger(compositingOrder)
		|| Number(compositingOrder) < -32_768 || Number(compositingOrder) > 32_767) {
		throw new RangeError('The video preview compositing order is outside its range.');
	}
	return Object.freeze({
		sourceDisplayToCanvas: Object.freeze(matrix) as VideoRenderDescription['sourceDisplayToCanvas'],
		sourceUv: Object.freeze({ x: left, y: top, width: 1 - left - right, height: 1 - top - bottom }),
		sourcePixels: sourcePixelCrop,
		opacity: opacityStart + (opacityEnd - opacityStart) * progress,
		blendMode: blendMode as VideoClipCompositionBlendMode,
		compositingOrder: Number(compositingOrder),
	});
}

export interface VideoPreviewRenderQuadOptions {
	readonly canvasWidth: number;
	readonly canvasHeight: number;
	readonly textureViewport?: Readonly<{ x: number; y: number; width: number; height: number }>;
	readonly textureWidth?: number;
	readonly textureHeight?: number;
}

/** Convert source-display geometry to a WebGL strip while retaining exact crop UVs. */
export function videoPreviewRenderQuad(
	geometry: VideoPreviewRenderGeometry,
	options: VideoPreviewRenderQuadOptions,
) {
	const canvasWidth = positiveInteger(options.canvasWidth, 'canvasWidth');
	const canvasHeight = positiveInteger(options.canvasHeight, 'canvasHeight');
	const crop = geometry.sourcePixels;
	const sourceLeft = crop.x;
	const sourceRight = crop.x + crop.width;
	const sourceTop = crop.y;
	const sourceBottom = crop.y + crop.height;
	const positions = [
		devicePoint(geometry.sourceDisplayToCanvas, sourceLeft, sourceBottom, canvasWidth, canvasHeight),
		devicePoint(geometry.sourceDisplayToCanvas, sourceRight, sourceBottom, canvasWidth, canvasHeight),
		devicePoint(geometry.sourceDisplayToCanvas, sourceLeft, sourceTop, canvasWidth, canvasHeight),
		devicePoint(geometry.sourceDisplayToCanvas, sourceRight, sourceTop, canvasWidth, canvasHeight),
	].flat();
	const uv = geometry.sourceUv;
	const left = uv.x;
	const right = uv.x + uv.width;
	const top = 1 - uv.y;
	const bottom = 1 - uv.y - uv.height;
	const textureCoordinates = options.textureViewport
		? viewportTextureCoordinates(
			{ left, right, top, bottom },
			options.textureViewport,
			positiveInteger(options.textureWidth, 'textureWidth'),
			positiveInteger(options.textureHeight, 'textureHeight'),
		)
		: [left, bottom, right, bottom, left, top, right, top];
	return Object.freeze({
		positions: Object.freeze(positions),
		textureCoordinates: Object.freeze(textureCoordinates),
	});
}

export interface VideoPreviewRenderQuadUniforms {
	readonly positionTransform: readonly number[];
	readonly textureTransform: readonly number[];
}

/** Express one affine quad as column-major matrices for the shared vertex shader. */
export function videoPreviewRenderQuadUniforms(
	quad: Readonly<{ positions: readonly number[]; textureCoordinates: readonly number[] }>,
): VideoPreviewRenderQuadUniforms {
	return Object.freeze({
		positionTransform: quadTransform(quad?.positions, 'positions'),
		textureTransform: quadTransform(quad?.textureCoordinates, 'textureCoordinates'),
	});
}

/** Shared normalized encoded-RGB formulas used by the preview blend shader. */
export function videoPreviewBlendExpression(mode: string): string {
	switch (mode) {
		case 'normal': return 'source';
		case 'multiply': return 'backdrop * source';
		case 'screen': return 'backdrop + source - backdrop * source';
		case 'overlay': return 'backdrop <= 0.5 ? 2.0 * backdrop * source : 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source)';
		case 'darken': return 'min(backdrop, source)';
		case 'lighten': return 'max(backdrop, source)';
		case 'difference': return 'abs(backdrop - source)';
		case 'exclusion': return 'backdrop + source - 2.0 * backdrop * source';
		default: throw new RangeError(`Unsupported video preview blend mode: ${mode}.`);
	}
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a canonical finite number.`);
	}
	return value;
}

function unitNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number < 0 || number > 1) throw new RangeError(`${name} must be from zero through one.`);
	return number;
}

function validateSourcePixelCrop(
	value: Readonly<Record<string, unknown>>,
	normalized: Readonly<{ left: number; top: number; right: number; bottom: number }>,
	options: VideoPreviewRenderGeometryOptions,
): VideoPreviewRenderGeometry['sourcePixels'] {
	const x = nonNegativeNumber(
		readClosedDomainField(value, 'x', 'video preview source pixels'),
		'sourcePixels.x',
	);
	const y = nonNegativeNumber(
		readClosedDomainField(value, 'y', 'video preview source pixels'),
		'sourcePixels.y',
	);
	const width = positiveNumber(
		readClosedDomainField(value, 'width', 'video preview source pixels'),
		'sourcePixels.width',
	);
	const height = positiveNumber(
		readClosedDomainField(value, 'height', 'video preview source pixels'),
		'sourcePixels.height',
	);
	const apertureWidth = 1 - normalized.left - normalized.right;
	const apertureHeight = 1 - normalized.top - normalized.bottom;
	const inferredWidth = displayDimension(width / apertureWidth, 'sourcePixels.width');
	const inferredHeight = displayDimension(height / apertureHeight, 'sourcePixels.height');
	const sourceWidth = requestedDisplayDimension(
		options.sourceDisplayWidth, inferredWidth, 'sourceDisplayWidth',
	);
	const sourceHeight = requestedDisplayDimension(
		options.sourceDisplayHeight, inferredHeight, 'sourceDisplayHeight',
	);
	if (!approximatelyEqual(x, normalized.left * sourceWidth)
		|| !approximatelyEqual(y, normalized.top * sourceHeight)
		|| !approximatelyEqual(width, apertureWidth * sourceWidth)
		|| !approximatelyEqual(height, apertureHeight * sourceHeight)
		|| x + width > sourceWidth + numericTolerance(sourceWidth)
		|| y + height > sourceHeight + numericTolerance(sourceHeight)) {
		throw new RangeError(
			'The video preview source pixel crop is inconsistent with its normalized source display aperture.',
		);
	}
	return Object.freeze({ x, y, width, height });
}

function requestedDisplayDimension(
	value: unknown,
	inferred: number,
	name: string,
): number {
	if (value == null) return inferred;
	const requested = positiveInteger(value, name);
	if (!approximatelyEqual(requested, inferred)) {
		throw new RangeError(`${name} is inconsistent with the source pixel aperture.`);
	}
	return requested;
}

function displayDimension(value: number, name: string): number {
	const rounded = Math.round(value);
	if (!Number.isSafeInteger(rounded) || rounded < 1 || !approximatelyEqual(value, rounded)) {
		throw new RangeError(`${name} does not describe a positive integer source display dimension.`);
	}
	return rounded;
}

function nonNegativeNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number < 0) throw new RangeError(`${name} must be non-negative.`);
	return number;
}

function positiveNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

function approximatelyEqual(left: number, right: number): boolean {
	return Math.abs(left - right) <= numericTolerance(Math.max(Math.abs(left), Math.abs(right)));
}

function numericTolerance(scale: number): number {
	return Math.max(1, scale) * 1e-9;
}

function devicePoint(
	matrix: VideoRenderDescription['sourceDisplayToCanvas'],
	x: number,
	y: number,
	canvasWidth: number,
	canvasHeight: number,
): readonly [number, number] {
	const [a, b, c, d, e, f] = matrix;
	const canvasX = a * x + c * y + e;
	const canvasY = b * x + d * y + f;
	return [2 * canvasX / canvasWidth - 1, 1 - 2 * canvasY / canvasHeight];
}

function viewportTextureCoordinates(
	uv: Readonly<{ left: number; right: number; top: number; bottom: number }>,
	viewport: Readonly<{ x: number; y: number; width: number; height: number }>,
	textureWidth: number,
	textureHeight: number,
): number[] {
	for (const [name, value] of Object.entries(viewport)) {
		if (!Number.isFinite(value) || value < 0) throw new RangeError(`textureViewport.${name} is invalid.`);
	}
	const left = (viewport.x + uv.left * viewport.width) / textureWidth;
	const right = (viewport.x + uv.right * viewport.width) / textureWidth;
	const bottom = (viewport.y + uv.bottom * viewport.height) / textureHeight;
	const top = (viewport.y + uv.top * viewport.height) / textureHeight;
	return [left, bottom, right, bottom, left, top, right, top];
}

function quadTransform(values: readonly number[] | undefined, name: string): readonly number[] {
	if (!Array.isArray(values) || values.length !== 8) {
		throw new TypeError(`Video preview quad ${name} must contain four two-dimensional points.`);
	}
	const numbers = values.map((value, index) => finiteNumber(value, `${name}[${String(index)}]`));
	const [leftX, leftY, rightX, rightY, topX, topY] = numbers;
	return Object.freeze([
		rightX - leftX, rightY - leftY, 0,
		topX - leftX, topY - leftY, 0,
		leftX, leftY, 1,
	]);
}
