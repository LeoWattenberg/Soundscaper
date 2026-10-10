/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionTransform } from './motion-composition.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';

/** Column-major matrices; degrees are authored in XYZ order, followed by translation. */
export type MotionMatrix4 = readonly [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
export const MOTION_IDENTITY_MATRIX: MotionMatrix4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function multiplyMotionMatrices(left: MotionMatrix4, right: MotionMatrix4): MotionMatrix4 {
	const result = new Array<number>(16).fill(0);
	for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) {
		for (let index = 0; index < 4; index += 1) result[column * 4 + row]! += left[index * 4 + row]! * right[column * 4 + index]!;
	}
	if (result.some((value) => !Number.isFinite(value))) throw new RangeError('Motion transform exceeds its finite range.');
	return Object.freeze(result) as unknown as MotionMatrix4;
}

export function motionTransformMatrix(transform: EvaluatedMotionState<MotionTransform>): MotionMatrix4 {
	const [x, y, z] = transform.rotation.map((value) => value * Math.PI / 180);
	const [sx, sy, sz] = transform.scale;
	const cx = Math.cos(x!), cy = Math.cos(y!), cz = Math.cos(z!);
	const rx = Math.sin(x!), ry = Math.sin(y!), rz = Math.sin(z!);
	const matrix: MotionMatrix4 = [
		cz * cy * sx, rz * cy * sx, -ry * sx, 0,
		(cz * ry * rx - rz * cx) * sy, (rz * ry * rx + cz * cx) * sy, cy * rx * sy, 0,
		(cz * ry * cx + rz * rx) * sz, (rz * ry * cx - cz * rx) * sz, cy * cx * sz, 0,
		...transform.position, 1,
	];
	const [ax, ay, az] = transform.anchor;
	return multiplyMotionMatrices(matrix, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -ax, -ay, -az, 1]);
}
