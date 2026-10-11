/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionVector2 } from './motion-property.ts';
import { freezeMotionValue, motionArray, motionInteger, motionNumber } from './motion-values.ts';
export type MotionTrackingQuad = readonly [MotionVector2, MotionVector2, MotionVector2, MotionVector2];
/** Row-major projective matrix, acting on [x,y,1]; normalized to h[8] = 1. */
export type MotionTrackingHomography = readonly [number, number, number, number, number, number, number, number, number];
export interface MotionTrackingMatch { readonly source: MotionVector2; readonly target: MotionVector2; readonly confidence: number }
export interface MotionTrackingPlanarEstimate { readonly matrix: MotionTrackingHomography; readonly inlierCount: number; readonly meanError: number }

export function motionTrackingPoint(value: unknown): MotionVector2 {
	const point = motionArray(value, 2, 'tracking point', 2);
	return Object.freeze([motionNumber(point[0], 'tracking x', -1e6, 1e6), motionNumber(point[1], 'tracking y', -1e6, 1e6)]);
}
export function motionTrackingQuad(value: unknown): MotionTrackingQuad {
	const points = motionArray(value, 4, 'tracking quadrilateral', 4).map(motionTrackingPoint) as unknown as MotionTrackingQuad;
	let sign = 0;
	for (let index = 0; index < 4; index++) {
		const a = points[index]!; const b = points[(index + 1) % 4]!; const c = points[(index + 2) % 4]!;
		const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
		if (Math.abs(cross) < 1e-8 || (sign && sign !== Math.sign(cross))) throw new RangeError('Tracking quadrilateral must be convex and nondegenerate; reorder or move its corners.');
		sign = Math.sign(cross);
	}
	return freezeMotionValue(points);
}
export function mapMotionTrackingPoint(matrix: MotionTrackingHomography, value: MotionVector2): MotionVector2 {
	const point = motionTrackingPoint(value);
	if (matrix.length !== 9 || !matrix.every(Number.isFinite)) throw new RangeError('Tracking homography must contain nine finite coefficients.');
	const denominator = matrix[6] * point[0] + matrix[7] * point[1] + matrix[8];
	if (Math.abs(denominator) <= 1e-12 * Math.max(1, Math.abs(matrix[6] * point[0]), Math.abs(matrix[7] * point[1]), Math.abs(matrix[8]))) throw new RangeError('Tracking projection reaches a projective horizon; move the corners.');
	return motionTrackingPoint([(matrix[0] * point[0] + matrix[1] * point[1] + matrix[2]) / denominator,
		(matrix[3] * point[0] + matrix[4] * point[1] + matrix[5]) / denominator]);
}
export function motionTrackingHomography(source: MotionTrackingQuad, target: MotionTrackingQuad): MotionTrackingHomography {
	const from = motionTrackingQuad(source); const to = motionTrackingQuad(target);
	const matrix = fit(from.map((point, index) => ({ source: point, target: to[index]!, confidence: 1 })));
	const denominators = from.map(([x, y]) => matrix[6] * x + matrix[7] * y + matrix[8]);
	if (denominators.some(value => Math.abs(value) < 1e-10 || Math.sign(value) !== Math.sign(denominators[0]!))) throw new RangeError('Tracking quadrilateral crosses a projective horizon; move the corners.');
	return matrix;
}
/** Finite deterministic consensus, followed by a normalized weighted least-squares fit. */
export function estimateMotionTrackingHomography(values: readonly MotionTrackingMatch[], options: {
	readonly inlierThreshold: number; readonly minimumInliers: number; readonly maximumHypotheses?: number;
}): MotionTrackingPlanarEstimate {
	const matches = motionArray(values, 128, 'planar tracking matches', 4).map(value => {
		const match = value as MotionTrackingMatch;
		return { source: motionTrackingPoint(match.source), target: motionTrackingPoint(match.target), confidence: motionNumber(match.confidence, 'tracking confidence', Number.EPSILON, 1) };
	});
	const threshold = motionNumber(options.inlierThreshold, 'tracking inlier threshold', 0.001, 1024);
	const minimum = motionInteger(options.minimumInliers, 'tracking minimum inliers', 4, matches.length);
	const limit = motionInteger(options.maximumHypotheses ?? 256, 'tracking hypotheses', 1, 256);
	const total = choose(matches.length, 4); const count = Math.min(total, limit);
	let best: { readonly indices: readonly number[]; readonly error: number } | null = null;
	for (let index = 0; index < count; index++) {
		const ordinal = total === count ? index : Math.floor((index + 0.5) * total / count);
		const selected = combination(matches.length, ordinal).map(position => matches[position]!);
		let matrix: MotionTrackingHomography;
		try { matrix = fit(selected); } catch { continue; }
		const consensus = classify(matches, matrix, threshold);
		if (!best || consensus.indices.length > best.indices.length || (consensus.indices.length === best.indices.length && consensus.error < best.error)) best = consensus;
	}
	if (!best || best.indices.length < minimum) throw new RangeError('Planar tracking has insufficient consensus; choose a textured plane or correct its corners manually.');
	const matrix = fit(best.indices.map(index => matches[index]!)); const final = classify(matches, matrix, threshold);
	if (final.indices.length < minimum) throw new RangeError('Refined planar tracking lost its inlier consensus; correct the plane manually.');
	return freezeMotionValue({ matrix, inlierCount: final.indices.length, meanError: final.error / final.indices.length });
}
function classify(matches: readonly MotionTrackingMatch[], matrix: MotionTrackingHomography, threshold: number) {
	const indices: number[] = []; let error = 0;
	matches.forEach((match, index) => {
		let point: MotionVector2; try { point = mapMotionTrackingPoint(matrix, match.source); } catch { return; }
		const distance = Math.hypot(point[0] - match.target[0], point[1] - match.target[1]);
		if (distance <= threshold) { indices.push(index); error += distance; }
	});
	return { indices, error };
}
function fit(matches: readonly MotionTrackingMatch[]): MotionTrackingHomography {
	const source = coordinates(matches.map(match => match.source)); const target = coordinates(matches.map(match => match.target));
	const normal = Array.from({ length: 8 }, () => Array<number>(9).fill(0));
	const row = (coefficients: readonly number[], value: number, weight: number) => {
		for (let i = 0; i < 8; i++) { for (let j = 0; j < 8; j++) normal[i]![j]! += coefficients[i]! * coefficients[j]! * weight; normal[i]![8]! += coefficients[i]! * value * weight; }
	};
	matches.forEach((match, index) => {
		const [x, y] = source.points[index]!; const [u, v] = target.points[index]!;
		row([x, y, 1, 0, 0, 0, -u * x, -u * y], u, match.confidence);
		row([0, 0, 0, x, y, 1, -v * x, -v * y], v, match.confidence);
	});
	const maximum = Math.max(...normal.flat().map(Math.abs));
	for (let column = 0; column < 8; column++) {
		let pivot = column; for (let row = column + 1; row < 8; row++) if (Math.abs(normal[row]![column]!) > Math.abs(normal[pivot]![column]!)) pivot = row;
		if (Math.abs(normal[pivot]![column]!) <= maximum * 1e-12) throw new RangeError('Tracking homography is degenerate; use spatially separated features.');
		[normal[pivot], normal[column]] = [normal[column]!, normal[pivot]!];
		const scale = normal[column]![column]!; for (let index = column; index <= 8; index++) normal[column]![index]! /= scale;
		for (let row = 0; row < 8; row++) if (row !== column) { const factor = normal[row]![column]!; for (let index = column; index <= 8; index++) normal[row]![index]! -= factor * normal[column]![index]!; }
	}
	const local = [...normal.map(row => row[8]!), 1];
	const result = multiply(target.inverse, multiply(local, source.matrix));
	if (Math.abs(result[8]!) < 1e-14) throw new RangeError('Tracking homography has an unstable projective horizon.');
	return Object.freeze(result.map(value => { const normalized = value / result[8]!; if (!Number.isFinite(normalized)) throw new RangeError('Tracking homography is nonfinite.'); return Object.is(normalized, -0) ? 0 : normalized; })) as unknown as MotionTrackingHomography;
}
function coordinates(points: readonly MotionVector2[]) {
	const x = points.reduce((sum, point) => sum + point[0], 0) / points.length; const y = points.reduce((sum, point) => sum + point[1], 0) / points.length;
	const distance = Math.sqrt(points.reduce((sum, point) => sum + (point[0] - x) ** 2 + (point[1] - y) ** 2, 0) / points.length);
	if (distance < 1e-8) throw new RangeError('Tracking points are degenerate.'); const scale = Math.SQRT2 / distance;
	return { points: points.map(point => [(point[0] - x) * scale, (point[1] - y) * scale] as const),
		matrix: [scale, 0, -x * scale, 0, scale, -y * scale, 0, 0, 1], inverse: [1 / scale, 0, x, 0, 1 / scale, y, 0, 0, 1] };
}
function multiply(left: readonly number[], right: readonly number[]): number[] {
	return Array.from({ length: 9 }, (_, index) => { const row = Math.floor(index / 3); const column = index % 3; return left[row * 3]! * right[column]! + left[row * 3 + 1]! * right[column + 3]! + left[row * 3 + 2]! * right[column + 6]!; });
}
function choose(count: number, selected: number): number { let result = 1; for (let index = 0; index < selected; index++) result = result * (count - index) / (index + 1); return Math.round(result); }
function combination(count: number, ordinal: number): readonly number[] {
	const result: number[] = []; let first = 0;
	for (let remaining = 4; remaining > 0; remaining--) {
		for (let index = first; index <= count - remaining; index++) { const size = choose(count - index - 1, remaining - 1); if (ordinal < size) { result.push(index); first = index + 1; break; } ordinal -= size; }
	}
	return result;
}
