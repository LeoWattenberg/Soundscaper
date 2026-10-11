/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMotionCurveMetrics, evaluateMotionCurveSlope } from '../src/common/editor/motion-curve-metrics.ts';
const r = (num: number, den = 1) => ({ num, den });
const anchors = [{ position: r(0), value: 0 }, { position: r(30), value: 100 }];

test('M06 curve metrics share playback values and analytic value-per-frame derivatives', () => {
	const metrics = compileMotionCurveMetrics({ anchors, segments: [{ kind: 'bezier', control1: { position: r(10), value: 0 }, control2: { position: r(20), value: 0 } }] });
	assert.ok(Math.abs(metrics.valueAt(r(15)) - 12.5) < 1e-10); assert.ok(Math.abs(metrics.slopeAt(r(15))! - 2.5) < 1e-10);
	assert.equal(metrics.slopeAt(r(0)), 0); assert.equal(metrics.slopeAt(r(30)), 10); assert.equal(metrics.slopeAt(r(31)), 0);
	assert.equal(evaluateMotionCurveSlope({ anchors, segments: [{ kind: 'linear' }] }, r(15)), 100 / 30);
	assert.equal(evaluateMotionCurveSlope({ anchors, segments: [{ kind: 'eased' }] }, r(15)), 5);
});

test('M06 derivatives follow nonlinear Bezier time and report vertical tangents or hold jumps explicitly', () => {
	const curve = { anchors, segments: [{ kind: 'bezier' as const, control1: { position: r(0), value: 80 }, control2: { position: r(25), value: 90 } }] };
	const metrics = compileMotionCurveMetrics(curve); assert.equal(metrics.slopeAt(r(0)), null);
	const numeric = (metrics.valueAt(r(100001, 10000)) - metrics.valueAt(r(99999, 10000))) / 0.0002;
	assert.ok(Math.abs(metrics.slopeAt(r(10))! - numeric) < 1e-6);
	const held = compileMotionCurveMetrics({ anchors, segments: [{ kind: 'hold' }] }); assert.equal(held.slopeAt(r(15)), 0); assert.equal(held.slopeAt(r(30)), null);
	const stationaryTime = compileMotionCurveMetrics({ anchors, segments: [{ kind: 'bezier', control1: { position: r(0), value: 0 }, control2: { position: r(0), value: 0 } }] });
	assert.equal(stationaryTime.slopeAt(r(0)), 100 / 30);
});

test('M06 metric compilation supports first-key constants without admitting malformed curve geometry', () => {
	const metrics = compileMotionCurveMetrics({ anchors: [{ position: r(8), value: 7 }], segments: [] });
	assert.equal(metrics.valueAt(r(0)), 7); assert.equal(metrics.slopeAt(r(8)), 0); assert.equal(compileMotionCurveMetrics(null, 9).valueAt(r(4)), 9);
	assert.throws(() => compileMotionCurveMetrics({ anchors, segments: [{ kind: 'bezier', control1: { position: r(20), value: 0 }, control2: { position: r(10), value: 1 } }] }), /control positions/iu);
});
