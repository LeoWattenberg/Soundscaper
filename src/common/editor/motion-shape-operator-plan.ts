/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionShapeOperator } from './motion-authoring-operators.ts';
import type { MotionLayer } from './motion-composition.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import { motionSurfaceLength } from './motion-surface.ts';
import type { MotionLocalSourceBounds } from './motion-local-raster.ts';

export type MotionEvaluatedShapeOperator = EvaluatedMotionState<MotionShapeOperator>;
export type MotionShapeMatrix = readonly [number, number, number, number, number, number];
type Bounds = readonly [number, number, number, number];
export const MOTION_SHAPE_IDENTITY: MotionShapeMatrix = [1, 0, 0, 1, 0, 0];
export function multiplyMotionShapeMatrices(l: MotionShapeMatrix, r: MotionShapeMatrix): MotionShapeMatrix {
	return [l[0] * r[0] + l[2] * r[1], l[1] * r[0] + l[3] * r[1], l[0] * r[2] + l[2] * r[3], l[1] * r[2] + l[3] * r[3], l[0] * r[4] + l[2] * r[5] + l[4], l[1] * r[4] + l[3] * r[5] + l[5]];
}
export function inverseMotionShapeMatrix(m: MotionShapeMatrix): MotionShapeMatrix {
	const [a, b, c, d, x, y] = m; const det = a * d - b * c;
	if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new RangeError('Motion trim/boolean requires a nonsingular repeater scale.');
	const inverse: MotionShapeMatrix = [d / det, -b / det, -c / det, a / det, (c * y - d * x) / det, (b * x - a * y) / det];
	if (inverse.some((value) => !Number.isFinite(value))) throw new RangeError('Motion shape inverse exceeds its rendering range.');
	return inverse;
}
export function motionRepeaterMatrix(operator: Extract<MotionEvaluatedShapeOperator, { kind: 'repeater' }>, index: number): MotionShapeMatrix {
	const amount = index + operator.offset; const [ax, ay] = operator.transform.anchor;
	const angle = operator.transform.rotation * amount * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
	const sx = operator.transform.scale[0] ** amount; const sy = operator.transform.scale[1] ** amount;
	const a = c * sx; const b = s * sx; const k = -s * sy; const d = c * sy;
	const matrix: MotionShapeMatrix = [a, b, k, d, operator.transform.position[0] * amount + (1 - a) * ax - k * ay, operator.transform.position[1] * amount - b * ax + (1 - d) * ay];
	if (matrix.some((v) => !Number.isFinite(v))) throw new RangeError('Motion repeater scale has an undefined fractional or negative power; use positive scales or an integer offset.');
	return matrix;
}
export function assertMotionShapeOperator(operator: MotionEvaluatedShapeOperator): void {
	if (operator.kind === 'boolean') return;
	const scalars = operator.kind === 'trim-paths' ? [operator.start, operator.end] : [operator.startOpacity, operator.endOpacity];
	if (scalars.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) throw new RangeError(`Motion ${operator.kind} fractions must be in the unit range.`);
	if (!Number.isFinite(operator.offset) || Math.abs(operator.offset) > 32768) throw new RangeError('Motion shape operator offset exceeds its rendering range.');
	if (operator.kind === 'repeater') {
		if (!Number.isFinite(operator.copies) || operator.copies < 0 || operator.copies > 1024) throw new RangeError('Motion repeater copies exceed the 0–1024 rendering range.');
		if ([...operator.transform.anchor, ...operator.transform.position, ...operator.transform.scale, operator.transform.rotation].some((v) => !Number.isFinite(v) || Math.abs(v) > 32768)) throw new RangeError('Motion repeater transform exceeds its rendering range.');
	}
}

