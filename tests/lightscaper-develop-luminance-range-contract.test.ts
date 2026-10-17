/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoMaskMatteGraphV1 } from '../src/common/editor/video-mask-matte-v24.ts';
import { evaluateVideoMaskMatteRgbaV13, withVideoMaskMatteRgbaV1 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { assertDeepFrozen } from './helpers/frozen-contract-assertions.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { gradientGraph, rectangleGraph, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

const PIXELS = [0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
	255, 255, 255, 255, 128, 128, 128, 255, 255, 0, 0, 128, 255, 0, 0, 0];
const EXPECTED = [0, 223, 0, 184, 0, 215, 223, 0];
function range(lower = 0.1, upper = 0.2, falloff = 0.1) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'range', kind: 'luminance-range', lower, upper, falloff }], outputNodeId: 'range' };
}
function evaluate(graph: unknown, pixels: readonly number[] = PIXELS, transfer: 'srgb' | 'linear' = 'srgb') {
	const frame = rgbaFrame(pixels);
	return evaluateVideoMaskMatteRgbaV13(graph, pixels.length / 4, 1, new Map(), { ...frame, descriptor: { ...frame.descriptor, transfer } });
}

test('luminance-range admission detaches frozen canonical interval and falloff without adding graph inputs', () => {
	const input = range(), saved = normalizeVideoMaskMatteGraphV1(input);
	assert.deepEqual(saved, input); assertDeepFrozen(saved); assert.deepEqual(saved.inputs, []);
	input.nodes[0]!.lower = 0; input.nodes[0]!.upper = 1; input.nodes[0]!.falloff = 0;
	assert.deepEqual(saved.nodes, [{ id: 'range', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 }]);
	assert.deepEqual(normalizeVideoMaskMatteGraphV1(saved), saved);
});

