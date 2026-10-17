/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertMotionAeNumericProperty } from '../src/common/editor/motion-ae-property-conversion.ts';
import type { MotionAeProperty } from '../src/common/editor/motion-ae-exchange-types.ts';
import { evaluateInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
const numeric: Extract<MotionAeProperty, { kind: 'numeric' }> = { kind: 'numeric', name: 'Opacity', matchName: 'ADBE Opacity', value: [100], spatial: false, keys: [], expression: null };
const key = (time: number, value: number) => ({ time, value: [value], inInterpolation: 'linear' as const, outInterpolation: 'linear' as const,
	inEase: [{ speed: 0, influence: 33.333 }], outEase: [{ speed: 0, influence: 33.333 }], inSpatialTangent: null, outSpatialTangent: null, roving: false });
test('AE numeric conversion preserves units and composition-frame timing for static, linear and hold values', () => {
	const result = convertMotionAeNumericProperty({ ...numeric, keys: [key(0, 100), key(1, 0)] }, { frameRate: { num: 24, den: 1 }, axes: [0], defaults: [1], scale: 0.01 });
	assert.equal(result.status, 'editable'); assert.equal(result.property?.kind, 'scalar');
	if (result.property?.kind !== 'scalar' || !result.property.curve) throw new Error('Expected scalar curve');
	assert.equal(evaluateInterpolationCurve(result.property.curve, 12), 0.5); assert.equal(result.property.value, 1);
	const hold = convertMotionAeNumericProperty({ ...numeric, keys: [{ ...key(0, 25), outInterpolation: 'hold' }, key(1, 75)] }, { frameRate: { num: 24, den: 1 }, axes: [0], defaults: [1], scale: 0.01 });
	if (hold.property?.kind !== 'scalar' || !hold.property.curve) throw new Error('Expected hold curve');
	assert.equal(evaluateInterpolationCurve(hold.property.curve, 12), 0.25);
});
test('AE curves needing temporal/spatial evaluation remain unsupported until separate samples are retained', () => {
	const curved = { ...numeric, keys: [{ ...key(0, 0), outInterpolation: 'bezier' as const }, key(1, 1)] };
	const options = { frameRate: { num: 24, den: 1 }, axes: [0], defaults: [0], scale: 1 };
	assert.equal(convertMotionAeNumericProperty(curved, options).status, 'unsupported');
	assert.equal(convertMotionAeNumericProperty({ ...numeric, expression: { source: 'arbitraryAECode()', enabled: true, disposition: 'translated' } }, options).status, 'unsupported');
	const sampled = convertMotionAeNumericProperty({ ...curved, samples: { frameRate: 24, firstFrame: 0, values: [[0], [3], [5]] } }, options);
	assert.equal(sampled.status, 'sampled'); if (sampled.property?.kind !== 'scalar' || !sampled.property.curve) throw new Error('Expected sampled curve');
	assert.deepEqual(sampled.property.curve.anchors.map((entry) => entry.position), [{ num: 0, den: 1 }, { num: 1, den: 1 }, { num: 2, den: 1 }]);
	assert.equal(sampled.property.expression, null); assert.equal(evaluateInterpolationCurve(sampled.property.curve, 1), 3);
});
test('AE vector mapping retains a constant third axis and reports bounded clock quantization', () => {
	const vector = { ...numeric, value: [10, 20], keys: [ { ...key(1 / 3, 10), value: [10, 20], inEase: [{ speed: 0, influence: 33 }, { speed: 0, influence: 33 }], outEase: [{ speed: 0, influence: 33 }, { speed: 0, influence: 33 }] } ] };
	const result = convertMotionAeNumericProperty(vector, { frameRate: { num: 30, den: 1 }, axes: [0, 1, null], defaults: [0, 0, 0], scale: 1 });
	assert.equal(result.property?.kind, 'vector3'); if (result.property?.kind !== 'vector3') throw new Error('Expected vector');
	assert.deepEqual(result.property.value, [10, 20, 0]); assert.equal(result.property.curves[2], null);
	assert.equal(convertMotionAeNumericProperty({ ...numeric, keys: [key(-1, 1)] }, { frameRate: { num: 24, den: 1 }, axes: [0], defaults: [0], scale: 1 }).status, 'unsupported');
	assert.equal(convertMotionAeNumericProperty({ ...numeric, keys: [key(0.123456789, 1)] }, { frameRate: { num: 24, den: 1 }, axes: [0], defaults: [0], scale: 1 }).quantizedClock, true);
});
