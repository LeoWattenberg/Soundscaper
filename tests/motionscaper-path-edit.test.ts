/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { editMotionPath } from '../src/common/editor/motion-path-edit.ts';
import { motionPropertyOfKind, type MotionPath, type MotionVector2 } from '../src/common/editor/motion-property.ts';
const point = (x: number, y: number): MotionVector2 => [x, y];
const path = (offset = 0): MotionPath => ({ closed: false, vertices: [
	{ point: point(offset, 0), inTangent: point(0, 0), outTangent: point(100, 200) },
	{ point: point(300 + offset, 0), inTangent: point(-100, 100), outTangent: point(0, 0) },
] });
const property = () => motionPropertyOfKind({ kind: 'path', value: path(), expression: null,
	keyframes: [{ position: { num: 0, den: 1 }, value: path() }, { position: { num: 30, den: 1 }, value: path(100) }], segments: ['linear'] }, 'path');
function sample(value: MotionPath, segment: number, t: number): MotionVector2 {
	const a = value.vertices[segment]!, b = value.vertices[segment + 1]!; const n = 1 - t;
	return [0, 1].map((channel) => n ** 3 * a.point[channel]! + 3 * n ** 2 * t * (a.point[channel]! + a.outTangent[channel]!) + 3 * n * t ** 2 * (b.point[channel]! + b.inTangent[channel]!) + t ** 3 * b.point[channel]!) as unknown as MotionVector2;
}
test('path insertion preserves cubic geometry and common animated topology at every retained key', () => {
	const before = property(), changed = editMotionPath(before, { type: 'insert', after: 0 });
	for (const [index, original] of [before.value, ...before.keyframes.map((key) => key.value)].entries()) {
		const inserted = [changed.value, ...changed.keyframes.map((key) => key.value)][index]!; assert.equal(inserted.vertices.length, 3);
		for (const t of [.125, .375, .5, .75, 1]) assert.deepEqual(sample(original, 0, t), sample(inserted, t < .5 ? 0 : 1, t < .5 ? t * 2 : (t - .5) * 2));
	}
	assert.deepEqual(changed.segments, before.segments); assert.equal(before.value.vertices.length, 2);
});
test('path vertex edits at a fractional frame create one evaluated morph key and retain other keys', () => {
	const before = property(), changed = editMotionPath(before, { type: 'vertex', vertex: 0, part: 'point', value: point(70, 20), position: { num: 15, den: 2 } });
	assert.equal(changed.keyframes.length, 3); assert.deepEqual(changed.keyframes[1]!.value.vertices[0]!.point, [70, 20]);
	assert.deepEqual(changed.keyframes[1]!.value.vertices[1]!.point, [325, 0]); assert.deepEqual(changed.value, before.value);
	assert.deepEqual(changed.keyframes[0], before.keyframes[0]); assert.deepEqual(changed.keyframes[2], before.keyframes[1]);
});
test('path topology deletion and closing validate the complete animated property without partial changes', () => {
	const before = property(); assert.throws(() => editMotionPath(before, { type: 'remove', vertex: 0 }), /vertices|least/iu);
	assert.throws(() => editMotionPath(before, { type: 'closed', closed: true }), /vertices|least/iu);
	const inserted = editMotionPath(before, { type: 'insert', after: 0 }), closed = editMotionPath(inserted, { type: 'closed', closed: true });
	assert.equal(closed.value.closed, true); assert.ok(closed.keyframes.every((key) => key.value.closed));
	assert.deepEqual(editMotionPath(inserted, { type: 'remove', vertex: 1 }).keyframes.map((key) => key.value.vertices.length), [2, 2]);
	assert.equal(before.keyframes[0]!.value.closed, false);
});
