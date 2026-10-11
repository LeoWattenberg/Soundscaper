/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionMatrix4 } from './motion-transform.ts';
import type { MotionVector3 } from './motion-property.ts';

/** Inversion is admitted before any pixel work; nearly singular planes/camera rigs need an authored correction. */
export function inverseMotionAffineMatrix(matrix: MotionMatrix4): MotionMatrix4 {
	if (matrix.some((value) => !Number.isFinite(value)) || matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) throw new RangeError('Motion 3D matrix must be finite and affine.');
	const [a, d, g, , b, e, h, , c, f, i] = matrix;
	const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	const norm = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), Math.abs(e), Math.abs(f), Math.abs(g), Math.abs(h), Math.abs(i));
	if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12 * norm ** 3) throw new RangeError('Motion 3D matrix is singular or poorly conditioned; use nonsingular camera/plane scales.');
	const inverse: MotionMatrix4 = [(e * i - f * h) / determinant, (f * g - d * i) / determinant, (d * h - e * g) / determinant, 0,
		(c * h - b * i) / determinant, (a * i - c * g) / determinant, (b * g - a * h) / determinant, 0,
		(b * f - c * e) / determinant, (c * d - a * f) / determinant, (a * e - b * d) / determinant, 0, 0, 0, 0, 1];
	const [x, y, z] = transformMotionDirection(inverse, [matrix[12], matrix[13], matrix[14]]);
	const result: MotionMatrix4 = [...inverse.slice(0, 12), -x, -y, -z, 1] as unknown as MotionMatrix4;
	if (result.some((value) => !Number.isFinite(value))) throw new RangeError('Motion 3D inverse exceeds its finite range.');
	return Object.freeze(result);
}
export function transformMotionPoint(matrix: MotionMatrix4, point: MotionVector3): MotionVector3 {
	const [x, y, z] = transformMotionDirection(matrix, point);
	return [x + matrix[12], y + matrix[13], z + matrix[14]];
}
export function transformMotionDirection(matrix: MotionMatrix4, [x, y, z]: MotionVector3): MotionVector3 {
	return [matrix[0] * x + matrix[4] * y + matrix[8] * z, matrix[1] * x + matrix[5] * y + matrix[9] * z, matrix[2] * x + matrix[6] * y + matrix[10] * z];
}
