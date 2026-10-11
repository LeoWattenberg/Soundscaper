/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { motionScalar, motionVector, normalizeMotionProperty, type MotionPath } from '../src/common/editor/motion-property.ts';
import { compileMotionProperty } from '../src/common/editor/motion-property-evaluation.ts';
import { editMotionKeyframes, copyMotionKeyframes, pasteMotionKeyframes } from '../src/common/editor/motion-keyframe-edit.ts';
const r = (num: number, den = 1) => ({ num, den });
const curve = { anchors: [{ position: r(0), value: 0 }, { position: r(30), value: 10 }], segments: [{ kind: 'bezier' as const, control1: { position: r(10), value: 2 }, control2: { position: r(20), value: 8 } }] };

test('M06 a first keyframe retains its authored position and evaluates as a constant until another key is added', () => {
	const first = editMotionKeyframes(motionScalar(3), { type: 'set-key', position: r(15), value: 7 });
	assert.equal(first.kind, 'scalar'); if (first.kind !== 'scalar') throw new Error('Expected scalar');
	assert.deepEqual(first.curve, { anchors: [{ position: r(15), value: 7 }], segments: [] });
	assert.equal(compileMotionProperty(first)(r(0)), 7); assert.equal(compileMotionProperty(first)(r(300)), 7);
	const second = editMotionKeyframes(first, { type: 'set-key', position: r(30), value: 10 }); assert.equal(compileMotionProperty(second)(r(45, 2)), 8.5);
	const removed = editMotionKeyframes(second, { type: 'delete-keys', positions: [r(15)] }); assert.equal(compileMotionProperty(removed)(r(0)), 10);
});

test('M06 moving selected Bezier keys preserves normalized handle geometry and rejects collisions atomically', () => {
	const property = normalizeMotionProperty({ ...motionScalar(0), curve });
	const moved = editMotionKeyframes(property, { type: 'move-keys', positions: [r(30)], deltaFrames: r(30) });
	assert.equal(moved.kind, 'scalar'); if (moved.kind !== 'scalar') throw new Error('Expected scalar');
	assert.deepEqual(moved.curve!.segments[0], { kind: 'bezier', control1: { position: r(20), value: 2 }, control2: { position: r(40), value: 8 } });
	for (const frame of [0, 3, 7, 15, 23, 30]) assert.ok(Math.abs(Number(compileMotionProperty(property)(r(frame))) - Number(compileMotionProperty(moved)(r(frame * 2)))) < 1e-10);
	assert.throws(() => editMotionKeyframes(property, { type: 'move-keys', positions: [r(30)], deltaFrames: r(-30) }), /collision|increasing/iu);
	assert.deepEqual(property, normalizeMotionProperty({ ...motionScalar(0), curve }));
});

test('M06 copied keyframes transfer between frame rates with exact positions and Bezier controls', () => {
	const source = normalizeMotionProperty({ ...motionScalar(0), curve });
	const clipboard = copyMotionKeyframes(source, [r(0), r(30)], r(30));
	const target = motionScalar(2); const pasted = pasteMotionKeyframes(target, clipboard, { atFrame: r(12), frameRate: r(24), mode: 'merge' });
	assert.equal(pasted.kind, 'scalar'); if (pasted.kind !== 'scalar') throw new Error('Expected scalar');
	assert.deepEqual(pasted.curve!.anchors.map(({ position }) => position), [r(12), r(36)]);
	assert.deepEqual(pasted.curve!.segments[0], { kind: 'bezier', control1: { position: r(20), value: 2 }, control2: { position: r(28), value: 8 } });
	assert.equal(compileMotionProperty(pasted)(r(24)), 5);
});

test('M06 interpolation and channel-specific edits preserve untouched channels and disabled expression source', () => {
	const expression = { source: 'future(1)', enabled: false, references: [] };
	const property = normalizeMotionProperty({ ...motionVector([0, 1, 2]), curves: [curve, curve, null], expression });
	const result = editMotionKeyframes(property, { type: 'interpolation', fromPosition: r(0), shape: { kind: 'hold' }, channels: [0] });
	assert.equal(result.kind, 'vector3'); if (result.kind !== 'vector3' || property.kind !== 'vector3') throw new Error('Expected vector3');
	assert.deepEqual(compileMotionProperty(result)(r(15)), [0, 5, 2]); assert.deepEqual(result.curves[1], property.curves[1]); assert.deepEqual(result.expression, expression);
});

test('M06 inserting a sampled key into a Bezier curve retains its geometry on both sides', () => {
	const source = normalizeMotionProperty({ ...motionScalar(0), curve }); const evaluate = compileMotionProperty(source);
	const inserted = editMotionKeyframes(source, { type: 'set-key', position: r(15), value: Number(evaluate(r(15))) });
	for (let frame = 0; frame <= 30; frame++) assert.ok(Math.abs(Number(evaluate(r(frame))) - Number(compileMotionProperty(inserted)(r(frame)))) < 1e-8);
});

test('M06 compatible path keys retain topology and incompatible morphs fail before changing authority', () => {
	const path = (x: number): MotionPath => ({ closed: false, vertices: [{ point: [x, 0], inTangent: [0, 0], outTangent: [0, 0] }, { point: [x, 10], inTangent: [0, 0], outTangent: [0, 0] }] });
	const base = normalizeMotionProperty({ kind: 'path', value: path(0), keyframes: [], segments: [], expression: null });
	const first = editMotionKeyframes(base, { type: 'set-key', position: r(0), value: path(0) });
	const second = editMotionKeyframes(first, { type: 'set-key', position: r(30), value: path(20) });
	assert.deepEqual(compileMotionProperty(second)(r(15)), path(10));
	const malformed = { ...path(0), vertices: [...path(0).vertices, path(0).vertices[0]!] };
	assert.throws(() => editMotionKeyframes(second, { type: 'set-key', position: r(60), value: malformed }), /topology/iu);
});