test('straight decoded Rec709 luminance yields independent ramps and does not scale coverage by partial alpha', () => {
	assert.deepEqual([...evaluate(range())], EXPECTED);
	assert.deepEqual([...evaluate(range(), PIXELS, 'linear')], [0, 223, 0, 184, 0, 0, 223, 0]);
	assert.deepEqual([...evaluate(range(0.2126, 0.2126, 0))], [0, 255, 0, 0, 0, 0, 255, 0]);
	assert.deepEqual([...evaluate(range(0, 1, 0))], [255, 255, 255, 255, 255, 255, 255, 0]);
	assert.deepEqual([...evaluate(range(0, 0, 0))], [255, 0, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual([...evaluate(range(1, 1, 0))], [0, 0, 0, 0, 255, 0, 0, 0]);
});

test('luminance coverage composes with existing inversion and boolean byte operations', () => {
	const node = range().nodes[0]!, inverse = { id: 'inverse', kind: 'invert', inputNodeId: 'range' };
	const graph = (nodes: readonly unknown[], outputNodeId: string) => ({ ...range(), nodes, outputNodeId });
	assert.deepEqual([...evaluate(graph([node, inverse], 'inverse'))], [255, 32, 255, 71, 255, 40, 32, 255]);
	assert.deepEqual([...evaluate(graph([node, inverse, { id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['range', 'inverse'] }], 'both'))],
		[0, 32, 0, 71, 0, 40, 32, 0]);
});

test('closed range fields require canonical finite ordered bounds and mandatory falloff without getter reads', () => {
	let getters = 0;
	for (const key of ['lower', 'upper', 'falloff']) for (const value of [-0, -0.1, 1.1, NaN, Infinity, '0.1', null, undefined]) {
		const input = range(); Object.assign(input.nodes[0]!, { [key]: value }); assert.throws(() => normalizeVideoMaskMatteGraphV1(input));
	}
	assert.throws(() => normalizeVideoMaskMatteGraphV1(range(0.7, 0.2)));
	for (const mutate of [
		(input: ReturnType<typeof range>) => Object.assign(input.nodes[0]!, { future: true }),
		(input: ReturnType<typeof range>) => Reflect.deleteProperty(input.nodes[0]!, 'falloff'),
		(input: ReturnType<typeof range>) => Object.defineProperty(input.nodes[0]!, 'upper', { enumerable: true, get() { getters++; return 0.2; } }),
		(input: ReturnType<typeof range>) => { input.nodes = [Object.create(input.nodes[0]!) as typeof input.nodes[number]]; },
	]) { const input = range(); mutate(input); assert.throws(() => normalizeVideoMaskMatteGraphV1(input)); }
	assert.equal(getters, 0); assert.deepEqual(normalizeVideoMaskMatteGraphV1(range(0, 1, 1)), range(0, 1, 1));
});

test('reachable range requires exact current pixels and supported descriptor while unreachable range acquires no pixel authority', async () => {
	await assert.rejects(withVideoMaskMatteRgbaV1({ graph: range(), width: 8, height: 1 }, () => {}), /current|frame|pixel/iu);
	const frame = rgbaFrame(PIXELS);
	for (const patch of [{ width: 7 }, { height: 2 }, { sampleFormat: 'float32' }, { primaries: 'display-p3' }, { transfer: 'pq' }]) {
		await assert.rejects(withVideoMaskMatteRgbaV1({ graph: range(), width: 8, height: 1, currentFrame: { ...frame, descriptor: { ...frame.descriptor, ...patch } } }, () => {}));
	}
	let reflections = 0;
	const unread = new Proxy({}, { ownKeys() { reflections++; throw Error('Unreachable range inspected a current frame'); } });
	const rectangle = rectangleGraph(), graph = { ...rectangle, nodes: [...rectangle.nodes, range().nodes[0]!] };
	const actual = await withVideoMaskMatteRgbaV1({ graph, width: 4, height: 1, currentFrame: unread }, coverage => [...coverage]);
	assert.deepEqual(actual, [0, 0, 255, 255]); assert.equal(reflections, 0);
});

test('current-frame admission refuses accessors, wrong-length and shared pixels without invoking a getter', async () => {
	let getters = 0, delivered = 0;
	const frame = rgbaFrame(PIXELS), accessor = Object.defineProperty({ ...frame }, 'pixels', { enumerable: true, get() { getters++; return frame.pixels; } });
	for (const currentFrame of [accessor, { ...frame, pixels: frame.pixels.subarray(1) },
		{ ...frame, pixels: new Uint8Array(new SharedArrayBuffer(frame.pixels.byteLength)) }]) {
		await assert.rejects(withVideoMaskMatteRgbaV1({ graph: range(), width: 8, height: 1, currentFrame }, () => { delivered++; }));
	}
	assert.equal(getters, 0); assert.equal(delivered, 0);
});

test('source and range scalars are captured before a yielding evaluation, then borrowed coverage joins opaque cancellation', async () => {
	const width = 65_536, pixels = new Uint8Array(width * 2 * 4);
	for (let index = 0; index < pixels.length; index += 4) { pixels[index] = 255; pixels[index + 3] = 128; }
	const frame = { descriptor: { schemaVersion: 1, width, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
	const graph = range(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy; let borrowed: Uint8Array | undefined;
	const work = withVideoMaskMatteRgbaV1({ graph, width, height: 2, currentFrame: frame, signal: stop.signal }, async coverage => {
		borrowed = coverage; assert.equal(coverage.every(value => value === 223), true); entered.resolve(); await release.promise;
	});
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), error => ({ failed: true, error: error as unknown }));
	graph.nodes[0]!.lower = 0; graph.nodes[0]!.upper = 1; pixels.fill(0);
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); assert.equal(borrowed?.every(value => value === 223), true); }
	finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(borrowed?.every(byte => byte === 0)); assert.equal(pixels.every(byte => byte === 0), true);
});

test('current-frame copy participates in the 64 MiB pre-admission budget and legacy raster luma remains encoded', async () => {
	let inspected = 0, delivered = 0;
	const hostilePixels = new Proxy({}, { ownKeys() { inspected++; throw Error('Oversized source pixels were inspected'); } });
	const descriptor = { ...rgbaFrame().descriptor, width: 4_096, height: 4_096 };
	await assert.rejects(withVideoMaskMatteRgbaV1({ graph: range(), width: 4_096, height: 4_096, currentFrame: { descriptor, pixels: hostilePixels } }, () => { delivered++; }), /64 MiB|working.*budget/iu);
	assert.equal(inspected, 0); assert.equal(delivered, 0);
	const raster = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'Body', sourceRef: 'body', kind: 'raster' }],
		nodes: [{ id: 'raster', kind: 'raster', inputName: 'Body', channel: 'luma' }], outputNodeId: 'raster' };
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(raster, 1, 1, new Map([['body', { width: 1, height: 1, pixels: new Uint8Array([128, 128, 128, 255]) }]]))], [128]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph(), 4, 1)], [32, 96, 159, 223]);
});
