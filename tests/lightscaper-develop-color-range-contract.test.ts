/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoMaskMatteGraphV1, videoMaskMatteWorkingBytesV1 } from '../src/common/editor/video-mask-matte-v24.ts';
import { evaluateVideoMaskMatteRgbaV13, withVideoMaskMatteRgbaV1 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { assertDeepFrozen } from './helpers/frozen-contract-assertions.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { gradientGraph, rectangleGraph, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

const PIXELS = [0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
	255, 255, 255, 255, 128, 128, 128, 255, 188, 0, 0, 255, 255, 0, 0, 128, 255, 0, 0, 0];
const EXPECTED = [108, 255, 47, 47, 47, 131, 182, 255, 0];
function range(radius = 0, falloff = 1, color = { r: 1, g: 0, b: 0 }) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'color', kind: 'color-range', color, radius, falloff }], outputNodeId: 'color' };
}
function evaluate(graph: unknown, pixels: readonly number[] = PIXELS, transfer: 'srgb' | 'linear' = 'srgb') {
	const frame = rgbaFrame(pixels);
	return evaluateVideoMaskMatteRgbaV13(graph, pixels.length / 4, 1, new Map(), { ...frame, descriptor: { ...frame.descriptor, transfer } });
}

test('color range admits and detaches a frozen closed encoded-sRGB target and scalar ramp', () => {
	const input = range(), saved = normalizeVideoMaskMatteGraphV1(input);
	assert.deepEqual(saved, input); assertDeepFrozen(saved); assert.deepEqual(saved.inputs, []);
	input.nodes[0]!.color.r = 0; input.nodes[0]!.radius = 1; input.nodes[0]!.falloff = 0;
	assert.deepEqual(saved.nodes, [{ id: 'color', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 1 }]);
	assert.deepEqual(normalizeVideoMaskMatteGraphV1(saved), saved);
});

test('normalized linear RGB distance has independent sRGB and linear goldens with one alpha admission', () => {
	// Independent IEC sRGB scalar calculation: sqrt(sum of squared linear
	// channel distances / 3), then one nearest-integer coverage rounding.
	assert.deepEqual([...evaluate(range())], EXPECTED);
	assert.deepEqual([...evaluate(range(), PIXELS, 'linear')], [108, 255, 47, 47, 47, 127, 216, 255, 0]);
	assert.deepEqual([...evaluate(range(0, 1, { r: 0, g: 0, b: 0 }), [128, 128, 128, 255])], [200]);
	assert.deepEqual([...evaluate(range(0, 1, { r: 0, g: 0, b: 0 }), [128, 128, 128, 255], 'linear')], [127]);
	assert.deepEqual([...evaluate(range(0, 0))], [0, 255, 0, 0, 0, 0, 0, 255, 0]);
	assert.deepEqual([...evaluate(range(1, 0))], [255, 255, 255, 255, 255, 255, 255, 255, 0]);
	assert.deepEqual([...evaluate(range(0, 0, { r: 128 / 255, g: 128 / 255, b: 128 / 255 }), [128, 128, 128, 255])], [255]);
});

test('color coverage preserves inversion and boolean semantics, while mixed ranges share one captured frame budget', () => {
	const node = range().nodes[0]!, inverse = { id: 'inverse', kind: 'invert', inputNodeId: 'color' };
	const graph = (nodes: readonly unknown[], outputNodeId: string) => ({ ...range(), nodes, outputNodeId });
	assert.deepEqual([...evaluate(graph([node, inverse], 'inverse'))], [147, 0, 208, 208, 208, 124, 73, 0, 255]);
	const mixed = normalizeVideoMaskMatteGraphV1(graph([node,
		{ id: 'luma', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 },
		{ id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['color', 'luma'] }], 'both'));
	assert.deepEqual([...evaluate(mixed)], [0, 223, 0, 47, 0, 131, 182, 223, 0]);
	assert.equal(videoMaskMatteWorkingBytesV1(mixed, 4096, 2048), 58_720_256);
	assert.throws(() => videoMaskMatteWorkingBytesV1(mixed, 4096, 4096), /64 MiB|working.*budget/iu);
});

