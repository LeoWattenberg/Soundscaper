/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoMaskMatteGraphV1 } from '../src/common/editor/video-mask-matte-v24.ts';
import { evaluateVideoMaskMatteRgbaV13, withVideoMaskMatteRgbaV1 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { assertDeepFrozen } from './helpers/frozen-contract-assertions.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { gradientGraph, rectangleGraph } from './helpers/lightscaper-masked-frame-fixture.ts';

function radial(center = { x: 0.5, y: 0.5 }, radius = { x: 0.5, y: 0.5 }, innerFraction = 0) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [
		{ id: 'radial', kind: 'radial-gradient', center: { ...center }, radius: { ...radius }, innerFraction },
	], outputNodeId: 'radial' };
}
function graph(nodes: readonly unknown[], outputNodeId: string) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes, outputNodeId };
}

test('radial admission detaches and freezes the exact retained center, radii and inner fraction', () => {
	const input = radial(), saved = normalizeVideoMaskMatteGraphV1(input);
	assert.deepEqual(saved, input); assertDeepFrozen(saved); assert.notEqual(saved.nodes[0], input.nodes[0]);
	input.nodes[0]!.center.x = 0; input.nodes[0]!.radius.y = 1; input.nodes[0]!.innerFraction = 0.5;
	assert.deepEqual(saved.nodes[0], { id: 'radial', kind: 'radial-gradient', center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.5 }, innerFraction: 0 });
	assert.deepEqual(normalizeVideoMaskMatteGraphV1(saved), saved);
});

test('actual normalized pixel centers give independent circular, vertical and elliptical coverage', () => {
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(radial(), 5, 1)], [51, 153, 255, 153, 51]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(radial({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.5 }), 1, 5)], [51, 153, 255, 153, 51]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(radial({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.25 }), 5, 3)],
		[0, 0, 0, 0, 0, 51, 153, 255, 153, 51, 0, 0, 0, 0, 0]);
});

test('inner plateau, exact ellipse edge and out-of-frame centers clamp coverage rather than wrapping', () => {
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(radial({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.5), 5, 1)], [102, 255, 255, 255, 102]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(radial({ x: 0.5, y: 0.5 }, { x: 0.4, y: 0.5 }), 5, 1)], [0, 128, 255, 128, 0]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(radial({ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 }), 5, 1)], [255, 0, 0, 0, 0]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(radial({ x: 2, y: -1 }, { x: 0.1, y: 0.1 }), 5, 1)], [0, 0, 0, 0, 0]);
});

test('radial inversion and existing boolean graphs retain independent byte-coverage semantics', () => {
	const node = radial().nodes[0]!, inverse = { id: 'inverse', kind: 'invert', inputNodeId: 'radial' };
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(graph([node, inverse], 'inverse'), 5, 1)], [204, 102, 0, 102, 204]);
	for (const [operation, expected] of [['union', [204, 153, 255, 153, 204]], ['intersect', [51, 102, 0, 102, 51]]] as const) {
		assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(graph([node, inverse,
			{ id: 'output', kind: 'boolean', operation, inputNodeIds: ['radial', 'inverse'] }], 'output'), 5, 1)], expected);
	}
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(graph([node, rectangleGraph().nodes[0]!,
		{ id: 'output', kind: 'boolean', operation: 'subtract', inputNodeIds: ['radial', 'shape'] }], 'output'), 5, 1)], [51, 153, 0, 0, 0]);
});

test('radial coordinates and mandatory falloff refuse noncanonical, zero-radius and future authority', () => {
	for (const [field, values] of [
		['center', [NaN, Infinity, -Infinity, -0, 1_000_001, -1_000_001, '0', null]],
		['radius', [0, -0, -1, NaN, Infinity, 1_000_001, '0.5', null]],
	] as const) for (const value of values) for (const axis of ['x', 'y']) {
		const input = radial(); Object.assign(input.nodes[0]![field], { [axis]: value });
		assert.throws(() => normalizeVideoMaskMatteGraphV1(input));
	}
	for (const value of [-0, -0.1, 1, 1.1, NaN, Infinity, '0', null, undefined]) {
		const input = radial(); Object.assign(input.nodes[0]!, { innerFraction: value }); assert.throws(() => normalizeVideoMaskMatteGraphV1(input));
	}
	const missing = radial(); Reflect.deleteProperty(missing.nodes[0]!, 'innerFraction'); assert.throws(() => normalizeVideoMaskMatteGraphV1(missing));
	const boundary = radial({ x: -1_000_000, y: 1_000_000 }, { x: 1_000_000, y: Number.MIN_VALUE }, 0.999999);
	assert.deepEqual(normalizeVideoMaskMatteGraphV1(boundary), boundary);
});

test('radial closed own-data records reject extras, inherited coordinates and accessors without invoking them', () => {
	let getters = 0;
	for (const mutate of [
		(input: ReturnType<typeof radial>) => Object.assign(input.nodes[0]!, { future: true }),
		(input: ReturnType<typeof radial>) => Object.assign(input.nodes[0]!.center, { z: 0 }),
		(input: ReturnType<typeof radial>) => Object.assign(input.nodes[0]!.radius, { z: 0 }),
		(input: ReturnType<typeof radial>) => Object.assign(input.nodes[0]!, { radius: Object.create({ x: 0.5, y: 0.5 }) as object }),
		(input: ReturnType<typeof radial>) => Object.defineProperty(input.nodes[0]!, 'innerFraction', { enumerable: true, get() { getters++; return 0; } }),
		(input: ReturnType<typeof radial>) => Object.defineProperty(input.nodes[0]!.radius, 'x', { enumerable: true, get() { getters++; return 0.5; } }),
		(input: ReturnType<typeof radial>) => Object.defineProperty(input.nodes[0]!.center, 'y', { enumerable: true, get() { getters++; return 0.5; } }),
	]) { const input = radial(); mutate(input); assert.throws(() => normalizeVideoMaskMatteGraphV1(input)); }
	assert.equal(getters, 0);
});

test('scoped radial coverage joins held cancellation and wipes only after its borrower settles', async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy; let borrowed: Uint8Array | undefined;
	const work = withVideoMaskMatteRgbaV1({ graph: radial(), width: 5, height: 1, signal: stop.signal }, async coverage => {
		borrowed = coverage; assert.deepEqual([...coverage], [51, 153, 255, 153, 51]); entered.resolve(); await release.promise;
	});
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), error => ({ failed: true, error: error as unknown }));
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); assert.deepEqual([...(borrowed ?? [])], [51, 153, 255, 153, 51]); }
	finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true); assert.ok(borrowed?.every(byte => byte === 0));
});

test('legacy linear and rectangle canonical bytes and coverage stay unchanged', () => {
	const linear = normalizeVideoMaskMatteGraphV1(gradientGraph()), rectangle = normalizeVideoMaskMatteGraphV1(rectangleGraph());
	assert.equal(JSON.stringify(linear), '{"schemaVersion":1,"id":"mask","kind":"mask","inputs":[],"nodes":[{"id":"gradient","kind":"linear-gradient","start":{"x":0,"y":0},"end":{"x":1,"y":0}}],"outputNodeId":"gradient"}');
	assert.equal(JSON.stringify(rectangle), '{"schemaVersion":1,"id":"mask","kind":"mask","inputs":[],"nodes":[{"id":"shape","kind":"vector-shape","shape":"rectangle","x":0.5,"y":0,"width":0.5,"height":1}],"outputNodeId":"shape"}');
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(linear, 4, 1)], [32, 96, 159, 223]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(rectangle, 4, 1)], [0, 0, 255, 255]);
});
