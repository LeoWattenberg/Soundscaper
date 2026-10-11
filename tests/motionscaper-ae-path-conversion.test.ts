/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertMotionAePath, exportMotionAePath } from '../src/common/editor/motion-ae-path-conversion.ts';
import { motionPropertyOfKind } from '../src/common/editor/motion-property.ts';
import type { MotionAeProperty } from '../src/common/editor/motion-ae-exchange-types.ts';
const rate = { num: 24, den: 1 };
const value = { closed: true, vertices: [
	{ point: [3, 4], inTangent: [-2, 1], outTangent: [5, -3] },
	{ point: [20, 5], inTangent: [-4, 0], outTangent: [2, 6] },
	{ point: [12, 24], inTangent: [-1, -2], outTangent: [3, 0] },
] };
const path = motionPropertyOfKind({ kind: 'path', value, keyframes: [], segments: [], expression: null }, 'path');
const options = { matchName: 'ADBE Mask Shape', name: 'Mask Path', rate: 24, startFrame: { num: 0, den: 1 } };
test('Motion AE paths preserve closed vertices and vertex-relative handles in both directions', () => {
	const exported = exportMotionAePath(path, options);
	assert.equal(exported.unsupported, null); assert.deepEqual(exported.property.value.inTangents, [[-2, 1], [-4, 0], [-1, -2]]);
	const imported = convertMotionAePath(exported.property, rate);
	assert.equal(imported.status, 'editable'); assert.deepEqual(imported.property, path); assert.equal(imported.quantizedClock, false);
});
test('Motion AE paths rebase local frame keys to composition seconds and retain hold/linear topology', () => {
	const next = { ...value, vertices: value.vertices.map(vertex => ({ ...vertex, point: [vertex.point[0]! + 8, vertex.point[1]!] })) };
	const animated = motionPropertyOfKind({ ...path, keyframes: [{ position: { num: 0, den: 1 }, value }, { position: { num: 24, den: 1 }, value: next }], segments: ['hold'] }, 'path');
	const exported = exportMotionAePath(animated, { ...options, startFrame: { num: 12, den: 1 } });
	assert.deepEqual(exported.property.keys.map(key => key.time), [0.5, 1.5]);
	const imported = convertMotionAePath(exported.property, rate).property!;
	assert.deepEqual(imported.keyframes.map(key => key.position), [{ num: 12, den: 1 }, { num: 36, den: 1 }]); assert.deepEqual(imported.segments, ['hold']);
	assert.deepEqual(imported.keyframes[1]!.value, animated.keyframes[1]!.value);
});
test('Motion AE paths refuse expression execution, temporal Bezier guesses and topology changes', () => {
	const exported = exportMotionAePath(path, options).property;
	const key = { time: 0, value: exported.value, inInterpolation: 'linear' as const, outInterpolation: 'linear' as const,
		inEase: [{ speed: 0, influence: 33 }], outEase: [{ speed: 0, influence: 33 }], inSpatialTangent: null, outSpatialTangent: null, roving: false };
	const input: Extract<MotionAeProperty, { kind: 'shape' }> = { ...exported, keys: [key, { ...key, time: 1 }] };
	for (const candidate of [
		{ ...input, expression: { enabled: true, source: 'arbitrary()', disposition: 'unsupported' as const } },
		{ ...input, keys: [{ ...key, outInterpolation: 'bezier' as const }, { ...key, time: 1 }] },
		{ ...input, keys: [key, { ...key, time: 1, value: { ...key.value, closed: false } }] },
		{ ...input, keys: [{ ...key, time: -1 }, key] },
	]) { const result = convertMotionAePath(candidate, rate); assert.equal(result.status, 'unsupported'); assert.equal(result.property, null); }
	const animated = motionPropertyOfKind({ ...path, keyframes: [{ position: { num: 0, den: 1 }, value }, { position: { num: 24, den: 1 }, value }], segments: ['eased'] }, 'path');
	assert.match(exportMotionAePath(animated, options).unsupported!, /temporal/iu);
});
test('Motion AE paths report bounded clock quantization and refuse colliding keys', () => {
	const exported = exportMotionAePath(path, options).property;
	const key = { time: 1 / 7, value: exported.value, inInterpolation: 'linear' as const, outInterpolation: 'linear' as const,
		inEase: [{ speed: 0, influence: 33 }], outEase: [{ speed: 0, influence: 33 }], inSpatialTangent: null, outSpatialTangent: null, roving: false };
	assert.equal(convertMotionAePath({ ...exported, keys: [key] }, rate).quantizedClock, true);
	assert.equal(convertMotionAePath({ ...exported, keys: [key, { ...key, time: key.time + 1e-12 }] }, rate).status, 'unsupported');
});
