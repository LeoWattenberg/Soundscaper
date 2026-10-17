/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoMaskMatteGraphV1 } from '../src/common/editor/video-mask-matte-v24.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { assertDeepFrozen } from './helpers/frozen-contract-assertions.ts';
import { gradientGraph, rectangleGraph } from './helpers/lightscaper-masked-frame-fixture.ts';

const forward = [32, 96, 159, 223];
function graph(nodes: readonly unknown[], outputNodeId: string) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes, outputNodeId };
}

test('linear gradient admission detaches its closed endpoints and retains canonical graph identity', () => {
	const input = gradientGraph(), normalized = normalizeVideoMaskMatteGraphV1(input);
	assert.deepEqual(normalized, input); assertDeepFrozen(normalized);
	assert.notEqual(normalized, input); assert.notEqual(normalized.nodes[0], input.nodes[0]);
	input.nodes[0]!.start.x = 0.5; input.nodes[0]!.end.y = 0.75;
	assert.deepEqual(normalized.nodes[0], { id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
	assert.deepEqual(normalizeVideoMaskMatteGraphV1(normalized), normalized);
});

test('normalized pixel centers produce literal horizontal, reversed, vertical and diagonal coverage', () => {
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph(), 4, 1)], forward);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph({ x: 1, y: 0 }, { x: 0, y: 0 }), 4, 1)], [223, 159, 96, 32]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph({ x: 0, y: 0 }, { x: 0, y: 1 }), 1, 4)], forward);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph({ x: 0, y: 0 }, { x: 1, y: 1 }), 2, 2)], [64, 128, 128, 191]);
});

test('coverage clamps exact endpoints and admits finite out-of-frame coordinates without wrapping', () => {
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph({ x: 0.25, y: 0 }, { x: 0.75, y: 0 }), 4, 1)], [0, 64, 191, 255]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph({ x: -1, y: 0 }, { x: 2, y: 0 }), 4, 1)], [96, 117, 138, 159]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph({ x: 2, y: 0 }, { x: 3, y: 0 }), 4, 1)], [0, 0, 0, 0]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph({ x: -2, y: 0 }, { x: -1, y: 0 }), 4, 1)], [255, 255, 255, 255]);
});

test('gradient inversion and existing boolean composition use the actual shared graph evaluator', () => {
	const gradient = gradientGraph().nodes[0]!, inverse = { id: 'inverse', kind: 'invert', inputNodeId: 'gradient' };
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(graph([gradient, inverse], 'inverse'), 4, 1)], [223, 159, 96, 32]);
	for (const [operation, expected] of [['union', [223, 159, 159, 223]], ['intersect', [32, 96, 96, 32]]] as const) {
		const output = { id: 'output', kind: 'boolean', operation, inputNodeIds: ['gradient', 'inverse'] };
		assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(graph([output, inverse, gradient], 'output'), 4, 1)], expected);
	}
	const shape = rectangleGraph().nodes[0]!;
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(graph([gradient, shape,
		{ id: 'output', kind: 'boolean', operation: 'subtract', inputNodeIds: ['gradient', 'shape'] }], 'output'), 4, 1)], [32, 96, 0, 0]);
});

test('new endpoint records refuse unknown fields and accessors without invoking getters', () => {
	let getters = 0;
	for (const mutate of [
		(value: ReturnType<typeof gradientGraph>) => Object.assign(value.nodes[0]!, { future: true }),
		(value: ReturnType<typeof gradientGraph>) => Object.assign(value.nodes[0]!.start, { z: 0 }),
		(value: ReturnType<typeof gradientGraph>) => Object.defineProperty(value.nodes[0]!, 'start', { enumerable: true, get() { getters++; return { x: 0, y: 0 }; } }),
		(value: ReturnType<typeof gradientGraph>) => Object.defineProperty(value.nodes[0]!.end, 'x', { enumerable: true, get() { getters++; return 1; } }),
	]) { const input = gradientGraph(); mutate(input); assert.throws(() => normalizeVideoMaskMatteGraphV1(input)); }
	assert.equal(getters, 0);
});

test('gradient coordinates are bounded canonical finite numbers and endpoints must be distinct', () => {
	for (const value of [NaN, Infinity, -Infinity, -0, 1_000_001, -1_000_001, '0', null]) {
		const input = gradientGraph(); Object.assign(input.nodes[0]!.start, { x: value });
		assert.throws(() => normalizeVideoMaskMatteGraphV1(input));
	}
	assert.throws(() => normalizeVideoMaskMatteGraphV1(gradientGraph({ x: 0.25, y: 0.5 }, { x: 0.25, y: 0.5 })));
	const boundary = gradientGraph({ x: -1_000_000, y: 1_000_000 }, { x: 1_000_000, y: -1_000_000 });
	assert.deepEqual(normalizeVideoMaskMatteGraphV1(boundary), boundary);
});

test('the old rectangle graph keeps its exact canonical JSON and coverage bytes', () => {
	const value = normalizeVideoMaskMatteGraphV1(rectangleGraph());
	assert.equal(JSON.stringify(value), '{"schemaVersion":1,"id":"mask","kind":"mask","inputs":[],"nodes":[{"id":"shape","kind":"vector-shape","shape":"rectangle","x":0.5,"y":0,"width":0.5,"height":1}],"outputNodeId":"shape"}');
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(value, 4, 1)], [0, 0, 255, 255]);
});