test('closed color scalars require canonical finite fractions and reject nested accessors without getter execution', () => {
	let getters = 0;
	for (const key of ['radius', 'falloff']) for (const value of [-0, -0.1, 1.1, NaN, Infinity, '0.1', null, undefined]) {
		const input = range(); Object.assign(input.nodes[0]!, { [key]: value }); assert.throws(() => normalizeVideoMaskMatteGraphV1(input));
	}
	for (const key of ['r', 'g', 'b']) for (const value of [-0, -0.1, 1.1, NaN, Infinity, '0.1', null, undefined]) {
		const input = range(); Object.assign(input.nodes[0]!.color, { [key]: value }); assert.throws(() => normalizeVideoMaskMatteGraphV1(input));
	}
	for (const mutate of [
		(input: ReturnType<typeof range>) => Object.assign(input.nodes[0]!, { future: true }),
		(input: ReturnType<typeof range>) => Object.assign(input.nodes[0]!.color, { alpha: 1 }),
		(input: ReturnType<typeof range>) => Reflect.deleteProperty(input.nodes[0]!, 'radius'),
		(input: ReturnType<typeof range>) => Reflect.deleteProperty(input.nodes[0]!.color, 'b'),
		(input: ReturnType<typeof range>) => Object.defineProperty(input.nodes[0]!, 'color', { enumerable: true, get() { getters++; return { r: 1, g: 0, b: 0 }; } }),
		(input: ReturnType<typeof range>) => Object.defineProperty(input.nodes[0]!.color, 'r', { enumerable: true, get() { getters++; return 1; } }),
		(input: ReturnType<typeof range>) => { input.nodes[0]!.color = Object.create(input.nodes[0]!.color) as typeof input.nodes[number]['color']; },
	]) { const input = range(); mutate(input); assert.throws(() => normalizeVideoMaskMatteGraphV1(input)); }
	assert.equal(getters, 0); assert.deepEqual(normalizeVideoMaskMatteGraphV1(range(1, 1)), range(1, 1));
});

test('reachable color requires exact authoritative pixels, while an unreachable color node requires no frame', async () => {
	await assert.rejects(withVideoMaskMatteRgbaV1({ graph: range(), width: 9, height: 1 }, () => {}), /current|frame|pixel/iu);
	const frame = rgbaFrame(PIXELS);
	for (const patch of [{ width: 8 }, { height: 2 }, { sampleFormat: 'float32' }, { primaries: 'display-p3' }, { transfer: 'pq' }]) {
		await assert.rejects(withVideoMaskMatteRgbaV1({ graph: range(), width: 9, height: 1, currentFrame: { ...frame, descriptor: { ...frame.descriptor, ...patch } } }, () => {}));
	}
	let reflections = 0;
	const unread = new Proxy({}, { ownKeys() { reflections++; throw Error('Unreachable color inspected frame authority'); } });
	const rectangle = rectangleGraph(), graph = { ...rectangle, nodes: [...rectangle.nodes, range().nodes[0]!] };
	assert.deepEqual(await withVideoMaskMatteRgbaV1({ graph, width: 4, height: 1, currentFrame: unread }, coverage => [...coverage]), [0, 0, 255, 255]);
	assert.equal(reflections, 0);
});

test('color source capture rejects accessor, shared and wrong-span bodies before delivery', async () => {
	let getters = 0, delivered = 0;
	const frame = rgbaFrame(PIXELS), accessor = Object.defineProperty({ ...frame }, 'pixels', { enumerable: true, get() { getters++; return frame.pixels; } });
	for (const currentFrame of [accessor, { ...frame, pixels: frame.pixels.subarray(1) },
		{ ...frame, pixels: new Uint8Array(new SharedArrayBuffer(frame.pixels.byteLength)) }]) {
		await assert.rejects(withVideoMaskMatteRgbaV1({ graph: range(), width: 9, height: 1, currentFrame }, () => { delivered++; }));
	}
	assert.equal(getters, 0); assert.equal(delivered, 0);
});

