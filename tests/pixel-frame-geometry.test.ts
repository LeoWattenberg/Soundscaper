/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withGeometryPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-geometry-v1.ts';

const LIMITS = { maximumSidePixels: 1024, maximumPixels: 1024 * 1024, maximumBytes: 4 * 1024 * 1024 };
const geometry = () => ({ schemaVersion: 1 as const, crop: null, rotationDegrees: 0,
	flipHorizontal: false, flipVertical: false, perspective: null });
const frame = (width: number, height: number, pixels: Uint8Array) => ({ descriptor: {
	schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels });
const rgba = (...ids: number[]) => Uint8Array.from(ids.flatMap(id => [id, id + 10, id + 20, 255]));
async function render(source: unknown, recipe: unknown = geometry()) {
	return withGeometryPixelFrameV1({ frame: source, geometry: recipe }, result => ({ descriptor: result.descriptor, pixels: result.pixels.slice() }), { limits: LIMITS });
}

test('actual native RGBA crop produces a smaller output and leaves every source byte unchanged', async () => {
	const source = frame(4, 2, rgba(1, 2, 3, 4, 5, 6, 7, 8)), before = source.pixels.slice();
	const output = await render(source, { ...geometry(), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } });
	assert.equal(output.descriptor.width, 2); assert.equal(output.descriptor.height, 2);
	assert.deepEqual(output.pixels, rgba(2, 3, 6, 7)); assert.deepEqual(source.pixels, before);
});

test('clockwise quarter-turn goldens and final-output flips retain their explicit operation order', async () => {
	const source = frame(2, 2, rgba(1, 2, 3, 4));
	for (const [recipe, expected] of [
		[{ ...geometry(), rotationDegrees: 90 }, rgba(3, 1, 4, 2)],
		[{ ...geometry(), rotationDegrees: -90 }, rgba(2, 4, 1, 3)],
		[{ ...geometry(), rotationDegrees: 180 }, rgba(4, 3, 2, 1)],
		[{ ...geometry(), rotationDegrees: 90, flipHorizontal: true }, rgba(1, 3, 2, 4)],
		[{ ...geometry(), rotationDegrees: 90, flipVertical: true }, rgba(4, 2, 3, 1)],
	] as const) assert.deepEqual((await render(source, recipe)).pixels, expected);
});

test('bilinear sampling uses premultiplied alpha so hidden RGB cannot bleed into visible samples', async () => {
	const source = frame(2, 1, new Uint8Array([255, 0, 0, 0, 0, 0, 255, 255]));
	const output = await render(source, { ...geometry(), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } });
	assert.deepEqual(Array.from(output.pixels), [0, 0, 255, 128]);
	assert.deepEqual(Array.from(source.pixels), [255, 0, 0, 0, 0, 0, 255, 255]);
});

test('a non-affine source trapezoid rectifies through the native byte renderer with a fixed independent golden', async () => {
	const source = frame(2, 2, rgba(0, 100, 50, 150)), before = source.pixels.slice();
	const perspective = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
		bottomRight: { x: 0.75, y: 1 }, bottomLeft: { x: 0.25, y: 1 } };
	const output = await render(source, { ...geometry(), perspective });
	// Unit inverse is ((u + v/2)/(1+v), 2v/(1+v)); centers yield these rounded bilinear samples.
	assert.deepEqual(output.pixels, rgba(25, 105, 71, 129));
	assert.equal(output.descriptor.width, 2); assert.equal(output.descriptor.height, 2);
	assert.deepEqual(source.pixels, before);
});

test('straightening has transparent bounding corners and deterministic visible center interpolation', async () => {
	const source = frame(2, 2, rgba(1, 2, 3, 4)), output = await render(source, { ...geometry(), rotationDegrees: 45 });
	assert.equal(output.descriptor.width, 3); assert.equal(output.descriptor.height, 3);
	assert.deepEqual(Array.from(output.pixels.subarray(0, 4)), [0, 0, 0, 0]);
	assert.deepEqual(Array.from(output.pixels.subarray(16, 20)), [3, 13, 23, 255]);
	assert.deepEqual((await render(source, { ...geometry(), rotationDegrees: 45 })).pixels, output.pixels);
});

