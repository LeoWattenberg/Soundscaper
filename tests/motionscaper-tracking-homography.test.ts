/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionTrackingHomography, mapMotionTrackingPoint, estimateMotionTrackingHomography, type MotionTrackingQuad } from '../src/common/editor/motion-tracking-homography.ts';
const quad: MotionTrackingQuad = [[0, 0], [100, 0], [100, 80], [0, 80]];
const target: MotionTrackingQuad = [[13, 17], [121, 9], [107, 99], [20, 91]];
function near(observed: readonly number[], expected: readonly number[], epsilon = 1e-7) { observed.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < epsilon, `${value} != ${expected[index]}`)); }
test('Motion corner-pin homography maps all four corners and its inverse exactly', () => {
	const matrix = motionTrackingHomography(quad, target); const inverse = motionTrackingHomography(target, quad);
	quad.forEach((point, index) => near(mapMotionTrackingPoint(matrix, point), target[index]!));
	for (const point of [[0, 0], [23.5, 61.1], [50, 40], [100, 80]] as const) near(mapMotionTrackingPoint(inverse, mapMotionTrackingPoint(matrix, point)), point);
	assert.equal(matrix[8], 1); assert.equal(Object.isFrozen(matrix), true);
});
test('Motion homography normalizes large translated coordinates and refuses degenerate or crossed planes', () => {
	const shifted = quad.map(([x, y]) => [x + 100000, y - 200000] as const) as unknown as MotionTrackingQuad;
	const shiftedTarget = target.map(([x, y]) => [x - 100000, y + 200000] as const) as unknown as MotionTrackingQuad;
	const matrix = motionTrackingHomography(shifted, shiftedTarget);
	shifted.forEach((point, index) => near(mapMotionTrackingPoint(matrix, point), shiftedTarget[index]!, 0.001));
	assert.throws(() => motionTrackingHomography([[0, 0], [1, 0], [2, 0], [3, 0]], target), /degenerate|convex/iu);
	assert.throws(() => motionTrackingHomography(quad, [target[0], target[2], target[1], target[3]]), /convex/iu);
	assert.throws(() => mapMotionTrackingPoint([1, 0, 0, 0, 1, 0, 1, 0, -50], [50, 1]), /horizon/iu);
});
test('Motion planar estimation rejects outliers deterministically within a finite hypothesis budget', () => {
	const matrix = motionTrackingHomography(quad, target);
	const matches = Array.from({ length: 24 }, (_, index) => {
		const source = [8 + (index % 6) * 16, 8 + Math.floor(index / 6) * 18] as const;
		return { source, target: index % 5 === 0 ? [300 + index, -100] as const : mapMotionTrackingPoint(matrix, source), confidence: 1 };
	});
	const options = { inlierThreshold: 0.1, minimumInliers: 18, maximumHypotheses: 128 };
	const result = estimateMotionTrackingHomography(matches, options);
	assert.equal(result.inlierCount, 19); assert.ok(result.meanError < 1e-8);
	assert.deepEqual(estimateMotionTrackingHomography(matches, options), result);
	quad.forEach(point => near(mapMotionTrackingPoint(result.matrix, point), mapMotionTrackingPoint(matrix, point)));
	assert.throws(() => estimateMotionTrackingHomography(matches, { ...options, minimumInliers: 24 }), /consensus/iu);
	assert.throws(() => estimateMotionTrackingHomography(matches, { ...options, maximumHypotheses: 100000 }), /hypotheses/iu);
});
