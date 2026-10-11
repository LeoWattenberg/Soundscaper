/* SPDX-License-Identifier: AGPL-3.0-only */

import { motionPropertyOfKind, type MotionPathVertex, type MotionPathProperty, type MotionVector2 } from './motion-property.ts';
import { motionInteger, motionNumber } from './motion-values.ts';

const KAPPA = 0.5522847498307936;
const vertex = (point: MotionVector2, inTangent: MotionVector2 = [0, 0], outTangent: MotionVector2 = [0, 0]): MotionPathVertex => ({ point, inTangent, outTangent });
const path = (vertices: readonly MotionPathVertex[]): MotionPathProperty => motionPropertyOfKind({ kind: 'path', value: { closed: true, vertices }, keyframes: [], segments: [], expression: null }, 'path');
const positive = (value: number, name: string): number => motionNumber(value, name, Number.EPSILON, 32768);

/** Primitive creation stores ordinary editable paths; no renderer-specific geometry is persisted. */
export function motionRectanglePath(input: Readonly<{ x: number; y: number; width: number; height: number; radius?: number }>): MotionPathProperty {
	const x = motionNumber(input.x, 'rectangle x'); const y = motionNumber(input.y, 'rectangle y');
	const width = positive(input.width, 'rectangle width'); const height = positive(input.height, 'rectangle height');
	const radius = Math.min(motionNumber(input.radius ?? 0, 'rectangle radius', 0, 32768), width / 2, height / 2);
	if (radius === 0) return path([vertex([x, y]), vertex([x + width, y]), vertex([x + width, y + height]), vertex([x, y + height])]);
	const r = radius; const k = r * KAPPA;
	return path([vertex([x + r, y], [-k, 0]), vertex([x + width - r, y], [0, 0], [k, 0]),
		vertex([x + width, y + r], [0, -k]), vertex([x + width, y + height - r], [0, 0], [0, k]),
		vertex([x + width - r, y + height], [k, 0]), vertex([x + r, y + height], [0, 0], [-k, 0]),
		vertex([x, y + height - r], [0, k]), vertex([x, y + r], [0, 0], [0, -k])]);
}
export function motionEllipsePath(input: Readonly<{ center: MotionVector2; radius: MotionVector2 }>): MotionPathProperty {
	const [x, y] = input.center; const rx = positive(input.radius[0], 'ellipse radius'); const ry = positive(input.radius[1], 'ellipse radius');
	return path([vertex([x + rx, y], [0, -ry * KAPPA], [0, ry * KAPPA]), vertex([x, y + ry], [rx * KAPPA, 0], [-rx * KAPPA, 0]),
		vertex([x - rx, y], [0, ry * KAPPA], [0, -ry * KAPPA]), vertex([x, y - ry], [-rx * KAPPA, 0], [rx * KAPPA, 0])]);
}
export function motionPolygonPath(input: Readonly<{ center: MotionVector2; radius: number; points: number; rotationDegrees?: number; innerRadius?: number }>): MotionPathProperty {
	const points = motionInteger(input.points, 'polygon points', 3, 1024); const radius = positive(input.radius, 'polygon radius');
	const inner = input.innerRadius === undefined ? null : positive(input.innerRadius, 'star inner radius');
	const rotation = motionNumber(input.rotationDegrees ?? -90, 'polygon rotation') * Math.PI / 180; const count = points * (inner === null ? 1 : 2);
	return path(Array.from({ length: count }, (_, index) => {
		const angle = rotation + index * Math.PI * 2 / count; const r = inner !== null && index % 2 !== 0 ? inner : radius;
		return vertex([input.center[0] + Math.cos(angle) * r, input.center[1] + Math.sin(angle) * r]);
	}));
}
