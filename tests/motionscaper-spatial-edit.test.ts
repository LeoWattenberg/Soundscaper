/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionPropertyOfKind } from '../src/common/editor/motion-property.ts';
import { compileMotionProperty } from '../src/common/editor/motion-property-evaluation.ts';
import { setMotionSpatialKey, enableMotionSpatialBezier, setMotionSpatialHandle } from '../src/common/editor/motion-spatial-edit.ts';
const frame = (num: number) => ({ num, den: 1 });
const property = () => motionPropertyOfKind({ kind: 'vector3', value: [0, 0, 12], expression: { enabled: false, source: 'value', references: [] }, curves: [null, null, { anchors: [{ position: frame(0), value: 7 }], segments: [] }] }, 'vector3');
test('spatial position edits update X/Y together and preserve Z and expressions', () => {
	const initial = property(); const first = setMotionSpatialKey(initial, frame(0), [0, 0]); const last = setMotionSpatialKey(first, frame(30), [300, 0]);
	const curved = enableMotionSpatialBezier(last, frame(0));
	const changed = setMotionSpatialHandle(curved, frame(0), 1, [100, 200]);
	assert.deepEqual(changed.curves[2], initial.curves[2]); assert.deepEqual(changed.expression, initial.expression);
	assert.deepEqual(compileMotionProperty(changed)(frame(15)), [150, 75, 7]);
	assert.deepEqual(compileMotionProperty(initial)(frame(15)), [0, 0, 7]);
});
test('spatial Bezier creation refuses mismatched channel time spans without discarding authored keys', () => {
	const initial = motionPropertyOfKind({ kind: 'vector2', value: [0, 0], expression: null, curves: [
		{ anchors: [{ position: frame(0), value: 0 }, { position: frame(30), value: 300 }], segments: [{ kind: 'linear' }] },
		{ anchors: [{ position: frame(0), value: 0 }, { position: frame(15), value: 100 }, { position: frame(30), value: 0 }], segments: [{ kind: 'linear' }, { kind: 'linear' }] },
	] }, 'vector2');
	assert.throws(() => enableMotionSpatialBezier(initial, frame(0)), /matching|aligned/iu);
	assert.equal(initial.curves[1]!.anchors.length, 3);
});

test('creating spatial handles preserves existing easing and refuses discontinuous hold conversion', () => {
	const initial = motionPropertyOfKind({ kind: 'vector2', value: [0, 0], expression: null, curves: [
		{ anchors: [{ position: frame(0), value: 0 }, { position: frame(30), value: 300 }], segments: [{ kind: 'eased' }] },
		{ anchors: [{ position: frame(0), value: 0 }, { position: frame(30), value: 100 }], segments: [{ kind: 'linear' }] },
	] }, 'vector2');
	const changed = enableMotionSpatialBezier(initial, frame(0)); const before = compileMotionProperty(initial), after = compileMotionProperty(changed);
	for (const at of [3, 15, 27]) { const a = before(frame(at)) as readonly number[], b = after(frame(at)) as readonly number[]; assert.ok(Math.abs(a[0]! - b[0]!) < 1e-8); assert.ok(Math.abs(a[1]! - b[1]!) < 1e-8); }
	const held = motionPropertyOfKind({ ...initial, curves: [{ ...initial.curves[0], segments: [{ kind: 'hold' }] }, initial.curves[1]] }, 'vector2');
	assert.throws(() => enableMotionSpatialBezier(held, frame(0)), /hold/iu);
});
