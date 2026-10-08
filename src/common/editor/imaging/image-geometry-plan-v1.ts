/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageGeometryV1, imageGeometryDimensionV1, type ImageGeometryCropV1,
	type ImageGeometryPointV1, type ImageGeometryPerspectiveV1 } from './image-geometry-v1.ts';

type Matrix = readonly [number, number, number, number, number, number, number, number, number];
type Affine = readonly [number, number, number, number, number, number];
export interface ImageGeometryPlanV1 {
	readonly width: number;
	readonly height: number;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly crop: Readonly<ImageGeometryCropV1>;
	/** Row-major 2x3 inverse, from output pixel centers to unit cropped aperture. */
	readonly outputToAperture: Affine;
	/** Row-major homography, from unit aperture to original source pixel coordinates. */
	readonly apertureToSource: Matrix;
}

/** Source crop, quad rectification, clockwise rotation, then flips in output axes. */
export function planImageGeometryV1(value: unknown, sourceWidth: number, sourceHeight: number): Readonly<ImageGeometryPlanV1> {
	const geometry = normalizeImageGeometryV1(value); imageGeometryDimensionV1(sourceWidth); imageGeometryDimensionV1(sourceHeight);
	const crop = geometry.crop ?? Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
	const cropWidth = crop.width * sourceWidth, cropHeight = crop.height * sourceHeight;
	const { cosine, sine } = rotation(geometry.rotationDegrees);
	const width = Math.max(1, Math.ceil(Math.abs(cosine) * cropWidth + Math.abs(sine) * cropHeight));
	const height = Math.max(1, Math.ceil(Math.abs(sine) * cropWidth + Math.abs(cosine) * cropHeight));
	imageGeometryDimensionV1(width); imageGeometryDimensionV1(height);
	const fx = geometry.flipHorizontal ? -1 : 1, fy = geometry.flipVertical ? -1 : 1;
	const a = cosine * fx / cropWidth, b = sine * fy / cropWidth, d = -sine * fx / cropHeight, e = cosine * fy / cropHeight;
	const outputToAperture: Affine = Object.freeze([a, b, 0.5 - a * width / 2 - b * height / 2,
		d, e, 0.5 - d * width / 2 - e * height / 2].map(canonical) as unknown as Affine);
	const unit = homography(geometry.perspective), x = crop.x * sourceWidth, y = crop.y * sourceHeight;
	const apertureToSource: Matrix = Object.freeze([
		cropWidth * unit[0] + x * unit[6], cropWidth * unit[1] + x * unit[7], cropWidth * unit[2] + x,
		cropHeight * unit[3] + y * unit[6], cropHeight * unit[4] + y * unit[7], cropHeight * unit[5] + y,
		unit[6], unit[7], 1,
	].map(canonical) as unknown as Matrix);
	if (![...outputToAperture, ...apertureToSource].every(Number.isFinite)) throw new RangeError('Image geometry has a singular mapping.');
	return Object.freeze({ width, height, sourceWidth, sourceHeight, crop, outputToAperture, apertureToSource });
}

/** Fixed Frame delivery contains the natural aperture centrally, with transparent bars and no aspect stretch. */
export function containImageGeometryPlanV1(plan: ImageGeometryPlanV1, width: number, height: number): Readonly<ImageGeometryPlanV1> {
	imageGeometryDimensionV1(width); imageGeometryDimensionV1(height);
	const scale = Math.min(width / plan.width, height / plan.height);
	const x = (width - plan.width * scale) / 2, y = (height - plan.height * scale) / 2, a = plan.outputToAperture;
	const outputToAperture: Affine = Object.freeze([a[0] / scale, a[1] / scale, a[2] - (a[0] * x + a[1] * y) / scale,
		a[3] / scale, a[4] / scale, a[5] - (a[3] * x + a[4] * y) / scale].map(canonical) as unknown as Affine);
	return Object.freeze({ ...plan, width, height, outputToAperture });
}

/** UI point mapping; renderers reuse one writable scalar point through the sibling function. */
export function mapImageGeometryPointV1(plan: ImageGeometryPlanV1, x: number, y: number): Readonly<ImageGeometryPointV1> | null {
	const point = { x: 0, y: 0 }; return writeImageGeometryPointV1(plan, x, y, point) ? Object.freeze(point) : null;
}

/** No per-pixel arrays, matrices or point allocations. Outside rotated aperture is transparent. */
export function writeImageGeometryPointV1(plan: ImageGeometryPlanV1, x: number, y: number, point: { x: number; y: number }): boolean {
	const a = plan.outputToAperture, m = plan.apertureToSource;
	let u = a[0] * x + a[1] * y + a[2], v = a[3] * x + a[4] * y + a[5];
	if (!Number.isFinite(u) || !Number.isFinite(v) || u < -1e-12 || v < -1e-12 || u > 1 + 1e-12 || v > 1 + 1e-12) return false;
	u = Math.max(0, Math.min(1, u)); v = Math.max(0, Math.min(1, v));
	const denominator = m[6] * u + m[7] * v + m[8];
	point.x = (m[0] * u + m[1] * v + m[2]) / denominator;
	point.y = (m[3] * u + m[4] * v + m[5]) / denominator;
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function homography(quad: ImageGeometryPerspectiveV1 | null): Matrix {
	if (!quad) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
	const p = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft] as const;
	const dx1 = p[1].x - p[2].x, dx2 = p[3].x - p[2].x, dx3 = p[0].x - p[1].x + p[2].x - p[3].x;
	const dy1 = p[1].y - p[2].y, dy2 = p[3].y - p[2].y, dy3 = p[0].y - p[1].y + p[2].y - p[3].y;
	let g = 0, h = 0;
	if (dx3 !== 0 || dy3 !== 0) {
		const determinant = dx1 * dy2 - dx2 * dy1;
		if (Math.abs(determinant) <= 1e-10) throw new RangeError('Perspective has a near-singular homography.');
		g = (dx3 * dy2 - dx2 * dy3) / determinant; h = (dx1 * dy3 - dx3 * dy1) / determinant;
	}
	const denominators = [1, 1 + g, 1 + h, 1 + g + h];
	if (denominators.some(value => !Number.isFinite(value) || value <= 1e-10)) throw new RangeError('Perspective crosses a singular projective plane.');
	return [p[1].x - p[0].x + g * p[1].x, p[3].x - p[0].x + h * p[3].x, p[0].x,
		p[1].y - p[0].y + g * p[1].y, p[3].y - p[0].y + h * p[3].y, p[0].y, g, h, 1];
}

function rotation(degrees: number): { cosine: number; sine: number } {
	const turn = ((degrees % 360) + 360) % 360;
	if (turn === 0) return { cosine: 1, sine: 0 };
	if (turn === 90) return { cosine: 0, sine: 1 };
	if (turn === 180) return { cosine: -1, sine: 0 };
	if (turn === 270) return { cosine: 0, sine: -1 };
	return { cosine: Math.cos(turn * Math.PI / 180), sine: Math.sin(turn * Math.PI / 180) };
}
function canonical(value: number): number { return Object.is(value, -0) ? 0 : value; }
