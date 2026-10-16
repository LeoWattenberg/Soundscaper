/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2MaskGraphCurrentV1, readPixelFrameWebGl2MaskGraphCurrentV1,
	isPixelFrameWebGl2MaskGraphCurrentV1, writePixelFrameWebGl2MaskPathEdgesCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-graph-current-v1.ts';
import { prepareVideoMaskMatteBrushInputsV1 } from '../src/common/editor/imaging/image-develop-brush-mask-v1.ts';
import { withLinearMaskCoverageV1 } from '../src/common/editor/imaging/pixel-frame-linear-mask-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { withMaskRasterSourceScopeV1 } from '../src/common/editor/imaging/mask-raster-source-scope-v1.ts';
import type { ImageDevelopMaskBindingPlanV1 } from '../src/common/editor/imaging/image-develop-mask-plan-v1.ts';
import type { LinearKernelDescriptorV1 } from '../src/common/editor/imaging/linear-kernel-descriptor-v1.ts';
import { videoMaskMatteWorkingBytesV1 } from '../src/common/editor/video-mask-matte-v24.ts';

const descriptor = (width: number, height = 1): LinearKernelDescriptorV1 => ({ schemaVersion: 1, width, height,
	sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
const gradient = (id = 'a') => ({ id, kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
const graph = (nodes: readonly unknown[], outputNodeId = 'a', inputs: readonly unknown[] = []) => ({
	schemaVersion: 1, id: 'mask', kind: 'mask', inputs, nodes, outputNodeId,
});
function binding(value: unknown, width: number, height: number): Readonly<ImageDevelopMaskBindingPlanV1> {
	const prepared = prepareVideoMaskMatteBrushInputsV1(value, width, height);
	return Object.freeze({ effectId: 'tone', maskId: 'mask', width, height, graph: prepared.graph,
		workingBytes: videoMaskMatteWorkingBytesV1(prepared.graph, width, height), suffixGeometry: Object.freeze([]) });
}
async function cpu(value: unknown, width: number, height = 1, values?: readonly number[]): Promise<number[]> {
	const pixels = values === undefined ? new Float32Array(width * height * 4).fill(1) : Float32Array.from(values);
	try { return await withLinearMaskCoverageV1(binding(value, width, height), { descriptor: descriptor(width, height), pixels }, coverage => [...coverage]); }
	finally { pixels.fill(0); }
}
async function withBrush<Result>(width: number, height: number, alpha: readonly number[], run: (key: string, bytes: Uint8Array<ArrayBuffer>) => Promise<Result>): Promise<Result> {
	return withPreparedBrushMaskResourceV1({ width, height, alpha: Uint8Array.from(alpha) }, prepared => run(prepared.reference.storageKey, prepared.bytes));
}
async function brushCpu(key: string, bytes: Uint8Array<ArrayBuffer>, width: number, height: number, radius: number): Promise<number[]> {
	const nodes: unknown[] = [{ id: 'a', kind: 'alpha', inputName: 'Brush' }];
	if (radius >= 0) nodes.push({ id: 'f', kind: 'feather', inputNodeId: 'a', radius });
	const value = graph(nodes, radius < 0 ? 'a' : 'f', [{ name: 'Brush', kind: 'alpha', sourceRef: key }]);
	const prepared = prepareVideoMaskMatteBrushInputsV1(value, width, height), pixels = new Float32Array(width * height * 4).fill(1);
	try {
		return await withMaskRasterSourceScopeV1(prepared.references, prepared.retainedStorageKeys, {
			withBytes(_reference, consume) { return Promise.resolve(consume(bytes)); },
		}, scope => withLinearMaskCoverageV1(binding(value, width, height), { descriptor: descriptor(width, height), pixels }, coverage => [...coverage], undefined, scope));
	} finally { pixels.fill(0); }
}

/** Independent rational oracle: direct integer box sums in both directions,
 * unlike CPU sliding Float64 means. This is an equivalence regression,
 * not proof that a browser exposes integer attachment/readback capability. */
function integerFeather(source: readonly number[], width: number, height: number, radius: number): number[] {
	const r = Math.ceil(radius), side = r * 2 + 1, horizontal: number[] = [], result: number[] = [];
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		let sum = 0; for (let dx = -r; dx <= r; dx++) sum += source[y * width + Math.max(0, Math.min(width - 1, x + dx))]!;
		horizontal.push(sum);
	}
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		let sum = 0; for (let dy = -r; dy <= r; dy++) sum += horizontal[Math.max(0, Math.min(height - 1, y + dy)) * width + x]!;
		result.push(Math.floor((sum + Math.floor(side * side / 2)) / (side * side)));
	}
	return result;
}

test('mask graph captures closed CPU computation and private identity without reading forged properties', () => {
	const authored = graph([gradient()]), prepared = preparePixelFrameWebGl2MaskGraphCurrentV1(authored, descriptor(4));
	authored.nodes = [gradient('replacement')];
	assert.equal(prepared.steps[0]!.nodeId, 'a'); assert.ok(Object.isFrozen(prepared.steps[0]!.uniforms.params0));
	assert.equal(readPixelFrameWebGl2MaskGraphCurrentV1(prepared), prepared);
	assert.throws(() => readPixelFrameWebGl2MaskGraphCurrentV1({ ...prepared }), TypeError);
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	assert.equal(isPixelFrameWebGl2MaskGraphCurrentV1(revoked.proxy), false);
	assert.throws(() => readPixelFrameWebGl2MaskGraphCurrentV1(revoked.proxy), TypeError);
	const hostile = { ...gradient('dead'), get start(): never { return assert.fail('Accessor must not execute.'); } };
	assert.throws(() => preparePixelFrameWebGl2MaskGraphCurrentV1(graph([gradient(), hostile]), descriptor(4)), TypeError);
});

test('mask graph retains every declaration but allocates only reachable coverage with no attachment feedback', () => {
	const key = `brush-mask-v1:1:1:${'0'.repeat(64)}`;
	const value = graph([gradient(), { id: 'b', kind: 'invert', inputNodeId: 'a' },
		{ id: 'c', kind: 'boolean', operation: 'subtract', inputNodeIds: ['a', 'b'] },
		{ id: 'dead', kind: 'alpha', inputName: 'Unused' }], 'c', [{ name: 'Unused', kind: 'alpha', sourceRef: key }]);
	const prepared = preparePixelFrameWebGl2MaskGraphCurrentV1(value, descriptor(4));
	assert.equal(prepared.references.length, 1); assert.deepEqual(prepared.retainedStorageKeys, []);
	assert.deepEqual(prepared.steps.map(step => step.nodeId), ['a', 'b', 'c']);
	for (const step of prepared.steps) assert.ok(!step.operands.includes(step.destination), 'A sampled attachment must not be its draw target.');
	assert.ok(!prepared.steps[1]!.release.includes(prepared.steps[0]!.destination), 'Shared a must survive until the subtract node.');
	assert.ok(prepared.steps[2]!.release.includes(prepared.steps[0]!.destination));
});

test('gradient radial ordered boolean and fractional feather literals retain byte authority', async () => {
	assert.deepEqual(await cpu(graph([gradient()]), 4), [32, 96, 159, 223]);
	assert.deepEqual(await cpu(graph([{ id: 'a', kind: 'radial-gradient', center: { x: .5, y: .5 }, radius: { x: .5, y: .5 }, innerFraction: 0 }]), 5), [51, 153, 255, 153, 51]);
	const nodes = [gradient(), { id: 'b', kind: 'invert', inputNodeId: 'a' }];
	assert.deepEqual(await cpu(graph([...nodes, { id: 'c', kind: 'boolean', operation: 'subtract', inputNodeIds: ['a', 'b'] }], 'c'), 4), [32, 96, 159, 223]);
	assert.deepEqual(await cpu(graph([...nodes, { id: 'c', kind: 'boolean', operation: 'xor', inputNodeIds: ['a', 'b'] }], 'c'), 4), [191, 63, 63, 191]);
	await withBrush(3, 1, [0, 0, 255], async (key, bytes) => {
		assert.deepEqual(await brushCpu(key, bytes, 3, 1, 0), [0, 0, 255]);
		assert.deepEqual(await brushCpu(key, bytes, 3, 1, .01), [0, 85, 170]);
	});
});

test('native incoming luminance and color ranges distinguish sub-byte samples and transparent centers', async () => {
	const values = [.18, .18, .18, 1, .1801, .1801, .1801, 1, 4, -1, .25, 0];
	assert.deepEqual(await cpu(graph([{ id: 'a', kind: 'luminance-range', lower: .18005, upper: .1802, falloff: 0 }]), 3, 1, values), [0, 255, 0]);
	assert.deepEqual(await cpu(graph([{ id: 'a', kind: 'color-range', color: { r: 0, g: 0, b: 0 }, radius: .00002, falloff: 0 }]), 3, 1,
		[.00001, .00001, .00001, 1, .0001, .0001, .0001, 1, .00001, .00001, .00001, 0]), [255, 0, 0]);
});

test('brush source uses installed alpha and exact top-left-nearest 4-to-3 sampling', async () => {
	await withBrush(4, 1, [0, 64, 192, 255], async (key, bytes) => {
		assert.deepEqual(await brushCpu(key, bytes, 3, 1, -1), [0, 64, 192]);
		const prepared = preparePixelFrameWebGl2MaskGraphCurrentV1(graph([{ id: 'a', kind: 'alpha', inputName: 'Brush' }], 'a', [{ name: 'Brush', kind: 'alpha', sourceRef: key }]), descriptor(3));
		assert.equal(prepared.steps[0]!.brushStorageKey, key); assert.equal(prepared.brushTextureBytes, 4);
	});
});

test('all radii through64 preserve replicated-border rational feather bytes against actual CPU means', async () => {
	for (const [width, height] of [[1, 9], [13, 3]] as const) {
		const alpha = Array.from({ length: width * height }, (_, index) => (index * 97 + index * index * 11) % 256);
		await withBrush(width, height, alpha, async (key, bytes) => {
			for (let radius = 0; radius <= 64; radius++) assert.deepEqual(await brushCpu(key, bytes, width, height, radius), integerFeather(alpha, width, height, radius), `radius ${radius} at ${width}×${height}`);
		});
	}
});

test('path upload preserves CPU last-to-first open edges and ignores admitted handles', () => {
	const points = [{ position: { x: 0, y: 0 }, inHandle: { x: -4, y: 9 }, outHandle: null },
		{ position: { x: 1, y: 0 }, inHandle: null, outHandle: { x: 99, y: -10 } }];
	const prepared = preparePixelFrameWebGl2MaskGraphCurrentV1(graph([{ id: 'a', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'path', closed: false, points }] }]), descriptor(3));
	points[0]!.position.x = 40;
	const bank = new Float32Array(1024);
	assert.equal(writePixelFrameWebGl2MaskPathEdgesCurrentV1(prepared, 0, 0, bank), 2);
	assert.deepEqual([...bank.subarray(0, 8)], [0, 0, 1, 0, 1, 0, 0, 0]);
	assert.ok(bank.subarray(8).every(value => value === 0)); assert.equal(prepared.integerScratchTextureCount, 1);
	assert.throws(() => writePixelFrameWebGl2MaskPathEdgesCurrentV1(prepared, 0, 0, new Float32Array(2048).subarray(0, 1024)), RangeError);
});