/** Trim and booleans cannot expand the control hull; repeaters transform its conservative stroke envelope. */
export function planMotionShapeOperators(state: EvaluatedMotionState<Extract<MotionLayer, { kind: 'shapes' }>>): Readonly<{ bounds: MotionLocalSourceBounds; workingBytes: number }> {
	if (state.shapes.length > 4096 || state.shapes.reduce((sum, shape) => sum + 1 + shape.path.vertices.length * 3, 0) > 1_000_000) throw new RangeError('Motion authored shape geometry exceeds its shape/point budget.');
	let entries = state.shapes.map((shape) => {
		const points = shape.path.vertices.flatMap((v) => [[...v.point], [v.point[0] + v.inTangent[0], v.point[1] + v.inTangent[1]], [v.point[0] + v.outTangent[0], v.point[1] + v.outTangent[1]]]);
		const padding = (shape.stroke?.width ?? 0) * 2;
		if (!Number.isFinite(padding) || padding < 0 || padding > 65536) throw new RangeError('Motion shape stroke exceeds the rendering range.');
		return { bounds: [Math.min(...points.map((p) => p[0]!)) - padding, Math.min(...points.map((p) => p[1]!)) - padding, Math.max(...points.map((p) => p[0]!)) + padding, Math.max(...points.map((p) => p[1]!)) + padding] as Bounds,
			points: points.length + 1, padding, matrix: MOTION_SHAPE_IDENTITY };
	});
	let peak = entries.reduce((sum, e) => sum + e.points, 0); let booleanScratch = 0; let hasBoolean = false;
	for (const operator of state.operators ?? []) {
		if (!operator.enabled) continue; assertMotionShapeOperator(operator);
		if (operator.kind === 'repeater') {
			const copies = Math.ceil(operator.copies);
			if (entries.length * copies > 4096) throw new RangeError('Motion generated shape count exceeds its 4096-shape budget.');
			entries = Array.from({ length: copies }, (_, index) => { const m = motionRepeaterMatrix(operator, index); return entries.map((entry) => ({ points: entry.points, padding: entry.padding * Math.hypot(m[0], m[1], m[2], m[3]), bounds: transformed(entry.bounds, m), matrix: multiplyMotionShapeMatrices(m, entry.matrix) })); }).flat();
		} else if (operator.kind === 'boolean' && entries.length > 1) {
			inverseMotionShapeMatrix(entries[0]!.matrix);
			if (!hasBoolean && entries.reduce((sum, e) => sum + e.points, 0) > 512) throw new RangeError('Motion boolean input exceeds its 512-point intersection budget; simplify the shapes.');
			const padding = Math.max(...entries.map((e) => e.padding)); const box = union(entries.map((e) => e.bounds));
			entries = [{ bounds: [box[0] - padding, box[1] - padding, box[2] + padding, box[3] + padding], points: 32768, padding, matrix: entries[0]!.matrix }]; booleanScratch = 512 * 512 * 64; hasBoolean = true;
		} else if (operator.kind === 'trim-paths') {
			for (const entry of entries) inverseMotionShapeMatrix(entry.matrix);
			if (Math.abs(operator.end - operator.start) !== 1) entries = entries.map((entry) => ({ ...entry, points: entry.points * 2 + 6 }));
		}
		const points = entries.reduce((sum, e) => sum + e.points, 0); peak = Math.max(peak, points);
		if (points > 1_000_000) throw new RangeError('Motion generated shape geometry exceeds its point budget.');
	}
	if (!entries.length) return { bounds: { width: 1, height: 1, origin: [0, 0], empty: true }, workingBytes: peak * 256 + booleanScratch };
	const [left, top, right, bottom] = union(entries.map((e) => e.bounds)); const x = Math.floor(left); const y = Math.floor(top);
	const width = Math.max(1, Math.ceil(right) - x); const height = Math.max(1, Math.ceil(bottom) - y); motionSurfaceLength(width, height);
	const opacityLayer = state.operators?.some((operator) => operator.enabled && operator.kind === 'repeater') ? width * height * 16 : 0;
	return { bounds: { width, height, origin: [x, y], empty: false }, workingBytes: peak * 256 + booleanScratch + opacityLayer };
}
function union(entries: readonly Bounds[]): Bounds { return [Math.min(...entries.map((b) => b[0])), Math.min(...entries.map((b) => b[1])), Math.max(...entries.map((b) => b[2])), Math.max(...entries.map((b) => b[3]))]; }
function transformed(b: Bounds, m: MotionShapeMatrix): Bounds {
	return union([[b[0], b[1]], [b[0], b[3]], [b[2], b[1]], [b[2], b[3]]].map(([x, y]) => { const px = m[0] * x! + m[2] * y! + m[4]; const py = m[1] * x! + m[3] * y! + m[5]; return [px, py, px, py] as Bounds; }));
}
