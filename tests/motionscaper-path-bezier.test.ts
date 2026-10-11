/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMotionProperty, type MotionPathProperty } from '../src/common/editor/motion-property.ts';
import { compileMotionProperty } from '../src/common/editor/motion-property-evaluation.ts';
import { copyMotionKeyframes, editMotionKeyframes, pasteMotionKeyframes } from '../src/common/editor/motion-keyframe-edit.ts';
import { retimeMotionLayer } from '../src/common/editor/motion-layer-retiming.ts';
import { createMotionLayer } from '../src/motionscaper/editor-project.ts';
const r = (num: number, den = 1) => ({ num, den });
const path = (x: number) => ({ closed: false, vertices: [{ point: [x, 0], inTangent: [0, 0], outTangent: [1, 0] }, { point: [x + 10, 0], inTangent: [-1, 0], outTangent: [0, 0] }] });
const candidate = { kind: 'path', value: path(0), keyframes: [{ position: r(0), value: path(0) }, { position: r(30), value: path(100) }], segments: [{ kind: 'bezier', control1: { position: r(10), value: 0 }, control2: { position: r(20), value: 0 } }], expression: null };
const property = () => normalizeMotionProperty(candidate) as MotionPathProperty;
function point(value: unknown): number { return (value as { vertices: { point: number[] }[] }).vertices[0]!.point[0]!; }

test('M06 path temporal Bezier evaluates exact frame time against normalized morph progress and rejects unordered handles', () => {
	const evaluate = compileMotionProperty(property()); assert.ok(Math.abs(point(evaluate(r(15))) - 12.5) < 1e-10);
	assert.deepEqual(evaluate(r(30)), property().keyframes[1]!.value);
	assert.throws(() => normalizeMotionProperty({ ...candidate, segments: [{ ...candidate.segments[0], control1: { position: r(25), value: 0 }, control2: { position: r(5), value: 1 } }] }), /control positions/iu);
});

test('M06 inserting a sampled path key splits temporal Bezier authority without changing the complete morph', () => {
	const original = property(); const evaluate = compileMotionProperty(original); const inserted = editMotionKeyframes(original, { type: 'set-key', position: r(15), value: evaluate(r(15)) });
	const next = compileMotionProperty(inserted);
	for (let frame = 0; frame <= 30; frame += 1) assert.ok(Math.abs(point(next(r(frame))) - point(evaluate(r(frame)))) < 1e-8, `frame ${frame}`);
	assert.equal(inserted.kind === 'path' && inserted.keyframes.length, 3);
});

test('M06 moving and pasting path keys retimes temporal controls with exact frame-rate conversion', () => {
	const original = property(); const moved = editMotionKeyframes(original, { type: 'move-keys', positions: [r(30)], deltaFrames: r(30) }) as MotionPathProperty;
	assert.deepEqual(moved.segments[0], { kind: 'bezier', control1: { position: r(20), value: 0 }, control2: { position: r(40), value: 0 } });
	const clipboard = copyMotionKeyframes(original, [r(0), r(30)], r(30));
	const pasted = pasteMotionKeyframes(original, clipboard, { atFrame: r(24), frameRate: r(24), mode: 'replace' }) as MotionPathProperty;
	assert.deepEqual(pasted.segments[0], { kind: 'bezier', control1: { position: r(32), value: 0 }, control2: { position: r(40), value: 0 } });
	const layer = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'null' } });
	const withMask = { ...layer, masks: [{ id: 'mask', path: original, opacity: { kind: 'scalar' as const, value: 1, curve: null, expression: null }, feather: { kind: 'vector2' as const, value: [0, 0] as const, curves: [null, null] as const, expression: null }, expansion: { kind: 'scalar' as const, value: 0, curve: null, expression: null }, inverted: false, operation: 'add' as const }] };
	assert.deepEqual(retimeMotionLayer(withMask, r(4, 5)).masks[0]!.path.segments[0], { kind: 'bezier', control1: { position: r(8), value: 0 }, control2: { position: r(16), value: 0 } });
});

test('M06 path key insertion refuses returning progress loops that equal endpoint paths cannot represent', () => {
	const looping = normalizeMotionProperty({ ...candidate, segments: [{ kind: 'bezier', control1: { position: r(10), value: 0 }, control2: { position: r(20), value: -1 / 3 } }] });
	const value = compileMotionProperty(looping)(r(15));
	assert.throws(() => editMotionKeyframes(looping, { type: 'set-key', position: r(15), value }), /returning progress loop/iu);
});