test('color target and bytes are captured before yielding and held coverage joins exact opaque cancellation', async () => {
	const width = 65_536, pixels = new Uint8Array(width * 2 * 4);
	for (let index = 0; index < pixels.length; index += 4) { pixels[index] = 255; pixels[index + 3] = 128; }
	const frame = { descriptor: { schemaVersion: 1, width, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
	const graph = range(0, 0), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy; let borrowed: Uint8Array | undefined;
	const work = withVideoMaskMatteRgbaV1({ graph, width, height: 2, currentFrame: frame, signal: stop.signal }, async coverage => {
		borrowed = coverage; assert.equal(coverage.every(value => value === 255), true); entered.resolve(); await release.promise;
	});
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	graph.nodes[0]!.color.r = 0; graph.nodes[0]!.radius = 1; pixels.fill(0);
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); assert.equal(borrowed?.every(value => value === 255), true); }
	finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(borrowed?.every(byte => byte === 0)); assert.equal(pixels.every(byte => byte === 0), true);
});

test('color capture budget refuses before pixel reflection and old encoded raster/gradient bytes remain exact', async () => {
	let inspected = 0, delivered = 0;
	const pixels = new Proxy({}, { ownKeys() { inspected++; throw Error('Unaffordable color pixels acquired'); } });
	const descriptor = { ...rgbaFrame().descriptor, width: 4096, height: 4096 };
	await assert.rejects(withVideoMaskMatteRgbaV1({ graph: range(), width: 4096, height: 4096, currentFrame: { descriptor, pixels } }, () => { delivered++; }), /64 MiB|working.*budget/iu);
	assert.equal(inspected, 0); assert.equal(delivered, 0);
	const raster = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'Body', sourceRef: 'body', kind: 'raster' }],
		nodes: [{ id: 'raster', kind: 'raster', inputName: 'Body', channel: 'luma' }], outputNodeId: 'raster' };
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(raster, 1, 1, new Map([['body', { width: 1, height: 1, pixels: new Uint8Array([128, 128, 128, 255]) }]]))], [128]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(gradientGraph(), 4, 1)], [32, 96, 159, 223]);
});

test('generated color samples preserve byte bounds, radius/falloff monotonicity and alpha-independent membership', () => {
	let seed = 0x51cab1e;
	const byte = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed >>> 24; };
	for (let sample = 0; sample < 64; sample++) {
		const target = [byte(), byte(), byte()] as const, rgb = [byte(), byte(), byte()] as const;
		const color = { r: target[0] / 255, g: target[1] / 255, b: target[2] / 255 };
		assert.deepEqual([...evaluate(range(0, 0, color), [...target, 255, ...target, 128, ...target, 0])], [255, 255, 0]);
		for (const transfer of ['srgb', 'linear'] as const) {
			const pixels = [...rgb, 255, ...rgb, 128, ...rgb, 0];
			for (const axis of ['radius', 'falloff'] as const) {
				let previous = -1;
				for (const amount of [0, 0.125, 0.5, 1]) {
					const coverage = evaluate(range(axis === 'radius' ? amount : 0, axis === 'falloff' ? amount : 0.125, color), pixels, transfer);
					assert.equal(coverage.length, 3); assert.ok(coverage.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
					assert.equal(coverage[0], coverage[1]); assert.equal(coverage[2], 0);
					assert.ok(coverage[0]! >= previous, `${sample}/${transfer}/${axis}/${amount}`); previous = coverage[0]!;
				}
			}
		}
	}
});