test('valid CPU tiny controls select unsupported GPU metadata without changing the graph', async () => {
	const value = graph([{ id: 'a', kind: 'radial-gradient', center: { x: .5, y: .5 }, radius: { x: Number.MIN_VALUE, y: Number.MIN_VALUE }, innerFraction: 0 }]);
	const prepared = preparePixelFrameWebGl2MaskGraphCurrentV1(value, descriptor(1));
	assert.equal(prepared.supported, false); assert.equal(prepared.eligible, false);
	assert.deepEqual(await cpu(value, 1), [255]);
});

test('GPU graph storage does not widen the64MiB component or require image allocation for capacity decisions', () => {
	const value = graph([gradient(), { id: 'f', kind: 'feather', inputNodeId: 'a', radius: 64 }], 'f');
	const prepared = preparePixelFrameWebGl2MaskGraphCurrentV1(value, descriptor(2048, 2048));
	assert.ok(prepared.cpuComponentBytes < 64 * 1024 * 1024);
	assert.ok(prepared.minimumMaskComponentBytes > 64 * 1024 * 1024);
	assert.equal(prepared.eligible, false); assert.equal(prepared.integerScratchBytes, 2048 * 2048 * 4);
});

test('no invented opacity or combine graph wire is admitted; brush opacity is already encoded alpha', () => {
	assert.throws(() => preparePixelFrameWebGl2MaskGraphCurrentV1(graph([{ id: 'a', kind: 'opacity', inputNodeId: 'b' }]), descriptor(1)), RangeError);
	assert.throws(() => preparePixelFrameWebGl2MaskGraphCurrentV1(graph([{ id: 'a', kind: 'combine', inputNodeIds: ['b', 'c'] }]), descriptor(1)), RangeError);
	assert.throws(() => preparePixelFrameWebGl2MaskGraphCurrentV1(graph([{ ...gradient(), opacity: .5 }]), descriptor(1)), TypeError);
});

