/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { PIXEL_FRAME_HARD_LIMITS_V1 } from './pixel-frame-contract-v1.ts';

export interface ImageGeometryPointV1 { readonly x: number; readonly y: number }
export interface ImageGeometryCropV1 extends ImageGeometryPointV1 { readonly width: number; readonly height: number }
export interface ImageGeometryPerspectiveV1 {
	readonly topLeft: ImageGeometryPointV1;
	readonly topRight: ImageGeometryPointV1;
	readonly bottomRight: ImageGeometryPointV1;
	readonly bottomLeft: ImageGeometryPointV1;
}
/** A new shared recipe, independent of persisted PhotoGeometryV1 and timeline mask crops. */
export interface ImageGeometryV1 {
	readonly schemaVersion: 1;
	readonly crop: ImageGeometryCropV1 | null;
	readonly rotationDegrees: number;
	readonly flipHorizontal: boolean;
	readonly flipVertical: boolean;
	/** Clockwise source corners within the cropped aperture, rectified to that rectangle. */
	readonly perspective: ImageGeometryPerspectiveV1 | null;
}
export type ImageGeometryAspectPresetV1 = 'free' | 'source' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16';
export const IMAGE_GEOMETRY_MINIMUM_QUAD_CROSS_V1 = 1e-8;
const FULL_CROP = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

export function normalizeImageGeometryV1(value: unknown): Readonly<ImageGeometryV1> {
	const input = record(value, 'image geometry', ['schemaVersion', 'crop', 'rotationDegrees', 'flipHorizontal', 'flipVertical', 'perspective']);
	if (field(input, 'schemaVersion', 'image geometry') !== 1) throw new RangeError('Unsupported image geometry schema.');
	const crop = field(input, 'crop', 'image geometry'), perspective = field(input, 'perspective', 'image geometry');
	return Object.freeze({ schemaVersion: 1, crop: crop === null ? null : readCrop(crop),
		rotationDegrees: finite(field(input, 'rotationDegrees', 'image geometry'), -180, 180, 'rotation'),
		flipHorizontal: boolean(field(input, 'flipHorizontal', 'image geometry')),
		flipVertical: boolean(field(input, 'flipVertical', 'image geometry')),
		perspective: perspective === null ? null : readPerspective(perspective) });
}

/** Author a centered narrower crop in original coordinates; no resampling or implicit aspect stretch. */
export function centeredImageGeometryAspectCropV1(width: number, height: number, preset: ImageGeometryAspectPresetV1,
	cropValue: unknown = null): Readonly<ImageGeometryCropV1> {
	imageGeometryDimensionV1(width); imageGeometryDimensionV1(height);
	const crop = cropValue === null ? FULL_CROP : readCrop(cropValue);
	const ratios = { source: width / height, '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16 };
	if (preset === 'free') return crop;
	if (!Object.hasOwn(ratios, preset)) throw new RangeError('Unsupported image crop aspect preset.');
	const ratio = ratios[preset], current = crop.width * width / (crop.height * height);
	const selectedWidth = current > ratio ? crop.height * height * ratio / width : crop.width;
	const selectedHeight = current < ratio ? crop.width * width / ratio / height : crop.height;
	return Object.freeze({ x: crop.x + (crop.width - selectedWidth) / 2, y: crop.y + (crop.height - selectedHeight) / 2,
		width: selectedWidth, height: selectedHeight });
}

export function imageGeometryDimensionV1(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > PIXEL_FRAME_HARD_LIMITS_V1.maximumSidePixels) {
		throw new RangeError('Image geometry dimension must be a positive bounded integer.');
	}
}

function readCrop(value: unknown): Readonly<ImageGeometryCropV1> {
	const input = record(value, 'image crop', ['x', 'y', 'width', 'height']);
	const x = finite(field(input, 'x', 'image crop'), 0, 1, 'crop x'), y = finite(field(input, 'y', 'image crop'), 0, 1, 'crop y');
	const width = finite(field(input, 'width', 'image crop'), Number.MIN_VALUE, 1, 'crop width');
	const height = finite(field(input, 'height', 'image crop'), Number.MIN_VALUE, 1, 'crop height');
	if (x + width > 1 || y + height > 1 || x + width === x || y + height === y) throw new RangeError('Image crop must have a nonempty aperture inside its source.');
	return Object.freeze({ x, y, width, height });
}

function readPerspective(value: unknown): Readonly<ImageGeometryPerspectiveV1> {
	const input = record(value, 'image perspective', ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);
	const point = (key: string) => {
		const inputPoint = record(field(input, key, 'image perspective'), 'perspective point', ['x', 'y']);
		return Object.freeze({ x: finite(field(inputPoint, 'x', 'perspective point'), 0, 1, 'perspective x'),
			y: finite(field(inputPoint, 'y', 'perspective point'), 0, 1, 'perspective y') });
	};
	const topLeft = point('topLeft'), topRight = point('topRight'), bottomRight = point('bottomRight'), bottomLeft = point('bottomLeft');
	const points = [topLeft, topRight, bottomRight, bottomLeft];
	for (let index = 0; index < 4; index++) {
		const a = points[index]!, b = points[(index + 1) % 4]!, c = points[(index + 2) % 4]!;
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (cross <= IMAGE_GEOMETRY_MINIMUM_QUAD_CROSS_V1) throw new RangeError('Perspective requires a convex clockwise nonsingular source quad.');
	}
	return Object.freeze({ topLeft, topRight, bottomRight, bottomLeft });
}

function finite(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < minimum || value > maximum) {
		throw new RangeError(`Image geometry ${name} must be finite and within its canonical range.`);
	}
	return value;
}
function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new TypeError('Image geometry flip must be boolean.'); return value;
}
