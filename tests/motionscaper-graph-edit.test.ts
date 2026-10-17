/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionPropertyOfKind } from '../src/common/editor/motion-property.ts';
import { compileMotionCurveMetrics } from '../src/common/editor/motion-curve-metrics.ts';
import { moveMotionGraphKey, moveMotionGraphHandle } from '../src/common/editor/ui/motionscaper/motion-graph-edit.ts';
const frame = (num: number) => ({ num, den: 1 });
const property = () => motionPropertyOfKind({ kind: 'vector2', value: [4, 9], expression: null, curves: [
	{ anchors: [{ position: frame(0), value: 0 }, { position: frame(30), value: 300 }], segments: [{ kind: 'bezier', control1: { position: frame(10), value: 100 }, control2: { position: frame(20), value: 200 } }] },
	{ anchors: [{ position: frame(5), value: 50 }], segments: [] },
] }, 'vector2');
test('graph moves time and value atomically while retaining other channels and handle authority', () => {
	const before = property(); const moved = moveMotionGraphKey(before, 0, frame(30), frame(45), 400);
	assert.equal(moved.kind, 'vector2'); if (moved.kind !== 'vector2') throw new Error('Wrong property kind.');
	assert.deepEqual(moved.curves[0]!.anchors[1], { position: frame(45), value: 400 });
	assert.deepEqual(moved.curves[1], before.curves[1]); assert.deepEqual(moved.value, before.value);
	assert.throws(() => moveMotionGraphKey(before, 0, frame(30), frame(0), 400), /duplicate|same|overlap|colli/iu);
	assert.deepEqual(before.curves[0]!.anchors[1], { position: frame(30), value: 300 });
});
test('speed graph edits a Bezier endpoint slope in units per second without altering anchor values', () => {
	const before = property(); const changed = moveMotionGraphHandle(before, 0, 0, 1, frame(10), 600, 'speed', frame(30));
	if (changed.kind !== 'vector2') throw new Error('Wrong property kind.');
	assert.deepEqual(changed.curves[0]!.anchors, before.curves[0]!.anchors);
	assert.equal(compileMotionCurveMetrics(changed.curves[0]).slopeAt(frame(0))! * 30, 600);
	assert.deepEqual(changed.curves[1], before.curves[1]);
	assert.throws(() => moveMotionGraphHandle(before, 0, 0, 1, frame(0), 600, 'speed', frame(30)), /span|inside|vertical/iu);
});

test('graph sampling retains exact rational hold boundaries and leaves undefined speed gaps', async () => {
	const { motionGraphGeometry } = await import('../src/common/editor/ui/motionscaper/motion-graph-geometry.ts');
	const boundary = { num: 1, den: 3 };
	const held = motionPropertyOfKind({ kind: 'scalar', value: 0, expression: null, curve: { anchors: [{ position: frame(0), value: 0 }, { position: boundary, value: 10 }], segments: [{ kind: 'hold' }] } }, 'scalar');
	const speed = motionGraphGeometry(held, 0, 30, frame(30), 'speed');
	assert.equal(speed.points.find((point) => point.frame === 1 / 3)?.value, null);
	const value = motionGraphGeometry(held, 0, 30, frame(30), 'value');
	assert.deepEqual(value.points.filter((point) => point.frame === 1 / 3).map((point) => point.value), [0, 10]);
});