test('callback owns no retained output and every owned byte is wiped on success and failure', async () => {
	let borrowed: Uint8Array | undefined;
	await withGeometryPixelFrameV1({ frame: frame(1, 1, rgba(1)), geometry: geometry() }, output => {
		borrowed = output.pixels; assert.deepEqual(output.pixels, rgba(1));
	}, { limits: LIMITS });
	assert.deepEqual(borrowed, new Uint8Array(4));
	const failure = new Error('consumer failed');
	await assert.rejects(withGeometryPixelFrameV1({ frame: frame(1, 1, rgba(1)), geometry: geometry() }, output => {
		borrowed = output.pixels; throw failure;
	}, { limits: LIMITS }), error => error === failure);
	assert.deepEqual(borrowed, new Uint8Array(4));
});

test('intrinsic clamped samples and a nonzero source offset retain exact geometry without touching padding', async () => {
	const raw = new Uint8ClampedArray([17, 31, 41, 51, 127, 29]);
	const source = { ...frame(1, 1, rgba(1)), pixels: raw.subarray(1, 5) };
	assert.deepEqual(Array.from((await render(source)).pixels), [31, 41, 51, 127]);
	assert.deepEqual(Array.from(raw), [17, 31, 41, 51, 127, 29]);
});

test('pre-cancellation preserves an opaque reason before reflecting on source or geometry', async () => {
	const stop = new AbortController(); let probes = 0;
	const hostile = new Proxy({}, { get() { probes++; throw new Error('get'); }, getOwnPropertyDescriptor() { probes++; throw new Error('descriptor'); },
		getPrototypeOf() { probes++; throw new Error('prototype'); } });
	stop.abort(hostile); Object.defineProperty(stop.signal, 'throwIfAborted', { get() { probes++; throw new Error('override'); } });
	const observed = await withGeometryPixelFrameV1({ frame: hostile, geometry: hostile, signal: stop.signal }, () => null, { limits: LIMITS })
		.then(() => ({ reason: undefined as unknown }), error => ({ reason: error as unknown }));
	assert.equal(observed.reason === hostile, true); assert.equal(probes, 0);
});

test('actual task cancellation and source transfer refuse incomplete output before consumer publication', async () => {
	for (const transfer of [false, true]) {
		const source = frame(512, 512, new Uint8Array(512 * 512 * 4).fill(128)), stop = new AbortController(), reason = 17;
		let consumed = false;
		const timer = setTimeout(() => { if (transfer) structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] }); else stop.abort(reason); }, 0);
		try { await assert.rejects(withGeometryPixelFrameV1({ frame: source, geometry: geometry(), signal: stop.signal }, () => { consumed = true; }, { limits: LIMITS }),
			error => transfer ? error instanceof RangeError && /detached/u.test(error.message) : error === reason); }
		finally { clearTimeout(timer); }
		assert.equal(consumed, false);
	}
});

test('held consumer cancellation joins the callback and clears output before rejection', async () => {
	const stop = new AbortController(); let release: (() => void) | undefined, borrowed: Uint8Array | undefined, settled = false;
	const operation = withGeometryPixelFrameV1({ frame: frame(1, 1, rgba(1)), geometry: geometry(), signal: stop.signal }, output => {
		borrowed = output.pixels; return new Promise<void>(resolve => { release = resolve; });
	}, { limits: LIMITS }).finally(() => { settled = true; });
	const rejected = assert.rejects(operation, error => error === 17);
	stop.abort(17); await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(borrowed, rgba(1));
	assert.ok(release); release(); await rejected; assert.deepEqual(borrowed, new Uint8Array(4));
});

test('output geometry and profile budgets refuse before requesting a consumer', async () => {
	let consumed = false;
	await assert.rejects(withGeometryPixelFrameV1({ frame: frame(2, 2, rgba(1, 2, 3, 4)), geometry: { ...geometry(), rotationDegrees: 45 } },
		() => { consumed = true; }, { limits: { ...LIMITS, maximumBytes: 16 } }), /byte length/u);
	const source = frame(1, 1, rgba(1));
	await assert.rejects(render({ ...source, descriptor: { ...source.descriptor, transfer: 'linear' } }), /not admitted/u);
	assert.equal(consumed, false);
});

test('singular perspective refuses before source access or pixel allocation', async () => {
	let probes = 0;
	const source = new Proxy({}, { get() { probes++; throw new Error('source read'); },
		getOwnPropertyDescriptor() { probes++; throw new Error('source descriptor'); }, getPrototypeOf() { probes++; throw new Error('source prototype'); } });
	const point = { x: 0, y: 0 }, perspective = { topLeft: point, topRight: point, bottomLeft: point, bottomRight: point };
	await assert.rejects(render(source, { ...geometry(), perspective }), /convex/u); assert.equal(probes, 0);
});