test('unreachable brush declarations still authenticate and a corrupt body never reaches graph execution', async () => {
	await withBrush(1, 1, [128], async (key, bytes) => {
		const value = graph([gradient(), { id: 'dead', kind: 'alpha', inputName: 'Dead' }], 'a', [{ name: 'Dead', kind: 'alpha', sourceRef: key }]);
		const plan = preparePixelFrameWebGl2MaskGraphCurrentV1(value, descriptor(1));
		assert.deepEqual(plan.retainedStorageKeys, []); assert.equal(plan.references.length, 1);
		const corrupted = bytes.slice(); corrupted[16] = 127;
		let reads = 0, executed = false;
		try {
			await assert.rejects(withMaskRasterSourceScopeV1(plan.references, new Set(plan.retainedStorageKeys), {
				withBytes(_reference, consume) { reads++; return Promise.resolve(consume(corrupted)); },
			}, () => { executed = true; }), /SHA256/u);
			assert.equal(reads, 1); assert.equal(executed, false);
		} finally { corrupted.fill(0); }
	});
});

test('shape boundaries and every ordered boolean operation have independent byte literals', async () => {
	const shape = (x: number, width: number, kind = 'rectangle') => graph([{ id: 'a', kind: 'vector-shape', shape: kind, x, y: 0, width, height: 1 }]);
	assert.deepEqual(await cpu(shape(.5, .5), 1), [255]);
	assert.deepEqual(await cpu(shape(0, .5), 1), [0]);
	assert.deepEqual(await cpu(shape(-.5, 1, 'ellipse'), 1), [255]);
	const nodes = [gradient(), { id: 'b', kind: 'invert', inputNodeId: 'a' }];
	for (const [operation, expected] of [['union', [223, 159, 159, 223]], ['intersect', [32, 96, 96, 32]]] as const) {
		assert.deepEqual(await cpu(graph([...nodes, { id: 'c', kind: 'boolean', operation, inputNodeIds: ['a', 'b'] }], 'c'), 4), expected);
	}
});

test('actual CPU path authority sums signed winding across paths and closes admitted open paths', async () => {
	const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
	const path = (id: string, reverse = false) => ({ id, closed: false,
		points: (reverse ? [...square].reverse() : square).map(position => ({ position, inHandle: null, outHandle: null })) });
	const node = (fillRule: string, reverse = false) => graph([{ id: 'a', kind: 'vector-path', fillRule, paths: [path('first'), path('second', reverse)] }]);
	assert.deepEqual(await cpu(node('nonzero'), 2), [255, 255]);
	assert.deepEqual(await cpu(node('even-odd'), 2), [0, 0]);
	assert.deepEqual(await cpu(node('nonzero', true), 2), [0, 0]);
});
